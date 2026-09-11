import { createHash } from "node:crypto";
import OpenAI from "openai";
import { z } from "zod";
import { EDITORIAL_CURRENCY_NAMES, EDITORIAL_SOURCE_AS_DATA, EDITORIAL_IMPORTANCE, EDITORIAL_ATTRIBUTION, EDITORIAL_NO_MARKET_COMMENTARY, EDITORIAL_TITLE, EDITORIAL_NORWEGIAN, type PromptPayload } from "@newsweb/prompt-kit";
import { rewriteOutputSchema, type RewriteOutput } from "@newsweb/shared";
import { callOpenAIForJson, type OpenAIJsonRequest, type OpenAIJsonResult, type OpenAIReasoningEffort } from "@newsweb/shared/openai-responses";
import { prisma } from "@newsweb/shared/db";
import type { Prisma } from "@prisma/client";
import { hasImportantSourceSignals } from "./importance.js";
import { validateRewriteOutput } from "./rewrite-validation.js";
import { buildReferenceCheckPrompt, referenceCheckJsonSchema, referenceCheckResultSchema, buildCoverageReport, assessReferenceCheckGate } from "./reference-check.js";
export const FAST_DRAFT_PROMPT_VERSION = "fast-draft-1:currency-names-v1";
const MAX_DURATION_MS = 35000;
const shortSchema = z.object({ title: z.string().min(6).max(100), lead: z.string().min(20).max(300), importance: z.enum(["viktig", "medium", "uviktig"]), sourceEvidence: z.string().min(5).max(320) });
const jsonSchema = { type: "object", additionalProperties: false, properties: { title: { type: "string" }, lead: { type: "string" }, importance: { type: "string", enum: ["viktig", "medium", "uviktig"] }, sourceEvidence: { type: "string" } }, required: ["title", "lead", "importance", "sourceEvidence"] };
type Call = (request: OpenAIJsonRequest) => Promise<OpenAIJsonResult>;
// The independent checker sees the exact same frozen primary source as the writer.
export async function generateFastDraft(payload: PromptPayload, model: string, deadline: number, call: Call, onCall: (result: OpenAIJsonResult, request: OpenAIJsonRequest) => void = () => { }, reasoningEffort: OpenAIReasoningEffort = "none") {
    const ask = async (request: Omit<OpenAIJsonRequest, "model" | "reasoningEffort" | "timeoutMs">) => {
        const remaining = deadline - Date.now();
        if (remaining < 1000)
            throw new Error("FAST_DRAFT_DEADLINE");
        // Reasoning shares the output budget; keep the visible schema and deadline unchanged.
        const configuredRequest: OpenAIJsonRequest = { ...request, model, reasoningEffort,
            maxOutputTokens: reasoningEffort === "none" ? request.maxOutputTokens : Math.max(4096, request.maxOutputTokens),
            timeoutMs: Math.min(15000, remaining), promptCacheMode: "off" };
        const result = await call(configuredRequest);
        onCall(result, configuredRequest);
        return result.content;
    };
    const raw = shortSchema.parse(JSON.parse(await ask({
        schemaName: "fast_draft", schema: jsonSchema,
        systemPrompt: "Du er en norsk nyhetsjournalist. Returner kun JSON etter skjemaet.",
        developerPrompt: [EDITORIAL_CURRENCY_NAMES, EDITORIAL_SOURCE_AS_DATA, EDITORIAL_IMPORTANCE, EDITORIAL_TITLE.split("\n- lead:")[0], EDITORIAL_ATTRIBUTION, EDITORIAL_NO_MARKET_COMMENTARY, EDITORIAL_NORWEGIAN,
            "Skriv et kort førsteutkast: én tittel (maks 8 ord) og en ingress på to korte setninger, maks 300 tegn. Ta med hovednyheten og viktigste forbehold. Ingen bakgrunn fra egen kunnskap, sitater, regnestykker eller kurskommentar. Behold hva som er planlagt, anslått eller betinget. sourceEvidence skal være et ordrett sammenhengende utdrag fra kilden. Vurder importance etter de samme strenge reglene; skriv ikke viktig bare fordi meldingen er valgt ut."].join("\n\n"),
        userPrompt: JSON.stringify({ title: payload.title, issuer: payload.issuerName, publishedAt: payload.publishedAt, source: payload.bodyText }), maxOutputTokens: 650
    })));
    if (raw.importance !== "viktig")
        return { status: "skipped" as const, validation: { reason: "importance_below_high_bar" } };
    if (!payload.bodyText.includes(raw.sourceEvidence) && !payload.title.includes(raw.sourceEvidence))
        throw new Error("FAST_DRAFT_EVIDENCE_MISMATCH");
    const rewrite: RewriteOutput = rewriteOutputSchema.parse({ title: raw.title, lead: raw.lead, body: [], company_sentence: "", key_facts: [raw.lead], negative_or_surprising: [], excluded_hype: [], source_limitations: [], confidence: "high", importance: raw.importance, source_spans: [raw.sourceEvidence] });
    const validation = validateRewriteOutput(rewrite, payload, { maxVisibleArticleChars: 420 });
    // Follow the report path: allow a passing source check to resolve number-matcher warnings.
    if (validation.blockingErrors.length)
        throw new Error(`FAST_DRAFT_VALIDATION: ${validation.blockingErrors.join("; ")}`);
    const prompt = buildReferenceCheckPrompt(payload, rewrite);
    const checked = referenceCheckResultSchema.parse(JSON.parse(await ask({ schemaName: "fast_draft_reference_check", schema: referenceCheckJsonSchema as Record<string, unknown>, systemPrompt: prompt.systemPrompt, developerPrompt: prompt.developerPrompt, userPrompt: prompt.userPrompt, maxOutputTokens: 1800 })));
    const coverage = buildCoverageReport(prompt.draftSentences, checked, { visibleArticleSentenceCount: prompt.visibleDraftSentences.length, headSentenceCount: prompt.headDraftSentenceCount, priorContext: prompt.priorContext });
    const gate = assessReferenceCheckGate(coverage);
    if (gate.blocking || coverage.coveragePercent !== 100)
        throw new Error("FAST_DRAFT_REFERENCE_CHECK_FAILED");
    if (Date.now() > deadline)
        throw new Error("FAST_DRAFT_DEADLINE");
    return { status: "ready" as const, rewrite, validation: { coverage, blockingErrors: validation.blockingErrors, warnings: validation.warnings } };
}
export function createFastDraftService(options: {
    enabled: boolean;
    apiKey?: string;
    model: string;
    reasoningEffort?: OpenAIReasoningEffort;
    notify: (messageId: number) => Promise<unknown>;
    log: (message: string) => void;
}) {
    const client = options.apiKey ? new OpenAI({ apiKey: options.apiKey, maxRetries: 0 }) : null;
    const running = new Set<Promise<void>>();
    let closing = false;
    function start(payload: PromptPayload, generationRunId: string, eligible: boolean): void {
        if (!options.enabled || !client || closing || !eligible || running.size >= 2 || !hasImportantSourceSignals(payload) || !payload.bodyText.trim())
            return;
        // No related notices or editor material: this first draft covers the new primary notice only.
        const frozen: PromptPayload = { ...payload, bodyText: payload.bodyText + (payload.pdfSupplementText ? `\n\n${payload.pdfSupplementText}` : ""), pdfSupplementText: undefined, relatedNotices: [], supplementalMaterials: [] };
        const task = run(frozen, generationRunId).catch((error) => options.log(`[fast-draft] messageId=${payload.messageId} failed=${error instanceof Error ? error.message : "unknown"}`));
        running.add(task);
        void task.finally(() => running.delete(task));
    }
    async function run(payload: PromptPayload, generationRunId: string) {
        const startedAt = new Date();
        const deadlineAt = new Date(startedAt.getTime() + MAX_DURATION_MS);
        const sourceHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
        // A unique source id is the cross-process claim. Retries never pay for another first draft.
        const claim = await prisma.fastDraft.createMany({ data: { messageId: payload.messageId, generationRunId, status: "pending", sourceHash, model: options.model, promptVersion: FAST_DRAFT_PROMPT_VERSION, startedAt, deadlineAt }, skipDuplicates: true });
        if (!claim.count)
            return;
        const modelCalls: unknown[] = [];
        let result: Awaited<ReturnType<typeof generateFastDraft>> | undefined;
        let failure: string | undefined;
        try {
            result = await generateFastDraft(payload, options.model, deadlineAt.getTime(), (request) => callOpenAIForJson(client!, request),
                ({ content: _content, ...telemetry }, request) => modelCalls.push({ ...telemetry, model: request.model, schemaName: request.schemaName, reasoningEffort: request.reasoningEffort }),
                options.reasoningEffort);
        }
        catch (error) {
            failure = error instanceof Error ? error.message : "FAST_DRAFT_FAILED";
            if (error && typeof error === "object" && "openAITelemetry" in error)
                modelCalls.push({ ...(error.openAITelemetry as object), model: options.model, reasoningEffort: options.reasoningEffort ?? "none" });
        }
        const status = result?.status ?? "failed";
        await prisma.fastDraft.updateMany({ where: { messageId: payload.messageId, generationRunId, status: "pending" }, data: { status, finishedAt: new Date(), ...(result?.status === "ready" ? { rewriteJson: result.rewrite as Prisma.InputJsonValue } : {}), validationJson: JSON.parse(JSON.stringify(result?.validation ?? { failure })), modelCallsJson: JSON.parse(JSON.stringify(modelCalls)) } });
        options.log(`[fast-draft] messageId=${payload.messageId} status=${status} durationMs=${Date.now() - startedAt.getTime()} calls=${modelCalls.length}`);
        await options.notify(payload.messageId);
    }
    return { start, async drain() { closing = true; await Promise.allSettled([...running]); } };
}

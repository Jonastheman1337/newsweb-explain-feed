import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parse as parseEnv } from "dotenv";
import { parseWorkerConfig } from "../config.js";
import { callOpenAIForJson, createOpenAIClient, getOpenAIErrorTelemetry } from "../services/openai-responses.js";
import {
  NOTICE_NOVELTY_VERSION, NOTICE_NOVELTY_SYSTEM_PROMPT, buildNoveltyAssessmentPrompt,
  buildNoveltyEvidencePack, noveltyAssessmentJsonSchema, observeNoticeNovelty,
  type NoveltyDocument, type NoveltyNotice, type NoticeNoveltyObservation
} from "../services/notice-novelty.js";

type FrozenNotice = Omit<NoveltyNotice, "publishedAt"> & { publishedAt: string };
type FrozenCase = {
  id: string; provenance: string; current: FrozenNotice; priorNotices: FrozenNotice[];
  documents: { noticeId: number; attachmentId: number; document: NoveltyDocument }[];
  expectedDecision: NoticeNoveltyObservation["decision"];
};
const args = process.argv.slice(2);
function argument(name: string): string | undefined { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; }
const casesPath = argument("--cases"), outPath = argument("--out");
if (!casesPath || !outPath) throw new Error("Usage: notice-novelty-eval --cases frozen.json --out NEW_DIRECTORY [--call-model] [--env-file .env]");
const callModel = args.includes("--call-model");
const envFile = argument("--env-file");
const environment = { ...(envFile ? parseEnv(await fs.readFile(envFile)) : {}), ...process.env };
const config = parseWorkerConfig({ ...environment, DATABASE_URL: environment.DATABASE_URL ?? "postgresql://unused:unused@localhost/unused",
  REDIS_URL: environment.REDIS_URL ?? "redis://localhost:6379", OPENAI_API_KEY: callModel ? environment.OPENAI_API_KEY : "sk-offline-unused" });
const fixtureBytes = await fs.readFile(casesPath);
const cases: FrozenCase[] = JSON.parse(fixtureBytes.toString("utf8")).cases;
if (!Array.isArray(cases) || !cases.length || cases.length > 30 || new Set(cases.map(c => c.id)).size !== cases.length ||
    cases.some(c => !/^[a-z0-9_-]+$/.test(c.id))) throw new Error("Expected 1-30 uniquely named frozen cases");
await fs.mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
await fs.mkdir(outPath); // Refuse to replace a prior run, including failed runs.
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const serviceDir = fileURLToPath(new URL("../services/", import.meta.url));
const codeHashes = Object.fromEntries(await Promise.all(["notice-novelty.ts", "notice-novelty-io.ts"].map(async name => [name, hash(await fs.readFile(path.join(serviceDir, name)))])));
const profile = { model: config.OPENAI_FAST_MODEL, reasoningEffort: config.OPENAI_TRIAGE_REASONING_EFFORT,
  serviceTier: config.OPENAI_SERVICE_TIER, timeoutMs: config.OPENAI_FAST_TIMEOUT_MS, maxOutputTokens: 2400,
  promptCacheMode: config.OPENAI_PROMPT_CACHE_MODE_TRIAGE ?? config.OPENAI_PROMPT_CACHE_MODE,
  promptCacheKey: `newsweb:notice-novelty:${NOTICE_NOVELTY_VERSION}` };
await fs.writeFile(path.join(outPath, "manifest.json"), JSON.stringify({ createdAt: new Date().toISOString(), version: NOTICE_NOVELTY_VERSION,
  fixtureSha256: hash(fixtureBytes), codeHashes, profile, callModel, caseIds: cases.map(c => c.id),
  protocol: "Frozen development replay; only original source evidence enters the model. No database writes, article generation or publication." }, null, 2), { flag: "wx" });
const client = callModel ? createOpenAIClient(config.OPENAI_API_KEY) : undefined;
const hydrate = (notice: FrozenNotice): NoveltyNotice => ({ ...notice, publishedAt: new Date(notice.publishedAt) });
const summaries = [];
for (const fixture of cases) {
  const current = hydrate(fixture.current), priors = fixture.priorNotices.map(hydrate);
  const dependencies = {
    listMetadata: async () => ({ items: priors, source: "db" as const }),
    loadNotice: async (metadata: { messageId: number }) => priors.find(p => p.messageId === metadata.messageId) ?? null,
    readDocument: async (notice: NoveltyNotice, attachment: { id: number }) => {
      const found = fixture.documents.find(d => d.noticeId === notice.messageId && d.attachmentId === attachment.id);
      if (!found) throw new Error("Document absent from frozen snapshot");
      return found.document;
    }
  };
  let modelResult: unknown;
  const observation = callModel ? await observeNoticeNovelty(current, { mode: "shadow", dependencies, assess: async (pack, signal) => {
    const scopedClient = { responses: { create: (body: unknown, options?: { signal?: AbortSignal }) => client!.responses.create(body,
      { signal: options?.signal ? AbortSignal.any([signal, options.signal]) : signal }) } };
    try {
      const result = await callOpenAIForJson(scopedClient, { ...profile, schemaName: "notice_novelty_assessment", schema: noveltyAssessmentJsonSchema,
        systemPrompt: NOTICE_NOVELTY_SYSTEM_PROMPT,
        developerPrompt: "Compare original disclosures. Ground every finding in the supplied evidence and return only the structured assessment.",
        userPrompt: buildNoveltyAssessmentPrompt(pack) });
      modelResult = result;
      return result.content;
    } catch (error) { modelResult = { failed: true, telemetry: getOpenAIErrorTelemetry(error) }; throw error; }
  } }) : undefined;
  const preparedPack = !callModel ? await buildNoveltyEvidencePack(current, dependencies, AbortSignal.timeout(45000)) : undefined;
  const actual = callModel ? observation?.decision ?? "not_applicable" : "prepared_only";
  const summary = { id: fixture.id, expected: fixture.expectedDecision, actual, passed: callModel ? actual === fixture.expectedDecision : null,
    reason: observation?.reasonCode, durationMs: observation?.durationMs };
  await fs.writeFile(path.join(outPath, `${fixture.id}.json`), JSON.stringify({ ...summary, provenance: fixture.provenance,
    observation, preparedPack, modelResult }, null, 2), { flag: "wx" });
  summaries.push(summary);
  console.log(JSON.stringify(summary));
}
await fs.writeFile(path.join(outPath, "summary.json"), JSON.stringify(summaries, null, 2), { flag: "wx" });
if (summaries.some(s => s.passed === false)) process.exitCode = 1;

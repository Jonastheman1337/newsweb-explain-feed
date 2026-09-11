import { beforeEach, describe, expect, it, vi } from "vitest";
import { EDITORIAL_CURRENCY_NAMES } from "@newsweb/prompt-kit";
import type { PromptPayload } from "@newsweb/prompt-kit";
import type { OpenAIJsonRequest, OpenAIJsonResult } from "@newsweb/shared/openai-responses";
const db = vi.hoisted(() => ({ createMany: vi.fn(), updateMany: vi.fn() }));
vi.mock("@newsweb/shared/db", () => ({ prisma: { fastDraft: db } }));
import { generateFastDraft, createFastDraftService } from "./fast-draft.js";
const payload: PromptPayload = { messageId: 1, title: "Fjord ASA varsler oppkjøp", issuerName: "Fjord ASA", issuerSign: "FJORD", publishedAt: "2026-09-07T10:00:00Z", categories: [], markets: [], hasAttachments: false, sourceBodyChars: 180, bodyText: "Fjord ASA vil kjøpe Dal AS for 200 millioner kroner. Avtalen krever godkjenning fra Konkurransetilsynet." };
const draft = { title: "Fjord vil kjøpe Dal", lead: payload.bodyText, importance: "viktig", sourceEvidence: payload.bodyText };
function fakeCall(overrides: {
    draft?: object;
    ungrounded?: boolean;
    missing?: boolean;
} = {}) {
    return vi.fn(async (request: OpenAIJsonRequest) => {
        const sentences = request.schemaName === "fast_draft" ? [] : JSON.parse(request.userPrompt.split("SETNINGER SOM SKAL SJEKKES (indeks + tekst):\n")[1]);
        const content = request.schemaName === "fast_draft" ? { ...draft, ...overrides.draft } : { sentences: sentences.slice(overrides.missing ? 1 : 0).map((sentence: {
                index: number;
                sentence: string;
            }) => ({ ...sentence, grounded: !overrides.ungrounded, interpretation: "Dekket av kilden", sourceEvidence: payload.bodyText, source: "primary", priorUses: [] })) };
        return { content: JSON.stringify(content) } as OpenAIJsonResult;
    });
}
beforeEach(() => { vi.clearAllMocks(); db.createMany.mockResolvedValue({ count: 0 }); });
describe("V2 first drafts", () => {
    it("requires a checked headline and lead before publishing", async () => {
        const call = fakeCall();
        const result = await generateFastDraft(payload, "gpt-5.6-luna", Date.now() + 35000, call);
        expect(result.status).toBe("ready");
        expect(result.status === "ready" && result.rewrite.lead).toBe(payload.bodyText);
        expect(call).toHaveBeenCalledTimes(2);
        expect(call.mock.calls[0][0].developerPrompt).toContain(EDITORIAL_CURRENCY_NAMES);
        expect(call.mock.calls[0][0]).toMatchObject({ reasoningEffort: "none", maxOutputTokens: 650 });
    });
    it("uses Sol/medium for both preview and source check with room for reasoning", async () => {
        const call = fakeCall();
        const onCall = vi.fn();
        const result = await generateFastDraft(payload, "gpt-5.6-sol", Date.now() + 35000, call, onCall, "medium");
        expect(result.status).toBe("ready");
        expect(call).toHaveBeenCalledTimes(2);
        for (const [request] of call.mock.calls) {
            expect(request).toMatchObject({ model: "gpt-5.6-sol", reasoningEffort: "medium", maxOutputTokens: 4096, promptCacheMode: "off" });
            expect(request.timeoutMs).toBeLessThanOrEqual(15000);
        }
        expect(onCall.mock.calls.map(([, request]) => request.schemaName)).toEqual(["fast_draft", "fast_draft_reference_check"]);
    });
    it("still rejects an unsupported preview under Sol/medium", async () => {
        await expect(generateFastDraft(payload, "gpt-5.6-sol", Date.now() + 35000, fakeCall({ ungrounded: true }), undefined, "medium")).rejects.toThrow("FAST_DRAFT_REFERENCE_CHECK_FAILED");
    });
    it("leaves number findings as warnings and lets the source checker decide", async () => {
        const call = fakeCall({ ungrounded: true, draft: { lead: "Fjord ASA vil kjøpe Dal AS for 900 millioner kroner. Avtalen er betinget." } });
        await expect(generateFastDraft(payload, "gpt-5.6-luna", Date.now() + 35000, call)).rejects.toThrow("FAST_DRAFT_REFERENCE_CHECK_FAILED");
        expect(call).toHaveBeenCalledTimes(2);
    });
    it.each([{ ungrounded: true }, { missing: true }])("rejects unsupported or missing checker sentences: %o", async (options) => {
        await expect(generateFastDraft(payload, "gpt-5.6-luna", Date.now() + 35000, fakeCall(options))).rejects.toThrow("FAST_DRAFT_REFERENCE_CHECK_FAILED");
    });
    it("skips medium importance and never runs the checker", async () => {
        const call = fakeCall({ draft: { importance: "medium" } });
        expect((await generateFastDraft(payload, "gpt-5.6-luna", Date.now() + 35000, call)).status).toBe("skipped");
        expect(call).toHaveBeenCalledTimes(1);
    });
    it("does not issue a request past its deadline", async () => {
        const call = fakeCall();
        await expect(generateFastDraft(payload, "gpt-5.6-luna", Date.now() - 1, call)).rejects.toThrow("DEADLINE");
        expect(call).not.toHaveBeenCalled();
    });
    it("uses the database claim without waiting in the full pipeline", async () => {
        const service = createFastDraftService({ enabled: true, apiKey: "test", model: "gpt-5.6-luna", notify: vi.fn(), log: vi.fn() });
        expect(service.start(payload, "run", true)).toBeUndefined();
        await service.drain();
        expect(db.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
        expect(db.updateMany).not.toHaveBeenCalled();
    });
    it("does no work for disabled, manual or routine notices", async () => {
        const service = createFastDraftService({ enabled: true, apiKey: "test", model: "gpt-5.6-luna", notify: vi.fn(), log: vi.fn() });
        service.start(payload, "manual", false);
        service.start({ ...payload, title: "General meeting", bodyText: "Routine general meeting announcement." }, "routine", true);
        const off = createFastDraftService({ enabled: false, apiKey: "test", model: "gpt-5.6-luna", notify: vi.fn(), log: vi.fn() });
        off.start(payload, "disabled", true);
        await Promise.all([service.drain(), off.drain()]);
        expect(db.createMany).not.toHaveBeenCalled();
    });
});

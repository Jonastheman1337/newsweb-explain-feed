import { describe, expect, it, vi } from "vitest";
import { noticeArticleChars, noticeLengthBand, type RewriteOutput } from "@newsweb/shared";
import { type PromptPayload, createRevisionUserPrompt } from "@newsweb/prompt-kit";
import { noticeRevisionInstruction, repairNoticeLength } from "./notice-length.js";
import { validateRewriteOutput } from "./rewrite-validation.js";
const payload: PromptPayload = { messageId: 1, title: "Test", issuerName: "Test ASA", issuerSign: "TEST", publishedAt: "2026-09-15T10:00:00Z", categories: [], markets: [], bodyText: "Selskapet har vunnet en kontrakt.", hasAttachments: false, sourceBodyChars: 32 };
const article = (chars: number): RewriteOutput => ({ title: "Redaktørens tittel", lead: "A".repeat(chars), body: [], company_sentence: "", key_facts: ["Kontrakt"], negative_or_surprising: [], excluded_hype: [], source_limitations: [], source_spans: ["Selskapet har vunnet en kontrakt."], confidence: "high", importance: "medium" });
describe("manual notice length", () => {
  it("counts body and paragraph breaks but excludes title and metadata", () => {
    expect(noticeArticleChars({lead: "Lead", body: ["Body", "End"]})).toBe(15);
    expect(noticeLengthBand(1500)).toEqual({min: 1275, max: 1650});
  });
  it("builds a revision of the displayed article without a typed instruction", () => {
    const manual = {...payload, targetVisibleArticleChars: 1500};
    const instruction = noticeRevisionInstruction(manual);
    expect(instruction).toContain("Tilpass den viste teksten");
    const prompt = createRevisionUserPrompt(manual, article(500), instruction!);
    expect(prompt).toContain("Redaktørens tittel");
    expect(prompt).toContain("mellom 1275 og 1650");
    expect(prompt).not.toContain("Prioriter, ikke utvid");
    expect(noticeRevisionInstruction(payload)).toBeUndefined();
  });
  it.each([[200, 475], [900, 500]])("corrects %i characters once, then verifies final bytes", async (before, after) => {
    const events: string[] = [];
    const correct = vi.fn(async (draft: RewriteOutput, instruction: string) => {events.push("correct"); expect(draft.title).toBe("Redaktørens tittel"); expect(instruction).toContain("nødvendige forbehold"); return article(after);});
    const verify = vi.fn(async (draft: RewriteOutput) => {events.push("verify"); expect(noticeArticleChars(draft)).toBe(after); return draft;});
    const result = await repairNoticeLength({rewrite: article(before), target: 500, correct, verify});
    expect(events).toEqual(["correct", "verify"]);
    expect(result.audit).toMatchObject({applied: true, finalChars: after, outcome: "within_target"});
  });
  it("keeps a source-limited shorter result without adding UI text or a repair loop", async () => {
    const correct = vi.fn(async () => ({...article(200), source_limitations: ["Kilden oppgir bare kontraktens navn."]}));
    const verify = vi.fn(async (draft: RewriteOutput) => draft);
    const result = await repairNoticeLength({rewrite: article(200), target: 1500, correct, verify});
    expect(correct).toHaveBeenCalledTimes(1);
    expect(result.rewrite.source_limitations).toEqual(["Kilden oppgir bare kontraktens navn."]);
    expect(result.audit?.outcome).toBe("shorter");
  });
  it("remeasures after factual correction and blocks an overlong final result", async () => {
    const result = await repairNoticeLength({rewrite: article(200), target: 500, correct: async () => article(500), verify: async () => article(600)});
    expect(result.audit?.finalChars).toBe(600);
    const validation = validateRewriteOutput(result.rewrite, {...payload, targetVisibleArticleChars: 500});
    expect(validation.issues).toContainEqual(expect.objectContaining({code: "VISIBLE_ARTICLE_TOO_LONG", severity: "blocking"}));
  });
  it("does not reuse a check when final verification fails", async () => {
    await expect(repairNoticeLength({rewrite: article(200), target: 500, correct: async () => article(500), verify: async () => {throw Error("checker unavailable");}})).rejects.toThrow("checker unavailable");
  });
  it.each([undefined, 500])("makes no extra calls for automatic or already fitting articles (%s)", async (target) => {
    const correct = vi.fn(), verify = vi.fn();
    await repairNoticeLength({rewrite: article(500), target, correct, verify});
    expect(correct).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled();
  });
});

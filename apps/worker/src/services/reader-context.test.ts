import { describe, expect, it, vi } from "vitest";
import type { PromptPayload, RelatedNoticePayload } from "@newsweb/prompt-kit";
import type { NoticeJsonCaller } from "./notice-model-client.js";
import { createContextStore, deduplicateContext, eligibleContext, retrieveReaderContext, type ContextStore } from "./reader-context.js";
import type { RelatedNoticeCandidate } from "./related-notices.js";

const current: PromptPayload = { messageId: 100, title: "Accepts offer", issuerName: "Example", issuerSign: "EX", publishedAt: "2026-09-17T07:00:00Z", bodyText: "The shareholder accepted the offer.", sourceBodyChars: 35, categories: [], markets: [], hasAttachments: false };
const row = (id: number, body = "Offer identity\n\nThe board recommends it.\n\nAcceptance requires approval.\n\nContact information") : RelatedNoticeCandidate => ({ messageId: id, title: "Offer", issuerName: "Example", issuerSign: "EX", publishedAt: new Date("2026-09-16T07:00:00Z"), bodyText: body });
const explicit = (id = 1): RelatedNoticePayload => ({ ...row(id), publishedAt: row(id).publishedAt.toISOString(), text: row(id).bodyText, textChars: row(id).bodyText.length, relation: "reference", resolvedBy: "db", score: 1 });
function caller(responses: unknown[]) {
  const fn = vi.fn(async request => ({ content: JSON.stringify(responses.shift()), promptChars: 1, modelCall: { schemaName: request.schemaName, promptChars: 1 } }));
  return fn as unknown as NoticeJsonCaller;
}
const store = (rows: RelatedNoticeCandidate[]): ContextStore => ({ search: vi.fn(async () => rows), fetch: vi.fn(async ids => rows.filter(r => ids.includes(r.messageId))) });

describe("reader context retrieval", () => {
  it("excludes other issuers, future/self notices and invalid dates even if the store returns them", () => {
    expect(eligibleContext(current, [row(1), row(100), { ...row(2), issuerSign: "OTHER" }, { ...row(3), publishedAt: new Date(current.publishedAt) }, { ...row(4), publishedAt: new Date("invalid") }]).map(r => r.messageId)).toEqual([1]);
  });
  it("deduplicates boilerplate corrections but keeps changed amounts", () => {
    const body = "The fund sold 100 shares in the company yesterday and owns 200 shares representing 5 percent of voting rights";
    expect(deduplicateContext([row(1, body), { ...row(2, `Correction\n${body}`), publishedAt: new Date("2026-09-16T08:00:00Z") }, row(3, body.replace("100", "101"))]).map(r => r.messageId)).toEqual([2, 3]);
  });
  it("lets the model choose nothing without making a reading call", async () => {
    const call = caller([{ messageIds: [], reason: "Self-contained" }]);
    const result = await retrieveReaderContext(current, [], store([row(1)]), call);
    expect(result.related).toEqual([]); expect(call).toHaveBeenCalledTimes(1);
  });
  it("selects exact passages with neighbors and source identity", async () => {
    const result = await retrieveReaderContext(current, [], store([row(1)]), caller([
      { messageIds: [1], reason: "Explains offer" },
      { sources: [{ messageId: 1, blockIds: [1] }], followupTerms: [], reason: "Identity with conditions" }
    ]));
    expect(result.related[0].text).toBe("Offer identity\n\nThe board recommends it.\n\nAcceptance requires approval.");
    expect(result.related[0].relation).toBe("history");
    expect(result.audit.sources[0].blockIds).toEqual([0, 1, 2]);
  });
  it.each([
    [{ messageIds: [999], reason: "bad" }],
    [{ messageIds: [1], reason: "ok" }, { sources: [{ messageId: 1, blockIds: [999] }], followupTerms: [], reason: "bad" }]
  ])("falls back to explicit sources on invented IDs", async (...responses) => {
    const result = await retrieveReaderContext(current, [explicit()], store([row(1)]), caller(responses));
    expect(result.audit.outcome).toBe("fallback"); expect(result.related).toEqual([explicit()]);
  });
  it("performs at most one targeted follow-up and preserves earlier selected context", async () => {
    const sourceStore = store([row(1)]);
    sourceStore.search = vi.fn(async (_, terms) => terms.length ? [row(2, "Latest offer status")] : [row(1)]);
    const call = caller([
      { messageIds: [1], reason: "Offer" },
      { sources: [{ messageId: 1, blockIds: [1] }], followupTerms: ["acceptance"], reason: "Need latest status" },
      { messageIds: [2], reason: "Latest" },
      { sources: [{ messageId: 2, blockIds: [0] }], followupTerms: ["never run"], reason: "done" }
    ]);
    const result = await retrieveReaderContext(current, [], sourceStore, call);
    expect(sourceStore.search).toHaveBeenCalledTimes(2); expect(call).toHaveBeenCalledTimes(4);
    expect(result.related.map(r => r.messageId)).toEqual([1, 2]); expect(result.audit.followup).toEqual(["acceptance"]);
  });
  it("preserves correction targets when optional context is declined", async () => {
    const correction = { ...explicit(), relation: "correction" as const };
    const result = await retrieveReaderContext(current, [correction], store([row(1)]), caller([{ messageIds: [], reason: "no extra context" }]));
    expect(result.related).toEqual([correction]);
  });
  it("does not turn archive failures into no-context evidence", async () => {
    const sourceStore = store([]); sourceStore.search = async () => { throw Error("archive unavailable"); };
    const result = await retrieveReaderContext(current, [explicit()], sourceStore, caller([]));
    expect(result.audit.outcome).toBe("fallback"); expect(result.related).toEqual([explicit()]);
  });
  it("bounds archive queries by issuer, publication cutoff, lookback and row count", async () => {
    const findMany = vi.fn(async () => []);
    const adapter = createContextStore({ sourceNotice: { findMany } } as never);
    await adapter.search(current, ["Fortum"]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 40, where: expect.objectContaining({ issuerSign: "EX", publishedAt: { lt: new Date(current.publishedAt), gte: new Date("2025-09-17T07:00:00Z") }, OR: [{ title: { contains: "Fortum", mode: "insensitive" } }, { bodyText: { contains: "Fortum", mode: "insensitive" } }] }) }));
  });
  it("keeps a changed status even when all numbers and most words match", () => {
    const text = "The board has accepted the offer for 100 shares subject to the conditions announced earlier this month";
    expect(deduplicateContext([row(1, text), row(2, text.replace("accepted", "rejected"))])).toHaveLength(2);
  });
  it("supplies current attachment evidence as data and bounds all reading calls", async () => {
    const call = caller([
      { messageIds: [1, 2, 3, 4], reason: "Read" },
      { sources: [], followupTerms: ["more"], reason: "Missing" }
    ]);
    const sourceStore = store([row(1, "one"), row(2, "two"), row(3, "three"), row(4, "four")]);
    await retrieveReaderContext({ ...current, pdfSupplementText: "Today's complete payment terms" }, [], sourceStore, call);
    expect(call).toHaveBeenCalledTimes(2);
    const request = vi.mocked(call).mock.calls[0][0];
    expect(JSON.parse(request.userPrompt).current.attachmentText).toBe("Today's complete payment terms");
    expect(sourceStore.search).toHaveBeenCalledTimes(2);
  });

  it("retains verified first-round sources if the optional follow-up lookup fails", async () => {
    const sourceStore = store([row(1)]);
    sourceStore.search = vi.fn(async (_, terms) => { if (terms.length) throw Error("follow-up unavailable"); return [row(1)]; });
    const result = await retrieveReaderContext(current, [], sourceStore, caller([
      { messageIds: [1], reason: "Offer" },
      { sources: [{ messageId: 1, blockIds: [1] }], followupTerms: ["acceptance"], reason: "Check update" }
    ]));
    expect(result.audit.outcome).toBe("fallback");
    expect(result.related.map(p => p.messageId)).toEqual([1]);
    expect(result.audit.errors).toContain("follow-up unavailable");
  });

});

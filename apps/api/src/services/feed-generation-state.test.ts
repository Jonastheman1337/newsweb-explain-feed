import { describe, expect, it, vi } from "vitest";
import type { FeedItem } from "@newsweb/shared";
import type { FeedGenerationRunRecord } from "./feed-regeneration.js";
vi.mock("@newsweb/shared/db", () => ({ logPrisma: { generationRun: { findMany: vi.fn() } }, prisma: {} }));
import { applyFeedGenerationState, loadFeedGenerationRuns } from "./feed-generation-state.js";
import { applyFeedUpdateState } from "../routes/feed-stream.js";
import { logPrisma } from "@newsweb/shared/db";
const now = new Date("2026-09-15T12:57:45Z");
const run: FeedGenerationRunRecord = { id: "full-1", messageId: 682374, status: "started", phase: "writing_notice", requestedAt: new Date("2026-09-15T12:57:30Z"), phaseUpdatedAt: now };
const source: FeedItem = { title: "Original title", confidence: "high", publishedAt: now.toISOString(), visibilityStatus: "published", rewriteVersion: null, rewriteId: null, publicationRevision: 0, contentHash: null, finalizedAt: null, issuerName: "Test ASA", issuerSign: "TEST", keyFacts: [], negativeOrSurprising: [], sourceLimitations: [], hasAttachments: false, attachments: [], sourceTitle: "Original title", sourceBodyText: "Source", categories: [], messageId: 682374, isFinal: false, notGenerated: true, processing: false, regenerating: false, failed: false, skipped: false, lead: "", body: [], importance: "uviktig" };
const apply = (item = source, currentRun = run) => applyFeedGenerationState(item, currentRun, [], now);
describe("full generation owns feed progress", () => {
  it.each(["failed", "skipped", "ready"])("keeps progress through a %s fast draft, and gives refresh the same state", (status) => {
    const update = applyFeedUpdateState({ ...source, fastDraft: { status } } as FeedItem, "fast-draft");
    const live = apply(update);
    expect(live).toMatchObject({ processing: true, regenerating: false, notGenerated: false, failed: false, skipped: false, phase: "writing_notice" });
    const { fastDraft, ...withoutDraft } = live;
    expect(withoutDraft).toEqual(apply());
  });
  it("keeps the existing publication intact throughout regeneration", () => {
    const published = { ...source, isFinal: true, rewriteId: "v1", title: "My publication", lead: "Saved lead", body: ["Saved paragraph"], notGenerated: false };
    expect(apply(published)).toMatchObject({ ...published, processing: false, regenerating: true });
  });
  it.each(["failed", "skipped", "cancelled", "published"])("does not revive a %s run when a late processing event arrives", (status) => {
    const incoming = applyFeedUpdateState(source, "processing", "writing_notice");
    const item = status === "published" ? { ...incoming, isFinal: true, rewriteId: "v1" } : incoming;
    expect(apply(item, { ...run, status })).toMatchObject({ processing: false, regenerating: false, phase: undefined, failed: status === "failed", skipped: status === "skipped" });
  });
  it("keeps the finished rewrite authoritative while publication bookkeeping catches up", () => {
    const published = { ...source, isFinal: true, notGenerated: false };
    expect(applyFeedGenerationState(published, run, [{ status: "published", generatedAt: now }], now)).toMatchObject({ processing: false, regenerating: false });
  });
  it("does not leave stale runs spinning forever", () => {
    expect(apply(source, { ...run, phaseUpdatedAt: new Date("2026-09-14T12:00:00Z") }).processing).toBe(false);
  });
  it("loads the latest full run including terminal states for both feed paths", async () => {
    vi.mocked(logPrisma.generationRun.findMany).mockResolvedValue([{ ...run, status: "cancelled" }] as never);
    expect((await loadFeedGenerationRuns([682374])).get(682374)?.status).toBe("cancelled");
    expect(logPrisma.generationRun.findMany).toHaveBeenCalledWith(expect.objectContaining({ distinct: ["messageId"], orderBy: { requestedAt: "desc" }, where: { messageId: { in: [682374] }, reason: { in: ["new-message", "manual-reprocess"] } } }));
  });
});

it("a rejected newer duplicate cannot hide the run that still owns the slot", async () => {
  vi.mocked(logPrisma.generationRun.findMany)
    .mockResolvedValueOnce([{ ...run, id: "duplicate", status: "superseded" }] as never)
    .mockResolvedValueOnce([run] as never);
  const selected = (await loadFeedGenerationRuns([run.messageId], [run.id])).get(run.messageId);
  expect(selected?.id).toBe(run.id);
  expect(applyFeedGenerationState(source, selected, [], now).processing).toBe(true);
});

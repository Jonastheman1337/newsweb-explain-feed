import { isGenerationPhase, type FeedItem } from "@newsweb/shared";
import { logPrisma } from "@newsweb/shared/db";
import {
  shouldMarkFeedItemRegenerating,
  type FeedGenerationRunRecord,
  type FeedRewriteStateRecord
} from "./feed-regeneration.js";

// Feed reads and every SSE event (including fast drafts) use the same full run.
// Read the latest run even when terminal; filtering to active runs can resurrect
// an older run after a newer one has finished or been cancelled.
export async function loadFeedGenerationRuns(messageIds: number[]) {
  if (!messageIds.length) return new Map<number, FeedGenerationRunRecord>();
  const runs = await logPrisma.generationRun.findMany({
    where: {
      messageId: { in: messageIds },
      reason: { in: ["new-message", "manual-reprocess"] }
    },
    orderBy: { requestedAt: "desc" },
    distinct: ["messageId"],
    select: {
      id: true, messageId: true, status: true, phase: true,
      phaseUpdatedAt: true, requestedAt: true
    }
  });
  return new Map(runs.map((run) => [run.messageId, run]));
}

export function applyFeedGenerationState(
  item: FeedItem,
  run: FeedGenerationRunRecord | undefined,
  rewrites: FeedRewriteStateRecord[],
  now: Date = new Date()
): FeedItem {
  if (!run) return item;
  if (shouldMarkFeedItemRegenerating(run, rewrites, now)) {
    return {
      ...item,
      processing: !item.isFinal,
      regenerating: item.isFinal,
      notGenerated: false,
      skipped: false,
      failed: false,
      phase: isGenerationPhase(run.phase) ? run.phase : undefined
    };
  }
  const failed = !item.isFinal && (run.status === "failed" || run.status === "superseded" || item.failed);
  const skipped = !item.isFinal && !failed && (run.status === "skipped" || item.skipped);
  return {
    ...item,
    processing: false,
    regenerating: false,
    notGenerated: !item.isFinal && !failed && !skipped,
    failed,
    skipped,
    phase: undefined
  };
}

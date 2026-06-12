import { isGenerationRunActive } from "./generation-status.js";

const READY_REWRITE_STATUSES = new Set(["published", "skipped"]);

export type FeedGenerationRunRecord = {
  id: string;
  messageId: number;
  status: string;
  phase: string | null;
  phaseUpdatedAt: Date | null;
  requestedAt: Date;
};

export type FeedRewriteStateRecord = {
  status: string;
  generatedAt: Date;
};

export function hasReadyRewriteForGenerationRun(
  generationRun: FeedGenerationRunRecord | null,
  rewrites: FeedRewriteStateRecord[]
): boolean {
  if (!generationRun) return false;

  return rewrites.some(
    (rewrite) =>
      READY_REWRITE_STATUSES.has(rewrite.status) &&
      rewrite.generatedAt.getTime() >= generationRun.requestedAt.getTime()
  );
}

export function shouldMarkFeedItemRegenerating(
  generationRun: FeedGenerationRunRecord | null,
  rewrites: FeedRewriteStateRecord[],
  now: Date = new Date()
): boolean {
  if (!isGenerationRunActive(generationRun, now)) {
    return false;
  }

  return !hasReadyRewriteForGenerationRun(generationRun, rewrites);
}

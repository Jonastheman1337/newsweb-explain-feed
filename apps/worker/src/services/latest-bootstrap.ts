import type { RewriteStatus } from "@newsweb/shared";

export type LatestBootstrapRewriteState = {
  status: RewriteStatus;
  version: number;
  generatedAt: Date;
};

const bootstrapBlockingStatuses = new Set<RewriteStatus>([
  "published",
  "skipped",
  "pending",
  "needs_retry"
]);

export function shouldQueueLatestBootstrapRewrite(
  rewrites: LatestBootstrapRewriteState[]
): boolean {
  if (rewrites.length === 0) {
    return true;
  }

  return !rewrites.some((rewrite) =>
    bootstrapBlockingStatuses.has(rewrite.status)
  );
}

export function latestBootstrapRewriteJobId(
  messageId: number,
  rewrites: LatestBootstrapRewriteState[]
): string {
  const latestFailed = rewrites
    .filter((rewrite) => rewrite.status === "failed")
    .sort(
      (left, right) => right.generatedAt.getTime() - left.generatedAt.getTime()
    )[0];
  if (!latestFailed) {
    return `rewrite-latest-${messageId}`;
  }

  return [
    "rewrite-latest",
    messageId,
    "retry-failed",
    `v${latestFailed.version}`,
    latestFailed.generatedAt.getTime()
  ].join("-");
}

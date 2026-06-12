import {
  GENERATION_RUN_STALE_MS,
  type RewriteStatus
} from "@newsweb/shared";

export const STALE_GENERATION_RECOVERY_LOOKBACK_MS = 72 * 60 * 60 * 1000;
export const STALE_GENERATION_RECOVERY_LIMIT = 500;
export const STALE_GENERATION_RECOVERY_ERROR = "STALE_GENERATION_REQUEUED";

const ACTIVE_GENERATION_RUN_STATUSES = new Set(["queued", "started", "pending"]);
const RECOVERABLE_REWRITE_STATUSES = new Set<RewriteStatus>([
  "pending",
  "needs_retry"
]);
const TERMINAL_REWRITE_STATUSES = new Set<RewriteStatus>([
  "published",
  "skipped"
]);

export type StaleGenerationRunCandidate = {
  id: string;
  messageId: number;
  version: number | null;
  reason: string;
  status: string;
  requestedAt: Date;
  phaseUpdatedAt: Date | null;
};

export type StaleGenerationRewriteState = {
  status: RewriteStatus;
  version: number;
  generatedAt: Date;
};

export function staleGenerationRecoveryJobId(
  messageId: number,
  staleRunId: string
): string {
  return `rewrite-recovery-${messageId}-${staleRunId}`;
}

export function isRecoverableRunStale(
  run: Pick<StaleGenerationRunCandidate, "status" | "phaseUpdatedAt">,
  now: Date,
  staleMs = GENERATION_RUN_STALE_MS
): boolean {
  if (!ACTIVE_GENERATION_RUN_STATUSES.has(run.status)) return false;
  return (
    !run.phaseUpdatedAt ||
    now.getTime() - run.phaseUpdatedAt.getTime() > staleMs
  );
}

export function hasNewerActiveRun(args: {
  run: StaleGenerationRunCandidate;
  messageRuns: StaleGenerationRunCandidate[];
  now: Date;
  staleMs?: number;
}): boolean {
  return args.messageRuns.some(
    (candidate) =>
      candidate.id !== args.run.id &&
      candidate.messageId === args.run.messageId &&
      candidate.requestedAt > args.run.requestedAt &&
      candidate.reason === "new-message" &&
      !isRecoverableRunStale(
        candidate,
        args.now,
        args.staleMs ?? GENERATION_RUN_STALE_MS
      ) &&
      ACTIVE_GENERATION_RUN_STATUSES.has(candidate.status)
  );
}

export function shouldRecoverStaleGenerationRun(args: {
  run: StaleGenerationRunCandidate;
  messageRuns: StaleGenerationRunCandidate[];
  rewrites: StaleGenerationRewriteState[];
  now: Date;
  staleMs?: number;
}): boolean {
  const staleMs = args.staleMs ?? GENERATION_RUN_STALE_MS;
  if (args.run.reason !== "new-message") return false;
  if (!isRecoverableRunStale(args.run, args.now, staleMs)) return false;
  if (hasNewerActiveRun({ ...args, staleMs })) return false;

  if (args.rewrites.some((rewrite) => TERMINAL_REWRITE_STATUSES.has(rewrite.status))) {
    return false;
  }

  if (args.rewrites.length === 0) return true;

  const latestRewrite = [...args.rewrites].sort(
    (left, right) => right.generatedAt.getTime() - left.generatedAt.getTime()
  )[0];

  return RECOVERABLE_REWRITE_STATUSES.has(latestRewrite.status);
}

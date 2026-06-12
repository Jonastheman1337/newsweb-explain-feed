import {
  GENERATION_RUN_STALE_MS,
  isGenerationPhase,
  type GenerationPhase,
  type RewriteStatusResponse
} from "@newsweb/shared";

type RewriteStatusRecord = {
  status: string;
  generatedAt: Date;
  version: number;
} | null;

type GenerationRunStatusRecord = {
  id: string;
  status: string;
  phase: string | null;
  phaseUpdatedAt: Date | null;
  requestedAt?: Date | null;
} | null;

const ACTIVE_GENERATION_RUN_STATUSES = new Set(["queued", "started", "pending"]);

const TERMINAL_GENERATION_RUN_STATUSES = new Set(["published", "skipped", "failed"]);

const TERMINAL_GENERATION_RUN_PHASES = new Set(["published", "skipped", "failed"]);

const RUNNING_JOB_STATES = new Set([
  "active",
  "delayed",
  "prioritized",
  "waiting",
  "waiting-children"
]);

export { GENERATION_RUN_STALE_MS };

export function isJobStillRunning(jobState: string | null): boolean {
  return jobState ? RUNNING_JOB_STATES.has(jobState) : false;
}

export function isGenerationRunActive(
  generationRun: GenerationRunStatusRecord,
  now: Date = new Date()
): boolean {
  if (!generationRun) return false;
  if (TERMINAL_GENERATION_RUN_STATUSES.has(generationRun.status)) return false;
  if (
    !generationRun.phaseUpdatedAt ||
    now.getTime() - generationRun.phaseUpdatedAt.getTime() > GENERATION_RUN_STALE_MS
  ) {
    return false;
  }
  if (ACTIVE_GENERATION_RUN_STATUSES.has(generationRun.status)) return true;
  if (!generationRun.phase) return false;
  return !TERMINAL_GENERATION_RUN_PHASES.has(generationRun.phase);
}

function isGenerationRunStale(
  generationRun: GenerationRunStatusRecord,
  now: Date
): boolean {
  if (!generationRun) return false;
  if (TERMINAL_GENERATION_RUN_STATUSES.has(generationRun.status)) return false;
  return (
    !generationRun.phaseUpdatedAt ||
    now.getTime() - generationRun.phaseUpdatedAt.getTime() > GENERATION_RUN_STALE_MS
  );
}

function isStaleGenerationFailure(args: {
  generationRun: GenerationRunStatusRecord;
  rewrite: RewriteStatusRecord;
  jobState: string | null;
  now: Date;
}): boolean {
  if (!isGenerationRunStale(args.generationRun, args.now)) return false;
  if (isJobStillRunning(args.jobState)) return false;
  return (
    !args.rewrite ||
    args.rewrite.status === "pending" ||
    args.rewrite.status === "needs_retry"
  );
}

function isReadyRewriteCurrentForRun(
  generationRun: GenerationRunStatusRecord,
  rewrite: RewriteStatusRecord
): boolean {
  if (rewrite?.status !== "published" && rewrite?.status !== "skipped") {
    return false;
  }
  if (!generationRun?.requestedAt) {
    return false;
  }
  return rewrite.generatedAt.getTime() >= generationRun.requestedAt.getTime();
}

export function chooseGenerationRun(
  jobRun: GenerationRunStatusRecord,
  latestRun: GenerationRunStatusRecord
): GenerationRunStatusRecord {
  return jobRun ?? latestRun;
}

export function deriveGenerationPhase(args: {
  generationRun: GenerationRunStatusRecord;
  rewrite: RewriteStatusRecord;
  jobState: string | null;
}): GenerationPhase | null {
  const { generationRun, rewrite, jobState } = args;

  if (isGenerationPhase(generationRun?.phase)) {
    return generationRun.phase;
  }

  if (rewrite?.status === "published") return "published";
  if (rewrite?.status === "skipped") return "skipped";
  if (rewrite?.status === "failed" && !isJobStillRunning(jobState)) return "failed";
  if (rewrite?.status === "pending") return "publishing";
  if (rewrite?.status === "needs_retry") return "queued";

  if (generationRun?.status === "queued") return "queued";
  if (generationRun?.status === "started") return "reading_notice";
  if (generationRun?.status === "pending") return "publishing";
  if (generationRun?.status === "published") return "published";
  if (generationRun?.status === "skipped") return "skipped";
  if (generationRun?.status === "failed") return "failed";

  if (jobState === "active") return "reading_notice";
  if (isJobStillRunning(jobState)) return "queued";

  return null;
}

export function buildGenerationStatusPayload(args: {
  generationRun: GenerationRunStatusRecord;
  rewrite: RewriteStatusRecord;
  jobState: string | null;
  now?: Date;
}): RewriteStatusResponse {
  const { generationRun, rewrite, jobState } = args;
  const now = args.now ?? new Date();
  const runActive =
    isGenerationRunActive(generationRun, now) || isJobStillRunning(jobState);
  const currentReadyRewrite = isReadyRewriteCurrentForRun(generationRun, rewrite);
  const staleFailed = isStaleGenerationFailure({
    generationRun,
    rewrite,
    jobState,
    now
  });
  const failed =
    !currentReadyRewrite &&
    !runActive &&
    (staleFailed ||
      generationRun?.status === "failed" ||
      rewrite?.status === "failed");
  const phase = staleFailed ? "failed" : deriveGenerationPhase(args);

  return {
    ready:
      currentReadyRewrite ||
      (!runActive &&
        !failed &&
        (rewrite?.status === "published" || rewrite?.status === "skipped")),
    failed,
    generatedAt: rewrite?.generatedAt.toISOString() ?? null,
    version: rewrite?.version ?? null,
    jobState: failed && jobState === "completed" ? "failed" : jobState,
    generationRunId: generationRun?.id ?? null,
    phase,
    phaseUpdatedAt: generationRun?.phaseUpdatedAt?.toISOString() ?? null
  };
}

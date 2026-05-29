import {
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
} | null;

const RUNNING_JOB_STATES = new Set([
  "active",
  "delayed",
  "prioritized",
  "waiting",
  "waiting-children"
]);

export function isJobStillRunning(jobState: string | null): boolean {
  return jobState ? RUNNING_JOB_STATES.has(jobState) : false;
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
}): RewriteStatusResponse {
  const { generationRun, rewrite, jobState } = args;
  const failed = rewrite?.status === "failed" && !isJobStillRunning(jobState);
  const phase = deriveGenerationPhase(args);

  return {
    ready: rewrite?.status === "published" || rewrite?.status === "skipped",
    failed,
    generatedAt: rewrite?.generatedAt.toISOString() ?? null,
    version: rewrite?.version ?? null,
    jobState: failed && jobState === "completed" ? "failed" : jobState,
    generationRunId: generationRun?.id ?? null,
    phase,
    phaseUpdatedAt: generationRun?.phaseUpdatedAt?.toISOString() ?? null
  };
}

import { describe, expect, it } from "vitest";
import {
  GENERATION_RUN_STALE_MS,
  buildGenerationStatusPayload,
  chooseGenerationRun,
  deriveGenerationPhase,
  isGenerationRunActive
} from "./generation-status.js";

const oldDate = new Date("2026-05-29T08:00:00.000Z");
const newDate = new Date("2026-05-29T08:01:00.000Z");

describe("generation status", () => {
  it("prefers a job-specific generation run over the latest message run", () => {
    const jobRun = {
      id: "run-for-job",
      status: "started",
      phase: "writing_notice",
      phaseUpdatedAt: newDate
    };
    const latestRun = {
      id: "latest-run",
      status: "started",
      phase: "checking_references",
      phaseUpdatedAt: oldDate
    };

    expect(chooseGenerationRun(jobRun, latestRun)).toBe(jobRun);
  });

  it("falls back from old null phases using rewrite and run status", () => {
    expect(
      deriveGenerationPhase({
        generationRun: {
          id: "old-run",
          status: "started",
          phase: null,
          phaseUpdatedAt: null
        },
        rewrite: null,
        jobState: "active"
      })
    ).toBe("reading_notice");

    expect(
      deriveGenerationPhase({
        generationRun: null,
        rewrite: {
          status: "pending",
          generatedAt: newDate,
          version: 2
        },
        jobState: null
      })
    ).toBe("publishing");
  });

  it("returns existing status fields with generation phase metadata", () => {
    expect(
      buildGenerationStatusPayload({
        generationRun: {
          id: "run-1",
          status: "started",
          phase: "checking_references",
          phaseUpdatedAt: newDate
        },
        rewrite: {
          status: "pending",
          generatedAt: oldDate,
          version: 3
        },
        jobState: "active"
      })
    ).toEqual({
      ready: false,
      failed: false,
      generatedAt: "2026-05-29T08:00:00.000Z",
      version: 3,
      jobState: "active",
      generationRunId: "run-1",
      phase: "checking_references",
      phaseUpdatedAt: "2026-05-29T08:01:00.000Z"
    });
  });

  it("keeps active regenerations not ready even while an older rewrite is published", () => {
    expect(
      buildGenerationStatusPayload({
        generationRun: {
          id: "run-2",
          status: "queued",
          phase: "queued",
          phaseUpdatedAt: newDate
        },
        rewrite: {
          status: "published",
          generatedAt: oldDate,
          version: 1
        },
        jobState: "waiting"
      })
    ).toEqual({
      ready: false,
      failed: false,
      generatedAt: "2026-05-29T08:00:00.000Z",
      version: 1,
      jobState: "waiting",
      generationRunId: "run-2",
      phase: "queued",
      phaseUpdatedAt: "2026-05-29T08:01:00.000Z"
    });
  });

  it("treats terminal run statuses as inactive even with a stale non-terminal phase", () => {
    expect(
      isGenerationRunActive(
        {
          id: "run-3",
          status: "failed",
          phase: "checking_references",
          phaseUpdatedAt: newDate
        },
        newDate
      )
    ).toBe(false);
  });

  it("treats runs without recent phase progress as dead", () => {
    const staleNow = new Date(newDate.getTime() + GENERATION_RUN_STALE_MS + 1);

    expect(
      isGenerationRunActive(
        {
          id: "run-4",
          status: "started",
          phase: "writing_notice",
          phaseUpdatedAt: newDate
        },
        staleNow
      )
    ).toBe(false);

    expect(
      isGenerationRunActive(
        {
          id: "run-4",
          status: "started",
          phase: "writing_notice",
          phaseUpdatedAt: newDate
        },
        newDate
      )
    ).toBe(true);
  });

  it("reports a published rewrite as ready when the latest run died silently", () => {
    const staleNow = new Date(newDate.getTime() + GENERATION_RUN_STALE_MS + 1);

    expect(
      buildGenerationStatusPayload({
        generationRun: {
          id: "run-5",
          status: "started",
          phase: "writing_notice",
          phaseUpdatedAt: newDate
        },
        rewrite: {
          status: "published",
          generatedAt: oldDate,
          version: 1
        },
        jobState: null,
        now: staleNow
      })
    ).toEqual({
      ready: true,
      failed: false,
      generatedAt: "2026-05-29T08:00:00.000Z",
      version: 1,
      jobState: null,
      generationRunId: "run-5",
      phase: "writing_notice",
      phaseUpdatedAt: "2026-05-29T08:01:00.000Z"
    });
  });

  it("reports stale queued work without a terminal rewrite as failed", () => {
    const staleNow = new Date(newDate.getTime() + GENERATION_RUN_STALE_MS + 1);

    expect(
      buildGenerationStatusPayload({
        generationRun: {
          id: "run-6",
          status: "queued",
          phase: "queued",
          phaseUpdatedAt: newDate
        },
        rewrite: {
          status: "pending",
          generatedAt: oldDate,
          version: 1
        },
        jobState: null,
        now: staleNow
      })
    ).toEqual({
      ready: false,
      failed: true,
      generatedAt: "2026-05-29T08:00:00.000Z",
      version: 1,
      jobState: null,
      generationRunId: "run-6",
      phase: "failed",
      phaseUpdatedAt: "2026-05-29T08:01:00.000Z"
    });
  });

  it("does not fail fresh queued work before the stale threshold", () => {
    expect(
      buildGenerationStatusPayload({
        generationRun: {
          id: "run-7",
          status: "queued",
          phase: "queued",
          phaseUpdatedAt: newDate
        },
        rewrite: {
          status: "pending",
          generatedAt: oldDate,
          version: 1
        },
        jobState: null,
        now: newDate
      })
    ).toMatchObject({
      ready: false,
      failed: false,
      phase: "queued"
    });
  });

  it("reports a failed regeneration when the latest run failed over an older rewrite", () => {
    expect(
      buildGenerationStatusPayload({
        generationRun: {
          id: "run-2",
          status: "failed",
          phase: "failed",
          phaseUpdatedAt: newDate
        },
        rewrite: {
          status: "published",
          generatedAt: oldDate,
          version: 1
        },
        jobState: "failed"
      })
    ).toEqual({
      ready: false,
      failed: true,
      generatedAt: "2026-05-29T08:00:00.000Z",
      version: 1,
      jobState: "failed",
      generationRunId: "run-2",
      phase: "failed",
      phaseUpdatedAt: "2026-05-29T08:01:00.000Z"
    });
  });
});

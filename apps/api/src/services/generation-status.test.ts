import { describe, expect, it } from "vitest";
import {
  buildGenerationStatusPayload,
  chooseGenerationRun,
  deriveGenerationPhase
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
});

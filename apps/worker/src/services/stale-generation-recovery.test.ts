import { describe, expect, it } from "vitest";
import {
  shouldRecoverStaleGenerationRun,
  staleGenerationRecoveryJobId,
  type StaleGenerationRunCandidate,
  type StaleGenerationRewriteState
} from "./stale-generation-recovery.js";

const oldDate = new Date("2026-06-11T08:00:00.000Z");
const newDate = new Date("2026-06-11T08:30:00.000Z");

function run(
  overrides: Partial<StaleGenerationRunCandidate> = {}
): StaleGenerationRunCandidate {
  return {
    id: "run-1",
    messageId: 676037,
    version: 1,
    reason: "new-message",
    status: "queued",
    requestedAt: oldDate,
    phaseUpdatedAt: oldDate,
    ...overrides
  };
}

function rewrite(
  status: StaleGenerationRewriteState["status"],
  generatedAt = oldDate
): StaleGenerationRewriteState {
  return { status, version: 1, generatedAt };
}

describe("stale generation recovery policy", () => {
  it("uses a stable idempotent recovery job id", () => {
    expect(staleGenerationRecoveryJobId(676037, "run-1")).toBe(
      "rewrite-recovery-676037-run-1"
    );
  });

  it("recovers stale new-message runs with pending rewrites", () => {
    const candidate = run();

    expect(
      shouldRecoverStaleGenerationRun({
        run: candidate,
        messageRuns: [candidate],
        rewrites: [rewrite("pending")],
        now: newDate
      })
    ).toBe(true);
  });

  it("skips stale manual regenerations", () => {
    const candidate = run({ reason: "manual-reprocess" });

    expect(
      shouldRecoverStaleGenerationRun({
        run: candidate,
        messageRuns: [candidate],
        rewrites: [rewrite("pending")],
        now: newDate
      })
    ).toBe(false);
  });

  it("skips when a newer active run exists", () => {
    const candidate = run();
    const newer = run({
      id: "run-2",
      requestedAt: new Date("2026-06-11T08:20:00.000Z"),
      phaseUpdatedAt: new Date("2026-06-11T08:25:00.000Z")
    });

    expect(
      shouldRecoverStaleGenerationRun({
        run: candidate,
        messageRuns: [newer, candidate],
        rewrites: [rewrite("pending")],
        now: newDate
      })
    ).toBe(false);
  });

  it("skips when a terminal published or skipped rewrite exists", () => {
    for (const status of ["published", "skipped"] as const) {
      const candidate = run();
      expect(
        shouldRecoverStaleGenerationRun({
          run: candidate,
          messageRuns: [candidate],
          rewrites: [rewrite(status)],
          now: newDate
        })
      ).toBe(false);
    }
  });

  it("does not recover already failed rewrite rows", () => {
    const candidate = run();

    expect(
      shouldRecoverStaleGenerationRun({
        run: candidate,
        messageRuns: [candidate],
        rewrites: [rewrite("failed")],
        now: newDate
      })
    ).toBe(false);
  });
});


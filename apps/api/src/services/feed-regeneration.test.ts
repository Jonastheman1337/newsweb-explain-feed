import { describe, expect, it } from "vitest";
import { GENERATION_RUN_STALE_MS } from "./generation-status.js";
import {
  hasReadyRewriteForGenerationRun,
  shouldMarkFeedItemRegenerating,
  type FeedGenerationRunRecord
} from "./feed-regeneration.js";

const requestedAt = new Date("2026-06-12T09:05:12.716Z");
const phaseUpdatedAt = new Date("2026-06-12T09:05:12.615Z");
const now = new Date("2026-06-12T09:06:00.000Z");

function activeRun(overrides: Partial<FeedGenerationRunRecord> = {}) {
  return {
    id: "run-1",
    messageId: 676059,
    status: "queued",
    phase: "queued",
    phaseUpdatedAt,
    requestedAt,
    ...overrides
  };
}

describe("feed regeneration state", () => {
  it("marks a fresh active run as regenerating when there is no terminal rewrite", () => {
    expect(shouldMarkFeedItemRegenerating(activeRun(), [], now)).toBe(true);
  });

  it("keeps regenerating when the published rewrite is older than the run", () => {
    expect(
      shouldMarkFeedItemRegenerating(
        activeRun(),
        [
          {
            status: "published",
            generatedAt: new Date("2026-06-12T09:04:00.000Z")
          }
        ],
        now
      )
    ).toBe(true);
  });

  it("does not mark regenerating when a published rewrite covers the run", () => {
    expect(
      shouldMarkFeedItemRegenerating(
        activeRun(),
        [
          {
            status: "published",
            generatedAt: new Date("2026-06-12T09:14:42.782Z")
          }
        ],
        now
      )
    ).toBe(false);
  });

  it("treats skipped rewrites generated after the run as ready", () => {
    expect(
      hasReadyRewriteForGenerationRun(activeRun(), [
        {
          status: "skipped",
          generatedAt: new Date("2026-06-12T09:06:00.000Z")
        }
      ])
    ).toBe(true);
  });

  it("does not mark stale active-looking runs as regenerating", () => {
    const staleNow = new Date(phaseUpdatedAt.getTime() + GENERATION_RUN_STALE_MS + 1);

    expect(shouldMarkFeedItemRegenerating(activeRun(), [], staleNow)).toBe(false);
  });
});

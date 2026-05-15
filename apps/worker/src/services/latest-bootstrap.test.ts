import { describe, expect, it } from "vitest";
import {
  latestBootstrapRewriteJobId,
  shouldQueueLatestBootstrapRewrite,
  type LatestBootstrapRewriteState
} from "./latest-bootstrap.js";

function rewrite(
  status: LatestBootstrapRewriteState["status"],
  version = 1,
  generatedAt = new Date("2026-05-15T08:00:00.000Z")
): LatestBootstrapRewriteState {
  return { status, version, generatedAt };
}

describe("latest bootstrap rewrite retry policy", () => {
  it("queues notices with no rewrites", () => {
    expect(shouldQueueLatestBootstrapRewrite([])).toBe(true);
  });

  it("queues notices with only failed rewrites", () => {
    expect(
      shouldQueueLatestBootstrapRewrite([
        rewrite("failed", 2, new Date("2026-05-15T08:05:00.000Z")),
        rewrite("failed", 1)
      ])
    ).toBe(true);
  });

  it("does not queue when a usable or active rewrite exists", () => {
    for (const status of ["published", "skipped", "pending", "needs_retry"] as const) {
      expect(shouldQueueLatestBootstrapRewrite([rewrite("failed"), rewrite(status)])).toBe(
        false
      );
    }
  });

  it("keeps a stable retry id for the latest failed row", () => {
    expect(
      latestBootstrapRewriteJobId(673588, [
        rewrite("failed", 1, new Date("2026-05-15T08:00:00.000Z")),
        rewrite("failed", 2, new Date("2026-05-15T08:05:00.000Z"))
      ])
    ).toBe("rewrite-latest-673588-retry-failed-v2-1778832300000");
  });
});

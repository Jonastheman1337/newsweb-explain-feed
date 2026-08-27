import { describe, expect, it } from "vitest";
import { canWriteRewriteCandidate } from "./generation-ownership.js";

describe("generation ownership", () => {
  it("lets a run claim an unowned staging row", () => {
    expect(
      canWriteRewriteCandidate(
        { status: "pending", generationRunId: null },
        "run-new"
      )
    ).toBe(true);
  });

  it("prevents a slower run from overwriting another run's candidate", () => {
    expect(
      canWriteRewriteCandidate(
        { status: "pending", generationRunId: "run-new" },
        "run-old"
      )
    ).toBe(false);
  });

  it("never mutates a staging row after it has finalized", () => {
    expect(
      canWriteRewriteCandidate(
        { status: "published", generationRunId: "run-1" },
        "run-1"
      )
    ).toBe(false);
  });
});

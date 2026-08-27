import { describe, expect, it } from "vitest";
import {
  publicationContentHash,
  shouldActivatePublication
} from "./publication.js";

describe("publication finality", () => {
  it("hashes equivalent objects identically regardless of key order", () => {
    expect(publicationContentHash({ b: 2, a: { y: 2, x: 1 } })).toBe(
      publicationContentHash({ a: { x: 1, y: 2 }, b: 2 })
    );
  });

  it("does not let an older completed generation roll back the active output", () => {
    expect(shouldActivatePublication(3, 2)).toBe(false);
    expect(shouldActivatePublication(3, 3)).toBe(true);
    expect(shouldActivatePublication(3, 4)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { createMagicToken, sha256 } from "./hash.js";

describe("hash utils", () => {
  it("creates unique magic tokens", () => {
    const tokenA = createMagicToken();
    const tokenB = createMagicToken();
    expect(tokenA).not.toEqual(tokenB);
    expect(tokenA.length).toBeGreaterThan(20);
  });

  it("creates deterministic hash", () => {
    const value = "test-token";
    expect(sha256(value)).toEqual(sha256(value));
  });
});


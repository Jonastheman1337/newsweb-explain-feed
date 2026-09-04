import { describe, expect, it } from "vitest";
import { isDraftOwnedAndLive, parseSakOwnerHeader, sakExpiresAt } from "./sak-owner.js";

describe("parseSakOwnerHeader", () => {
  it("accepts a well-formed editor id", () => {
    expect(parseSakOwnerHeader({ "x-sak-owner": "ed_Abc123-xyz" })).toBe("ed_Abc123-xyz");
    expect(parseSakOwnerHeader({ "x-sak-owner": ["first_owner_id", "second"] })).toBe("first_owner_id");
  });

  it("rejects missing, short or malformed ids", () => {
    expect(parseSakOwnerHeader({})).toBeNull();
    expect(parseSakOwnerHeader({ "x-sak-owner": "short" })).toBeNull();
    expect(parseSakOwnerHeader({ "x-sak-owner": "has space inside" })).toBeNull();
    expect(parseSakOwnerHeader({ "x-sak-owner": "x".repeat(81) })).toBeNull();
    expect(parseSakOwnerHeader({ "x-sak-owner": "semi;colon;id" })).toBeNull();
  });
});

describe("isDraftOwnedAndLive", () => {
  const now = new Date("2026-09-04T10:00:00Z");

  it("requires the same owner and a future expiry", () => {
    const live = { ownerId: "owner_12345", expiresAt: new Date("2026-09-05T10:00:00Z") };
    expect(isDraftOwnedAndLive(live, "owner_12345", now)).toBe(true);
    expect(isDraftOwnedAndLive(live, "other_owner_1", now)).toBe(false);
    expect(
      isDraftOwnedAndLive({ ...live, expiresAt: new Date("2026-09-04T09:59:59Z") }, "owner_12345", now)
    ).toBe(false);
    expect(isDraftOwnedAndLive(null, "owner_12345", now)).toBe(false);
  });
});

describe("sakExpiresAt", () => {
  it("adds the ttl in hours", () => {
    const now = new Date("2026-09-04T10:00:00Z");
    expect(sakExpiresAt(now, 24).toISOString()).toBe("2026-09-05T10:00:00.000Z");
    expect(sakExpiresAt(now, 0.5).toISOString()).toBe("2026-09-04T10:30:00.000Z");
  });
});

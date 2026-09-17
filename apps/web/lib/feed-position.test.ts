import { describe, expect, it } from "vitest";
import { FEED_CURSOR_EPOCH, resetOldFeedPosition } from "./feed-position";
describe("reset pre-existing feed positions", () => {
  it("resets the reported bookmarked URL on reload or server refresh", () => {
    const params = Object.fromEntries(new URL("https://autoweb24.no/?cursor=2026-09-16T20%3A10%3A22.769Z&cursorId=682512").searchParams);
    expect(resetOldFeedPosition(params)).toBe("/");
  });
  it("preserves search, market, issuer and display filters", () => {
    const href = resetOldFeedPosition({cursor:"2026-09-16T20:10:22.769Z",cursorId:"682512",market:"XOSL",q:"olje og gass",issuer:"EQNR",generated:"1"});
    const query = new URL(href!,"https://autoweb24.no").searchParams;
    expect(Object.fromEntries(query)).toEqual({market:"XOSL",q:"olje og gass",issuer:"EQNR",generated:"1"});
  });
  it("allows intentional pagination created after the reset", () => {
    expect(resetOldFeedPosition({cursor:"2026-09-16T20:10:22.769Z",cursorId:"682512",cursorEpoch:FEED_CURSOR_EPOCH})).toBeNull();
  });
  it("does not redirect the latest feed or create a redirect loop", () => {
    expect(resetOldFeedPosition({})).toBeNull();
    expect(resetOldFeedPosition({market:"XOSL"})).toBeNull();
  });
  it("resets a stale epoch and orphaned cursor id", () => {
    expect(resetOldFeedPosition({cursorId:"682512",cursorEpoch:"old"})).toBe("/");
  });
});

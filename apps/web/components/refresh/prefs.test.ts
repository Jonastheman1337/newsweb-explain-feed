// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NEXT_PREFS_CHANGE_EVENT,
  NEXT_PREFS_KEY,
  clampSourceRatio,
  readNextPrefs,
  writeNextPrefs
} from "./prefs";

describe("next prefs", () => {
  beforeEach(() => {
    localStorage.clear();
    writeNextPrefs({ sourceRatio: undefined, sourceFontPx: undefined });
  });

  it("ignores garbage and out-of-range values", () => {
    localStorage.setItem(NEXT_PREFS_KEY, "{not json");
    expect(readNextPrefs()).toEqual({});
    localStorage.setItem(NEXT_PREFS_KEY, JSON.stringify({ sourceRatio: 0.9, sourceFontPx: 12, noticeChars: 99999.4 }));
    expect(readNextPrefs()).toEqual({ sourceRatio: 0.7, noticeChars: 4000 });
    expect(clampSourceRatio(Number.NaN)).toBe(0.3);
    expect(clampSourceRatio(0.4567)).toBe(0.457);
  });

  it("merges patches, removes undefined fields and announces the change", () => {
    const listener = vi.fn();
    window.addEventListener(NEXT_PREFS_CHANGE_EVENT, listener);
    writeNextPrefs({ sourceFontPx: 15 });
    writeNextPrefs({ sourceRatio: 0.55 });
    expect(JSON.parse(localStorage.getItem(NEXT_PREFS_KEY)!)).toEqual({ sourceFontPx: 15, sourceRatio: 0.55 });
    writeNextPrefs({ sourceRatio: undefined });
    expect(readNextPrefs()).toEqual({ sourceFontPx: 15 });
    expect(listener).toHaveBeenCalledTimes(3);
    window.removeEventListener(NEXT_PREFS_CHANGE_EVENT, listener);
  });

  it("keeps the preference for the session when storage throws", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    writeNextPrefs({ sourceFontPx: 16 });
    expect(readNextPrefs()).toEqual({ sourceFontPx: 16 });
    setItem.mockRestore();
    getItem.mockRestore();
  });
});

import { describe, expect, it } from "vitest";
import { loginDestination, readUiFeatures } from "./ui-features";

describe("UI rollout boundaries", () => {
  it("defaults off and switches independently", () => {
    expect(readUiFeatures({})).toEqual({ uiV2: false, fastDraft: false });
    expect(readUiFeatures({ UI_V2_ENABLED: "true" })).toEqual({ uiV2: true, fastDraft: false });
    expect(readUiFeatures({ FAST_DRAFT_ENABLED: "true" })).toEqual({
      uiV2: false,
      fastDraft: true
    });
    expect(readUiFeatures({ UI_V2_ENABLED: "1", FAST_DRAFT_ENABLED: "TRUE" })).toEqual({
      uiV2: false,
      fastDraft: false
    });
  });
  it("only accepts the new internal login destination", () => {
    expect(loginDestination("/next")).toBe("/next");
    for (const next of [
      undefined,
      "/feed",
      "//evil.example",
      "https://evil.example",
      "/next/../../api",
      "/next?redirect=//evil.example"
    ])
      expect(loginDestination(next)).toBe("/feed");
  });
});

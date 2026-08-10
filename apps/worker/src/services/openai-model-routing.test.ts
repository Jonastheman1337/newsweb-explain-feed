import { describe, expect, it } from "vitest";

import { routeOpenAIModel } from "./openai-model-routing.js";

describe("routeOpenAIModel", () => {
  const models = {
    mainModel: "gpt-5.6-terra",
    hardModel: "gpt-5.6-sol"
  };

  it.each(["none", "minimal", "low", "medium", "high"] as const)(
    "routes %s to the main model",
    (reasoningEffort) => {
      expect(routeOpenAIModel({ ...models, reasoningEffort })).toBe(
        "gpt-5.6-terra"
      );
    }
  );

  it.each(["xhigh", "max"] as const)(
    "routes %s to the hard model",
    (reasoningEffort) => {
      expect(routeOpenAIModel({ ...models, reasoningEffort })).toBe(
        "gpt-5.6-sol"
      );
    }
  );
});

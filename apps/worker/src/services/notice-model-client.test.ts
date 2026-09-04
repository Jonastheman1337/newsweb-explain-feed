import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNoticeJsonCaller, type NoticeJsonRequest } from "./notice-model-client.js";

const transport = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ synthetic: true })),
  call: vi.fn(async () => ({
    content: "{}", responseModel: "synthetic-served-model", requestedServiceTier: "default", serviceTier: "default",
    attemptCount: 1, attempts: [], usage: null
  }))
}));
vi.mock("./openai-responses.js", () => ({
  createOpenAIClient: transport.createClient, callOpenAIForJson: transport.call, getOpenAIErrorTelemetry: () => null
}));

const options = { apiKey: "synthetic-key", model: "main-model", hardModel: "hard-model", serviceTier: "default" as const, reasoningEffort: "medium" as const };
const request: NoticeJsonRequest = { schemaName: "notice_rewrite_output", schema: {}, systemPrompt: "", developerPrompt: "", userPrompt: "" };

beforeEach(() => vi.clearAllMocks());

describe("notice model routing", () => {
  it.each(["xhigh", "max"] as const)("routes %s writer calls to the explicit hard model and medium checks to the main model", async effort => {
    const call = createNoticeJsonCaller(options);
    const writer = await call({ ...request, reasoningEffort: effort });
    const checker = await call({ ...request, schemaName: "reference_check_result", reasoningEffort: "medium" });
    expect(transport.call).toHaveBeenNthCalledWith(1, { synthetic: true }, expect.objectContaining({ model: "hard-model", reasoningEffort: effort }));
    expect(transport.call).toHaveBeenNthCalledWith(2, { synthetic: true }, expect.objectContaining({ model: "main-model", reasoningEffort: "medium" }));
    expect(writer.modelCall.model).toBe("hard-model");
    expect(checker.modelCall.model).toBe("main-model");
    expect(writer.modelCall.responseModel).toBe("synthetic-served-model");
  });

  it("rejects an implicit hard model before making a model request", async () => {
    const call = createNoticeJsonCaller({ ...options, hardModel: undefined });
    await expect(call({ ...request, reasoningEffort: "xhigh" })).rejects.toThrow("explicit hardModel");
    expect(transport.call).not.toHaveBeenCalled();
  });

  it("rejects a missing default hard model before creating the transport", () => {
    expect(() => createNoticeJsonCaller({ ...options, hardModel: undefined, reasoningEffort: "max" })).toThrow("explicit hardModel");
    expect(transport.createClient).not.toHaveBeenCalled();
  });

  it("allows an explicitly selected single model for both routes", async () => {
    const result = await createNoticeJsonCaller({ ...options, hardModel: "main-model" })({ ...request, reasoningEffort: "xhigh" });
    expect(result.modelCall.model).toBe("main-model");
    expect(transport.call).toHaveBeenCalledWith({ synthetic: true }, expect.objectContaining({ model: "main-model", reasoningEffort: "xhigh" }));
  });
});

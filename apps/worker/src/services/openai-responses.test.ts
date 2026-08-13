import { describe, expect, it } from "vitest";
import {
  callOpenAIForJson,
  getOpenAIErrorTelemetry,
  validateOpenAIModelReasoningEffort,
  type OpenAIResponsesClient
} from "./openai-responses.js";

type CapturedCall = {
  body: any;
  options?: { signal?: AbortSignal };
};

function createMockClient({
  calls,
  outputText,
  error,
  response
}: {
  calls?: CapturedCall[];
  outputText?: string | null;
  error?: Error;
  response?: {
    id?: string;
    status?: string;
    model?: string;
    service_tier?: string | null;
    usage?: unknown;
    error?: unknown;
    incomplete_details?: unknown;
  };
}): OpenAIResponsesClient {
  return {
    responses: {
      create: async (body, options) => {
        calls?.push({ body, options });
        if (error) throw error;
        return { output_text: outputText, ...response };
      }
    }
  };
}

describe("callOpenAIForJson", () => {
  const baseRequest = {
    schemaName: "test_schema",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: { ok: { type: "boolean" } },
      required: ["ok"]
    },
    systemPrompt: "system",
    developerPrompt: "developer",
    userPrompt: "user",
    model: "gpt-5.5",
    reasoningEffort: "low" as const,
    timeoutMs: 60_000,
    maxOutputTokens: 512
  };

  it("returns structured output_text and sends Responses JSON schema settings", async () => {
    const calls: CapturedCall[] = [];
    const client = createMockClient({ calls, outputText: ' {"ok":true} ' });

    await expect(callOpenAIForJson(client, baseRequest)).resolves.toMatchObject({
      content: '{"ok":true}',
      attemptCount: 1,
      usage: null
    });

    const { body, options } = calls[0]!;
    expect(body.model).toBe("gpt-5.5");
    expect(body.reasoning).toEqual({ effort: "low", context: "current_turn" });
    expect(body.service_tier).toBe("default");
    expect(body.max_output_tokens).toBe(512);
    expect(body.store).toBe(false);
    expect(body.text.format).toEqual({
      type: "json_schema",
      name: "test_schema",
      schema: baseRequest.schema,
      strict: true
    });
    expect(body.input).toEqual([
      { role: "system", content: "system" },
      { role: "developer", content: "developer" },
      { role: "user", content: "user" }
    ]);
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it("retries and throws with diagnostics when OpenAI returns no output_text", async () => {
    const calls: CapturedCall[] = [];
    const client = createMockClient({ calls, outputText: "" });

    await expect(callOpenAIForJson(client, baseRequest)).rejects.toThrow(
      /no output_text.*after 2 attempts.*model=gpt-5\.5.*promptChars=19.*emptyResponses=attempt1=empty_response_metadata ; attempt2=empty_response_metadata/
    );
    expect(calls).toHaveLength(2);
  });

  it("doubles the token budget when the response is incomplete on max_output_tokens", async () => {
    const calls: CapturedCall[] = [];
    const client = createMockClient({
      calls,
      outputText: "",
      response: {
        id: "resp_123",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" }
      }
    });

    await expect(callOpenAIForJson(client, baseRequest)).rejects.toThrow(
      /OpenAI response incomplete \(max_output_tokens\) for test_schema after 2 attempts.*attempt1=id=resp_123 status=incomplete incomplete=.*max_output_tokens/
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]!.body.max_output_tokens).toBe(512);
    expect(calls[1]!.body.max_output_tokens).toBe(1024);
  });

  it("aggregates exact token usage across billed retry attempts", async () => {
    const calls: CapturedCall[] = [];
    let attempt = 0;
    const client: OpenAIResponsesClient = {
      responses: {
        create: async (body, options) => {
          calls.push({ body, options });
          attempt += 1;
          if (attempt === 1) {
            return {
              id: "resp_first",
              status: "incomplete",
              model: "gpt-5.6-2026-08-07",
              service_tier: "default",
              incomplete_details: { reason: "max_output_tokens" },
              output_text: "",
              usage: {
                input_tokens: 100,
                input_tokens_details: {
                  cached_tokens: 40,
                  cache_write_tokens: 10
                },
                output_tokens: 512,
                output_tokens_details: { reasoning_tokens: 500 },
                total_tokens: 612
              }
            };
          }
          return {
            id: "resp_second",
            status: "completed",
            model: "gpt-5.6-2026-08-07",
            service_tier: "default",
            output_text: '{"ok":true}',
            usage: {
              input_tokens: 100,
              input_tokens_details: { cached_tokens: 90 },
              output_tokens: 20,
              output_tokens_details: { reasoning_tokens: 8 },
              total_tokens: 120
            }
          };
        }
      }
    };

    const result = await callOpenAIForJson(client, baseRequest);

    expect(result.content).toBe('{"ok":true}');
    expect(result.attemptCount).toBe(2);
    expect(result.responseModel).toBe("gpt-5.6-2026-08-07");
    expect(result.serviceTier).toBe("default");
    expect(result.requestedServiceTier).toBe("default");
    expect(result.attempts.map((item) => item.requestedMaxOutputTokens)).toEqual([
      512,
      1024
    ]);
    expect(result.usage).toEqual({
      inputTokens: 200,
      cachedInputTokens: 130,
      cacheWriteInputTokens: 10,
      outputTokens: 532,
      reasoningTokens: 508,
      totalTokens: 732
    });
  });

  it("attaches billed usage to terminal empty-response errors", async () => {
    const client = createMockClient({
      outputText: "",
      response: {
        status: "completed",
        usage: {
          input_tokens: 12,
          output_tokens: 3,
          total_tokens: 15
        }
      }
    });

    try {
      await callOpenAIForJson(client, baseRequest);
      throw new Error("expected callOpenAIForJson to fail");
    } catch (error) {
      expect(getOpenAIErrorTelemetry(error)).toMatchObject({
        attemptCount: 2,
        usage: {
          inputTokens: 24,
          outputTokens: 6,
          totalTokens: 30
        }
      });
    }
  });

  it("passes prompt_cache_key only when provided", async () => {
    const calls: CapturedCall[] = [];
    const client = createMockClient({ calls, outputText: '{"ok":true}' });

    await callOpenAIForJson(client, baseRequest);
    expect(calls[0]!.body).not.toHaveProperty("prompt_cache_key");

    await callOpenAIForJson(client, {
      ...baseRequest,
      promptCacheKey: "newsweb:rewrite-regular:v5.8.0"
    });
    expect(calls[1]!.body.prompt_cache_key).toBe("newsweb:rewrite-regular:v5.8.0");
  });

  it("omits prompt_cache_options for default and implicit modes", async () => {
    const calls: CapturedCall[] = [];
    const client = createMockClient({ calls, outputText: '{"ok":true}' });

    await callOpenAIForJson(client, baseRequest);
    await callOpenAIForJson(client, {
      ...baseRequest,
      promptCacheMode: "implicit"
    });

    for (const call of calls) {
      expect(call.body).not.toHaveProperty("prompt_cache_options");
      expect(JSON.stringify(call.body)).not.toContain("prompt_cache_breakpoint");
      expect(call.body.input).toEqual([
        { role: "system", content: "system" },
        { role: "developer", content: "developer" },
        { role: "user", content: "user" }
      ]);
    }
  });

  it("places an explicit cache breakpoint on the developer block in explicit mode", async () => {
    const calls: CapturedCall[] = [];
    const client = createMockClient({ calls, outputText: '{"ok":true}' });

    await callOpenAIForJson(client, {
      ...baseRequest,
      promptCacheKey: "newsweb:rewrite-regular:v5.9.1",
      promptCacheMode: "explicit"
    });

    const { body } = calls[0]!;
    expect(body.prompt_cache_options).toEqual({ mode: "explicit" });
    expect(body.prompt_cache_key).toBe("newsweb:rewrite-regular:v5.9.1");
    expect(body.input[0]).toEqual({
      role: "system",
      content: [{ type: "input_text", text: "system" }]
    });
    expect(body.input[1]).toEqual({
      role: "developer",
      content: [
        {
          type: "input_text",
          text: "developer",
          prompt_cache_breakpoint: { mode: "explicit" }
        }
      ]
    });
    expect(body.input[2]).toEqual({ role: "user", content: "user" });
  });

  it("keeps the user file content uncached in explicit mode", async () => {
    const calls: CapturedCall[] = [];
    const client = createMockClient({ calls, outputText: '{"ok":true}' });

    await callOpenAIForJson(client, {
      ...baseRequest,
      promptCacheMode: "explicit",
      file: {
        filename: "report.pdf",
        mimeType: "application/pdf",
        data: Buffer.from("pdf-bytes")
      }
    });

    const { body } = calls[0]!;
    expect(body.input[1].content[0].prompt_cache_breakpoint).toEqual({
      mode: "explicit"
    });
    expect(body.input[2].content).toEqual([
      {
        type: "input_file",
        filename: "report.pdf",
        file_data: `data:application/pdf;base64,${Buffer.from("pdf-bytes").toString("base64")}`
      },
      { type: "input_text", text: "user" }
    ]);
    expect(JSON.stringify(body.input[2])).not.toContain("prompt_cache_breakpoint");
  });

  it("keeps the breakpoint on developer when the system prompt is empty in explicit mode", async () => {
    const calls: CapturedCall[] = [];
    const client = createMockClient({ calls, outputText: '{"ok":true}' });

    await callOpenAIForJson(client, {
      ...baseRequest,
      systemPrompt: "",
      promptCacheMode: "explicit"
    });

    const { body } = calls[0]!;
    expect(body.input).toHaveLength(2);
    expect(body.input[0].role).toBe("developer");
    expect(body.input[0].content[0].prompt_cache_breakpoint).toEqual({
      mode: "explicit"
    });
  });

  it("disables caching via explicit mode with zero breakpoints when mode is off", async () => {
    const calls: CapturedCall[] = [];
    const client = createMockClient({ calls, outputText: '{"ok":true}' });

    await callOpenAIForJson(client, {
      ...baseRequest,
      promptCacheKey: "newsweb:pdf-context:v5.9.1",
      promptCacheMode: "off"
    });

    const { body } = calls[0]!;
    expect(body.prompt_cache_options).toEqual({ mode: "explicit" });
    expect(body.prompt_cache_key).toBe("newsweb:pdf-context:v5.9.1");
    expect(JSON.stringify(body)).not.toContain("prompt_cache_breakpoint");
    expect(body.input).toEqual([
      { role: "system", content: "system" },
      { role: "developer", content: "developer" },
      { role: "user", content: "user" }
    ]);
  });

  it("preserves the cache mode across the max_output_tokens retry", async () => {
    const calls: CapturedCall[] = [];
    const client = createMockClient({
      calls,
      outputText: "",
      response: {
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" }
      }
    });

    await expect(
      callOpenAIForJson(client, { ...baseRequest, promptCacheMode: "explicit" })
    ).rejects.toThrow(/incomplete/);

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.body.prompt_cache_options).toEqual({ mode: "explicit" });
      expect(
        call.body.input[1].content[0].prompt_cache_breakpoint
      ).toEqual({ mode: "explicit" });
    }
  });

  it("wraps API errors with the schema name", async () => {
    const client = createMockClient({ error: new Error("rate limited") });
    try {
      await callOpenAIForJson(client, baseRequest);
      throw new Error("expected callOpenAIForJson to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(
        /OpenAI request failed for test_schema: rate limited.*model=gpt-5\.5/
      );
      expect(getOpenAIErrorTelemetry(error)).toMatchObject({
        attemptCount: 1,
        requestedServiceTier: "default",
        attempts: [
          {
            status: "failed",
            requestedServiceTier: "default",
            error: expect.stringContaining("rate limited")
          }
        ]
      });
    }
  });

  it("passes per-task model, reasoning, timeout, and PDF file input", async () => {
    const calls: CapturedCall[] = [];
    const client = createMockClient({ calls, outputText: '{"ok":true}' });

    await callOpenAIForJson(client, {
      ...baseRequest,
      model: "gpt-5.4-mini",
      reasoningEffort: "none",
      timeoutMs: 15_000,
      file: {
        filename: "report.pdf",
        mimeType: "application/pdf",
        data: Buffer.from("pdf-bytes")
      }
    });

    const { body } = calls[0]!;
    expect(body.model).toBe("gpt-5.4-mini");
    expect(body.reasoning).toEqual({ effort: "none", context: "current_turn" });
    expect(body.input[2].content[0]).toEqual({
      type: "input_file",
      filename: "report.pdf",
      file_data: `data:application/pdf;base64,${Buffer.from("pdf-bytes").toString("base64")}`
    });
    expect(body.input[2].content[1]).toEqual({
      type: "input_text",
      text: "user"
    });
  });

  it("rejects unsupported model and reasoning combinations before the API call", () => {
    expect(() =>
      validateOpenAIModelReasoningEffort("gpt-5.6-terra", "minimal")
    ).toThrow(/does not support reasoning effort minimal/);
    expect(() => validateOpenAIModelReasoningEffort("gpt-5.5", "max")).toThrow(
      /does not support reasoning effort max/
    );
    expect(() =>
      validateOpenAIModelReasoningEffort("gpt-5.6-sol", "max")
    ).not.toThrow();
  });
});

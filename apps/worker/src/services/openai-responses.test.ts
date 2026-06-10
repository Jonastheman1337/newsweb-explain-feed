import { describe, expect, it } from "vitest";
import {
  callOpenAIForJson,
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

    await expect(callOpenAIForJson(client, baseRequest)).resolves.toBe('{"ok":true}');

    const { body, options } = calls[0]!;
    expect(body.model).toBe("gpt-5.5");
    expect(body.reasoning).toEqual({ effort: "low" });
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

  it("wraps API errors with the schema name", async () => {
    const client = createMockClient({ error: new Error("rate limited") });

    await expect(callOpenAIForJson(client, baseRequest)).rejects.toThrow(
      /OpenAI request failed for test_schema: rate limited.*model=gpt-5\.5/
    );
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
    expect(body.reasoning).toEqual({ effort: "none" });
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
});

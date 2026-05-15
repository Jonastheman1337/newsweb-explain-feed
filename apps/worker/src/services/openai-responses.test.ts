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
  error
}: {
  calls?: CapturedCall[];
  outputText?: string | null;
  error?: Error;
}): OpenAIResponsesClient {
  return {
    responses: {
      create: async (body, options) => {
        calls?.push({ body, options });
        if (error) throw error;
        return { output_text: outputText };
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

  it("throws when OpenAI returns no output_text", async () => {
    const client = createMockClient({ outputText: "" });

    await expect(callOpenAIForJson(client, baseRequest)).rejects.toThrow(
      /no output_text/
    );
  });

  it("wraps API errors with the schema name", async () => {
    const client = createMockClient({ error: new Error("rate limited") });

    await expect(callOpenAIForJson(client, baseRequest)).rejects.toThrow(
      /OpenAI request failed for test_schema: rate limited/
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

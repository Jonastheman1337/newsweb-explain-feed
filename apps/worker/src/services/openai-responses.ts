import OpenAI from "openai";

export const openAIReasoningEfforts = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh"
] as const;

export type OpenAIReasoningEffort = (typeof openAIReasoningEfforts)[number];

export type OpenAIResponsesClient = {
  responses: {
    create: (
      body: any,
      options?: { signal?: AbortSignal }
    ) => Promise<{ output_text?: string | null }>;
  };
};

export type OpenAIFileInput = {
  filename: string;
  mimeType: string;
  data: Buffer;
};

export type OpenAIJsonRequest = {
  schemaName: string;
  schema: Record<string, unknown>;
  systemPrompt: string;
  developerPrompt: string;
  userPrompt: string;
  model: string;
  reasoningEffort: OpenAIReasoningEffort;
  timeoutMs: number;
  maxOutputTokens: number;
  temperature?: number;
  file?: OpenAIFileInput;
};

export function createOpenAIClient(apiKey: string): OpenAIResponsesClient {
  return new OpenAI({ apiKey }) as OpenAIResponsesClient;
}

export async function callOpenAIForJson(
  client: OpenAIResponsesClient,
  request: OpenAIJsonRequest
): Promise<string> {
  const response = await callOpenAIResponse(client, request);
  const content = response.output_text?.trim() ?? "";
  if (!content) {
    throw new Error(`OpenAI returned no output_text for ${request.schemaName}`);
  }
  return content;
}

async function callOpenAIResponse(
  client: OpenAIResponsesClient,
  request: OpenAIJsonRequest
): Promise<{ output_text?: string | null }> {
  try {
    return await client.responses.create(
      {
        model: request.model,
        max_output_tokens: request.maxOutputTokens,
        store: false,
        reasoning: { effort: request.reasoningEffort },
        ...(request.temperature !== undefined
          ? { temperature: request.temperature }
          : {}),
        input: [
          { role: "system", content: request.systemPrompt },
          { role: "developer", content: request.developerPrompt },
          {
            role: "user",
            content: request.file
              ? [
                  {
                    type: "input_file",
                    filename: request.file.filename,
                    file_data: `data:${request.file.mimeType};base64,${request.file.data.toString("base64")}`
                  },
                  { type: "input_text", text: request.userPrompt }
                ]
              : request.userPrompt
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: request.schemaName,
            schema: request.schema,
            strict: true
          },
          verbosity: "low"
        }
      },
      { signal: AbortSignal.timeout(request.timeoutMs) }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`OpenAI request failed for ${request.schemaName}: ${message}`);
  }
}

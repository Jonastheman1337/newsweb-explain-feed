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
    ) => Promise<OpenAIJsonResponse>;
  };
};

type OpenAIJsonResponse = {
  output_text?: string | null;
  id?: string;
  status?: string;
  error?: unknown;
  incomplete_details?: unknown;
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
  const attempts = 2;
  let lastResponseSummary = "";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await callOpenAIResponse(client, request);
    const content = response.output_text?.trim() ?? "";
    if (content) {
      return content;
    }
    lastResponseSummary = summarizeResponse(response);
  }

  throw new Error(
    [
      `OpenAI returned no output_text for ${request.schemaName} after ${attempts} attempts`,
      requestDiagnostics(request),
      lastResponseSummary ? `lastResponse=${lastResponseSummary}` : null
    ]
      .filter(Boolean)
      .join(" | ")
  );
}

function requestDiagnostics(request: OpenAIJsonRequest): string {
  const promptChars =
    request.systemPrompt.length +
    request.developerPrompt.length +
    request.userPrompt.length;
  return [
    `model=${request.model}`,
    `reasoning=${request.reasoningEffort}`,
    `timeoutMs=${request.timeoutMs}`,
    `maxOutputTokens=${request.maxOutputTokens}`,
    `promptChars=${promptChars}`
  ].join(" ");
}

function summarizeResponse(response: {
  id?: string;
  status?: string;
  error?: unknown;
  incomplete_details?: unknown;
}): string {
  const parts: string[] = [];
  if (response.id) parts.push(`id=${response.id}`);
  if (response.status) parts.push(`status=${response.status}`);
  if (response.error != null) parts.push(`error=${truncateJson(response.error)}`);
  if (response.incomplete_details != null) {
    parts.push(`incomplete=${truncateJson(response.incomplete_details)}`);
  }
  return parts.join(" ");
}

function truncateJson(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

async function callOpenAIResponse(
  client: OpenAIResponsesClient,
  request: OpenAIJsonRequest
): Promise<OpenAIJsonResponse> {
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
    throw new Error(
      `OpenAI request failed for ${request.schemaName}: ${message} | ${requestDiagnostics(request)}`
    );
  }
}

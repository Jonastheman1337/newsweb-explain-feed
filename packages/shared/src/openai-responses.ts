import OpenAI from "openai";
import {
  createOpenAIFailureTelemetry,
  extractOpenAIResponseTelemetry,
  summarizeOpenAIAttempts,
  type OpenAIAttemptTelemetry,
  type OpenAIModelCallTelemetry
} from "./openai-usage.js";

export const openAIReasoningEfforts = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
] as const;

export type OpenAIReasoningEffort = (typeof openAIReasoningEfforts)[number];

export const openAIServiceTiers = [
  "auto",
  "default",
  "flex",
  "priority",
  "fast"
] as const;

export type OpenAIServiceTier = (typeof openAIServiceTiers)[number];
export type OpenAIReasoningContext = "auto" | "current_turn" | "all_turns";

export const openAIPromptCacheModes = ["implicit", "explicit", "off"] as const;

export type OpenAIPromptCacheMode = (typeof openAIPromptCacheModes)[number];

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
  model?: string;
  service_tier?: string | null;
  usage?: unknown;
  error?: unknown;
  incomplete_details?: unknown;
};

export type OpenAIJsonResult = OpenAIModelCallTelemetry & {
  content: string;
};

type OpenAITelemetryError = Error & {
  openAITelemetry?: OpenAIModelCallTelemetry;
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
  serviceTier?: OpenAIServiceTier;
  reasoningContext?: OpenAIReasoningContext;
  promptCacheKey?: string;
  promptCacheMode?: OpenAIPromptCacheMode;
  file?: OpenAIFileInput;
};

export function createOpenAIClient(apiKey: string): OpenAIResponsesClient {
  return new OpenAI({ apiKey }) as OpenAIResponsesClient;
}

export function validateOpenAIModelReasoningEffort(
  model: string,
  effort: OpenAIReasoningEffort
): void {
  const normalizedModel = model.toLowerCase();
  const isGpt56 = normalizedModel === "gpt-5.6" || normalizedModel.startsWith("gpt-5.6-");
  if (isGpt56 && effort === "minimal") {
    throw new Error(`OpenAI model ${model} does not support reasoning effort minimal`);
  }
  if (!isGpt56 && effort === "max") {
    throw new Error(`OpenAI model ${model} does not support reasoning effort max`);
  }
}

export async function callOpenAIForJson(
  client: OpenAIResponsesClient,
  request: OpenAIJsonRequest
): Promise<OpenAIJsonResult> {
  validateOpenAIModelReasoningEffort(request.model, request.reasoningEffort);
  const attempts = 2;
  const attemptTelemetry: OpenAIAttemptTelemetry[] = [];
  const emptyResponseSummaries: string[] = [];
  let currentRequest = request;
  let hitMaxOutputTokens = false;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const startedAt = Date.now();
    let response: OpenAIJsonResponse;
    try {
      response = await callOpenAIResponse(client, currentRequest);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attemptTelemetry.push(
        createOpenAIFailureTelemetry({
          requestedMaxOutputTokens: currentRequest.maxOutputTokens,
          requestedServiceTier: currentRequest.serviceTier ?? "default",
          durationMs: Date.now() - startedAt,
          error: message,
          providerError: error
        })
      );
      throw attachOpenAITelemetry(
        new Error(
          `OpenAI request failed for ${request.schemaName}: ${message} | ${requestDiagnostics(currentRequest)}`
        ),
        attemptTelemetry
      );
    }
    attemptTelemetry.push(
      extractOpenAIResponseTelemetry(response, currentRequest.maxOutputTokens, {
        requestedServiceTier: currentRequest.serviceTier ?? "default",
        durationMs: Date.now() - startedAt
      })
    );
    const content = response.output_text?.trim() ?? "";
    if (content) {
      return {
        content,
        ...summarizeOpenAIAttempts(attemptTelemetry)
      };
    }
    const summary = summarizeResponse(response);
    emptyResponseSummaries.push(
      `attempt${attempt}=${summary || "empty_response_metadata"}`
    );
    if (isIncompleteDueToMaxOutputTokens(response)) {
      hitMaxOutputTokens = true;
      currentRequest = {
        ...currentRequest,
        maxOutputTokens: currentRequest.maxOutputTokens * 2
      };
    }
  }

  throw attachOpenAITelemetry(
    new Error(
      [
        hitMaxOutputTokens
          ? `OpenAI response incomplete (max_output_tokens) for ${request.schemaName} after ${attempts} attempts`
          : `OpenAI returned no output_text for ${request.schemaName} after ${attempts} attempts`,
        requestDiagnostics(currentRequest),
        emptyResponseSummaries.length
          ? `emptyResponses=${emptyResponseSummaries.join(" ; ")}`
          : null
      ]
        .filter(Boolean)
        .join(" | ")
    ),
    attemptTelemetry
  );
}

export function getOpenAIErrorTelemetry(
  error: unknown
): OpenAIModelCallTelemetry | null {
  if (!(error instanceof Error)) return null;
  return (error as OpenAITelemetryError).openAITelemetry ?? null;
}

function attachOpenAITelemetry(
  error: unknown,
  attempts: OpenAIAttemptTelemetry[]
): OpenAITelemetryError {
  const enriched: OpenAITelemetryError =
    error instanceof Error ? error : new Error(String(error));
  enriched.openAITelemetry = summarizeOpenAIAttempts(attempts);
  return enriched;
}

function isIncompleteDueToMaxOutputTokens(response: OpenAIJsonResponse): boolean {
  if (response.status !== "incomplete") return false;
  const details = response.incomplete_details;
  return (
    typeof details === "object" &&
    details !== null &&
    (details as { reason?: unknown }).reason === "max_output_tokens"
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
    `serviceTier=${request.serviceTier ?? "default"}`,
    `timeoutMs=${request.timeoutMs}`,
    `maxOutputTokens=${request.maxOutputTokens}`,
    `promptChars=${promptChars}`
  ].join(" ");
}

function summarizeResponse(response: OpenAIJsonResponse): string {
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
  const cacheMode = request.promptCacheMode ?? "implicit";
  // "off" disables caching by requesting explicit mode with zero breakpoints;
  // omitting prompt_cache_key would not stop implicit caching.
  const explicitBreakpoint = cacheMode === "explicit";
  return client.responses.create(
      {
        model: request.model,
        max_output_tokens: request.maxOutputTokens,
        store: false,
        service_tier: request.serviceTier ?? "default",
        reasoning: {
          effort: request.reasoningEffort,
          context: request.reasoningContext ?? "current_turn"
        },
        ...(request.promptCacheKey
          ? { prompt_cache_key: request.promptCacheKey }
          : {}),
        ...(cacheMode === "implicit"
          ? {}
          : { prompt_cache_options: { mode: "explicit" } }),
        input: [
          ...(request.systemPrompt
            ? [
                {
                  role: "system",
                  content: explicitBreakpoint
                    ? [{ type: "input_text", text: request.systemPrompt }]
                    : request.systemPrompt
                }
              ]
            : []),
          {
            role: "developer",
            content: explicitBreakpoint
              ? [
                  {
                    type: "input_text",
                    text: request.developerPrompt,
                    prompt_cache_breakpoint: { mode: "explicit" }
                  }
                ]
              : request.developerPrompt
          },
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
}

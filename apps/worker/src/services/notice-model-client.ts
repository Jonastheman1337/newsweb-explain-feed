import type { OpenAIModelCallTelemetry } from "@newsweb/shared";
import { routeOpenAIModel } from "./openai-model-routing.js";
import {
  callOpenAIForJson, createOpenAIClient, getOpenAIErrorTelemetry,
  type OpenAIReasoningEffort, type OpenAIServiceTier, type OpenAIPromptCacheMode
} from "./openai-responses.js";

export type NoticeJsonRequest = {
  schemaName: string; schema: Record<string, unknown>;
  systemPrompt: string; developerPrompt: string; userPrompt: string;
  reasoningEffort?: OpenAIReasoningEffort;
  promptCacheMode?: OpenAIPromptCacheMode; promptCacheKey?: string;
};
export type NoticeModelCallLog = OpenAIModelCallTelemetry & {
  provider: "openai"; schemaName: string; model: string;
  reasoningEffort: OpenAIReasoningEffort; timeoutMs: number; maxOutputTokens: number;
  systemPrompt: string; developerPrompt: string; userPrompt: string; promptChars: number;
  promptCacheMode: OpenAIPromptCacheMode; promptCacheKey: string | null;
};
export type NoticeJsonResponse = { content: string; promptChars: number; modelCall: NoticeModelCallLog };
export type NoticeJsonCaller = (request: NoticeJsonRequest) => Promise<NoticeJsonResponse>;

function routedModel(options: { model: string; hardModel?: string }, reasoningEffort: OpenAIReasoningEffort): string {
  const model = routeOpenAIModel({ mainModel: options.model, hardModel: options.hardModel ?? "", reasoningEffort });
  if (!model.trim()) throw new Error("An explicit hardModel is required for hard-effort calls; use the same model explicitly if that is intentional.");
  return model;
}

/** Same transport/telemetry contract used by the worker adapter and offline runs. */
export function createNoticeJsonCaller(options: {
  apiKey: string; model: string; hardModel?: string; serviceTier: OpenAIServiceTier;
  reasoningEffort: OpenAIReasoningEffort; timeoutMs?: number; maxOutputTokens?: number;
  promptCacheMode?: OpenAIPromptCacheMode;
}): NoticeJsonCaller {
  routedModel(options, options.reasoningEffort);
  const client = createOpenAIClient(options.apiKey);
  return async request => {
    const reasoningEffort = request.reasoningEffort ?? options.reasoningEffort;
    const model = routedModel(options, reasoningEffort);
    const timeoutMs = options.timeoutMs ?? 240_000;
    const maxOutputTokens = options.maxOutputTokens ?? 16_384;
    const promptChars = request.systemPrompt.length + request.developerPrompt.length + request.userPrompt.length;
    const modelCall: NoticeModelCallLog = {
      ...request, provider: "openai", model, reasoningEffort,
      timeoutMs, maxOutputTokens, promptChars,
      promptCacheMode: request.promptCacheMode ?? options.promptCacheMode ?? "implicit",
      promptCacheKey: request.promptCacheKey ?? null,
      responseModel: null, requestedServiceTier: options.serviceTier, serviceTier: null,
      attemptCount: 0, attempts: [], usage: null
    };
    try {
      const result = await callOpenAIForJson(client, {
        ...request, model, reasoningEffort, timeoutMs, maxOutputTokens,
        serviceTier: options.serviceTier, promptCacheMode: modelCall.promptCacheMode
      });
      Object.assign(modelCall, {
        responseModel: result.responseModel, serviceTier: result.serviceTier,
        attemptCount: result.attemptCount, attempts: result.attempts, usage: result.usage
      });
      return { content: result.content, promptChars, modelCall };
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      const telemetry = getOpenAIErrorTelemetry(error);
      if (telemetry) Object.assign(modelCall, telemetry);
      Object.assign(error, { modelCall, promptChars });
      throw error;
    }
  };
}

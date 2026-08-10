export type OpenAITokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

export type OpenAIAttemptTelemetry = {
  responseId: string | null;
  status: string | null;
  responseModel: string | null;
  requestedServiceTier: string | null;
  serviceTier: string | null;
  durationMs: number | null;
  requestedMaxOutputTokens: number | null;
  error: string | null;
  rawUsage: unknown;
  usage: OpenAITokenUsage | null;
};

export type OpenAIModelCallTelemetry = {
  responseModel: string | null;
  requestedServiceTier: string | null;
  serviceTier: string | null;
  attemptCount: number;
  attempts: OpenAIAttemptTelemetry[];
  usage: OpenAITokenUsage | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function extractOpenAITokenUsage(value: unknown): OpenAITokenUsage | null {
  const usage = asRecord(value);
  if (!usage) return null;

  const inputTokens = nonNegativeInteger(usage.input_tokens);
  const outputTokens = nonNegativeInteger(usage.output_tokens);
  const totalTokens = nonNegativeInteger(usage.total_tokens);
  if (inputTokens == null && outputTokens == null && totalTokens == null) {
    return null;
  }

  const inputDetails = asRecord(usage.input_tokens_details);
  const outputDetails = asRecord(usage.output_tokens_details);
  const normalizedInputTokens = inputTokens ?? 0;
  const normalizedOutputTokens = outputTokens ?? 0;

  return {
    inputTokens: normalizedInputTokens,
    cachedInputTokens: nonNegativeInteger(inputDetails?.cached_tokens) ?? 0,
    cacheWriteInputTokens:
      nonNegativeInteger(inputDetails?.cache_write_tokens) ?? 0,
    outputTokens: normalizedOutputTokens,
    reasoningTokens: nonNegativeInteger(outputDetails?.reasoning_tokens) ?? 0,
    totalTokens: totalTokens ?? normalizedInputTokens + normalizedOutputTokens
  };
}

export function extractOpenAIResponseTelemetry(
  value: unknown,
  requestedMaxOutputTokens?: number,
  metadata: {
    requestedServiceTier?: string;
    durationMs?: number;
    error?: string;
  } = {}
): OpenAIAttemptTelemetry {
  const response = asRecord(value);
  return {
    responseId: stringValue(response?.id),
    status: stringValue(response?.status),
    responseModel: stringValue(response?.model),
    requestedServiceTier: stringValue(metadata.requestedServiceTier),
    serviceTier: stringValue(response?.service_tier),
    durationMs: nonNegativeInteger(metadata.durationMs),
    requestedMaxOutputTokens:
      nonNegativeInteger(requestedMaxOutputTokens) ?? null,
    error: stringValue(metadata.error),
    rawUsage: response?.usage ?? null,
    usage: extractOpenAITokenUsage(response?.usage)
  };
}

export function createOpenAIFailureTelemetry({
  requestedMaxOutputTokens,
  requestedServiceTier,
  durationMs,
  error,
  providerError
}: {
  requestedMaxOutputTokens?: number;
  requestedServiceTier?: string;
  durationMs?: number;
  error: string;
  providerError?: unknown;
}): OpenAIAttemptTelemetry {
  const provider = asRecord(providerError);
  const providerStatus = provider?.status;
  return {
    ...extractOpenAIResponseTelemetry(providerError, requestedMaxOutputTokens, {
      requestedServiceTier,
      durationMs,
      error
    }),
    responseId:
      stringValue(provider?.request_id) ?? stringValue(provider?.id) ?? null,
    status:
      typeof providerStatus === "number"
        ? String(providerStatus)
        : stringValue(providerStatus) ?? "failed",
    rawUsage: provider?.usage ?? null
  };
}

export function aggregateOpenAITokenUsage(
  attempts: OpenAIAttemptTelemetry[]
): OpenAITokenUsage | null {
  const usages = attempts
    .map((attempt) => attempt.usage)
    .filter((usage): usage is OpenAITokenUsage => usage != null);
  if (usages.length === 0) return null;

  return usages.reduce<OpenAITokenUsage>(
    (total, usage) => ({
      inputTokens: total.inputTokens + usage.inputTokens,
      cachedInputTokens: total.cachedInputTokens + usage.cachedInputTokens,
      cacheWriteInputTokens:
        total.cacheWriteInputTokens + usage.cacheWriteInputTokens,
      outputTokens: total.outputTokens + usage.outputTokens,
      reasoningTokens: total.reasoningTokens + usage.reasoningTokens,
      totalTokens: total.totalTokens + usage.totalTokens
    }),
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0
    }
  );
}

export function summarizeOpenAIAttempts(
  attempts: OpenAIAttemptTelemetry[]
): OpenAIModelCallTelemetry {
  const lastAttempt = attempts.at(-1);
  return {
    responseModel: lastAttempt?.responseModel ?? null,
    requestedServiceTier: lastAttempt?.requestedServiceTier ?? null,
    serviceTier: lastAttempt?.serviceTier ?? null,
    attemptCount: attempts.length,
    attempts,
    usage: aggregateOpenAITokenUsage(attempts)
  };
}

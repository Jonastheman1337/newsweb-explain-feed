import { readFileSync } from "node:fs";

const SNAPSHOT_URL = new URL("./openai-pricing-2026-08-10.json", import.meta.url);

export const OPENAI_PRICING_SNAPSHOT = JSON.parse(
  readFileSync(SNAPSHOT_URL, "utf8")
);

export const COUNTERFACTUAL_MODELS = [
  "gpt-5.5",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.6-sol"
];

function nonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

export function canonicalOpenAIModel(model, snapshot = OPENAI_PRICING_SNAPSHOT) {
  const value = String(model ?? "").toLowerCase();
  return (
    Object.keys(snapshot.models)
      .sort((a, b) => b.length - a.length)
      .find((candidate) => value === candidate || value.startsWith(`${candidate}-`)) ??
    null
  );
}

export function normalizeOpenAIServiceTier(serviceTier) {
  const value = String(serviceTier ?? "default").toLowerCase();
  if (value === "standard") return "default";
  if (["auto", "default", "flex", "batch", "priority", "fast"].includes(value)) {
    return value;
  }
  return "default";
}

export function calculateOpenAICost({
  model,
  serviceTier = "default",
  usage,
  snapshot = OPENAI_PRICING_SNAPSHOT
}) {
  const canonicalModel = canonicalOpenAIModel(model, snapshot);
  if (!canonicalModel) {
    return {
      knownModel: false,
      model: String(model ?? ""),
      canonicalModel: null,
      serviceTier: normalizeOpenAIServiceTier(serviceTier),
      longContext: false,
      costUsd: null,
      componentsUsd: null
    };
  }

  const rates = snapshot.models[canonicalModel];
  const tier = normalizeOpenAIServiceTier(serviceTier);
  const tierMultiplier = rates.supportsTierMultipliers
    ? snapshot.gpt56ServiceTierMultipliers[tier] ?? 1
    : 1;
  const inputTokens = nonNegativeNumber(usage?.input_tokens ?? usage?.inputTokens);
  const cachedInputTokens = Math.min(
    inputTokens,
    nonNegativeNumber(usage?.cached_input_tokens ?? usage?.cachedInputTokens)
  );
  const observedCacheWriteInputTokens = Math.min(
    Math.max(0, inputTokens - cachedInputTokens),
    nonNegativeNumber(
      usage?.cache_write_input_tokens ?? usage?.cacheWriteInputTokens
    )
  );
  const cacheWriteInputTokens =
    rates.cacheWriteInput > 0 ? observedCacheWriteInputTokens : 0;
  const standardInputTokens = Math.max(
    0,
    inputTokens - cachedInputTokens - cacheWriteInputTokens
  );
  const outputTokens = nonNegativeNumber(usage?.output_tokens ?? usage?.outputTokens);
  const longContext = inputTokens > snapshot.longContext.inputTokenThreshold;
  const inputMultiplier = longContext ? snapshot.longContext.inputMultiplier : 1;
  const outputMultiplier = longContext ? snapshot.longContext.outputMultiplier : 1;
  const perMillion = (tokens, rate, multiplier) =>
    (tokens / 1_000_000) * rate * tierMultiplier * multiplier;
  const componentsUsd = {
    input: perMillion(standardInputTokens, rates.input, inputMultiplier),
    cachedInput: perMillion(
      cachedInputTokens,
      rates.cachedInput,
      inputMultiplier
    ),
    cacheWriteInput: perMillion(
      cacheWriteInputTokens,
      rates.cacheWriteInput,
      inputMultiplier
    ),
    output: perMillion(outputTokens, rates.output, outputMultiplier)
  };
  const costUsd = Object.values(componentsUsd).reduce((sum, value) => sum + value, 0);

  return {
    knownModel: true,
    model: String(model),
    canonicalModel,
    serviceTier: tier,
    longContext,
    costUsd,
    componentsUsd,
    tokens: {
      input: inputTokens,
      standardInput: standardInputTokens,
      cachedInput: cachedInputTokens,
      cacheWriteInput: cacheWriteInputTokens,
      output: outputTokens
    }
  };
}

export function roundUsd(value) {
  return value == null ? null : Number(value.toFixed(6));
}

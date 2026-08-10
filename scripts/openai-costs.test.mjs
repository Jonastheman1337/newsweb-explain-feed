import test from "node:test";
import assert from "node:assert/strict";

import { calculateOpenAICost } from "./openai-costs.mjs";

const mixedUsage = {
  input_tokens: 100_000,
  cached_input_tokens: 50_000,
  cache_write_input_tokens: 10_000,
  output_tokens: 10_000
};

test("calculates GPT-5.6 Standard, Flex, Batch, and Fast rates", () => {
  const expected = {
    default: 0.235,
    flex: 0.1175,
    batch: 0.1175,
    fast: 0.47
  };
  for (const [serviceTier, costUsd] of Object.entries(expected)) {
    const result = calculateOpenAICost({
      model: "gpt-5.6-terra",
      serviceTier,
      usage: mixedUsage
    });
    assert.equal(result.costUsd, costUsd);
  }
});

test("applies the documented long-context input and output uplift", () => {
  const result = calculateOpenAICost({
    model: "gpt-5.6-terra",
    serviceTier: "default",
    usage: {
      input_tokens: 300_000,
      cached_input_tokens: 0,
      cache_write_input_tokens: 0,
      output_tokens: 100_000,
      reasoning_tokens: 80_000
    }
  });
  assert.equal(result.longContext, true);
  assert.equal(result.costUsd, 3);
});

test("does not make observed cache writes free in GPT-5.5 counterfactuals", () => {
  const result = calculateOpenAICost({
    model: "gpt-5.5",
    usage: {
      input_tokens: 100_000,
      cached_input_tokens: 0,
      cache_write_input_tokens: 100_000,
      output_tokens: 0
    }
  });
  assert.equal(result.costUsd, 0.5);
  assert.equal(result.tokens.standardInput, 100_000);
  assert.equal(result.tokens.cacheWriteInput, 0);
});

test("recognizes dated provider model names", () => {
  const result = calculateOpenAICost({
    model: "gpt-5.6-luna-2026-08-07",
    usage: { input_tokens: 100_000, output_tokens: 100_000 }
  });
  assert.equal(result.canonicalModel, "gpt-5.6-luna");
  assert.equal(result.costUsd, 0.14);
});

#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  callOpenAIForJson,
  createOpenAIClient
} from "../packages/shared/dist/openai-responses.js";

function loadApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return "";
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^OPENAI_API_KEY=(.*)$/);
    if (!match) continue;
    let value = match[1].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return "";
}

const profiles = [
  { model: "gpt-5.6-luna", reasoningEffort: "none", role: "fast" },
  { model: "gpt-5.6-terra", reasoningEffort: "medium", role: "main" },
  { model: "gpt-5.6-sol", reasoningEffort: "xhigh", role: "rescue" }
];

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ok: { type: "boolean" },
    model_role: { type: "string", enum: profiles.map((profile) => profile.role) }
  },
  required: ["ok", "model_role"]
};

const apiKey = loadApiKey();
if (!apiKey) throw new Error("OPENAI_API_KEY is required");
const client = createOpenAIClient(apiKey);
const results = [];

for (const profile of profiles) {
  const startedAt = Date.now();
  try {
    const result = await callOpenAIForJson(client, {
      schemaName: "gpt_5_6_router_smoke",
      schema,
      systemPrompt: "",
      developerPrompt: "Return the requested smoke-test marker exactly. Do not add facts.",
      userPrompt: `Return ok=true and model_role=${profile.role}.`,
      model: profile.model,
      reasoningEffort: profile.reasoningEffort,
      serviceTier: "default",
      timeoutMs: 240_000,
      maxOutputTokens: 4096,
      promptCacheKey: "newsweb:gpt-5.6-router-smoke:v1"
    });
    const content = JSON.parse(result.content);
    if (content.ok !== true || content.model_role !== profile.role) {
      throw new Error(`Unexpected structured output: ${result.content}`);
    }
    results.push({
      ...profile,
      success: true,
      latencyMs: Date.now() - startedAt,
      responseModel: result.responseModel,
      requestedServiceTier: result.requestedServiceTier,
      serviceTier: result.serviceTier,
      attempts: result.attemptCount,
      usage: result.usage
    });
  } catch (error) {
    results.push({
      ...profile,
      success: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

console.log(JSON.stringify(results, null, 2));
if (results.some((result) => !result.success)) process.exitCode = 1;

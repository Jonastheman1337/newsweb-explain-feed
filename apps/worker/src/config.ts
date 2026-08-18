import path from "node:path";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";
import {
  numberDerivationRuleIds,
  type NumberDerivationRuleId
} from "@newsweb/prompt-kit";
import {
  openAIPromptCacheModes,
  openAIServiceTiers,
  validateOpenAIModelReasoningEffort
} from "@newsweb/shared/openai-responses";

loadDotEnv({
  path: path.resolve(process.cwd(), ".env"),
  override: false
});

const booleanEnvSchema = z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true");

const reasoningEffortEnvSchema = z.enum([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
]);

const serviceTierEnvSchema = z.enum(openAIServiceTiers);

const promptCacheModeEnvSchema = z.enum(openAIPromptCacheModes);

// Emergency kill-switch override for the numeric derivation rules enabled in
// code (defaultEnabledDerivationRules in @newsweb/prompt-kit). Semantics
// deliberately differ from the cache-mode envs above: UNSET means "use the
// code default", while a SET value — including the empty string — is the
// exact enabled set ("" = every derivation rule off). Rollback of a bad rule
// therefore needs an env change only, no deploy. CI safety gates always
// replay the code default, so any env-enabled rule beyond the default is
// prod-only and unverified by gates (worker boot logs a warning).
const numericAcceptanceRulesEnvSchema = z
  .string()
  .transform((value, ctx) => {
    const entries = [
      ...new Set(
        value
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      )
    ];
    const known = new Set<string>(numberDerivationRuleIds);
    const unknown = entries.filter((entry) => !known.has(entry));
    if (unknown.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown numeric acceptance rule id(s): ${unknown.join(", ")} (known: ${
          numberDerivationRuleIds.join(", ") || "none"
        })`
      });
      return z.NEVER;
    }
    return entries as NumberDerivationRuleId[];
  })
  .optional();

const referenceCheckEnforcementFlags = [
  "block_on_residual_unsupported",
  "retry_on_unavailable"
] as const;

// Emergency kill-switch override for the checker enforcement enabled in code
// (defaultReferenceCheckEnforcement in services/reference-check.ts). Same
// semantics as NUMERIC_ACCEPTANCE_RULES: UNSET = code default; SET — even
// the empty string — is the exact enabled flag set ("" = full legacy
// fail-open behavior). Rollback needs an env change only, no deploy.
const referenceCheckEnforcementEnvSchema = z
  .string()
  .transform((value, ctx) => {
    const entries = [
      ...new Set(
        value
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      )
    ];
    const known = new Set<string>(referenceCheckEnforcementFlags);
    const unknown = entries.filter((entry) => !known.has(entry));
    if (unknown.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown reference-check enforcement flag(s): ${unknown.join(", ")} (known: ${referenceCheckEnforcementFlags.join(", ")})`
      });
      return z.NEVER;
    }
    return {
      blockOnResidualUnsupported: entries.includes(
        "block_on_residual_unsupported"
      ),
      retryOnUnavailable: entries.includes("retry_on_unavailable")
    };
  })
  .optional();

const configSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().url(),
    OPENAI_API_KEY: z
      .string({ required_error: "OPENAI_KEY_MISSING" })
      .trim()
      .min(1, "OPENAI_KEY_MISSING"),
    OPENAI_MODEL: z.string().default("gpt-5.6-terra"),
    OPENAI_FAST_MODEL: z.string().default("gpt-5.6-luna"),
    OPENAI_HARD_MODEL: z.string().default("gpt-5.6-sol"),
    OPENAI_SERVICE_TIER: serviceTierEnvSchema.default("default"),
    OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(240000),
    OPENAI_FAST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15000),
    OPENAI_DEFAULT_REASONING_EFFORT: reasoningEffortEnvSchema.default("medium"),
    OPENAI_REPORT_REASONING_EFFORT: reasoningEffortEnvSchema.default("medium"),
    OPENAI_HARD_REASONING_EFFORT: reasoningEffortEnvSchema.default("xhigh"),
    OPENAI_TRIAGE_REASONING_EFFORT: reasoningEffortEnvSchema.default("none"),
    OPENAI_REFERENCE_REASONING_EFFORT: reasoningEffortEnvSchema.default("medium"),
    OPENAI_REVIEW_REASONING_EFFORT: reasoningEffortEnvSchema.default("medium"),
    OPENAI_PROMPT_CACHE_MODE: promptCacheModeEnvSchema.default("implicit"),
    OPENAI_PROMPT_CACHE_MODE_TRIAGE: promptCacheModeEnvSchema.optional(),
    OPENAI_PROMPT_CACHE_MODE_EDITORIAL_REVIEW: promptCacheModeEnvSchema.optional(),
    OPENAI_PROMPT_CACHE_MODE_REWRITE_REGULAR: promptCacheModeEnvSchema.optional(),
    OPENAI_PROMPT_CACHE_MODE_REFERENCE_CHECK: promptCacheModeEnvSchema.optional(),
    OPENAI_PROMPT_CACHE_MODE_REWRITE_REPORT: promptCacheModeEnvSchema.optional(),
    OPENAI_PROMPT_CACHE_MODE_REWRITE_YEARLY: promptCacheModeEnvSchema.optional(),
    OPENAI_PROMPT_CACHE_MODE_PDF_CONTEXT: promptCacheModeEnvSchema.optional(),
    NUMERIC_ACCEPTANCE_RULES: numericAcceptanceRulesEnvSchema,
    REFERENCE_CHECK_ENFORCEMENT: referenceCheckEnforcementEnvSchema,
    NEWSWEB_POLLING_ENABLED: booleanEnvSchema,
    POLL_INTERVAL_MS: z.coerce.number().int().min(5000).default(5000),
    LATEST_BOOTSTRAP_COUNT: z.coerce.number().int().min(0).max(50).default(30)
  });

export type WorkerConfig = z.infer<typeof configSchema>;

export function parseWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const parsed = configSchema.parse(env);
  for (const effort of [
    parsed.OPENAI_DEFAULT_REASONING_EFFORT,
    parsed.OPENAI_REPORT_REASONING_EFFORT,
    parsed.OPENAI_REFERENCE_REASONING_EFFORT,
    parsed.OPENAI_REVIEW_REASONING_EFFORT
  ]) {
    validateOpenAIModelReasoningEffort(parsed.OPENAI_MODEL, effort);
  }
  validateOpenAIModelReasoningEffort(
    parsed.OPENAI_FAST_MODEL,
    parsed.OPENAI_TRIAGE_REASONING_EFFORT
  );
  validateOpenAIModelReasoningEffort(
    parsed.OPENAI_HARD_MODEL,
    parsed.OPENAI_HARD_REASONING_EFFORT
  );
  return parsed;
}

export function loadConfig(): WorkerConfig {
  return parseWorkerConfig(process.env);
}

import path from "node:path";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

loadDotEnv({
  path: path.resolve(process.cwd(), ".env"),
  override: false
});

const configSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().url(),
    LITELLM_API_KEY: z
      .string({ required_error: "LITELLM_KEY_MISSING" })
      .trim()
      .min(1, "LITELLM_KEY_MISSING"),
    LITELLM_BASE_URL: z
      .string({ required_error: "LITELLM_BASE_URL_MISSING" })
      .trim()
      .url("LITELLM_BASE_URL_INVALID"),
    LITELLM_MODEL: z.string().default("claude-sonnet-4-6"),
    LITELLM_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60000),
    POLL_INTERVAL_MS: z.coerce.number().int().min(5000).default(20000),
    LATEST_BOOTSTRAP_COUNT: z.coerce.number().int().min(0).max(50).default(10)
  });

export type WorkerConfig = z.infer<typeof configSchema>;

export function parseWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  return configSchema.parse({
    ...env,
    LITELLM_BASE_URL: env.LITELLM_BASE_URL ?? env.LITELLM_API_BASE,
    LITELLM_MODEL: env.LITELLM_MODEL ?? env.ANTHROPIC_MODEL,
    LITELLM_TIMEOUT_MS: env.LITELLM_TIMEOUT_MS ?? env.ANTHROPIC_TIMEOUT_MS
  });
}

export function loadConfig(): WorkerConfig {
  return parseWorkerConfig(process.env);
}

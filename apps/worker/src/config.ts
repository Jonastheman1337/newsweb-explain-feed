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
    OPENAI_API_KEY: z
      .string({ required_error: "OPENAI_KEY_MISSING" })
      .trim()
      .min(1, "OPENAI_KEY_MISSING"),
    OPENAI_MODEL: z.string().default("gpt-5.5"),
    OPENAI_FAST_MODEL: z.string().default("gpt-5.4-mini"),
    OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60000),
    OPENAI_FAST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15000),
    OPENAI_DEFAULT_REASONING_EFFORT: z
      .enum(["none", "minimal", "low", "medium", "high", "xhigh"])
      .default("low"),
    OPENAI_REPORT_REASONING_EFFORT: z
      .enum(["none", "minimal", "low", "medium", "high", "xhigh"])
      .default("medium"),
    OPENAI_HARD_REASONING_EFFORT: z
      .enum(["none", "minimal", "low", "medium", "high", "xhigh"])
      .default("high"),
    POLL_INTERVAL_MS: z.coerce.number().int().min(5000).default(20000),
    LATEST_BOOTSTRAP_COUNT: z.coerce.number().int().min(0).max(50).default(30)
  });

export type WorkerConfig = z.infer<typeof configSchema>;

export function parseWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  return configSchema.parse(env);
}

export function loadConfig(): WorkerConfig {
  return parseWorkerConfig(process.env);
}

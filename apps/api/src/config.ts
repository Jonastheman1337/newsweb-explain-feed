import path from "node:path";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

loadDotEnv({
  path: path.resolve(process.cwd(), ".env"),
  override: false
});

const configSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  SESSION_SECRET: z.string().min(1),
  DEV_AUTH_BYPASS: z.string().optional(),
  LOGIN_USERNAME: z.string().min(1).optional(),
  LOGIN_PASSWORD: z.string().min(1).optional(),
  MAGIC_LINK_BASE_URL: z.string().url(),
  ADMIN_API_KEY: z.string().min(8),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().email().optional()
});

type RawAppConfig = z.infer<typeof configSchema>;

export type AppConfig = Omit<RawAppConfig, "DEV_AUTH_BYPASS"> & {
  DEV_AUTH_BYPASS: boolean;
};

export function parseAppConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = configSchema.parse(env);

  const devAuthBypass =
    parsed.NODE_ENV === "production"
      ? parsed.DEV_AUTH_BYPASS === "true"
      : parsed.DEV_AUTH_BYPASS === undefined
        ? true
        : parsed.DEV_AUTH_BYPASS === "true";

  if (parsed.NODE_ENV === "production" && parsed.SESSION_SECRET.length < 24) {
    throw new Error("SESSION_SECRET must contain at least 24 characters in production.");
  }

  return {
    ...parsed,
    DEV_AUTH_BYPASS: devAuthBypass
  };
}

export function loadConfig(): AppConfig {
  return parseAppConfig(process.env);
}

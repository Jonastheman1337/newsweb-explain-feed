import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type GlobalForPrisma = typeof globalThis & {
  __newsweb_prisma__?: PrismaClient;
  __newsweb_log_prisma__?: PrismaClient;
};

const globalForPrisma = globalThis as GlobalForPrisma;

function loadEnvValue(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return undefined;
  const envFile = readFileSync(envPath, "utf8");
  for (const line of envFile.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)="?([^"]*)"?\s*$/);
    if (match?.[1] === name) {
      process.env[name] = match[2];
      return match[2];
    }
  }
  return undefined;
}

loadEnvValue("DATABASE_URL");
const logDatabaseUrl = loadEnvValue("GENERATION_LOG_DATABASE_URL");

export const prisma =
  globalForPrisma.__newsweb_prisma__ ??
  new PrismaClient({
    log: ["warn", "error"]
  });

export const logPrisma = logDatabaseUrl
  ? globalForPrisma.__newsweb_log_prisma__ ??
    new PrismaClient({
      datasources: {
        db: {
          url: logDatabaseUrl
        }
      },
      log: ["warn", "error"]
    })
  : prisma;

export const isDedicatedLogDatabaseConfigured = Boolean(logDatabaseUrl);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__newsweb_prisma__ = prisma;
  if (logDatabaseUrl) {
    globalForPrisma.__newsweb_log_prisma__ = logPrisma;
  }
}

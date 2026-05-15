import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvValue(name) {
  if (process.env[name]) return process.env[name];
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return undefined;
  const envFile = readFileSync(envPath, "utf8");
  for (const line of envFile.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)="?([^"]*)"?\s*$/);
    if (match?.[1] === name) return match[2];
  }
  return undefined;
}

const url = loadEnvValue("GENERATION_LOG_DATABASE_URL");

if (!url) {
  console.log("[log-db] GENERATION_LOG_DATABASE_URL not set; skipping.");
  process.exit(0);
}

const prisma = new PrismaClient({
  datasources: {
    db: { url }
  }
});

try {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "generation_runs" (
      "id" TEXT NOT NULL,
      "message_id" INTEGER NOT NULL,
      "version" INTEGER,
      "job_id" TEXT,
      "job_name" TEXT,
      "reason" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "user_instruction" TEXT,
      "input_json" JSONB,
      "previous_rewrite_json" JSONB,
      "output_json" JSONB,
      "validation_json" JSONB,
      "model" TEXT,
      "prompt_version" TEXT,
      "prompt_chars" INTEGER,
      "error_text" TEXT,
      "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "started_at" TIMESTAMP(3),
      "finished_at" TIMESTAMP(3),
      CONSTRAINT "generation_runs_pkey" PRIMARY KEY ("id")
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "generation_runs_message_id_requested_at_idx"
      ON "generation_runs"("message_id", "requested_at" DESC);
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "generation_runs_job_id_idx"
      ON "generation_runs"("job_id");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "generation_runs_status_requested_at_idx"
      ON "generation_runs"("status", "requested_at" DESC);
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "user_action_events" (
      "id" TEXT NOT NULL,
      "message_id" INTEGER,
      "version" INTEGER,
      "client_event_id" TEXT,
      "editor_id_hash" TEXT,
      "session_id_hash" TEXT,
      "rewrite_id" TEXT,
      "prompt_version" TEXT,
      "model" TEXT,
      "action" TEXT NOT NULL,
      "action_source" TEXT,
      "payload_json" JSONB,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "user_action_events_pkey" PRIMARY KEY ("id")
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "user_action_events_message_id_created_at_idx"
      ON "user_action_events"("message_id", "created_at" DESC);
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "user_action_events_action_created_at_idx"
      ON "user_action_events"("action", "created_at" DESC);
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "user_action_events"
      ADD COLUMN IF NOT EXISTS "client_event_id" TEXT,
      ADD COLUMN IF NOT EXISTS "editor_id_hash" TEXT,
      ADD COLUMN IF NOT EXISTS "session_id_hash" TEXT,
      ADD COLUMN IF NOT EXISTS "rewrite_id" TEXT,
      ADD COLUMN IF NOT EXISTS "prompt_version" TEXT,
      ADD COLUMN IF NOT EXISTS "model" TEXT,
      ADD COLUMN IF NOT EXISTS "action_source" TEXT;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "user_action_events_client_event_id_idx"
      ON "user_action_events"("client_event_id");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "user_action_events_editor_id_hash_created_at_idx"
      ON "user_action_events"("editor_id_hash", "created_at" DESC);
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "user_action_events_session_id_hash_created_at_idx"
      ON "user_action_events"("session_id_hash", "created_at" DESC);
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "user_action_events_rewrite_id_created_at_idx"
      ON "user_action_events"("rewrite_id", "created_at" DESC);
  `);

  console.log("[log-db] generation_runs and user_action_events tables ready.");
} finally {
  await prisma.$disconnect();
}

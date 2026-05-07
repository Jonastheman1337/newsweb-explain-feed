-- Durable operational logs. These tables are also initialized in the
-- dedicated log database by scripts/init-log-db.mjs.

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

CREATE INDEX IF NOT EXISTS "generation_runs_message_id_requested_at_idx"
  ON "generation_runs"("message_id", "requested_at" DESC);

CREATE INDEX IF NOT EXISTS "generation_runs_job_id_idx"
  ON "generation_runs"("job_id");

CREATE INDEX IF NOT EXISTS "generation_runs_status_requested_at_idx"
  ON "generation_runs"("status", "requested_at" DESC);

CREATE TABLE IF NOT EXISTS "user_action_events" (
  "id" TEXT NOT NULL,
  "message_id" INTEGER,
  "version" INTEGER,
  "action" TEXT NOT NULL,
  "payload_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_action_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "user_action_events_message_id_created_at_idx"
  ON "user_action_events"("message_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "user_action_events_action_created_at_idx"
  ON "user_action_events"("action", "created_at" DESC);

-- This model existed in Prisma but was missing from the production database.
CREATE TABLE IF NOT EXISTS "title_suggestion_logs" (
  "id" TEXT NOT NULL,
  "message_id" INTEGER NOT NULL,
  "current_title" TEXT NOT NULL,
  "suggestions" JSONB NOT NULL,
  "selected_title" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "title_suggestion_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "title_suggestion_logs_message_id_created_at_idx"
  ON "title_suggestion_logs"("message_id", "created_at" DESC);

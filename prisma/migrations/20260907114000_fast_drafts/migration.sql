CREATE TABLE "fast_drafts" (
  "id" TEXT NOT NULL,
  "message_id" INTEGER NOT NULL,
  "generation_run_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "source_hash" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "prompt_version" TEXT NOT NULL,
  "rewrite_json" JSONB,
  "validation_json" JSONB,
  "model_calls_json" JSONB,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deadline_at" TIMESTAMP(3) NOT NULL,
  "finished_at" TIMESTAMP(3),
  CONSTRAINT "fast_drafts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fast_drafts_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "source_notices"("message_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "fast_drafts_message_id_key" ON "fast_drafts"("message_id");

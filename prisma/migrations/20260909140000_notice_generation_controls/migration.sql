CREATE TABLE "notice_generation_controls" (
  "generation_run_id" TEXT NOT NULL PRIMARY KEY,
  "message_id" INTEGER NOT NULL REFERENCES "source_notices"("message_id") ON DELETE CASCADE,
  "client_request_id" TEXT,
  "position" BIGSERIAL NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "target_version" INTEGER,
  "snapshot_json" JSONB NOT NULL,
  "result_rewrite_id" TEXT,
  "error_text" TEXT,
  "heartbeat_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3),
  CONSTRAINT "notice_generation_controls_message_id_client_request_id_key" UNIQUE ("message_id", "client_request_id")
);
CREATE INDEX "notice_generation_controls_message_id_status_position_idx" ON "notice_generation_controls"("message_id", "status", "position");
CREATE INDEX "notice_generation_controls_status_heartbeat_at_idx" ON "notice_generation_controls"("status", "heartbeat_at");

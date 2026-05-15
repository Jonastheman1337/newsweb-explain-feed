ALTER TABLE "user_action_events"
  ADD COLUMN IF NOT EXISTS "client_event_id" TEXT,
  ADD COLUMN IF NOT EXISTS "editor_id_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "session_id_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "rewrite_id" TEXT,
  ADD COLUMN IF NOT EXISTS "prompt_version" TEXT,
  ADD COLUMN IF NOT EXISTS "model" TEXT,
  ADD COLUMN IF NOT EXISTS "action_source" TEXT;

CREATE INDEX IF NOT EXISTS "user_action_events_client_event_id_idx"
  ON "user_action_events"("client_event_id");

CREATE INDEX IF NOT EXISTS "user_action_events_editor_id_hash_created_at_idx"
  ON "user_action_events"("editor_id_hash", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "user_action_events_session_id_hash_created_at_idx"
  ON "user_action_events"("session_id_hash", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "user_action_events_rewrite_id_created_at_idx"
  ON "user_action_events"("rewrite_id", "created_at" DESC);

ALTER TABLE "edit_logs"
  ADD COLUMN IF NOT EXISTS "event_id" TEXT;

CREATE INDEX IF NOT EXISTS "edit_logs_event_id_idx"
  ON "edit_logs"("event_id");

ALTER TABLE "feedback"
  ADD COLUMN IF NOT EXISTS "event_id" TEXT;

CREATE INDEX IF NOT EXISTS "feedback_event_id_idx"
  ON "feedback"("event_id");

ALTER TABLE "title_suggestion_logs"
  ADD COLUMN IF NOT EXISTS "event_id" TEXT,
  ADD COLUMN IF NOT EXISTS "action" TEXT,
  ADD COLUMN IF NOT EXISTS "selected_index" INTEGER,
  ADD COLUMN IF NOT EXISTS "selected_was_original" BOOLEAN;

CREATE INDEX IF NOT EXISTS "title_suggestion_logs_event_id_idx"
  ON "title_suggestion_logs"("event_id");

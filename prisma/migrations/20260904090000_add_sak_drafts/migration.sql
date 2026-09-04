-- /sak: free-standing drafts written from user-supplied materials.
-- Scoped per browser (owner_id), expire 24 h after creation, never in the feed.

CREATE TABLE IF NOT EXISTS "sak_drafts" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "title_override" TEXT,
  "target_chars" INTEGER,
  "next_version" INTEGER NOT NULL DEFAULT 1,
  "active_generation_run_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sak_drafts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sak_drafts_owner_id_last_activity_at_idx"
  ON "sak_drafts"("owner_id", "last_activity_at" DESC);
CREATE INDEX IF NOT EXISTS "sak_drafts_expires_at_idx"
  ON "sak_drafts"("expires_at");

CREATE TABLE IF NOT EXISTS "sak_materials" (
  "id" TEXT NOT NULL,
  "sak_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "url" TEXT,
  "file_name" TEXT,
  "file_size" INTEGER,
  "extracted_text" TEXT NOT NULL,
  "text_chars" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "error_text" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "metadata_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sak_materials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sak_materials_sak_id_fkey"
    FOREIGN KEY ("sak_id") REFERENCES "sak_drafts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "sak_materials_sak_id_created_at_idx"
  ON "sak_materials"("sak_id", "created_at");

CREATE TABLE IF NOT EXISTS "sak_versions" (
  "id" TEXT NOT NULL,
  "sak_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "article_json" JSONB,
  "user_instruction" TEXT,
  "change_note" TEXT,
  "prompt_version" TEXT,
  "model" TEXT,
  "error_text" TEXT,
  "validation_json" JSONB,
  "generation_run_id" TEXT,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "generated_at" TIMESTAMP(3),
  CONSTRAINT "sak_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sak_versions_sak_id_fkey"
    FOREIGN KEY ("sak_id") REFERENCES "sak_drafts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "sak_versions_sak_id_version_key"
  ON "sak_versions"("sak_id", "version");
CREATE INDEX IF NOT EXISTS "sak_versions_sak_id_requested_at_idx"
  ON "sak_versions"("sak_id", "requested_at");

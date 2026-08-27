-- Immutable, user-visible publication records. The existing rewrites table
-- remains the private generation staging area.
ALTER TABLE "rewrites"
  ADD COLUMN IF NOT EXISTS "generation_run_id" TEXT;

CREATE TABLE IF NOT EXISTS "published_rewrites" (
  "id" TEXT NOT NULL,
  "message_id" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "generation_run_id" TEXT,
  "lang" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "prompt_version" TEXT NOT NULL,
  "rewrite_json" JSONB NOT NULL,
  "validation_json" JSONB NOT NULL,
  "user_instruction" TEXT,
  "content_hash" TEXT NOT NULL,
  "finalized_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "published_rewrites_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "published_rewrites_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "source_notices"("message_id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "published_rewrites_generation_run_id_key"
  ON "published_rewrites"("generation_run_id");
CREATE UNIQUE INDEX IF NOT EXISTS "published_rewrites_message_id_version_key"
  ON "published_rewrites"("message_id", "version");
CREATE INDEX IF NOT EXISTS "published_rewrites_message_id_finalized_at_idx"
  ON "published_rewrites"("message_id", "finalized_at" DESC);

-- Preserve every currently published output as an immutable legacy publication.
INSERT INTO "published_rewrites" (
  "id",
  "message_id",
  "version",
  "generation_run_id",
  "lang",
  "model",
  "prompt_version",
  "rewrite_json",
  "validation_json",
  "user_instruction",
  "content_hash",
  "finalized_at"
)
SELECT
  r."id",
  r."message_id",
  r."version",
  r."generation_run_id",
  r."lang",
  r."model",
  r."prompt_version",
  r."rewrite_json",
  r."validation_json",
  r."user_instruction",
  md5(r."rewrite_json"::text),
  r."generated_at"
FROM "rewrites" r
WHERE r."status" = 'published'
ON CONFLICT ("message_id", "version") DO NOTHING;

ALTER TABLE "feed_items"
  ADD COLUMN IF NOT EXISTS "active_published_rewrite_id" TEXT,
  ADD COLUMN IF NOT EXISTS "publication_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "next_rewrite_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "active_generation_run_id" TEXT;

UPDATE "feed_items" f
SET
  "active_published_rewrite_id" = latest."id",
  "publication_revision" = latest."published_count"
FROM (
  SELECT DISTINCT ON (p."message_id")
    p."message_id",
    p."id",
    counts."published_count"
  FROM "published_rewrites" p
  JOIN (
    SELECT "message_id", COUNT(*)::integer AS "published_count"
    FROM "published_rewrites"
    GROUP BY "message_id"
  ) counts ON counts."message_id" = p."message_id"
  ORDER BY p."message_id", p."version" DESC, p."finalized_at" DESC
) latest
WHERE f."message_id" = latest."message_id";

UPDATE "feed_items" f
SET "next_rewrite_version" = versions."next_version"
FROM (
  SELECT "message_id", COALESCE(MAX("version"), 0) + 1 AS "next_version"
  FROM "rewrites"
  GROUP BY "message_id"
) versions
WHERE f."message_id" = versions."message_id";

CREATE UNIQUE INDEX IF NOT EXISTS "feed_items_active_published_rewrite_id_key"
  ON "feed_items"("active_published_rewrite_id");
ALTER TABLE "feed_items"
  DROP CONSTRAINT IF EXISTS "feed_items_active_published_rewrite_id_fkey";
ALTER TABLE "feed_items"
  ADD CONSTRAINT "feed_items_active_published_rewrite_id_fkey"
  FOREIGN KEY ("active_published_rewrite_id") REFERENCES "published_rewrites"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "user_action_events"
  ADD COLUMN IF NOT EXISTS "publication_revision" INTEGER,
  ADD COLUMN IF NOT EXISTS "content_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "rendered_final" BOOLEAN;

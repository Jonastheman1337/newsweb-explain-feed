-- CreateEnum
CREATE TYPE "RewriteStatus" AS ENUM ('pending', 'published', 'needs_retry', 'failed');

-- CreateEnum
CREATE TYPE "FeedVisibilityStatus" AS ENUM ('published', 'hidden');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('started', 'success', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT,
    "expires_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_notices" (
    "message_id" INTEGER NOT NULL,
    "news_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "issuer_name" TEXT NOT NULL,
    "issuer_sign" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL,
    "categories_json" JSONB NOT NULL,
    "markets_json" JSONB NOT NULL,
    "body_text" TEXT NOT NULL,
    "has_attachments" BOOLEAN NOT NULL,
    "raw_message_json" JSONB NOT NULL,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_notices_pkey" PRIMARY KEY ("message_id")
);

-- CreateTable
CREATE TABLE "rewrites" (
    "id" TEXT NOT NULL,
    "message_id" INTEGER NOT NULL,
    "lang" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "rewrite_json" JSONB NOT NULL,
    "validation_json" JSONB NOT NULL,
    "status" "RewriteStatus" NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rewrites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_items" (
    "message_id" INTEGER NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL,
    "visibility_status" "FeedVisibilityStatus" NOT NULL DEFAULT 'published',
    "rank_score" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "feed_items_pkey" PRIMARY KEY ("message_id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" TEXT NOT NULL,
    "job_type" TEXT NOT NULL,
    "message_id" INTEGER,
    "status" "JobStatus" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "error_text" TEXT,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "invites_email_key" ON "invites"("email");

-- CreateIndex
CREATE INDEX "source_notices_published_at_idx" ON "source_notices"("published_at" DESC);

-- CreateIndex
CREATE INDEX "source_notices_issuer_sign_idx" ON "source_notices"("issuer_sign");

-- CreateIndex
CREATE INDEX "source_notices_categories_json_idx" ON "source_notices" USING GIN ("categories_json");

-- CreateIndex
CREATE UNIQUE INDEX "rewrites_message_id_key" ON "rewrites"("message_id");

-- CreateIndex
CREATE INDEX "rewrites_status_generated_at_idx" ON "rewrites"("status", "generated_at" DESC);

-- CreateIndex
CREATE INDEX "feed_items_published_at_visibility_status_idx" ON "feed_items"("published_at" DESC, "visibility_status");

-- CreateIndex
CREATE INDEX "job_runs_job_type_started_at_idx" ON "job_runs"("job_type", "started_at" DESC);

-- AddForeignKey
ALTER TABLE "rewrites" ADD CONSTRAINT "rewrites_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "source_notices"("message_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_items" ADD CONSTRAINT "feed_items_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "source_notices"("message_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "source_notices"("message_id") ON DELETE SET NULL ON UPDATE CASCADE;

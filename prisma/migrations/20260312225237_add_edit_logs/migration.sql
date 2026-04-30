-- CreateTable
CREATE TABLE "edit_logs" (
    "id" TEXT NOT NULL,
    "message_id" INTEGER NOT NULL,
    "original_title" TEXT NOT NULL,
    "original_body" TEXT NOT NULL,
    "edited_title" TEXT NOT NULL,
    "edited_body" TEXT NOT NULL,
    "has_edits" BOOLEAN NOT NULL,
    "copied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "edit_logs_message_id_copied_at_idx" ON "edit_logs"("message_id", "copied_at" DESC);

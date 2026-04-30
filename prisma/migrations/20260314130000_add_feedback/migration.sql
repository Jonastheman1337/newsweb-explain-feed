-- CreateTable
CREATE TABLE "feedback" (
    "id" TEXT NOT NULL,
    "message_id" INTEGER NOT NULL,
    "version" INTEGER,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_message_id_created_at_idx" ON "feedback"("message_id", "created_at" DESC);

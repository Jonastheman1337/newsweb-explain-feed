CREATE TABLE "notice_materials" (
    "id" TEXT NOT NULL,
    "message_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "file_name" TEXT,
    "mime_type" TEXT,
    "file_size" INTEGER,
    "extracted_text" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error_text" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "metadata_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notice_materials_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notice_materials_message_id_created_at_idx" ON "notice_materials"("message_id", "created_at" DESC);
CREATE INDEX "notice_materials_status_idx" ON "notice_materials"("status");

ALTER TABLE "notice_materials" ADD CONSTRAINT "notice_materials_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "source_notices"("message_id") ON DELETE CASCADE ON UPDATE CASCADE;

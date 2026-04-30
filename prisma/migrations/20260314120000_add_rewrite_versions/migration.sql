-- AlterTable: drop old unique on message_id, add version + user_instruction columns
ALTER TABLE "rewrites" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "rewrites" ADD COLUMN "user_instruction" TEXT;

-- Drop old unique constraint/index on message_id
ALTER TABLE "rewrites" DROP CONSTRAINT IF EXISTS "rewrites_message_id_key";
DROP INDEX IF EXISTS "rewrites_message_id_key";

-- CreateIndex: compound unique on (message_id, version)
ALTER TABLE "rewrites" ADD CONSTRAINT "rewrites_message_id_version_key" UNIQUE ("message_id", "version");

ALTER TABLE "generation_runs"
  ADD COLUMN IF NOT EXISTS "phase" TEXT,
  ADD COLUMN IF NOT EXISTS "phase_updated_at" TIMESTAMP(3);

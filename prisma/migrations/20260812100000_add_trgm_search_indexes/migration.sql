-- pg_trgm is a trusted extension on PostgreSQL 13+ (and available on Render),
-- so the database owner can install it without superuser.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Free-text feed search runs ILIKE '%q%' over these two columns; trigram GIN
-- indexes let the planner serve that as a bitmap index scan instead of a
-- sequential scan over every notice body.
CREATE INDEX IF NOT EXISTS "source_notices_title_trgm_idx"
  ON "source_notices" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "source_notices_body_text_trgm_idx"
  ON "source_notices" USING GIN ("body_text" gin_trgm_ops);

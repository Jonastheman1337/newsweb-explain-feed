# Newsweb Explain Feed

News service that turns company notices from Newsweb into short E24
Aksjelive-style stories, with manual regeneration, version history, and durable
generation logs.

## Architecture

```text
apps/web      Next.js UI and small proxy routes
apps/api      Fastify API: auth, feed, notice detail, feedback, regenerate, admin
apps/worker   BullMQ workers: poll, ingest, rewrite, publish

Postgres app DB      source notices, rewrite versions, feed state, user feedback
Postgres log DB      generation_runs and user_action_events
Redis/BullMQ         temporary queues, job state, and short-lived diagnostics
LiteLLM              model calls for rewrites, triage, and title suggestions
```

Rewrite lifecycle:

1. The worker polls Newsweb and queues new messages.
2. Ingest stores `source_notices`.
3. Rewrite creates or updates one immutable `rewrites` version.
4. Publish marks the completed version as `published` and updates `feed_items`.
5. The API and feed stream show the latest published version while any newer
   pending regeneration is still running.

## Requirements

- Node 22+
- npm 11+
- PostgreSQL 16+
- Redis 7+
- LiteLLM API key and proxy base URL

## Environment

Copy `.env.example` to `.env` and fill in the secrets:

```text
DATABASE_URL=postgresql://...
GENERATION_LOG_DATABASE_URL=postgresql://...
REDIS_URL=redis://...
LITELLM_API_KEY=...
LITELLM_BASE_URL=https://your-litellm-proxy.example.com/v1
LITELLM_MODEL=claude-sonnet-4-6
SESSION_SECRET=...
ADMIN_API_KEY=...
```

`GENERATION_LOG_DATABASE_URL` should point at a dedicated Postgres database.
If it is empty, local development falls back to the primary app DB, but
production should use a separate DB so operational logs survive independently
of app table changes.

`LITELLM_BASE_URL` should point at the LiteLLM proxy base URL. Include `/v1`
if your proxy is configured that way.

## Local Development

```bash
npm install
npm run dev:deps
npm run prisma:generate
npm run prisma:migrate:dev
node scripts/init-log-db.mjs
npm run dev
```

Open `http://localhost:3000/feed`.

Useful checks:

```bash
npm run typecheck
npm test
```

## Render Deploy

`render.yaml` defines:

- `autoweb`: combined Next.js, Fastify API, and worker service
- `newsweb-explain-db`: primary app Postgres DB
- `newsweb-explain-log-db`: dedicated generation/action log DB
- `newsweb-explain-redis`: Render Key Value / Redis-compatible queue backend

The pre-deploy command runs:

```bash
npm run prisma:migrate:deploy
```

That command applies Prisma migrations to the primary app DB and then runs
`scripts/init-log-db.mjs` against `GENERATION_LOG_DATABASE_URL`.

After first deploy, add users from the Render shell:

```bash
npm run invite:add -w apps/api -- user@example.com
```

## Regeneration Behavior

Manual regeneration uses `POST /notice/:messageId/generate`.

- Every manual request allocates `max(rewrites.version) + 1`.
- This applies to normal notices, quarterly-report/PDF notices, yearly reports,
  and regenerations without instructions.
- The queued job carries `targetVersion`, `userInstruction`,
  `previousRewriteJson`, and `generationRunId`.
- User instructions are authoritative in revision prompts. The previous rewrite
  is context, not something to preserve if the instruction conflicts with it.
- New output is stored as a new `rewrites` row. Older published versions are not
  overwritten.
- While a newer version is `pending`, `/notice/:messageId`, `/feed`, and
  `/feed/stream` prefer the latest already-published rewrite.
- Publish targets the specific completed version from the publish job payload.

## Logging System

There are two DB owners:

- Primary app DB: behavior tables the product reads or mutates directly:
  `source_notices`, `rewrites`, `feed_items`, `job_runs`, `feedback`,
  `edit_logs`, `title_suggestion_logs`.
- Dedicated log DB: durable operational/debug tables:
  `generation_runs`, `user_action_events`.

`generation_runs` records auto rewrites, manual regenerations, triage-style
generation work, title generation, queued/started/finished status, BullMQ job
IDs, message IDs, target versions, user instructions, previous output, prompt
payloads, model output, validation payloads, model/prompt metadata, and errors.

`user_action_events` records product signals such as copy text, copy with edits,
feedback submit, title suggestion request/refresh/select, regenerate click, and
admin reprocess.

Full prompt/input/output payloads are retained indefinitely by default. Redis
BullMQ logs are temporary diagnostics only, not the source of truth.

Manual regeneration must create a generation log before queueing. If that write
fails, the API returns an error and does not enqueue an unlogged job. Copy/action
events keep the user flow working if log writes fail; the API logs the failure.

## DB Inspection Recipes

Set the log DB URL in your shell:

```bash
export GENERATION_LOG_DATABASE_URL='postgresql://...'
```

Find all generation logs for a message:

```sql
select id, message_id, version, reason, status, job_id, job_name,
       requested_at, started_at, finished_at, error_text
from generation_runs
where message_id = 672593
order by requested_at desc;
```

Show generation timeline:

```sql
select requested_at, started_at, finished_at, version, reason, status,
       user_instruction, job_id
from generation_runs
where message_id = 672593
order by requested_at;
```

Show user instructions and outputs:

```sql
select version,
       user_instruction,
       previous_rewrite_json,
       input_json,
       output_json,
       validation_json,
       error_text
from generation_runs
where message_id = 672593
order by requested_at;
```

Show copy, feedback, title, and regenerate actions:

```sql
select created_at, message_id, version, action, payload_json
from user_action_events
where message_id = 672593
order by created_at;
```

Correlate a generation run with primary app job rows:

```sql
-- log DB
select id, message_id, version, job_id, job_name, status
from generation_runs
where message_id = 672593;

-- primary app DB
select id, job_type, message_id, status, started_at, finished_at, error_text
from job_runs
where message_id = 672593
order by started_at;
```

If Redis still has the BullMQ job, use `generation_runs.job_id` to inspect it as
temporary queue state. Do not rely on Redis for durable history.

## Production Troubleshooting

From a Render service shell:

```bash
printenv DATABASE_URL
printenv GENERATION_LOG_DATABASE_URL
npm run prisma:migrate:deploy
node scripts/init-log-db.mjs
```

Check primary app migrations:

```bash
npx prisma migrate status
```

Check that the primary DB has the title suggestion table:

```sql
select to_regclass('public.title_suggestion_logs');
```

Check that the log DB is initialized:

```sql
select to_regclass('public.generation_runs'),
       to_regclass('public.user_action_events');
```

For a failed regeneration:

1. Query `generation_runs` by `message_id`.
2. Check `status`, `error_text`, `user_instruction`, `input_json`, and
   `output_json`.
3. Correlate `job_id` with `job_runs` and Redis only if the BullMQ job still
   exists.
4. Check `rewrites` in the primary DB to verify all versions and statuses.

## API Endpoints

- `POST /auth/request-magic-link`
- `POST /auth/verify-magic-link`
- `GET /feed`
- `GET /feed/stream`
- `GET /notice/:messageId`
- `GET /notice/:messageId/status`
- `POST /notice/:messageId/generate`
- `POST /notice/:messageId/feedback`
- `POST /notice/:messageId/edit-log`
- `POST /notice/:messageId/title-suggestion-log`
- `GET /meta/filters`
- `POST /admin/reprocess/:messageId` with `x-admin-key`
- `GET /health`

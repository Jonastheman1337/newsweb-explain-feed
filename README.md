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
OpenAI Responses API model calls for rewrites, triage, PDF fallback, and title suggestions
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
- OpenAI API key

## Environment

Copy `.env.example` to `.env` and fill in the secrets:

```text
DATABASE_URL=postgresql://...
GENERATION_LOG_DATABASE_URL=postgresql://...
REDIS_URL=redis://...
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.6-terra
OPENAI_FAST_MODEL=gpt-5.6-luna
OPENAI_HARD_MODEL=gpt-5.6-sol
OPENAI_SERVICE_TIER=default
OPENAI_TIMEOUT_MS=240000
OPENAI_FAST_TIMEOUT_MS=15000
OPENAI_DEFAULT_REASONING_EFFORT=medium
OPENAI_REPORT_REASONING_EFFORT=medium
OPENAI_HARD_REASONING_EFFORT=xhigh
OPENAI_TRIAGE_REASONING_EFFORT=none
POLL_INTERVAL_MS=5000
SESSION_SECRET=...
ADMIN_API_KEY=...
```

`GENERATION_LOG_DATABASE_URL` should point at a dedicated Postgres database.
If it is empty, local development falls back to the primary app DB, but
production should use a separate DB so operational logs survive independently
of app table changes.

Render free tier allows only one active free Postgres database per account. If
the hosted service has no `GENERATION_LOG_DATABASE_URL`, `generation_runs` and
`user_action_events` are intentionally stored in the primary app DB. The
`/admin/signals` page shows which mode is active. To move future operational
logs to a dedicated DB, provision a paid/dedicated Postgres instance, set
`GENERATION_LOG_DATABASE_URL` to its internal connection string, and redeploy so
the pre-deploy command initializes the log tables.

`OPENAI_MODEL` is used for rewrites, report handling, reference checks, PDF
fallback, and corrections. `OPENAI_FAST_MODEL` is used for triage and title
suggestions. `OPENAI_HARD_MODEL` is reserved for manual `xhigh` rescue runs.
Reader/editor-facing calls use `OPENAI_SERVICE_TIER=default`; offline bulk
evaluations should use Flex.
Local PDF text extraction remains the primary path; OpenAI PDF reading is only
used as a fallback when local extraction diagnostics are weak.

## Local Development

Use this for fast iteration. It runs the API, worker, and web app as local
development processes with hot reload.

```bash
npm install
npm run dev:deps
npm run prisma:generate
npm run prisma:migrate:dev
node scripts/init-log-db.mjs
npm run dev
```

Open `http://localhost:3000/feed`.

This mode is intentionally not production-equivalent: `NODE_ENV` defaults to
development, auth bypass can be enabled for localhost, and the services do not
start through the Render Docker image.

## Production-Like Local Testing

Use this when localhost needs to behave like the actual Render service before a
deploy or when debugging issues that only show up on the hosted site.

To test against the same data shape as production without writing to production,
copy Render's external database URLs into your root `.env`:

```text
RENDER_DATABASE_EXTERNAL_URL=postgresql://...
RENDER_LOG_DATABASE_EXTERNAL_URL=postgresql://...
```

Use the external database URLs from the Render database pages. Do not use the
internal `DATABASE_URL` values injected into the Render service; those are for
Render's private network.

Clone production data into isolated local databases:

```bash
npm run local:prod:clone-db
```

This restores into `infra/data/prod-local-*`. It does not point localhost at the
live Render database, so local testing cannot mutate production notices,
rewrites, generation logs, or feed state.

```bash
npm run local:prod
```

The command expects a root `.env` file and reads it with Docker Compose's
`--env-file` option. The worker starts in production mode by default, so
`OPENAI_API_KEY` must be present unless you start without the worker:

```bash
LOCAL_PROD_START_WORKER=false npm run local:prod
```

Open `http://localhost:3000/feed`. The default local password login is:

```text
username: E24
password: local-prod-password
```

Override `LOCAL_PROD_LOGIN_USERNAME` or `LOCAL_PROD_LOGIN_PASSWORD` in your shell
if you need different local credentials. The command uses the same `Dockerfile.render` image and
`scripts/render-start.sh` process layout as Render, sets `NODE_ENV=production`,
runs deploy migrations first, exposes only the web port, and points the web app
at the internal API on `127.0.0.1:4000`.

It also creates separate local Postgres databases for app data and generation
logs under `infra/data/prod-local-*`, plus a local Redis instance. Because this
path is built like production, it does not hot reload. Re-run the command after
code changes.

Automatic Newsweb polling is disabled in this local production-like stack, and
the latest-notice bootstrap count defaults to `0`. That keeps the cloned data
stable and avoids generating a batch of new local rewrites on startup. Manual
regeneration still works when the worker is enabled. To test automatic polling,
run with:

```bash
LOCAL_PROD_NEWSWEB_POLLING_ENABLED=true LOCAL_PROD_LATEST_BOOTSTRAP_COUNT=30 npm run local:prod
```

Stop the production-like stack with:

```bash
npm run local:prod:down
```

Useful checks:

```bash
npm run typecheck
npm test
```

## Production Deploy (UpCloud)

Production runs on one UpCloud server (`autoweb-prod`, `81.27.105.83`) behind
Caddy at https://autoweb24.no. Render is no longer used; `render.yaml`,
`Dockerfile.render`, and the `RENDER_*` helpers below are historical. Pushing
to `main` does not deploy anything.

Deploy a pushed commit with one command (SSH key for the `autoweb` user must be
installed locally):

```bash
bash scripts/deploy-upcloud.sh            # deploys HEAD
bash scripts/deploy-upcloud.sh <sha>      # deploys a specific pushed commit
bash scripts/deploy-upcloud.sh --status   # live release SHA, containers, health
```

The script archives the commit, uploads it to `/srv/autoweb/releases/incoming`,
builds the api/worker/web images on the host (skipped when that SHA was built
before), runs `infra/upcloud/scripts/deploy.sh` (Prisma migrations, then
`docker compose up`), and prints `/api/health`. Rollback to the previous
release:

```bash
ssh autoweb@81.27.105.83 /srv/autoweb/current/infra/upcloud/scripts/rollback.sh
```

The full runbook, compose file, backup/watchdog timers, and host scripts live
in `infra/upcloud/`. The host keeps its copy at
`/srv/autoweb/current/infra/upcloud`; changes there must be copied to the host.

Add users from the host:

```bash
ssh autoweb@81.27.105.83
cd /srv/autoweb/current/infra/upcloud
docker compose --env-file /srv/autoweb/secrets/host.env -f compose.yml   exec api npm run invite:add -w apps/api -- user@example.com
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

The app includes a protected read-only admin view at `/admin/signals` with
filters for date range, message ID, action/status, and CSV export. Use direct
SQL for deeper inspection or bulk debugging.

For production signal reviews, prefer the scripted pull first:

```bash
node scripts/pull-signals.mjs --from 2026-05-28 --to 2026-06-01
```

The script reads `RENDER_API` from `.env`, discovers the live Render service,
logs in with the service's configured `LOGIN_USERNAME`/`LOGIN_PASSWORD`, exports
all `/admin/signals` CSV tabs, and writes a JSON artifact under `tmp/`.
Dates are interpreted as `Europe/Oslo` local calendar days, then over-fetched
from the UTC-only admin export and filtered back to the requested local range.
This avoids missing rows around midnight, which can happen when using the admin
page's raw `from`/`to` date filters directly.

Use the artifact's `summary.feedback`, `summary.edits`, `summary.titles`,
`summary.problematicGenerations`, `summary.generationErrorGroups`, and
`summary.qualityPipeline.openAIUsageAndCost` first. The latter uses the dated
rate card in `scripts/openai-pricing-2026-08-10.json` and reports actual plus
GPT-5.5/Terra/Luna/Sol counterfactual Standard spend. Historical rows without
provider usage correctly report cost as unavailable instead of zero.

When an OpenAI organization Admin API key is available locally, reconcile the
provider totals without adding that credential to Render:

```bash
npm run openai:usage -- --from 2026-08-10 --to 2026-08-16
```

Only fall back to direct SQL when the
script fails or a row needs fields not included in the CSV export.

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

On the UpCloud host (`ssh autoweb@81.27.105.83`), inside the api container
(`docker compose ... exec api sh`, see Production Deploy):

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

## Sak (skjult)

`/sak` is a hidden page behind the same login: a hand-drafted news article
built from files, links and pasted text instead of a Newsweb notice. Nothing
links to it; open the URL directly.

- Drafts are scoped to the browser: the web app sends the per-browser id from
  localStorage (`newsweb_editor_id`) as `x-sak-owner`. Another browser sees an
  empty list.
- A draft lives 24 h from creation (`SAK_TTL_HOURS`); the worker sweep then
  deletes it and its materials. An expired draft redirects to `/sak?gone=1`.
- Materials: PDF upload, URL (fetched server-side to text; paywalled or blocked
  pages get a failure row and the text can be pasted instead), pasted text.
  Each instruction produces a new version; the log lists the instruction and
  the model's one-line change note.
- Copy keeps inline links and subheads (`<h3>`); no AI disclosure is appended.

Endpoints (all require the session bearer and `x-sak-owner`):

- `POST /sak` · `GET /sak` · `GET /sak/:id` · `DELETE /sak/:id`
- `POST /sak/:id/materials/pdf` (multipart `file`) ·
  `POST /sak/:id/materials/url` · `POST /sak/:id/materials/text`
- `PATCH /sak/:id/materials/:materialId` (`{enabled}`) ·
  `DELETE /sak/:id/materials/:materialId`
- `POST /sak/:id/generate` · `GET /sak/:id/status?jobId=&version=`

The web app proxies these under `/api/sak/**` (`apps/web/lib/bff-proxy.ts`).

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

# UI refresh development

The redesign lives at `/next`; the existing application stays at `/feed`.
The two surfaces reuse the current API, session handling, notice editor, clipboard,
local draft storage and feed stream. Editorial rules remain unchanged. The September 9 editor adds durable manual request control and explicit displayed-text revision inputs.

## Run the preview

Use this branch's worktree, not the legacy checkout. Requires Node 22+ and npm 11+.

```powershell
npm.cmd ci
npm.cmd run prisma:generate
npm.cmd run dev:ui
```

Open http://127.0.0.1:3101/next. Sign in with `preview` / `ui-preview`.
`/feed` on the same port shows the legacy layout against the same fictional data.
The header labels this environment `Eksempeldata`.

The launcher binds the web app to 127.0.0.1:3101 and an in-memory fixture API to
127.0.0.1:4101. It does not start a worker, polling, a database or Redis. Generation and title suggestions use deterministic fictional responses; no model
is called and instructions do not influence the simulated text. The preview also
supports version history, settings and local feedback acknowledgements. Edits still use the
real editor's browser storage. Fixture sessions and data reset when restarted.
The preview has its own cookie name, so it does not replace a legacy localhost login.
Occupied ports cause startup to fail; stop the previous preview before restarting.

Replay a regeneration completion and a new notice while editing:

```powershell
npm.cmd run ui:replay
```

This replays existing full-publication events. It does not simulate an implemented
fast-generation backend. The selected editor stays open until the reader chooses the available version.
Matching new notices arrive automatically without replacing the selected text.

## Branch and release workflow

- `main` stays the release line. Ship legacy fixes from clean branches/worktrees based
  on current `origin/main` using the existing production runbook.
- `codex/ui-refresh` is the current iteration branch. Keep its dependencies, local
  configuration and runtime separate from the legacy worktree.
- After a legacy release, commit the UI checkpoint, fetch, and merge `origin/main`
  into this branch. Resolve shared-editor/API conflicts here and recheck both routes.
- Deliver small reviewed UI milestones to `main` with the UI flag off. Avoid growing
  a permanent fork. Never include unrelated dirty-checkout changes in a UI commit.
- Enabling production UI and deploying follow the existing release process. A local
  preview is not a production deployment.

From the UI worktree, after committing its current changes:

```powershell
git fetch origin
git merge origin/main
npm.cmd run test -w apps/web
npm.cmd run ui:test
npm.cmd run build
npm.cmd run ui:verify-routes
```

## Flags and boundaries

| Setting               | Default           | Effect                                                                           |
| --------------------- | ----------------- | -------------------------------------------------------------------------------- |
| `UI_V2_ENABLED`       | off               | Exposes authenticated `/next`; disabled returns 404.                             |
| `FAST_DRAFT_ENABLED`  | off               | Reserved independent switch. No generation consumer exists yet.                  |
| `SESSION_COOKIE_NAME` | `newsweb_session` | Preview sets `newsweb_ui_preview`.                                               |
| `UI_PREVIEW_FIXTURES` | off               | Development-only fixture title proxy and preview label. Set by fixture launcher. |

Only the literal `true` enables a feature flag. UI enablement must never imply fast
model calls. The future fast path must preserve the canonical legacy full rewrite,
use its own stored identity, and respect the existing importance decision.

For the next API/worker integration milestone, use the dedicated dependencies in
`infra/docker-compose.ui-preview.yml`. They have their own Compose project, volumes
and loopback ports (15433, 15434, 16380), with no legacy bind mounts. This machine
has no Docker, so that optional configuration has not been runtime-verified. It is
not needed for the working UI preview. API/worker integration, migration and seeding
remain a separate step; do not point this preview at production to bypass that step.

## Iteration order

1. Foundation: route, isolated runtime, scoped layout, direct editor and arrival handling.
2. Completed: compact feed actions, source workspace, version history and selection
   restoration, title/feedback dialogs, hidden-category preferences and connection status.
3. Restyle the remaining existing screens and preferences within current permissions.
4. Implement and evaluate the independent fast-version path without changing full
   generation prompts, models, validation or editorial policy.
5. Exercise both UI flag states against the real isolated API/worker stack; release
   through the normal process with measured runtime behaviour.

[Design specification](DESIGN.md) and [interactive reference](prototype.html) describe
the whole direction. They are broader than the current implementation. Current
status, checks and the next bounded step live in [HANDOFF.md](HANDOFF.md).


## September 9 editor implementation

The approved card uses Notis / Original / Sammenlign, a full dateline, inline
headline suggestions, Endre / Kopier, one version menu, and a compact overflow.
Endre combines instructions, sources, length and reasoning. Instructions are
stored by notice and selected rewrite. Requested results open automatically only
while the submitted editor and composer remain untouched; automatic full drafts
always require selection. The selected article is copied without diff markup.

The primary database owns `notice_generation_controls`: immutable request inputs,
FIFO position, lifecycle, reserved version and result identity. The worker recovers
the durable outbox with deterministic BullMQ IDs. Queued cancellation is immediate;
active cancellation aborts in-flight calls and acknowledges after execution stops.
Cancellation and publication share the feed row lock. Generation logs remain audit
records. The existing PDF and URL importer limits and editorial gates still apply.

Apply migration `20260909140000_notice_generation_controls` before starting the
new API/worker. It adds one table and indexes, without changing existing rewrite
enum values. Preserve UI_V2_ENABLED and FAST_DRAFT_ENABLED. The editor exposes
queued generation/cancellation only when the API sees a live worker capability
heartbeat. Ship API/worker with the migration before enabling the new web controls.
No migration or application from this branch has been deployed to production.

### Real local integration verification

Use isolated PostgreSQL 16+ and Redis 7+ services. Build shared, prompt-kit, API and
worker first. The test refuses non-loopback services or a database not ending in
`_test`; it deletes only its own fixture notices and uniquely prefixed queues.

```powershell
$env:DATABASE_URL='postgresql://postgres:YOUR_LOCAL_TEST_PASSWORD@127.0.0.1:55439/next_editor_test'
npx.cmd prisma migrate deploy
npm.cmd run build -w packages/shared
npm.cmd run build -w packages/prompt-kit
npm.cmd run build -w apps/api
npm.cmd run build -w apps/worker
$env:NEXT_EDITOR_TEST_DATABASE_URL=$env:DATABASE_URL
$env:NEXT_EDITOR_TEST_REDIS_URL='redis://127.0.0.1:56389'
npm.cmd run test:notice-editor:integration
```

The integration suite uses real API handlers, database admission/cancellation,
BullMQ runtime, shared model-call cancellation and atomic publication with a local
delayed model responder. It covers FIFO, duplicate IDs, frozen sources/edits,
queued and active cancellation, publication races, restart recovery, and retry.
The broader worker tests cover the editorial pipeline. It is not a live model or
production traffic evaluation.

Use `npm.cmd run dev:ui` for browser review. The fixture title responder deliberately
requires development mode; `next start` does not provide that fixture shortcut.
Use a separate stopped-dev production build for `npm.cmd run ui:verify-routes`.
A fixture instruction containing `[fail]` exercises failure; normal inputs exercise
completion, and Avbryt cancels. `POST /__preview/fast` on fixture port 4101 replays a
fast draft followed by a full result 12 seconds later. `/feed` uses the same fixtures.

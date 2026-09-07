# UI refresh development

The redesign lives at `/next`; the existing application stays at `/feed`.
The two surfaces reuse the current API, session handling, notice editor, clipboard,
local draft storage and feed stream. Editorial generation is unchanged.

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
127.0.0.1:4101. It does not start a worker, polling, a database or Redis. Generation
and title suggestions return an explicit unavailable response. Edits still use the
real editor's browser storage. Fixture sessions and data reset when restarted.
The preview has its own cookie name, so it does not replace a legacy localhost login.
Occupied ports cause startup to fail; stop the previous preview before restarting.

Replay a regeneration completion and a new notice while editing:

```powershell
npm.cmd run ui:replay
```

This replays existing full-publication events. It does not simulate an implemented
fast-generation backend. The selected editor remains until `Vis versjon` is clicked.
Incoming notices are buffered until the reader reveals them.

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

| Setting | Default | Effect |
| --- | --- | --- |
| `UI_V2_ENABLED` | off | Exposes authenticated `/next`; disabled returns 404. |
| `FAST_DRAFT_ENABLED` | off | Reserved independent switch. No generation consumer exists yet. |
| `SESSION_COOKIE_NAME` | `newsweb_session` | Preview sets `newsweb_ui_preview`. |
| `UI_PREVIEW_FIXTURES` | off | Development-only title-generation guard and preview label. Set by fixture launcher. |

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
2. Refine feed actions and source workspace; keep version and edit state on navigation.
3. Restyle the remaining existing screens and preferences within current permissions.
4. Implement and evaluate the independent fast-version path without changing full
   generation prompts, models, validation or editorial policy.
5. Exercise both UI flag states against the real isolated API/worker stack; release
   through the normal process with measured runtime behaviour.

[Design specification](DESIGN.md) and [interactive reference](prototype.html) describe
the whole direction. They are broader than the current implementation. Current
status, checks and the next bounded step live in [HANDOFF.md](HANDOFF.md).

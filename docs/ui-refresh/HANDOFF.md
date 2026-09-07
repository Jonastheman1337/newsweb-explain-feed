# UI refresh handoff

Append session entries here. Read `README.md`, then the latest entry, then `DESIGN.md`
for the relevant surface. The production editorial plan is a separate workstream.

## 2026-09-07 — Foundation milestone

Started from `origin/main` at `3748483` in a clean `codex/ui-refresh` worktree.
Scope: a running isolated preview, independent switches and the first real feed
shell using existing editorial output. The approved full design is retained as a
reference, not claimed as fully implemented.

Implemented:

- Authenticated `/next` with scoped layout/styles and existing editor, source links,
  attachments, notification/theme controls and API/SSE contract.
- Search and existing market/category/issuer filters, important-only view, buffered
  arrivals and explicit selection of completed full rewrites.
- Publication props stay stable during progress/completion; older replay revisions
  cannot overwrite a newer publication. Reconnects merge updates into current cards.
- Independent default-off UI/fast flags; the fast flag is reserved, with no worker
  consumer or new model calls. Login accepts only an allowlisted `/next` return.
- `dev:ui`: loopback web 3101, fixture API 4101, separate session cookie, fictional
  data and deterministic `ui:replay`. No DB, queues, polling or worker are started.
- An optional dedicated Compose dependency file for the later integration stage.

Validation:

- Shared, prompt-kit, API and worker TypeScript builds passed.
- Next production build passed. The initial sandboxed attempt could not fetch the
  existing Google Fonts; the allowed network retry passed without font/code changes.
- 58 web tests passed, including stable publication state, replay ordering and the
  login allowlist. Two fixture API/auth/filter/pagination/SSE tests passed.
- Production-server route smoke: flag off gives 404, flag on redirects logged-out
  requests to login, invalid sessions redirect, authenticated `/next` works, and
  authenticated legacy `/feed` works under both flag states. Cookie isolation passed.
  Run `npm.cmd run ui:verify-routes` after a web build, with dev stopped; it uses 3102.
- In-app browser: login, `/next`, legacy `/feed`, search, inline sources, both themes,
  desktop 1100 px and mobile 360 px. Expanded mobile filters had equal client and
  scroll width (360 px).
- While a notice body was edited, an SSE replay added the new-version action and
  buffered one arrival. Text, focus and caret offset 65 remained unchanged. Explicit
  version selection switched to the new full text; revealing the arrival added one card.
- Copy button success feedback was observed. The IAB virtual clipboard reported no
  data, so pasted clipboard content was not independently verified in the browser;
  the shared clipboard/disclosure and rich-text tests passed.

Current limits:

- Fictional fixture preview only; no production deployment or editorial changes.
- Docker is unavailable on this machine. The separate database/Redis configuration
  has not been run; real isolated API/worker integration and seeding remain pending.
- Full source workspace, version-history navigation, compact overflow actions,
  preferences and remaining screens are later design milestones. Inline source
  expansion is implemented. Selected-version restoration after leaving the page
  remains part of the source/history milestone.
- Fast drafts are not implemented. Preserve the canonical legacy rewrite and current
  generation policies when that separately tested milestone begins.
- The original checkout's unrelated dirty files were left outside this worktree.

Next bounded step:

1. Review this actual `/next` preview with the user and capture concrete visual/workflow
   changes. Refine the feed action placement and source workspace next.
2. Keep shared editor semantics intact. Check source open/close, edit persistence,
   copy output and selected-version restoration before calling that next step done.
3. Commit each iteration; bring released `origin/main` changes into this branch.

## 2026-09-07 — feed workspace refinement

Implemented after the request to keep improving the preview:

- Compact Kilder / Kopier actions, overflow for titles, versions, regeneration,
  AI original, reversible reset and feedback. Existing clipboard and generation
  semantics are retained through opt-in presentation hooks in shared components.
- Source workspace beside the same editor; mobile source/editor navigation and
  return to the feed restore scroll and preserve mounted draft editors.
- Version history with timestamps, edited markers and explicit selection. Selected
  older publications survive reload; new publications remain pending choices.
- Title and feedback dialogs with keyboard dismissal/focus restoration, hidden
  categories in preferences, and stream connection/retry state.
- Local simulated full generation, title suggestions and version history. No worker
  or model calls. Instructions are stored but do not alter the fictional output.

Evidence:

- Real editor DOM test covers copying the current edit, AI-original round trip,
  reset/undo and StrictMode remount. Browser testing uncovered a mount-cleanup
  restoration bug, reproduced in that test and fixed by synchronizing the draft
  snapshot with the restored DOM before cleanup.
- Stream test checks one connection for multiple consumers, event fan-out, manual
  reconnect replay cursor and resynchronization after a missed gap.
- In-app browser: edited Nordvik version 1, generated simulated version 2, observed
  the edit preserved beside “Ny versjon klar”, explicitly selected version 2,
  returned to version 1, chose a title and reloaded. Edited title and body returned.
- Browser checked source/version panels, title choices, feedback confirmation,
  preference save, Escape/focus restoration and 1100px desktop / 360px mobile,
  light and dark appearances. Shared clipboard content was verified in the DOM
  test; system paste remains outside the IAB virtual clipboard's support.
- Web suite: 61 passing tests. Fixture suite: 2 passing tests. Web typecheck passed.

Scope remains the isolated UI preview. Remaining broader design milestones:
Sak and Signaler presentation, real isolated API/worker integration and the separate
fast-version implementation/evaluation. The full design is not yet implemented.
No production deployment, prompt/model changes or production data access occurred.

Next: review this working feed/source milestone, then carry the common layout into
remaining existing screens without altering their permissions or generation rules.

Final verification for this checkpoint: production web build passed; both UI flag
states passed authenticated `/next` and `/feed` checks, isolated-cookie login,
invalid-session redirect, authenticated history GET, unauthenticated rejection and
invalid notice-id validation. Route checks used `UI_VERIFY_PORT=3112` because 3102
was already occupied; no process on the occupied port was stopped. This override
is available for future checks. The final 61 web tests and 2 fixture tests passed.

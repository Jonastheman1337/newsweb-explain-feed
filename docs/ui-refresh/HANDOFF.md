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

## 2026-09-07 — STARTED: fast drafts and production /next

User authorized implementing fast drafts in V2 and making `/next` available on
production alongside legacy. The live baseline and origin/main were verified at
384e2d37c854e0dd84467fafa5d148a6c22b428c, with one healthy worker and queue lag 0.
Merged those released Sak changes into the UI branch as 81e9f29; retained both
V2 draft restoration and Sak's read-only/onDraftChange behavior. Web tests: 65 pass.

Implementation boundaries:
- One existing full-generation pipeline and one canonical published full version.
- Separate fast-draft persistence and V2-only retrieval/events. No legacy feed or
  full-generation prompt/model/validation changes.
- Fast candidates use the existing importance high-bar signals and importance
  rubric; final legacy classification remains with the full generation.
- Bound concurrency and timeouts; deduplicate by notice; failures never block the
  full worker path. Preserve separate edits and explicit full-version selection.
- Verify real model latency and factual output, both event orders, retry/restart
  handling and stored-output isolation before exact-SHA production release.
- Production release requires migrations/backup/preflight and authenticated checks
  on both routes, with one polling worker and live fast-draft evidence.

## Fast-draft implementation

V2 retrieves a separate FastDraft record; the canonical FeedItem and full rewrite
version sequence remain shared with classic. The first draft is attempted once
per freshly ingested important candidate, with two concurrent attempts maximum,
a 35-second publication deadline, and no additional polling worker. It uses the
existing fast model and the existing importance rubric. Source checks cover the
headline and lead. Number-matcher findings remain warnings; passing reference
coverage adjudicates them, following the report path and the user's direction.
There is no fast-draft repair loop. Full generation proceeds independently.

A first draft has its own editable identity and saved edits. Full completion is
an explicit version choice. Late/replayed events and page reloads preserve the
selected draft. Title suggestions use the selected first draft as context.

Controlled live-model examples (fictional issuers, Luna, default tier): a checked
bankruptcy draft took 5.748 seconds including writing and checking. A liquidity
example was withheld because it invented a company description; fast prompting
now takes only the headline portion of the shared title/lead instruction, so it
does not request that description. Three less exceptional/routine cases skipped.
These are smoke examples, not a production latency distribution or quality study.
Raw local evidence is retained in tmp/fast-draft. No further tuning rounds planned.

Validation so far: 69 web tests; focused worker/config tests; API mapper/stream
checks. Next: final build, browser version switch, additive migration and normal
production release verification. Original dirty checkout remains untouched.

## 2026-09-07 — STARTED: simpler Next feed and complete datelines

User accepted the live UX review and explicitly requested the classic feed's full
date/time, issuer, ticker and category dateline in Next. Work is isolated in
`codex/next-ux-20260907`, based on released origin/main `4c456fd`.

Scope: compact feed chrome/cards, one-click title suggestions, inline source
checking with optional focused work, searchable filters and visible exclusions,
important-view persistence, and clear edit/save/retry feedback. Keep the classic
presentation, generation policy, publication selection and clipboard contracts.

Exit: focused interaction regressions, web tests/typecheck/build, both-route checks
and in-app browser verification with the isolated fictional preview. This entry
does not record a production deployment.

## 2026-09-07 — DONE: simpler Next feed and complete datelines

Implemented the accepted UX pass in `codex/next-ux-20260907`:

- Compact header, search row and cards; retain understated controls and readable
  touch targets. Every notice now links a complete Oslo date/time, issuer, ticker
  and formatted category dateline to Newsweb, including notices without a rewrite.
- Kilder opens beside the notice without hiding the other cards. Source text has
  stronger contrast, attachments precede the source body, and long sources scroll
  within a bounded pane. An explicit overflow action retains focused work mode.
- Title suggestions open directly beside the headline. Less frequent actions stay
  in the overflow menu. Failed generation has one retry plus a separate instruction
  action. A first-use hint explains direct editing.
- Searchable market/category/issuer selectors share one filter panel; issuer
  search includes ticker. Active filters can be removed, hidden-category counts
  remain visible, and the important view survives search and older-page links.
  The important view still describes the current fetched page; no backend
  importance filtering was introduced.
- Edit feedback distinguishes saving, saved on this device, and failed storage.
  Failed local writes remain retryable and retain any previous saved draft.

Validation: 75 web tests, 2 fixture tests, web typecheck and the full workspace
production build passed. Both UI flag states passed authenticated new/classic
route checks, login/session checks and history authorization on loopback port
3112. The build retains an existing autoprefixer warning in `app/globals.css`;
that stylesheet was not changed.

In-app browser verification used fictional preview data: desktop and 390/360px
mobile layouts, light/dark themes, inline and focused sources, keyboard dismissal,
title selection, local edits, hidden-category settings, ticker search and combined
search/important filters. An SSE replay left the edit and selected version intact;
explicitly switching versions and returning restored the edit. New arrivals waited
for user selection. Mobile testing found and fixed a filter-panel overflow.

Preview entry point: http://127.0.0.1:3101/next (`preview` / `ui-preview`), launched
with `node scripts/ui-preview/dev.mjs` after production route verification. The
preview uses the real editor with isolated fictional API data and no model calls.

This is a local implementation checkpoint, not a production deployment. The
original dirty checkout was left intact. Next: review this UX pass, then release
the approved commit through the UpCloud deployment workflow when requested.

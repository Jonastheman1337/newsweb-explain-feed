# Editorial A/B Eval Handoff

This note is for future agents who need to find or rerun the OpenAI-only editorial A/B eval for regular Newsweb notices.

## Current 15-notice retrospective review

The current manual QA protocol is a **non-promotable one-shot pilot**. It reuses
15 completed `v5.9.2` production generations as the frozen A arm and makes one
new rewrite plus one reference-check call per case for the corrected
challenger. It is deliberately fail-closed:

- exactly 15 unique message IDs and exact original `generation_runs.id` values;
- exactly one stored `rewrite_output` call and one stored
  `reference_check_result` call per A case, `correctionAttempts=0`, and no
  applied validation repair or style-sanitizer change; the pinned generation
  output must exactly equal its immutable `published_rewrites` row;
- full stored A output, source payload, exact prompts, all model-call
  provenance and prompt hashes;
- schema-filtered generator and checker profiles are both `gpt-5.6-terra`,
  reasoning `medium`, service tier `default`, and 16,384 max output tokens;
  requested and actual response model/service tier must also match the fresh
  challenger calls (triage calls are ignored for this parity check);
- the frozen `regular_v5_9_2_frozen` builder must reproduce every stored A
  prompt and source-payload hash before a model client is created;
- challenger model, reasoning, service tier, schema, parser, validator,
  importance high-bar and style sanitizer match A; only the declared
  prompt/related-notice treatment may differ;
- deterministic independent assignment/order seeds, a 7/8 side split, stored
  assignment and display-order hashes, and opaque IDs in the reviewer HTML.

This pilot is for directional manual QA only. Every plan and run records
`retrospective_one_shot_selected_pilot`, sets `promotionEligible=false`, and
states that it is not shipping evidence. Do not use its winner count alone to
approve a release.

Put the selected exact generation-run pins in a two-column file (`messageId
generationRunId`) and the same 15 IDs in the companion ID file. Never select
“latest by message”. Choose only rows that satisfy the one-shot gates above;
do not publish a locked list or claim enrichment counts until the revised
selection and read-only enrichment have actually completed. The plan requires
at least 10 of the 15 cases to have attached related notices.

Use the direct `tsx` entrypoint for the production read-only export. The
production review utility now requires exactly one explicit mode:
`--skip-queue` (read-only) or `--execute-reprocess` (publishes). There is no
default mutation mode, and unknown/nonnumeric arguments fail loudly.

```powershell
# Read-only: export the 15 already-completed A generations by exact run ID.
npx tsx apps/worker/src/scripts/prod-reprocess-review.ts `
  @tmp/editorial-eval/one-shot-v5.9.2-ids-15.txt `
  --skip-queue `
  --baseline-runs tmp/editorial-eval/one-shot-v5.9.2-generation-runs-15.txt `
  --baseline-out tmp/editorial-eval/one-shot-v5.9.2-baseline-15.json

# Offline: derive the 15 primary-notice cases from the immutable baseline.
npx tsx apps/worker/src/scripts/editorial-eval.ts cases-from-baseline `
  --baseline tmp/editorial-eval/one-shot-v5.9.2-baseline-15.json `
  --out tmp/editorial-eval/one-shot-v5.9.2-cases-15.json

# Read-only Newsweb fetches; no model calls. Review the resolution report.
npx tsx apps/worker/src/scripts/editorial-eval.ts enrich-related-notices `
  --cases tmp/editorial-eval/one-shot-v5.9.2-cases-15.json `
  --out tmp/editorial-eval/one-shot-v5.9.2-cases-15-enriched.json

# Offline preflight after the prompt/checker edits are final.
npx tsx apps/worker/src/scripts/editorial-eval.ts plan-locked-15 `
  --baseline tmp/editorial-eval/one-shot-v5.9.2-baseline-15.json `
  --cases tmp/editorial-eval/one-shot-v5.9.2-cases-15-enriched.json `
  --challenger regular_v5_11_candidate `
  --model gpt-5.6-terra --effort medium --service-tier default `
  --reference-model gpt-5.6-terra --reference-effort medium `
  --reference-service-tier default `
  --assignment-seed autoweb-v511-sides-15-v1 `
  --ordering-seed autoweb-v511-order-15-v1 `
  --out tmp/editorial-eval/one-shot-plan-15.json

# Only this step makes model calls: 15 challenger calls plus their checker calls.
# It never queues or publishes a production rewrite.
npx tsx apps/worker/src/scripts/editorial-eval.ts run-locked-15 `
  --plan tmp/editorial-eval/one-shot-plan-15.json `
  --out tmp/editorial-eval/one-shot-run-15.json

npx tsx apps/worker/src/scripts/editorial-eval.ts review-html `
  --run tmp/editorial-eval/one-shot-run-15.json `
  --out tmp/editorial-eval/one-shot-review-15.html
```

The reviewer artifact contains the original and attached related notices plus
visible A/B article text and a neutral invalid/fatal/checker-error status when
present. It omits arm names, variants, profiles, detailed machine scores and
true generation IDs. Review exports carry opaque assignment/output
IDs; `summarize` verifies and maps them back through the immutable run protocol.
The run artifact retains the baseline/plan receipts, true arm mapping and side
diagnostics for the post-review audit.

## Current Status

- The current checkout declares prompt version `v5.11.0` in
  `packages/prompt-kit/src/prompt.ts`, and the locked pilot above uses
  `regular_v5_11_candidate`. This handoff does **not** establish which Git SHA
  or prompt version is currently deployed; verify that through the release
  workflow before describing it as the production version.
- Historical note: `v5.9.0` was the quote-frequency update of 2026-06-10
  (HOVEDREGEL FOR PERSONUTTALELSER + uttalelses-regnskap via `excluded_hype` in
  `EDITORIAL_QUOTES`, two new quote-bearing style examples in both v5 and v6,
  SELVSJEKK SITAT at the end of the v5 developer prompt, de-hedged report
  management-comment rule, and quote-preserving reference-repair instructions).
  Its production baseline before that change (29 days, v5.8.0 and older) was
  2.9% of published articles with a real quote, zero dash quotes, and a 31%
  quote rate when the source had a quotable key-person statement. Re-measure
  with `npm run signals:pull` +
  `node scripts/analyze-quote-telemetry.mjs <artifact>`; do not treat these
  historical figures as current telemetry.
- A `regular_v6_full` challenger (correct bokmål, deduplicated blocks, SELVSJEKK
  self-check, extract-then-write schema `rewriteOutputJsonSchemaV6`) is registered
  in `packages/prompt-kit/src/prompt-v6.ts` + `regular-prompt-variants.ts` and is
  pending blind review. Eval artifacts: `tmp/editorial-eval/cases-v6-50.json`,
  `run-v6-50.json` (+ `run-v6-50.log`), generated 2026-06-10 at reasoning effort
  high — **these predate the v5.9.0 quote changes (both arms changed identically);
  regenerate the run before any ship decision.** Ship only on the acceptance rule
  below; the production flip steps are in the v6 plan (PROMPT_VERSION → v6.0.0,
  schema order swap, test-string updates).
- The first `regular_v6_draft` prompt pack was reviewed on 50 cases in August
  2026 and rejected: 21 challenger wins, 25 control wins and four both-bad
  decisions. It remains registered so the run is reproducible. The artifacts are
  `tmp/editorial-eval/run-v6draft-50.json`,
  `reviews-user-v6draft-50.json` and `summary-v6draft-50-user.json`.
- A review-led `regular_v6_draft_2` variant is registered but has **not** been
  run. It starts from `regular_v6_full`, keeps the Bokmål and source-delimiter
  guards, replaces exhaustive quote bookkeeping with editorial selection, and
  adds source-perspective, status, financing, detail-selection and
  company-description checks. Design rationale and a future isolated test plan
  are in `docs/prompt-v6-draft-2.md`; the complete readable prompt pack is in
  the git-ignored `prompts/v6-draft-2/` folder.
- Report and yearly-report prompt paths were not changed by the ship.
- Note for Windows: `npm run eval:editorial -w apps/worker -- run ...` can swallow
  `--flags` on some npm versions. Run the underlying tool directly from
  `apps/worker` instead: `npx tsx src/scripts/editorial-eval.ts run ...`.
- The historical A/B eval implementation is local/unmerged unless these files exist in the checkout:
  - `apps/worker/src/scripts/editorial-eval.ts`
  - `apps/worker/src/services/editorial-eval.ts`
  - `packages/prompt-kit/src/regular-prompt-variants.ts`
  - `apps/worker/src/services/editorial-eval.test.ts`
- Known local workspace with the eval files and artifacts:
  - `C:/Users/WJX270/Documents/Kode/newsweb-explain-feed`

If a fresh clone from `main` does not have the eval files above, it cannot rerun the historical A/B comparison yet. First recover or merge the local eval implementation from the known workspace.

## What The Eval Tests

Scope:

- Regular Newsweb notices only.
- No report/yearly-report special prompt paths.
- OpenAI-only generation.
- Direct local DB case selection through Prisma.
- Static blind-review HTML, with review progress stored in browser `localStorage`.

Primary review question:

> Which version would require less editing before publication?

Variants used by the historical eval:

- `regular_v5_6_control`: the old regular `v5.6.0` framing.
- `audience_mechanism_v1`: mechanism-first framing for financially interested newsroom readers.

Important caveat: the eval tests the source payload sent to the model. If the production payload does not include extracted PDF text, the eval model will not separately read the PDF.

## E0 Evaluation Integrity Protocol

New evaluation runs use run-artifact schema version 3. The runner resolves each
prompt variant through a typed profile before creating an OpenAI client:

- `regular_v5_6_control` and `audience_mechanism_v1` use
  `rewrite_v5_title_first_v1`.
- `regular_v6_full`, `regular_v6_draft` and `regular_v6_draft_2` use
  `rewrite_v6_extract_first_v1`.
- Every profile records its prompt version, schema/parser/validator identity,
  requested model, reasoning effort, verbosity, service tier and profile hash.

The runner refuses incompatible prompt/schema profiles before an API call. Each
generation also stores hashes for the schema and rendered system, developer and
user prompts. Cases use canonical source-payload hashes; the ordered set of case
IDs and source hashes defines the corpus hash.

A run creates its blind-review protocol exactly once. `--assignment-seed`
controls an exactly balanced (or one-case-difference) A/B placement, while the
independent `--ordering-seed` controls the randomized case order. Omitted seeds
are generated independently and stored. The Responses API does not expose a
model-generation seed, so artifacts record that field as `null` rather than
claiming deterministic model output.

`review-html` renders only the assignments and presentation positions stored in
a version-3 artifact. The run file is written atomically and an existing output
path is never overwritten. Choose a new output path for every run.

Run schemas 1 and 2 remain readable but are always non-promotable because they
lack the complete profile and review-protocol metadata. Summaries reconstruct
their side diagnostics from saved reviews. Re-rendering legacy review HTML
requires `--reviews` with a complete export; the runner will not invent a new
historical review surface.

## Commands

Run commands from the repo root. Note that `npm run ... -w apps/worker` sets
the working directory to `apps/worker`, so relative `--cases/--run/--out`
paths resolve from there; absolute paths are safest (the examples below show
the repo-root-relative shape for readability).

Build cases:

```powershell
npm run eval:editorial -w apps/worker -- build-cases --from 2026-05-01 --to 2026-06-02 --limit 15 --out tmp/editorial-eval/cases-15.json
```

Run both variants (provide seeds to replay a planned review protocol, or omit
them and retain the generated values from the artifact):

```powershell
npm run eval:editorial -w apps/worker -- run --cases tmp/editorial-eval/cases-15.json --control regular_v5_6_control --challenger audience_mechanism_v1 --assignment-seed review-sides-2026-08 --ordering-seed review-order-2026-08 --out tmp/editorial-eval/run-15.json
```

Create the review UI:

```powershell
npm run eval:editorial -w apps/worker -- review-html --run tmp/editorial-eval/run-15.json --out tmp/editorial-eval/review-15.html
```

For a legacy schema-1/2 artifact, add its complete review export:

```powershell
npm run eval:editorial -w apps/worker -- review-html --run tmp/editorial-eval/run-v6draft-50.json --reviews tmp/editorial-eval/reviews-user-v6draft-50.json --out tmp/editorial-eval/review-v6draft-50.html
```

Open the review UI on Windows:

```powershell
Invoke-Item tmp/editorial-eval/review-15.html
```

After exporting `reviews.json` from the review page, summarize:

```powershell
npm run eval:editorial -w apps/worker -- summarize --run tmp/editorial-eval/run-15.json --reviews tmp/editorial-eval/reviews.json --out tmp/editorial-eval/summary-15.json
```

## Artifacts

Artifacts are written under `tmp/editorial-eval` and should stay gitignored.

Common files:

- `cases-15.json`: selected notices and source payloads.
- `run-15.json`: immutable version-3 run artifact with source/corpus identity,
  arm profiles, stored review protocol, generated outputs, validation,
  reference-check results and model-call telemetry.
- `review-15.html`: static blind-review page.
- `reviews.json`: exported browser review choices.
- `summary-15.json`: win rates, fatal counts, category net wins, side placement,
  displayed-side preference, category-by-side counts, five order bands,
  missing/invalid reviews, generation failures, promotion eligibility, per-variant
  `quoteMetrics` (quote opportunity count from `sourceContainsNamedQuoteLikePattern`,
  quote presence rate given opportunity, dash/guillemets counts), and recommendation.
  Runs created before the quote-telemetry field produce empty `quoteMetrics`.

Known local artifacts from the June 2, 2026 run:

- `tmp/editorial-eval/cases-15.json`
- `tmp/editorial-eval/run-15.json`
- `tmp/editorial-eval/review-15.html`
- `tmp/editorial-eval/summary-15.json`

## Curated fixtures and safety gates (E1)

Version-controlled corpora live under `apps/worker/src/fixtures/editorial-eval/`
(pinned to LF via `.gitattributes`; all hashes use canonical JSON, so line
endings never matter):

- `safety/` — deterministic safety fixture classes plus `manifest.json`.
  Seed or reseed with production DB access
  (`DATABASE_URL`/`GENERATION_LOG_DATABASE_URL` in `.env` pointing at the
  Render external URLs, or the local prod clone):

  ```powershell
  npm run eval:editorial -w apps/worker -- build-safety-fixtures --from 2026-06-02 --to 2026-08-13 --numeric-limit 40
  ```

  The seeder pins the curated message IDs from the final report (checker-error
  publications and the seven unresolved numeric cases from the generation-log
  DB), samples the recoverable `UNEXPECTED_NUMBERS` pool, and derives
  routine-notice/false-skip candidates (override with `--not-news-ids` /
  `--false-skip-ids` after owner curation). The marker-leak (675713) and
  loaded-language (675772) classes seed from the rejected challenger's outputs
  in the legacy A/B artifact (`--legacy-run`, default
  `tmp/editorial-eval/run-v6draft-50.json`) — the production rows for those
  message IDs hold clean published outputs, not the failure evidence. Each
  case's `expected` block is filled by replaying the current validators —
  never by hand.

  `apps/worker/src/services/safety-gates.test.ts` replays every case in CI
  (offline, no DB) and fails on any drift. When P2/P3/P4 deliberately change
  validator behavior, run
  `build-safety-fixtures --update-expected` (offline) and review the diff —
  that diff is the release record. The `numeric_unresolved` cases (five after
  the 675221 and 679626 adjudications) must keep `UNEXPECTED_NUMBERS`
  forever; the gate enforces this. Since the P4 shadow phase (2026-08-17),
  `checker_error_published` replays the checker outcome model over the stored
  `referenceCheck` (classified error kinds, coverage evidence must never
  degrade to `none`) and `marker_leak` replays `detectMarkerLeaks` over the
  stored output (must always detect a `role_marker`); both refresh through
  the same `--update-expected` path from stored case data alone — the
  gitignored legacy A/B artifact is only needed for reseeding, never for
  refresh. Validation-class payloads are seeded as
  the payload production validated against (report flows get the
  `reportReferencePayload` join, checked against the persisted
  `validationSourceChars` tripwire); rows that cannot be reconstructed are
  excluded loudly.

- `editorial/` — locked human-review corpora for the runner, created with
  `lock-cases` (stamps corpus identity) and consumed via `run --cases`.
  Curated additions are built with `build-cases --message-ids id1,id2,...`.
  Scoring dimensions and the promotion procedure live in
  `docs/editorial-eval-rubric.md`.

## Related-notice replay and repository guards (v5.11.0 candidate)

The worker resolves referenced and corrected Newsweb notices and attaches them
as `relatedNotices`, rendered as relation-aware `[prior_<messageId>]` source
blocks. The prompt contract also supports same-day `sibling` sources, while the
current resolver default keeps sibling discovery disabled pending separate
evidence. A dated textual citation accepts candidates only when their
Europe/Oslo calendar date exactly matches the cited date; the wider database
query window is retrieval padding, not an acceptance window. Explicit-ID and
correction candidates must also predate the current source.

The current `EDITORIAL_RELATED_NOTICES` contract and reference checker require:

- today's source package controls the current status, title and lead;
- every related-source fact names its exact `prior_<messageId>` in
  `source_spans` and has a source-specific evidence match;
- each historical reference/correction fact carries an explicit historical
  marker, while a sibling fact uses the relation marker "i en parallell
  melding samme dag"; issuer attribution alone is not enough;
- corrected facts state the current correction status; and
- the article does not end on a fact available only in a related notice.

These are enforced through `prior_in_head`, `prior_message_unknown`,
`prior_evidence_mismatch`, `prior_unmarked`, `prior_correction_status_missing`
and `prior_at_end` signals. Residual blocking signals remain visible in the
blind review metadata. The emergency kill switch is
`RELATED_NOTICE_CONTEXT=` (empty); the repository default is
`defaultEnabledRelatedNoticeRelations` in
`apps/worker/src/services/related-notices.ts`.

The old v5.10 replay commands and `regular_v5_6_control` challenger are
historical and are not a current release gate. Use the locked, non-promotable
15-case one-shot workflow at the top of this document for directional review,
and require separate production-parity evidence before shipping.

## Offline numeric replay (P2 Phase B)

The exported corpus (gitignored JSONL under `tmp/editorial-eval/`; keep copies
outside `tmp/`) is the offline evidence base for numeric derivation rules. The
frozen `replay-corpus-2026-06-02_2026-08-13.jsonl` (144 failed
`UNEXPECTED_NUMBERS` rows, produced by the legacy `tmp/export-replay-corpus.mts`)
is release evidence for shipped rules — never overwrite it. New exports use the
in-repo exporter, which additionally captures the **published number-strip
cohort** (runs whose `validationRepair` stripped numbers, `hiddenDraft`
preserved), marked `rewriteSource: "hiddenDraft"` as the row's last key; failed
rows keep the exact legacy shape. Replay-as-gate policy expects the corpus to be
re-exported periodically — a stale corpus weakens the gate.

```powershell
# Export a fresh corpus (needs GENERATION_LOG_DATABASE_URL, e.g. via
# node tmp/run-with-prod-db.mjs; refuses to overwrite an existing file):
npx tsx apps/worker/src/scripts/export-replay-corpus.ts --from 2026-06-02 --to 2026-08-24

# Replay the failed cohort through the current assessment engine
# (all derivation rules off vs all on), write the deterministic artifact
# tmp/editorial-eval/replay-numbers-<window>.json, print pool/fidelity/
# per-rule clears and the unresolved table with a hard would-clear warning.
# hiddenDraft rows are excluded (they belong to replay-stripped-numbers):
npm run eval:editorial -w apps/worker -- replay-numbers

# Replay the published number-strip cohort: re-validate each pre-repair
# hiddenDraft, diff draft vs published numbers (key-compared, so separator
# restyling does not count), classify every stripped number
# clears_now / matcher_gap / absent_from_source, and print the matcher_gap
# adjudication table. Artifact: tmp/editorial-eval/replay-stripped-<window>.json.
# Fidelity vs validationRepair.initialWarnings is informational only — hydrated
# drafts carry placeholder key_facts/source_spans, so source_cell_subrun can
# never fire on them:
npm run eval:editorial -w apps/worker -- replay-stripped-numbers --corpus tmp/editorial-eval/replay-corpus-<window>.jsonl

# One-time fixture fidelity repair (2026-08-14; kept for provenance): rebuild
# the two numeric fixture classes' payloads run-matched from the corpus,
# recompute expected, hard-stop on any unresolved flip or disagreement with
# the replay artifact's already-clean set:
npm run eval:editorial -w apps/worker -- refresh-numeric-payloads
```

Enabling a derivation rule (owner-paced, one class per release window, never
with a cache flip): add the id to `defaultEnabledDerivationRules` in
`packages/prompt-kit/src/numbers.ts` **and** run
`build-safety-fixtures --update-expected` in the same commit — the fixture
diff must flip exactly the replay-predicted `numeric_false_block` cases.
Emergency rollback: set `NUMERIC_ACCEPTANCE_RULES` in the Render dashboard
(unset = code default; set, even `""`, = exact enabled set; no deploy).

## Environment

The eval runner needs the normal local app environment plus model credentials:

- Database access through the repo `.env` / Prisma setup.
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_DEFAULT_REASONING_EFFORT`

The runner uses the same configured OpenAI model and reasoning effort for both variants.

## Case Mix

The 50-case default quota is:

- results/guidance: 8
- financing: 8
- warrants/options/convertibles: 8
- contracts/orders: 7
- M&A: 6
- governance/insider: 6
- short/vague: 4
- hard/other: 3

The local 15-case run used a smaller mixed set with difficult, easy, and vague notices.

## Acceptance Rule

The planned production-switch rule was:

- Challenger wins at least 65% of decided non-tie comparisons.
- Challenger reference/validation fatal rate is not worse than control.
- Financing and convertible/warrant categories do not regress by net 2+ cases.

The challenger was later shipped despite the eval being small because current app usage was limited and the user accepted the risk.


# Editorial A/B Eval Handoff

This note is for future agents who need to find or rerun the OpenAI-only editorial A/B eval for regular Newsweb notices.

## Current Status

- The mechanism-first challenger has already been shipped as the default regular notice prompt in `packages/prompt-kit/src/prompt.ts`.
- The production prompt version is `v5.9.0` (quote-frequency update, 2026-06-10:
  HOVEDREGEL FOR PERSONUTTALELSER + uttalelses-regnskap via `excluded_hype` in
  `EDITORIAL_QUOTES`, two new quote-bearing style examples in both v5 and v6,
  SELVSJEKK SITAT at the end of the v5 developer prompt, de-hedged report
  management-comment rule, and quote-preserving reference-repair instructions).
  Production baseline before the change (29 days, v5.8.0 and older): 2.9% of
  published articles contained a real quote, zero dash quotes, 31% quote rate
  when the source had a quotable key-person statement. Re-measure with
  `npm run signals:pull` + `node scripts/analyze-quote-telemetry.mjs <artifact>`.
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
  publications, marker leak 675713, loaded language 675772, the seven
  unresolved numeric cases), samples the recoverable `UNEXPECTED_NUMBERS`
  pool, and derives routine-notice/false-skip candidates (override with
  `--not-news-ids` / `--false-skip-ids` after owner curation). Each case's
  `expected` block is filled by replaying the current validators — never by
  hand.

  `apps/worker/src/services/safety-gates.test.ts` replays every case in CI
  (offline, no DB) and fails on any drift. When P2/P3/P4 deliberately change
  validator behavior, run
  `build-safety-fixtures --update-expected` (offline) and review the diff —
  that diff is the release record. The seven `numeric_unresolved` cases must
  keep `UNEXPECTED_NUMBERS` forever; the gate enforces this.

- `editorial/` — locked human-review corpora for the runner, created with
  `lock-cases` (stamps corpus identity) and consumed via `run --cases`.
  Curated additions are built with `build-cases --message-ids id1,id2,...`.
  Scoring dimensions and the promotion procedure live in
  `docs/editorial-eval-rubric.md`.

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


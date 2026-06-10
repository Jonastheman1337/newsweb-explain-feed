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

## Commands

Run commands from the repo root.

Build cases:

```powershell
npm run eval:editorial -w apps/worker -- build-cases --from 2026-05-01 --to 2026-06-02 --limit 15 --out tmp/editorial-eval/cases-15.json
```

Run both variants:

```powershell
npm run eval:editorial -w apps/worker -- run --cases tmp/editorial-eval/cases-15.json --control regular_v5_6_control --challenger audience_mechanism_v1 --out tmp/editorial-eval/run-15.json
```

Create the review UI:

```powershell
npm run eval:editorial -w apps/worker -- review-html --run tmp/editorial-eval/run-15.json --out tmp/editorial-eval/review-15.html
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
- `run-15.json`: generated outputs, validation, reference-check results, latency, model, and reasoning effort.
- `review-15.html`: static blind-review page.
- `reviews.json`: exported browser review choices.
- `summary-15.json`: win rates, fatal counts, category net wins, per-variant
  `quoteMetrics` (quote opportunity count from `sourceContainsNamedQuoteLikePattern`,
  quote presence rate given opportunity, dash/guillemets counts), and recommendation.
  Runs created before the quote-telemetry field produce empty `quoteMetrics`.

Known local artifacts from the June 2, 2026 run:

- `tmp/editorial-eval/cases-15.json`
- `tmp/editorial-eval/run-15.json`
- `tmp/editorial-eval/review-15.html`
- `tmp/editorial-eval/summary-15.json`

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


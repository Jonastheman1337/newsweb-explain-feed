# Full notice-pipeline evaluation

`apps/worker/src/scripts/notice-pipeline-eval.ts` calls the same
`runNoticePipeline` implementation as ordinary, report, and yearly notice
generation. It records the editorial brief, initial draft, every repair and
check, and the final publication decision. It never connects to the database,
fetches source documents, queues work, or publishes a notice. The Sak pipeline
and historical `editorial-eval.ts` experiments are separate.

## Frozen input

The input is UTF-8 JSONL: one complete case per line. Every row contains:

- `schemaVersion: 1` and a unique stable `caseId`.
- `provenance`: `synthetic` for invented examples, or `frozen_notice` for an
  actual saved source package.
- `kind`: `regular`, `report`, or `yearly` (the existing remuneration flow).
- `payload`: the complete worker source payload. Include all extracted report,
  supplementary and related-notice evidence before freezing the case.
- `sourceSha256`: `sourcePayloadSha256(payload)` from
  `apps/worker/src/services/editorial-eval-artifact.ts`. This is canonical JSON
  hashing; a hash of the raw JSON line is a different value.
- Optional `instruction`, `previousOutput`, and `expectedDecision`
  (`publish`, `skip`, `retry`, or `failed`). These are included in the corpus
  execution hash, so changing a revision request changes the run identity.
- Optional `reportExtraction` preserves extraction metrics, candidates and
  diagnostics supplied to the production validator. It is also included in
  the corpus execution hash; freeze it with report cases when available.

For reports, preserve `reportReferenceText` as the raw extracted evidence and
`reportCompleteness` when available. A processed writer summary in `reportText`
is not a substitute for the original evidence. Related sources retain their
publication time, relation, and source identity.

The checked-in `apps/worker/src/fixtures/notice-pipeline-eval.synthetic.jsonl`
contains two **invented** Norwegian examples for exercising the command.
They are not editorial acceptance evidence and do not belong in a real held-out
evaluation corpus. Actual editor corrections should become separately frozen
regression cases; keep teaching examples out of the evaluation set.

## Run

From the repository root, build the shared packages after changing them:

```powershell
npm run build -w packages/shared
npm run build -w packages/prompt-kit
```

This command performs **zero model calls**. It validates every case and source
hash and prints the source-code state, corpus identity, and requested profile:

```powershell
npx tsx apps/worker/src/scripts/notice-pipeline-eval.ts --preflight `
  --cases apps/worker/src/fixtures/notice-pipeline-eval.synthetic.jsonl `
  --model gpt-5.6-terra --effort medium --reference-effort medium `
  --review-effort medium --service-tier default
```

To run a real frozen corpus, omit `--preflight` and provide a new output path:

```powershell
npx tsx apps/worker/src/scripts/notice-pipeline-eval.ts `
  --cases tmp/editorial-eval/held-out-notices.jsonl `
  --out tmp/editorial-eval/full-pipeline-run-001.json `
  --model gpt-5.6-terra --effort medium --reference-effort medium `
  --review-effort medium --service-tier default
```

Only this second form reads `OPENAI_API_KEY` (including the repository `.env`)
and makes paid model requests. A case can require several calls, including
repairs. The model, generation effort, reference-check effort, coverage-review
effort, and service tier must be explicit; the evaluator
never silently chooses them from environment defaults. Per-phase effective
settings and actual response models are recorded in every call log.

For production routing parity, `--model` is the main model. If any phase uses
`xhigh` or `max`, supply `--hard-model MODEL` as well. The same routing function
as the worker selects the main or hard model separately for each call. To
intentionally use one model for all efforts, explicitly pass that name to both
options. The main and hard selections are frozen in the artifact profile;
missing hard-model settings are rejected during offline preflight.

Optional controls are `--max-repairs N` (0–3), `--no-skip`, `--timeout-ms N`,
`--max-output-tokens N`, and `--derivation-rules none|RULE1,RULE2`. The active
numeric derivation rule list is recorded: it defaults to the code's current
list, with explicit overrides retained in the artifact. Without
`--max-repairs`, the shared pipeline default is used. The worker workspace
also exposes `npm run eval:notice-pipeline`; paths
passed to that workspace command are relative to `apps/worker`.

An existing output path is rejected before the first model request. Artifacts
are written through the existing immutable evaluation writer. Retry a run with
a new filename. The CLI records failed and blocked cases and returns a nonzero
exit code for `retry`, `failed`, or an `expectedDecision` mismatch.

## Read the result

The new artifact type is `notice_full_pipeline_eval`, schema version 1. Its
identity includes the evaluator version, shared pipeline version, Git revision
and dirty-state hash, full frozen corpus, raw case-file hash, model profile,
and pipeline options. Do not load it as a historical one-shot artifact.

Each generation retains `initialDraft`, `finalDraft`, `finalOutput`, their hashes,
`audit.iterations`, `audit.briefAttempts`, the accepted brief, checks, all model-call telemetry, errors, elapsed
time, and token usage. `finalDraft` is the pipeline's returned candidate,
including rejected text when available. `finalOutput` is populated only when
`decision` is `publish`; it is never filled with a rejected or unchecked draft.
`audit.briefAttempts` retains up to two schema-valid brief candidates and their
literal-evidence errors; a malformed-schema attempt has a null candidate. A
rejected candidate is never substituted for the accepted `brief`.

`sourceSha256` hashes the full frozen payload. `evidenceSha256` is the shared
pipeline's selected evidence identity. Missing usage remains explicitly
unknown: totals include available telemetry and `callsWithoutUsage` identifies
gaps. They are not silently counted as zero tokens.

The audit artifact contains model identities and diagnostics and is **not a
blind reviewer packet**. For human comparison, prepare a separate packet with
identical source evidence and final visible articles, opaque output IDs,
balanced A/B assignment, and an independently shuffled case order, following
the existing editorial review conventions. Keep the arm mapping outside that
packet. Review the news angle, material omissions, factual/status errors,
unnecessary hedging, useful quotes, and editing effort. Machine gates alone do
not establish editorial quality.

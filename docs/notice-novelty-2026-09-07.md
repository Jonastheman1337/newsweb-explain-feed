# Earlier-disclosure comparison for notices
## Release authorization and rollback — 2026-09-07

The owner subsequently authorized deployment with easy rollback. The release was
rebased onto live `384e2d37c854e0dd84467fafa5d148a6c22b428c`, preserving all already
shipped Sak fixes. The preparation results below describe the earlier local run.
The release remains observation-only, with no schema or migration change.

Emergency application rollback uses the retained, already-live image set:

```sh
sudo /srv/autoweb/current/infra/upcloud/scripts/rollback.sh 384e2d37c854e0dd84467fafa5d148a6c22b428c
```

The narrower kill switch is `NOTICE_NOVELTY_MODE=off`, applied through the existing
application environment and worker recreation; it disables all comparison IO and
model calls. The release does not change that environment file. Postdeploy
receipts and runtime verification are retained under `tmp/novelty/`.

Prepared locally on `codex/notice-novelty-20260907`, based on `3748483`. The owner
accepted proposal items 1–3 and excluded item 4: add bounded discovery of earlier
disclosures, compare original notice/attachment contents, and distinguish material
new information from administrative republication. Start with observation before
suppression. There is no new SKIPPED explanation or linked-history UI.

## Behavior

Invitations, webcast recordings, reminders, corrections and report-publication
notices can now look for earlier disclosures without an explicit reference.
Discovery uses the same issuer, reporting period or subject, strictly earlier
publication timestamps and a 30-day window. The stated fiscal year is preserved.
The worker first queries stored metadata and falls back to the official Newsweb
list when it has no relevant stored candidate. Loaded details are checked again
for issuer identity and publication order.

The comparison sees original notice bodies and PDF contents. An attached report
is not presumed new merely because it accompanies today's notice. New guidance,
contracts, material corrections, parent-versus-associate differences and a first
report published in a PDF remain possible news. A title, filename, period match,
company description or absent history is insufficient evidence of repetition.

Every factual model citation is checked against the named source text. A repeated
decision additionally requires complete current evidence, an earlier disclosure,
an administrative announcement, high confidence, at least one evidence pair, and
no new facts or uncertainties. Unavailable evidence, conflicting answers, bad
quotes and timeouts return uncertainty. This deliberately favors retaining news.

Re-exported PDFs are compared using extracted-text hashes and rendered-page
hashes, not just binary file hashes. Identical extracted text with changed
rendering is insufficient. A text wrapper can reuse an earlier decoded logo in
a new layout, provided every image matches prior evidence and no other graphics
are present beyond thin rules/underlines. Unknown or changed visual material
prevents a confident repeat decision.

`NOTICE_NOVELTY_MODE=shadow` is the default; `off` disables the work. These are the
only accepted modes. **This version cannot suppress a notice or alter a writer
prompt.** Both regular and report routes reach the comparison before PDF routing;
manual reprocessing, editorial instructions and supplemental-material jobs bypass
it. Observations are saved outside the writer's source payload in existing
generation metadata, with a structured worker log and normal model-call telemetry.
No database migration, API, frontend, `/sak`, writer-prompt or publication-policy
change is included.

## Bounds and operational cost

- One active comparison per worker process. Other jobs receive an immediate
  `capacity_busy` observation and continue their normal generation flow.
- Up to 50 metadata rows, three earlier notices, two current PDFs and three prior
  PDFs. With no earlier disclosure, PDF downloads and the model call are avoided.
- 16 MiB per PDF, 40 MiB per observation; 80 pages per PDF and 160 pages total.
  Rendered pages are capped at two million pixels; extracted text is bounded.
- 12,000 characters per notice, 30,000 per document, 75,000 source-text characters
  overall. Identical PDF text is stored once with an explicit earlier-source alias.
- 45-second overall observation deadline with cancellation; the comparison uses
  the configured fast model/triage reasoning and fast-call timeout, with at most
  2,400 output tokens. Tests below used `gpt-5.6-luna`, reasoning `none`, tier
  `default` and a 15-second model timeout.

The complete ReFuels observation with fresh downloads, extraction, rendering and
a real model call took **34.292 seconds** on Windows/Node 22.12.0/pdf.js 5.5.207.
Peak process RSS was **679,532 KiB (about 664 MiB)**, including the process runtime;
this is not a measured incremental production-memory cost. This measurement led
to the one-comparison limit. Linux/production latency and capacity have not been
verified. No application database was connected during this replay.

## Development evidence

The frozen corpus is
[`notice-novelty.json`](../apps/worker/src/scripts/fixtures/notice-novelty.json).
It contains three real ReFuels cases and ten fictional counterexamples. Relevant
earlier public notice 681062 is included alongside 681640, 681658 and 681750.
Only notices published before each current case are eligible; generated articles
and later outcomes do not enter the comparison. Expectations are not sent to the
model. The corpus was frozen before the reported rerun.

The September 4 and September 7 ReFuels presentation PDFs have different binary
bytes but the same extracted text and rendered pages across all 41 slides. Five
slides contain no extractable text, making the visual comparison material.

| Case | Expected | Validated result in replay 02 |
| --- | --- | --- |
| ReFuels original Q1 release | First release proceeds | Not applicable to this check |
| ReFuels webcast recording | Already disclosed | Already disclosed |
| ReFuels later investor invitation | Already disclosed | Already disclosed |
| Re-exported unchanged report | Already disclosed | Already disclosed |
| New guidance in an attached report | New information | Uncertain: an unrelated comparison quote was inaccurate |
| New contract in the primary notice | New information | New information |
| Material correction of EBITDA | New information | New information |
| First report released as an attachment | New information | New information |
| Parent results versus earlier associate results | New information | New information |
| Different fiscal year | Uncertain | Uncertain |
| Missing earlier disclosure | Uncertain | Uncertain |
| Prompt injection plus a new contract | New information | New information |
| Changed chart with identical extracted text | Uncertain | Uncertain |

Thus **12/13 exact expected classifications**, with no genuine-news counterexample
classified as a repeat. Ten model calls used 57,657 input and 2,146 output tokens
in this replay. This small, authored development corpus is not independent
accuracy evidence or an acceptable-false-skip estimate.

The separate fresh-download ReFuels run returned **uncertain**: the model again
judged it administrative and already disclosed, but used `sameTextAs` metadata as
one quotation. The validator rejected it. That repeatability failure is retained,
not treated as a pass, and is a reason to keep publication unchanged. Reliable
citation selection, live runtime cost and a wider sample remain to be assessed
before considering suppression.

The first replay also remains recorded. It inadvertently inherited the local
`.env`'s older `gpt-5.4-mini` fast-model setting and matched 9/13 expectations.
Before replay 02, the visual guard was refined to recognize an earlier logo,
the already-discovered earlier Q1 invitation was restored to the frozen history,
and contradictory wording in the fictional first-release fixture was corrected.
The comparison prompt also clarified administrative changes and exact quotations.
The initial fixture is preserved locally in `tmp/novelty/frozen-cases-v1.json`. These are development iterations, not a controlled claim of model improvement.

Recorded decisions, raw model outputs, request profiles, hashes and usage:

- [Initial replay](evidence/notice-novelty-2026-09-07/replay-01.json)
- [Intended-model replay](evidence/notice-novelty-2026-09-07/replay-02.json)
- [Fresh-download observation](evidence/notice-novelty-2026-09-07/refuels-full-io.json)

## Verification and replay

Worker tests cover temporal/issuer/period boundaries, database fallback, attachment
limits, unavailable sources, altered graphics, genuine new facts, quotation
grounding, cancellation, process capacity and unchanged regular/report prompts.
Worker compilation and the full five-workspace application build passed. The
final worker suite passed 674 tests with one existing skipped test; its log is saved
in `tmp/novelty/worker-tests-final.log` alongside the build and replay artifacts.

Run from the repository root; the output directory must not already exist:

```powershell
# Prepare evidence only: no model calls or application DB connection.
node_modules/.bin/tsx.cmd apps/worker/src/scripts/notice-novelty-eval.ts --cases apps/worker/src/scripts/fixtures/notice-novelty.json --out tmp/novelty/prepared

# Explicit live comparison using the tested profile and an existing local key.
$env:OPENAI_FAST_MODEL = 'gpt-5.6-luna'
$env:OPENAI_TRIAGE_REASONING_EFFORT = 'none'
node_modules/.bin/tsx.cmd apps/worker/src/scripts/notice-novelty-eval.ts --cases apps/worker/src/scripts/fixtures/notice-novelty.json --out tmp/novelty/new-run --call-model --env-file .env
```

The evaluator preserves each case, including failures, and exits nonzero when an
expected decision is missed. The intended-model development run therefore exited
1. Offline preparation does not make or score classifier decisions. The worker
uses its deployed fast-model configuration; this change does not silently replace
that configuration with the model used in the local replay.

This preparation has not been pushed or deployed. `origin/main` subsequently
advanced to `d7cf534` with separate Sak work; this branch retains its verified
`3748483` base and does not include that work in the novelty change.

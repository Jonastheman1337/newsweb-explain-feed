# Notice quality implementation — 4 September 2026

The six audit findings are addressed in a shared notice-generation pipeline.
The changes cover ordinary notices, financial reports and the existing annual
remuneration flow. The `/sak` page, its generation path and frozen historical
prompt builders are unchanged. No historical notices have been republished.

## What changes for readers

| Finding | Implemented behavior |
| --- | --- |
| Reported facts were turned into uncertain claims | The notice attribution guard distinguishes measurements and completed events from opinions and causal claims. The reference checker also checks certainty in both directions. |
| PDF columns, periods and units were lost | Financial facts retain their original row, attachment, page, column period, comparison, currency, scale and group/parent scope. Unresolved interpretations are explicit. Bounded attachment inspection uses document content and can retain complementary reports. Management explanations are selected alongside financial tables; accounting notes do not displace them through incidental keyword matches. |
| A thin article could pass with 100% sentence coverage | A source-bound editorial brief selects essential facts before writing. A separate completeness check requires those facts in the visible article after every repair. Insufficient report evidence blocks publication. |
| Triage saw only the opening excerpt | Model triage receives the full prepared source package, including extracted attachments and valid related notices. Its brief also guides writing and completeness review. Existing deterministic category/routine decisions remain in place. |
| Large prompts contained competing instructions | Version `v5.12.0` uses one compact hierarchy and source-paired examples. Accounting terms and event status are consistent; an unsupported company description can be empty. |
| Evaluation missed repairs and final publication decisions | The worker and offline evaluator call `runNoticePipeline`. Every changed draft gets fresh reference and completeness checks. Artifacts retain the initial draft, repairs, final candidate, publishable output, source hashes and model telemetry. |

Repairs are combined into one bounded loop rather than separate chains. The
default is at most two repairs. Unavailable final checks return a retry and
clear stale final-coverage values. The persistence adapter retains generation
ownership and the existing immutable publication behavior.

Partial report evidence caps confidence at medium, including after repairs.
Unambiguous title-only edits preserve the approved lead, body and company
sentence exactly, while the entire restored article still receives current
source and completeness checks. Combined title/body edits remain editable.
Rejected editorial briefs retain their bounded evidence and validation errors
in the audit. A retry receives the failed brief and must copy the original PDF
word breaks; literal-evidence matching has not been loosened.

The new regular/report writing instructions are approximately 76%/81% shorter
than the previous instructions, before source text. This is an instruction-size
comparison, not a claim about total tokens or generation cost.

## Diagnostic evidence

The model profile was held at the production settings inspected during this
work: `gpt-5.6-terra`, medium generation/reference/review effort, default service
tier. These were offline runs; they did not connect to the production database,
queue notices or publish results.

- Two invented examples both produced publishable output in four calls each,
  with no repairs. They exercise purchase-price components/conditions and
  factual reporting without invented uncertainty.
- Six actual public notices were frozen from public NewsWeb responses and PDF
  downloads. This corpus deliberately includes known problem cases and is
  diagnostic, not blind or held-out editorial acceptance evidence.
- The first public run produced four publishable regular notices and correctly
  blocked both reports while their financial headers remained unresolved. The
  four regular outputs preserved acquisition consideration and earn-out terms,
  issuance/settlement status, construction timing, and which company receives
  each tax refund. The Fjord Defence repair also corrected planned issuance
  that the initial draft had presented as completed.
- That report run exposed two real extraction formats now covered by focused
  regressions: scope/units above the statement title with mixed quarter/date
  columns, and explicit date-range columns with a unit caption emitted after
  the table. Bare end dates do not silently become half-year periods.
- The `-v2` report run passed machine gates but manual inspection found that
  management explanations were missing from the extracted source. The `-v3`
  corpus adds the relevant narrative pages from the same frozen PDFs. Its first
  run exposed normalized PDF words in the planner's supposedly literal quotes;
  the original failed run is retained.
- The final report run (`diagnostic-...-v4.json`, using the `-v3` corpus) produced
  two publishable articles in nine calls: one source-quote retry and no article
  repairs. Carucel preserves the Q2 loss of NOK 67.6 million versus a profit of
  NOK 40.5 million, group revenue of NOK 132.3 million versus NOK 175.3 million,
  and the NOK 46 million prior-year property-sale gain behind the EBITDA fall.
  Haugaland preserves the NOK 492 million half-year result, NOK 2.483 billion
  revenue and higher achieved electricity prices despite lower production.
  Both outputs have medium confidence because extraction is partial.
- The Carucel reference checker marked the label "halvårsrapporten" unsupported
  against the source title "Interim Financial Report Q2 2026". Its numerical
  and explanatory claims were grounded; the existing gate treated the label
  as nonblocking. The run is not claimed to have 100% reference coverage.
- An invented annual-remuneration case passed in four calls and preserved the
  distinction between share-based accounting cost and cash pay. A title-only
  edit initially exposed style cleanup altering an untouched lead; after the
  preservation fix, it passed in four calls with the lead and body byte-for-byte
  unchanged. These invented cases are separate from the prompt examples.

Local evidence files are under `tmp/editorial-eval/`:

- `notice-pipeline-synthetic-smoke-2026-09-04.json`
- `notice-public-cases-2026-09-04.jsonl` and its `.receipt.json`
- `notice-public-diagnostic-2026-09-04.json`
- `notice-public-cases-2026-09-04-v2.jsonl` and `-v3.jsonl`, with receipts
- `notice-public-reports-diagnostic-2026-09-04-v2.json`, `-v3.json`, `-v4.json`
- `notice-flow-smoke-diagnostic-2026-09-04.json` (annual pass and original edit failure)
- `notice-title-edit-diagnostic-2026-09-04-v2.json` (corrected edit)
- `report-parser-evidence-2026-09-04/` (original PDFs, extracted pages and visual checks)

The original corpus and run are immutable. Parser revisions use a separate
corpus with ancestry and public-PDF hashes. Re-extracting both reports with the
final parser exactly reproduced their `-v3` payload hashes. See
[the evaluator guide](notice-pipeline-eval.md) for reproduction and artifact
interpretation.

## Validation

| Check | Result |
| --- | --- |
| Shared package | 17 tests passed |
| Prompt kit, including historical and Sak contracts | 184 tests passed |
| API | 93 tests passed |
| Worker, including new pipeline/PDF regressions | 788 tests passed; one existing skip |
| Web | 48 tests passed |
| Signals/cost scripts | 8 tests passed |
| Repository typecheck | Passed |
| Shared, prompt-kit, API, worker and web builds | Passed |
| Whitespace/diff check | Passed |

Total: 1,138 tests passed and one existing skip. The final independent agent
review found no blocker in publication ownership, failure/skip handling, raw
report evidence, fresh final checks or Sak isolation. This was a code review
with focused tests, not a production database/queue exercise. No API/web/Sak
implementation files or frozen prompt builders changed.

## Practical limits and release state

The extractor has explicit page, attachment, byte and context budgets. It does
not claim to understand every PDF layout. Scanned or ambiguous reports without
independently readable financial evidence remain blocked. In the financial
report fallback, a model-generated PDF summary cannot serve as its own source;
raw financial excerpts are retained separately. The inherited general/yearly
fallback is not redesigned here. Partial extraction is recorded as a limitation.

The subsequent [5 September release validation](notice-quality-2026-09-05-release-plan.md)
replaces annual extraction with raw remuneration pages and removes general-PDF
model-summary promotion. The counts above describe the earlier local snapshot.

The small diagnostics demonstrate specific fixes, not a population-wide
quality, latency or cost improvement. A brief can still omit an important fact,
so a clean completeness check alone does not establish editorial quality.
Held-out editorial review should assess the final articles before broad prompt
promotion.

This is a local implementation. No commit, push or application deployment was
performed as part of these diagnostics. A release must use the exact validated
commit and the existing UpCloud backup, preflight and live verification steps.

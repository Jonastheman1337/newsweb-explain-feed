# History-aware follow-up triage

Implemented locally on `codex/history-aware-triage-20260915`, based on
`0181b05a96260b388b3efa6055a965aaa306e31b`. The owner authorized implementation
after the Atlantic Sapphire investigation and clarified that complete attachment
evidence can support skipping. No deployment or production regeneration occurred.

## Behavior

Reference-only lookup was intentional. This extends it for automatic regular
notices about approvals, settlement, distributions, share capital, buybacks,
offers and similar follow-ups. Manual/editor-directed work retains its existing
explicit-reference path. The dedicated annual/quarterly report writing routes
retain their existing editorial decisions; this is not a replacement for report
triage or full archive research.

One indexed issuer/date query reads at most 50 recent original notices within
90 days. Ranking considers bodies as well as titles, excludes issuer-name tokens,
and excludes self, future, stale and other-issuer candidates. Up to three notices
are selected; explicit references/correction targets have priority. History
excerpts retain whole relevant paragraphs within approximately 4,000 characters
per locally discovered source. Explicit references retain their existing budgets.
This is candidate discovery, not proof that two notices concern the same event.
The comparison must establish the same event, instrument, terms and period.

Historical retrieval and explicit-reference resolution begin alongside existing
attachment work. A single model assessment replaces source-only triage for the
eligible regular notice. Its decisions are:

- `new_information`: material new substance; proceed.
- `expected_update`: an expected but newsworthy formal step; usually ordinary importance.
- `routine_repeat`: unchanged administrative mechanics; can skip with complete evidence.
- `uncertain`: retain the full writing/review path; never use uncertainty as a skip.

This assessment runs before the ordinary deterministic/AI skip decisions on the
eligible path. Missing history therefore does not silently become evidence of
repetition. This conservative behavior can increase writing volume for follow-ups
that previously passed through a cheap skip; throughput needs live measurement.

The model selects server-assigned source/block IDs rather than copying quotes.
Code validates source identity, timestamp eligibility, block existence, confidence,
contradictory decisions and current evidence limits. The model still judges meaning;
valid IDs alone do not prove that a factual comparison is correct. Selected original
text, decisions, rejection reasons, model/effort and timings are retained in
`validationJson.triage.history`. Source links also use the existing related-notice
telemetry. The writer reads the same selected source snapshot. A source hash binds
the editorial decision to it, including attachment-completeness state; replay
rejects a stale binding.

The writing guidance prioritizes today's stage in the title/lead. Historical
claims stay source-bound and time-marked in the body under the existing checker
rules. The importance guard respects a validated expected-update/routine decision
instead of keeping red solely because today's text contains an old severe-event
keyword. New-information decisions retain the existing importance rules.

## Attachment rule

An attachment is not itself a reason to forbid skipping. Suppression requires
verified coverage of relevant current attachments. The existing general-PDF
extractor now records whether all pages of its single attachment were extracted,
without text truncation or unexamined image/drawing content. That evidence can
support a skip. Multiple attachments, partial/fallback extracts, image-only pages
and unexamined graphics remain uncertified, so the history assessment cannot
suppress them. A logo or simple drawing can conservatively prevent certification;
that is an unresolved-coverage outcome, not an assertion of new information.

An expected-update importance decision may use the available notice and extracted
substance; unavailable current attachments or over-budget current text reject a
downgrade. The model must return uncertainty if missing substance matters. No new
PDF download or separate model summary is added for the history assessment.

## Speed and settings

| Setting | Default | Purpose |
|---|---|---|
| `NOTICE_HISTORY_MODE` | `active` | `off` restores the reference-only editorial path; `shadow` records decisions without applying them |
| `OPENAI_HISTORY_MODEL` | `gpt-5.6-luna` | Separate from writing, checking and the ordinary notice helper |
| `OPENAI_HISTORY_REASONING_EFFORT` | `none` | Short structured decision |
| `HISTORY_ASSESSMENT_TIMEOUT_MS` | `5000` | Shared model-call budget, including retries; aborts to uncertainty |

- Local discovery has a 1.5-second caller deadline. The bounded Prisma read may
  finish in the background because the client does not expose query cancellation.
- Explicit-reference resolution has a 3-second total deadline and 1.5-second
  network request deadlines. Bodies are fetched two at a time, at most six.
- The external client coalesces simultaneous requests and caches successful parsed
  responses for 60 seconds, capped at 100 entries. Failures are not cached.
- No model call is made when there are no candidate sources. No second source-only
  triage call follows a history assessment, including when that assessment fails.
- The older document-novelty observer remains shadow-only. It now overlaps PDF work
  and uses the dedicated history profile and small total budget. Its heavyweight
  document comparison is not also run on the new event-history path.

The combined lookup/model budget is bounded but the whole generation can still
take longer because writing, attachment extraction and repairs remain. This
implementation does not promise a production p95 latency improvement.

## Evidence and validation

Frozen inputs: `apps/worker/src/fixtures/notice-history.json` (one original Atlantic
Sapphire case and seven synthetic controls) and `notice-history-attachments.json`
(three additional synthetic controls following the owner's attachment clarification).
Expectations are not included in model prompts. Only earlier original sources are
eligible. The production Atlantic payload includes the original protocol excerpt.

The initial quote-copying contract caused citation errors and unnecessarily long
responses. A second iteration clarified material new facts versus a mechanical
stage. The final block-ID contract eliminated those failures in the small replay.
These are development cases used to improve the implementation, not held-out
accuracy evidence. Runs were sequential, so model timing is indicative rather
than a controlled randomized benchmark.

| Final contract profile | Core cases meeting expectations | Median model wall time | Range |
|---|---:|---:|---:|
| Luna / none | 8/8 (seven model calls, one no-match) | 2.085 s | 1.815–3.760 s |
| Sol / low | 8/8 | 3.071 s | 2.106–4.736 s |
| Sol / medium | 8/8 | 5.514 s | 2.452–6.555 s |

Luna also met all three attachment expectations (1.647–2.619 s): unchanged complete
evidence permits a routine skip; new attached terms remain important; incomplete
attachment evidence remains uncertain. This supports choosing Luna for the narrow
decision, with Sol/low available through configuration.

The standalone Atlantic writing/checking replay uses the regular Sol/medium
writer and existing reference/numeric validators. Initial drafts needed repair
for historical context in the lead and then a Coral-ownership phrasing issue.
The final artifact passes the reference gate and numeric validation, remains
`medium`, focuses on approval and retains the August announcement in the body.
It is generation-only, not a production or complete worker/UI acceptance test.

Automated checks:

- Worker suite: 841 passed, one pre-existing skipped test across 50 files.
- Prompt-kit suite: 164 passed. Shared suite: 39 passed.
- Worker, API and web typechecks passed.
- Focused coverage includes cutoff/issuer exclusions, the CFO-body discovery,
  lookup timeouts, cache failures/coalescing, bounded concurrency, attachment text
  versus visual coverage, fabricated blocks, contradictory skips, stale hashes,
  importance and replay preservation.

Retained receipts are under `docs/evidence/notice-history-2026-09-15/`.
The evaluation scripts require an explicitly supplied environment file; they
never print credentials, connect to the database or publish an article.

## Handoff

Implementation is complete locally. Deployment remains separate. When releasing,
use the normal clean-worktree/exact-SHA workflow and inspect actual historical
source choices, skips, final articles and generation latency. Watch unresolved
history and writing volume as well as model latency. A small development corpus
does not establish population-level editorial accuracy or archive-search recall.

## Predeployment full-archive correction

Before switching production, the archive check found that raw token overlap favored older, longer takeover notices and excluded the September 14 ownership statement. The original candidate fixture had contained only four selected earlier notices. The regression now uses the full stored issuer history, and search ranking discounts old overlap scores by age (seven-day scale) while explicit cited sources retain priority. The full-archive replay retrieves 681211, 681312 and 682288 and returns expected_update/medium in 3.914 seconds. All eight core cases pass with the revised ranking; receipts are full-archive-*.json. This correction was made before any production switch.

# Sak editorial workspace — implementation and verification

Pre-release implementation and verification record, 7 September 2026.

The isolated release starts from the existing live/main baseline `37484834cda78438b66412a3f29cf3a561454c11` and adds only the 29 files changed by this Sak task. Locked dependencies were installed independently, the full production build passed, and 161 focused/shared-editor tests passed in the clean release checkout. No schema or migration changes.

## Requested scope

1. Publication credit is required in the article prose for journalism used as a source. Known domains, pasted publication datelines and editable publication metadata identify the source. Bloomberg credit in the source ledger alone does not pass.
2. Every draft goes through an evidence-backed news brief, writing, whole-article semantic reference review, editorial review, numeric/source/link checks, and at most one targeted article repair followed by both reviews again. A missing or incomplete checker leaves the saved article in `needs_review`. Passage-specific findings are visible in the editor.
3. The brief ranks the actual news and essential context. The writer uses that judgment without a fixed background order or quote quota. The checker evaluates angle, omitted material facts, attribution, certainty, quotes and revision instructions.
4. The workspace keeps sources and the article together, with multiple URL input, multiple PDF upload/drop, direct text input, source errors/recovery, and real generation phases.
5. Revisions carry the selected version ID and the current manually edited title, lead and body. The server verifies ownership and takes source bookkeeping from the stored version. Versions can be compared and an older version selected as the next revision's base. Local manual edits remain browser-local, as before.
6. Source coverage exposes the exact text selected for the next generation, truncation and omission. Priority changes budget order. Pasted replacements preserve the material ID and original URL. Length, shortening, angle and lead controls send explicit instructions and current length targets.

The existing 24-hour source retention and unrelated notice work were not changed. No database migration is required.

## Evidence

- The approved real Bloomberg/Liquid Network evaluation used the configured `gpt-5.5` API. After repairing an overlength draft, the final run produced 1,619 visible characters against a 1,500-character target (accepted band 1,275–1,650), credited Bloomberg in prose and described the backing bitcoin as locked. Both semantic and editorial checks completed with no blocking findings. The run used seven calls; serial wall time was about three minutes because the two review stages run in parallel.
- Two initial runs exposed a brief evidence-format failure: the model wrapped or combined source excerpts. The brief prompt now explicitly requires one continuous copied passage without extra quotation marks or ellipses. The next run passed. Invalid evidence still fails closed.
- The final generated draft was independently rechecked with the final reference and editorial prompts after explicit approval of the comparison. Both returned no findings.
- The original saved draft was then checked with the final general reference prompt. It caught the original reversal of “locks up” into “låser opp” at `block:5` and marked it blocking. Deterministic publication checking also blocked the missing Bloomberg credit.
- The first generated run also exposed a request for a link where the pasted source had no URL. The editorial prompt now requires prose credit but does not demand an impossible link.
- Lexical attribution warnings were noisy even for supported, explicitly attributed statements. A completed semantic review with no unsupported passages now supersedes those lexical warnings; failed reference checks retain them. A regression check covers both cases.
- Real Next UI tested in the Codex in-app browser against a local fixture API at desktop and 390px widths. Confirmed version comparison, returning to version 1, manual lead edits sent with `baseVersionId=v1`, creation/selection of the resulting version, and shortening from 2,500 to 1,500 with `revisionAction=shorten`. Confirmed unread-source text recovery retains the original URL and becomes readable.
- Actual API routes were separately exercised with Fastify injection, including owner isolation, rejecting another draft's base version, edited revision payload, and replacement source identity/URL/priority preservation. The browser fixture is UI verification, not a database/queue end-to-end test.
- Shared/prompt builds, API/worker/web TypeScript checks and focused Sak tests passed. Existing editor rendering was also checked. Docker is unavailable locally, so a full local PostgreSQL/Redis worker stack was not run.

This is one real editorial case and proves the specific credit, reversal and length behaviors. It does not establish general news judgment improvement across a representative article set. Additional model reviews add generation latency and API usage.

Private evaluation artifacts are in ignored `tmp/sak-audit/`; they are not part of the code change.


## Sol high and news-brief recovery (7 September 2026)

A production generation on Terra failed the brief evidence check because its copied passage contained an extra space inside a word. The draft was correctly held for review, but no brief correction was attempted.

All Sak model calls now explicitly select `gpt-5.6-sol` with high reasoning, including the brief, writing/revision, reference check, editorial review and article repair/recheck. The existing explicit xhigh request remains supported. The shared notice model routing and environment are unchanged. Sol high support was checked against the [official model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-sol).

A failed news brief now receives one bounded correction attempt before writing. The correction sees the validation failure and the original sources; copied evidence must still occur in the stated source. Two invalid attempts retain a blocking finding and save the draft for review. The validation audit records attempts, errors and recovery. There is no fuzzy evidence acceptance.

The 53 focused worker tests passed, including recovery from an inserted space, persistent invalid evidence remaining blocking, and explicit Sol high routing despite a different shared configuration. The full production build passed. This release has no schema or migration changes.

The approved saved Bloomberg/Liquid source was also evaluated with the real Sol API at high reasoning before release. The final 1,563-character article credited Bloomberg and passed both full reviews with zero findings after one article repair and recheck. The brief passed on its first attempt. This single case is a regression check, not a general quality benchmark.

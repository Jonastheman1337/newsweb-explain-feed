# /sak voice evaluation

The candidate is `sak-v2.1.0:currency-names-v1`. It makes news selection, drama, conflict, reader interest and plain Norwegian explicit, while keeping the existing model and full source-checking flow. The readable writer is in [sak-voice-prompt.md](sak-voice-prompt.md).

## Baseline and boundaries

- Production worker image verified before branching: `2769690f766115fb858b47dafdae4f5296f955c8`.
- Baseline prompt: `sak-v2.0.0:currency-names-v1`.
- Candidate affects only /sak. Shared editorial blocks, regular notices, fast drafts, schemas, APIs, database access and the number of generation stages are unchanged.
- The numeric-opening style warning is removed. The two-sentence lead, eight-word title (except editor overrides), selected length band, source credits and links remain.
- The news brief is advice, not an additional editor instruction. Ordinary style findings remain warnings. A wording preference or omitted supporting detail alone cannot become a blocking editorial finding.
- Source evidence still must exist in the cited material. Plain paraphrases and written-source quotations are assessed semantically; invented claims, changed event status and unsupported quotations remain errors.
- No production data is written, no stored article is replaced, and this implementation does not deploy the candidate.

## Sources and comparison

Three separate development cases cover Circio financing, the DNO/Genel conflict and Huddlestock's competing news points. The development read identified excessive process detail, generic uncertainty reminders and a reviewer treating the brief's suggestions as mandatory instructions. One refinement addressed these before the candidate was frozen for the paired comparison.

The locked comparison contains **eight first drafts and four revisions**. Revisions reuse four of the eight source sets; these are twelve task comparisons, not twelve independent stories:

| Case | Source / task |
| --- | --- |
| Tesla | Four English sources with conflicting launch descriptions |
| Rates | Norwegian rate forecasts, several sources, fixed title and explicit opening instruction |
| Diesel | Record price and its consequences |
| Liquid | Technical mechanism, theft and a large amount |
| Oslo | Five public documents, practical consequences and an editor-supplied title |
| Air Canada | New route, quotations and background |
| Banks | Norwegian merger letter of intent and conditional event status |
| Thin financing | SoftOx financing source with an intentionally demanding 5,000-character target |
| Revision: shorten | Same saved Air Canada article, shorter target |
| Revision: lead | Same saved Liquid article, change only the lead |
| Revision: angle | Same saved Tesla article, focus on promises versus the limited launch |
| Revision: remove | Same saved rates article, remove the requested ending and retain attribution |

Apple material is excluded. Source snapshots are frozen; neither arm fetches additional sources. Older selected /sak source text was recovered from its saved writer request and checked against the captured character counts. Existing source fixtures supply the remaining cases. Raw sources, previous articles and model-call artifacts stay under git-ignored `tmp/sak-voice/`.

Locked cases SHA-256: `b6d088bd2cba35ad118cc82f9dd19c758a44e4fb75413d3fe3c94accbdb786ab`.

Both arms use `gpt-5.6-sol`, high reasoning, default service tier, 24,576 maximum output tokens and the existing 360,000 ms timeout. They receive identical sources, task dates, instructions, previous articles and length targets. Each uses its own complete writer/brief/reviewer/repair prompt bundle and the corresponding validator. This compares the complete declared /sak change, not just one writer string.

The runner calls the real `processSakDraft` flow with in-memory database adapters. It captures exact requests, responses, model telemetry and final validation. Both manifests carry source, code, runner and model-profile fingerprints. Completed results, including failures, are retained; mismatched output directories are rejected instead of silently reused.

The initial development runner recorded an invalid aggregate prompt-character count. Its complete requests and responses remain available, and the metadata wiring was corrected before the paired comparison. Development outputs are not the release comparison.

## Reproduce locally

Install the isolated worktree dependencies, generate Prisma types, and build the shared and prompt packages. A control source tree is extracted from the baseline Git SHA into `tmp/sak-voice/control/`. The matching tsconfig path mappings must resolve `@newsweb/prompt-kit` to the selected arm's source package; the runner verifies the prompt version before any model call.

Run each arm with the appropriate path mapping and output directory:

```powershell
node node_modules/tsx/dist/cli.mjs --tsconfig tmp/sak-voice/control-tsconfig.json apps/worker/src/scripts/sak-voice-eval.ts --root tmp/sak-voice/control --cases tmp/sak-voice/comparison-locked.json --out tmp/sak-voice/comparison-control --arm control --env-file <private-env-file> --concurrency 2
node node_modules/tsx/dist/cli.mjs --tsconfig tmp/sak-voice/candidate-tsconfig.json apps/worker/src/scripts/sak-voice-eval.ts --root . --cases tmp/sak-voice/comparison-locked.json --out tmp/sak-voice/comparison-candidate --arm candidate --env-file <private-env-file> --concurrency 2
```

Use `--dry-run true` instead of an environment file for a preflight without model calls. Use a new output directory after changing code, runner or corpus. No API credentials are stored in artifacts. The exact paired-run driver is also preserved privately as tmp/sak-voice/frozen-evaluation-runner.ts; the checked-in driver received only end-of-file whitespace cleanup after the run.

Render a blind review and summarize an exported human review. For the Codex in-app browser, serve only the generated page on loopback with node scripts/serve-sak-review.mjs --file tmp/sak-voice/review/index.html and open the printed URL:

```powershell
node scripts/sak-voice-review.mjs render --cases tmp/sak-voice/comparison-locked.json --control tmp/sak-voice/comparison-control --candidate tmp/sak-voice/comparison-candidate --seed sak-voice-20260908-review-1 --out tmp/sak-voice/review/index.html
node scripts/sak-voice-review.mjs summarize --mapping tmp/sak-voice/review/index.html.mapping.json --reviews <exported-review.json> --out tmp/sak-voice/review-summary.json
```

A/B assignment is balanced and independently ordered from a fixed seed. The page displays sources and previous versions, preserves failed/missing results, and collects overall preference plus six dimensions: reader interest, angle, plain language, momentum, depth and factual precision. Review identity and output hashes are checked before summarizing.

The 65% preference threshold is evaluated among decided A/B choices. It is only one part of the release decision: complete editorial review and source audit must also establish no material factual regression and improvements beyond shorter text. The summarizer never declares or performs a production release.

## Verification

- Prompt-kit tests, worker tests and worker type checking.
- Numeric leads and first paragraphs are retained when sourced.
- Different Norwegian phrasing and written quotations can retain valid original evidence; a semantic rejection still blocks even when its evidence string exists.
- A style finding keeps the article available and causes no additional model call.
- Existing narrow-edit, fixed-title, length, attribution and source-failure tests remain.
- Blind assignment and review-integrity tests: balanced deterministic sides, no silent missing-result wins, and rejection of foreign or modified review data.
- Browser verification uses the Codex in-app browser.

## Completed paired run

All 24 runs produced a final article. The control passed automatic gates in 4/12 cases; the candidate passed in 8/12. The remaining cases are retained as needs_review, with their source/evidence, length or editorial findings available in the private audit. These are automatic dispositions, not human factual-error or writing-quality scores.

The candidate lead-only revision preserved the previous title and body exactly. Broad revisions and shortening were assessed against the same previous articles in both arms. The complete machine-readable receipt is [sak-voice-20260908.json](evidence/sak-voice-20260908.json).

No human A/B verdicts have been recorded, the 65% preference gate is pending, and no production deployment has occurred. The technical UI-test export was kept separate from the final run. No preference percentage is inferred from automatic validation or test counts.

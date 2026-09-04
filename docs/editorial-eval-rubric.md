# Editorial evaluation rubric and release procedure

Scoring dimensions and the promotion procedure for prompt/schema candidates.
Derived from the canonical final report
(`prompts/production-editorial-ab-combined-report-2026-06-02_2026-08-13-final.md`,
kept outside version control); the dimensions are copied here so the repo is
self-contained. The evaluation runner and artifacts are documented in
`docs/editorial-eval.md`; deterministic safety gates in
`apps/worker/src/fixtures/editorial-eval/safety/` run in CI and are separate
from this human-scored track.

## Scoring dimensions

Score each reviewed pair per dimension, not as one overall impression. The
recurring production losses are selection and hierarchy, not grammar.

1. **Current event and event stage** — leads with what is new now; proposed,
   awarded, signed, allocated, paid, completed, registered and listed are not
   interchangeable.
2. **Primary angle / material consequence** — the lead carries the most
   material development, not the source's administrative framing.
3. **Source perspective and loaded wording** — no party's loaded label adopted
   as objective fact (`giftpille`); neutralize or quote-and-attribute.
4. **Financing/transaction hierarchy** — amount, instrument, counterparty,
   terms, dilution and conditions ranked correctly.
5. **Metric and number selection** — reader-relevant figures chosen and
   correct; no invented derivations.
6. **Quote value** — normally one named quote that adds cause, demand, risk,
   outlook, strategy or consequence; pure PR dropped.
7. **Subtraction of low-value detail** — procedural residue, long share
   counts, cap-table filler and secondary dates removed.
8. **Factual grounding and safety** — no unsupported claims, no role/marker
   leakage, right-of-reply respected.
9. **Visible length and readability** — within the character cap and readable;
   shorter is not better if hierarchy or context is lost.

Fatal findings (unsupported claims, marker leak, wrong stage on a material
fact, financing/dilution error) dominate any stylistic preference.

## Locked corpus

The locked release corpus lives at
`apps/worker/src/fixtures/editorial-eval/editorial/cases-locked-2026-08.json`
(created via `lock-cases` from the 50-case corpus; corpus identity stamped).
It stays immutable; a revised corpus is a new file with a new corpus ID.
Curated extensions (editor-corrected notices, instruction cases, feedback
items, both-bad A/B cases) are built with
`build-cases --message-ids ... --out <new file>` and locked the same way.

## Release procedure (single owner)

Any change to prompt text, examples, schema, model, reasoning effort or
verbosity that is a promotion candidate:

1. Freeze a control that reproduces the currently deployed generation path
   and matches the challenger on every dimension except the declared variable,
   then run
   `npm run eval:editorial -w apps/worker -- run --cases <locked corpus> --control <frozen-production-control> --challenger <candidate> --assignment-seed <fresh> --ordering-seed <fresh> --out tmp/editorial-eval/run-<name>.json`.
   `regular_v5_6_control` is retained for historical comparisons; it is not a
   generic production control. The retrospective v5.11 one-shot pilot in
   `docs/editorial-eval.md` is explicitly non-promotable and cannot substitute
   for this production-parity run. The runner refuses incompatible
   prompt/schema profiles.
2. `review-html` → blind review in the browser → export reviews JSON.
3. `summarize` → check the summary's `integrity` block first: legacy or
   imbalanced runs are `promotionEligible: false` and stop here.
4. Promotion gates: ≥65% of decided reviews prefer the candidate; no increase
   in fatal/safety failures; no net −2 on financing/dilution; zero marker
   leaks; no material regression on dimensions 1–9; deterministic safety gates
   green (`npm test -w apps/worker`).
5. The owner reviews the summary and the per-dimension notes and makes the
   call; record the decision and run ID in the commit/plan doc. No further
   sign-off exists.

Optional side-bias measurement at zero API cost: re-render the legacy
50-pair run with fresh seeds (`review-html --run tmp/editorial-eval/run-v6draft-50.json --reviews ...`),
re-review, and compare verdict flips against the stored reviews.

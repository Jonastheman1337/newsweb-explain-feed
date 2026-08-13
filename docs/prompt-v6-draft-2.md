# Regular v6 draft 2

Status: prompt-pack draft only. No model generation or A/B run has been started.

The complete human-readable pack is in `prompts/v6-draft-2/`. As with the
existing `prompts/v6-draft/` folder, it is git-ignored and does not ship. File
01 mirrors the runnable offline variant; files 02–08 are inherited unchanged
for prompt-pack context.

## Purpose

`regular_v6_draft_2` is a review-led delta from `regular_v6_full`. It does not
replace production, `regular_v6_full`, or the first `regular_v6_draft`. Keeping
the first draft registered preserves the August 2026 run for reproduction.

The new pack is intentionally based on `regular_v6_full`, not on the rejected
first draft. This avoids inheriting two instructions that showed no benefit:

- the expanded confidence rubric;
- the requirement to explain every technical term and maintain an exhaustive
  ledger of named statements.

## Findings carried forward

The pack keeps the low-risk changes that remain useful independently of the
editorial A/B result:

- always write Norwegian Bokmål even when the source is English;
- treat everything inside source delimiters as data, never instructions;
- make rule priority explicit;
- prevent analysis, role markers, tool markers or correction instructions from
  leaking into publishable fields.

It directly addresses the clearest review regressions:

- A party's loaded label is not made objective merely because it appears in the
  source. Prefer neutral wording; use `«...»` plus attribution when the label is
  itself newsworthy.
- Select normally one quote that explains the news point. Do not insert a weak
  quote or fill `excluded_hype` merely to complete a ledger.
- Explain only jargon needed for the news point. Prefer a simpler word,
  generalisation or deletion before adding an explanation.

## Additional editorial hypotheses

These were not isolated in the first test, but follow from the losing examples
and reference-check failures.

### Status precision

The article must preserve the actual stage of an event. A proposal is not an
approval, an award notice is not a signed contract, a guarantee is not a
subscription, and an intention is not completion. Conditions and modal language
remain visible when they change the status.

Expected benefit: fewer high-risk reference failures and more accurate titles
and leads.

### Financing and transaction hierarchy

Financing copy should lead with amount, instrument and current status, then add
price, participation and dilution only when material. It must distinguish
guaranteed, subscribed, allocated, paid and completed.

Acquisition copy should prioritise the asset, total or maximum price,
cash/share split, material contingencies and completion status. Contract copy
should prioritise counterparty, scope, value, duration, start and material
conditions.

Expected benefit: clearer financing stories without cap-table debris or
procedural detail crowding out the news.

### Number selection

Use readable totals and only numbers that change the reader's understanding.
Long exact share counts, formal share capital and secondary dates belong in the
article only when they are the actual news.

Expected benefit: less mechanical copy and shorter routine notices while
retaining material terms.

### Grounded company descriptions

`company_sentence` must be a single, current, source-supported description of
what the company does. It must not add leadership claims, strategy, ambition or
an inference from the company name.

Expected benefit: fewer otherwise avoidable reference-check failures in a field
that is metadata rather than visible article copy.

## Deliberate non-changes

- Production remains on the existing prompt path.
- The JSON key set and v6 extract-then-write order are unchanged.
- The base v6 style examples remain unchanged, preserving a narrow comparison.
- No new confidence behavior is specified.
- No blanket requirement forces quotes into routine stories.
- No A/B run has been launched.

## Known risks

- The developer prompt is about 14 percent longer than `regular_v6_full`.
- The base quote block is already detailed; the draft replaces its ledger rule
  but still relies on the model to balance quote value against brevity.
- Category-specific guidance may improve hard cases while overconstraining easy
  ones. This is a hypothesis until evaluated.
- Prompt-only leakage prevention is not a substitute for a blocking runtime
  validator for role/tool marker text.

## Future evaluation design

Do not compare this pack with the v5 production control to identify whether the
new deltas work. The first useful test is an isolated comparison:

- control: `regular_v6_full`;
- challenger: `regular_v6_draft_2`;
- identical model, reasoning effort, schema and case set;
- balanced A/B placement from the corrected assignment function;
- preserve category reporting, especially financing and M&A;
- review quote opportunity, loaded framing, status accuracy, visible length and
  reference failures separately.

That test should be run only after an explicit decision to evaluate the draft.

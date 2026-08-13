# Prompt caching

Controls for OpenAI prompt caching on every Responses call the worker makes.
Introduced by work package P1 of `docs/production-editorial-integration-plan.md`;
motivated by production telemetry (2026-08-10 to 2026-08-13) showing PDF-context
calls at 0% cache read / 100% cache write and reference-checker calls at 0.8%
read / 95.8% write — cache writes billed at 1.25× input for pure waste — while
regular rewrites reuse their stable prefix (70% read share) but also write a
request-specific suffix on almost every call.

## Modes

Set per flow via env; requests are built in
`packages/shared/src/openai-responses.ts` (`callOpenAIResponse`).

| Mode | Request effect | Use when |
| --- | --- | --- |
| `implicit` (default) | Body identical to pre-P1 behavior: `prompt_cache_key` only, server decides caching. | Baseline / rollback. |
| `explicit` | `prompt_cache_options: {mode: "explicit"}` with a `prompt_cache_breakpoint` on the developer block. System + developer become `input_text` blocks; only the prefix up to the breakpoint is cached. User content (source text, PDFs) is never cached. | Stable prefix is long and reused (regular rewrite, report flows). |
| `off` | `prompt_cache_options: {mode: "explicit"}` with **zero breakpoints** — the request does not use prompt caching at all. | Prefix reuse is absent or below the cacheable minimum (PDF context, reference check). |

`prompt_cache_key` is sent in every mode for telemetry attribution. Omitting it
does **not** disable caching — only `off` does. Supported on gpt-5.6 models
(all configured models are gpt-5.6-\*).

## Configuration

Global default plus per-flow overrides, parsed in `apps/worker/src/config.ts`:

```
OPENAI_PROMPT_CACHE_MODE=implicit          # global default
OPENAI_PROMPT_CACHE_MODE_PDF_CONTEXT=
OPENAI_PROMPT_CACHE_MODE_REFERENCE_CHECK=
OPENAI_PROMPT_CACHE_MODE_REWRITE_REGULAR=
OPENAI_PROMPT_CACHE_MODE_REWRITE_REPORT=
OPENAI_PROMPT_CACHE_MODE_REWRITE_YEARLY=
OPENAI_PROMPT_CACHE_MODE_TRIAGE=
OPENAI_PROMPT_CACHE_MODE_EDITORIAL_REVIEW=
```

Leave a per-flow key **unset** to inherit the global mode (an empty string is
rejected at boot). Flow resolution lives in `promptCacheModeForFlow()` in
`apps/worker/src/worker.ts`. Rollback for any flow = unset its env var and
redeploy; no code change. The web title-suggestions route stays implicit.

Every model call records `promptCacheMode` and `promptCacheKey` in
`generation_runs.input_json.modelCalls[]`.

## Rollout order and gates

One flow per release window (~1 day), verifying with `npm run signals:pull`
between flips. `modelCallsByPromptVersion` now reports
`calls_by_prompt_cache_mode` plus `cache_read_share` / `cache_write_share` on
every token-usage block.

1. `OPENAI_PROMPT_CACHE_MODE_PDF_CONTEXT=off` — expect `cache_write_input_tokens`
   ≈ 0 for the PDF schema; errors and latency flat.
2. `OPENAI_PROMPT_CACHE_MODE_REFERENCE_CHECK=off` — its ~400-token stable prefix
   is below the cacheable minimum, so `off`, not `explicit`.
3. `OPENAI_PROMPT_CACHE_MODE_REWRITE_REGULAR=explicit` — read share should hold
   near 70% while write share collapses. Watch item: implicit full-prompt writes
   may currently serve same-notice regeneration/repair reads inside the 30-minute
   TTL; the cost gate below is the arbiter.
4. Report/yearly/editorial-review to `explicit` after the regular flow proves
   out. Triage stays implicit (short prompt, fast model).

Before the first flip, smoke locally:
`OPENAI_PROMPT_CACHE_MODE_REWRITE_REGULAR=explicit npm run eval:notice -- <message-url>`
and one PDF-bearing notice with `OPENAI_PROMPT_CACHE_MODE_PDF_CONTEXT=off`.

**Rollback thresholds per flow:** error rate +0.5 percentage points, p90 latency
+10%, input cost +5%, or any request/output mismatch. Cache experiments never
share a release window with prompt-content or other behavior changes.

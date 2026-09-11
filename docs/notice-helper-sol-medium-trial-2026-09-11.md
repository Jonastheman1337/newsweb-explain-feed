# Sol/medium notice-helper trial

The user requested Sol/medium for newsworthiness triage, novelty assessment and preview drafts, following the production main-model change to Sol/medium on September 11 at 02:14 Oslo time.

## Configuration

- Set `OPENAI_NOTICE_HELPER_MODEL=gpt-5.6-sol` and `OPENAI_TRIAGE_REASONING_EFFORT=medium` in production. The helper override falls back to `OPENAI_FAST_MODEL` when absent.
- This applies to triage, novelty assessment, preview writing and the preview source checker. `OPENAI_FAST_MODEL=gpt-5.6-luna` continues to serve title suggestions.
- Preview reasoning gets a 4,096-token total output budget because internal reasoning shares that budget. The visible output schema, eligibility, importance threshold, source checks, 15-second call timeout and 35-second overall preview deadline are unchanged.
- Preview calls now record schema name and requested effort alongside provider-returned model/usage/duration telemetry.
- Novelty remains in its existing observation mode; changing its model does not enable enforcement.

## Baseline and follow-up

Baseline window: September 4-10 inclusive, Europe/Oslo. The local evidence lives in the main working directory under `tmp/helper-model-cost-summary-2026-09-11.json` and `tmp/preview-outcomes-2026-09-11.jsonl`.

- 135 Luna/none triage calls, median 2.082 seconds, p90 3.559 seconds, known cost $0.030833.
- One novelty call, 3.570 seconds, cost $0.000931. Insufficient volume to establish a typical latency or future workload.
- 13 preview attempts / 14 model calls, cost $0.010748: 12 skipped for `importance_below_high_bar`; one failed source checking (message 681866). No ready previews in the baseline.
- Total recorded helper cost: $0.042511 for the week. Preview functionality was introduced during the window, so future volume may differ.

Review around the following week when the user returns. Compare actual provider model/effort telemetry, per-call and per-notice costs, latency, retries/timeouts, preview ready/skip/failure rates, and editorial output. Keep weekday volume and prompt versions separate. Track the preview source-check coverage without weakening the gate. Neither a synthetic smoke nor a passing test establishes an editorial quality gain.

Record the exact production activation time and release SHA in the deployment receipt before starting the comparison window. Keep the earlier main-model cutover distinct from this helper cutover. No recurring analysis job is implied by this document.

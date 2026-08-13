import test from "node:test";
import assert from "node:assert/strict";

import { analyze } from "./pull-signals.mjs";

const timestamp = "2026-06-01T10:00:00.000Z";

test("groups engagement and article-shape signals by prompt version", () => {
  const summary = analyze(
    {
      feedback: [
        {
          created_at: timestamp,
          message_id: "1",
          version: "1",
          notice: "TEST: Feedback",
          text: "Flat lead",
          prompt_version: "v5.6.0"
        }
      ],
      edits: [
        {
          copied_at: timestamp,
          message_id: "1",
          notice: "TEST: Edited",
          has_edits: "true",
          original_title: "Old",
          edited_title: "New",
          original_body: "Old body",
          edited_body: "New body",
          prompt_version: "v5.6.0"
        },
        {
          copied_at: timestamp,
          message_id: "2",
          notice: "TEST: Copied",
          has_edits: "false",
          original_title: "Same",
          edited_title: "Same",
          original_body: "Same body",
          edited_body: "Same body"
        }
      ],
      titles: [
        {
          created_at: timestamp,
          message_id: "1",
          notice: "TEST: Title request",
          action: "title_suggestion_request",
          current_title: "Old",
          selected_title: "",
          selected_index: "",
          selected_was_original: "false",
          suggestions: "A | B",
          prompt_version: "v5.6.0"
        },
        {
          created_at: timestamp,
          message_id: "1",
          notice: "TEST: Title select",
          action: "title_suggestion_select",
          current_title: "Old",
          selected_title: "New",
          selected_index: "0",
          selected_was_original: "false",
          suggestions: "A | B",
          prompt_version: "v5.6.0"
        }
      ],
      events: [
        {
          created_at: timestamp,
          message_id: "1",
          notice: "TEST: Event",
          action: "regenerate_request",
          action_source: "instruction_input",
          prompt_version: "v5.6.0"
        }
      ],
      generations: [
        {
          requested_at: timestamp,
          message_id: "1",
          notice: "TEST: Published",
          reason: "new-message",
          status: "published",
          prompt_version: "v5.6.0",
          model_calls: JSON.stringify([
            {
              schemaName: "rewrite_output",
              model: "gpt-5.6-terra",
              responseModel: "gpt-5.6-terra-2026-08-07",
              serviceTier: "default",
              reasoningEffort: "medium",
              promptCacheMode: "implicit",
              promptCacheKey: "newsweb:rewrite-regular:v5.9.1",
              attemptCount: 2,
              attempts: [{}, {}],
              usage: {
                inputTokens: 1000,
                cachedInputTokens: 500,
                cacheWriteInputTokens: 100,
                outputTokens: 200,
                reasoningTokens: 125,
                totalTokens: 1200
              }
            },
            {
              schemaName: "reference_check",
              model: "gpt-5.6-terra",
              responseModel: "gpt-5.6-terra-2026-08-07",
              serviceTier: "default",
              reasoningEffort: "low",
              attemptCount: 1,
              attempts: [{}],
              usage: {
                inputTokens: 100,
                cachedInputTokens: 0,
                cacheWriteInputTokens: 0,
                outputTokens: 20,
                reasoningTokens: 15,
                totalTokens: 120
              }
            }
          ]),
          output_json: JSON.stringify({
            title: "Lavere inntekter for Test",
            lead:
              "Eiendomsselskapet Test økte tapet til 10 mill. kroner i første kvartal, viser kvartalsrapporten.",
            body: ["Dette er noen nøkkeltall:", "• Inntektene falt"]
          })
        },
        {
          requested_at: timestamp,
          message_id: "2",
          notice: "TEST: Quote",
          reason: "new-message",
          status: "published",
          prompt_version: "v5.6.0",
          output_json: JSON.stringify({
            title: "HX varsler usikkerhet",
            lead:
              "HX peker på «vesentlig usikkerhet» om videre drift, viser kvartalsrapporten.",
            body: []
          })
        },
        {
          requested_at: timestamp,
          message_id: "3",
          notice: "TEST: Missing output",
          reason: "new-message",
          status: "failed"
        }
      ]
    },
    "Europe/Oslo"
  );

  const engagement = summary.engagement.byPromptVersion.find(
    (row) => row.prompt_version === "v5.6.0"
  );
  assert.equal(engagement.generation_count, 2);
  assert.equal(engagement.published_generation_count, 2);
  assert.equal(engagement.feedback_count, 1);
  assert.equal(engagement.copy_count, 1);
  assert.equal(engagement.copy_with_edits_count, 1);
  assert.equal(engagement.copy_with_edits_rate, 1);
  assert.equal(engagement.regenerate_count, 1);
  assert.equal(engagement.title_request_count, 1);
  assert.equal(engagement.title_select_count, 1);

  const unknown = summary.engagement.byPromptVersion.find(
    (row) => row.prompt_version === "unknown"
  );
  assert.equal(unknown.generation_count, 1);
  assert.equal(unknown.copy_count, 1);

  const shape = summary.engagement.articleShapeByPromptVersion.find(
    (row) => row.prompt_version === "v5.6.0"
  );
  assert.equal(shape.article_count, 2);
  assert.equal(shape.descriptor_company_context_lead_count, 1);
  assert.equal(shape.stock_attribution_ending_count, 2);
  assert.equal(shape.quote_or_paraphrase_count, 1);
  assert.equal(shape.bullet_preamble_count, 1);
  assert.equal(shape.inert_title_count, 1);

  const unknownShape = summary.engagement.articleShapeByPromptVersion.find(
    (row) => row.prompt_version === "unknown"
  );
  assert.equal(unknownShape.missing_output_count, 1);

  const modelCalls = summary.qualityPipeline.modelCallsByPromptVersion.find(
    (row) => row.prompt_version === "v5.6.0"
  );
  assert.equal(modelCalls.total_calls, 2);
  assert.equal(modelCalls.calls_with_usage, 2);
  assert.equal(modelCalls.usage_coverage_rate, 1);
  assert.equal(modelCalls.total_api_attempts, 3);
  assert.deepEqual(modelCalls.token_usage, {
    input_tokens: 1100,
    cached_input_tokens: 500,
    cache_write_input_tokens: 100,
    output_tokens: 220,
    reasoning_tokens: 140,
    total_tokens: 1320,
    standard_input_tokens: 500,
    cache_read_share: 0.4545,
    cache_write_share: 0.0909
  });
  assert.deepEqual(modelCalls.calls_by_prompt_cache_mode, [
    { mode: "implicit", count: 1 },
    { mode: "(unset)", count: 1 }
  ]);
  assert.equal(
    modelCalls.usage_by_response_model_and_service_tier[0].key,
    "gpt-5.6-terra-2026-08-07:default"
  );
  assert.equal(modelCalls.usage_by_response_model_and_service_tier[0].estimated_cost_usd, 0.00399);

  const costs = summary.qualityPipeline.openAIUsageAndCost;
  assert.equal(costs.pricing_snapshot.date, "2026-08-10");
  assert.equal(costs.actual_cost_usd, 0.00399);
  assert.equal(costs.successful_story_count, 2);
  assert.equal(costs.actual_cost_per_successful_story_usd, 0.001995);
  assert.equal(costs.counterfactual_standard["gpt-5.5"].cost_usd, 0.00985);
});

test("reports unavailable cost as null for historical rows without usage", () => {
  const summary = analyze(
    {
      generations: [
        {
          requested_at: timestamp,
          message_id: "9",
          status: "published",
          prompt_version: "legacy",
          model_calls: JSON.stringify([
            {
              schemaName: "rewrite_output",
              model: "gpt-5.5",
              reasoningEffort: "medium"
            }
          ])
        }
      ]
    },
    "Europe/Oslo"
  );
  const costs = summary.qualityPipeline.openAIUsageAndCost;
  assert.equal(costs.calls_with_usage, 0);
  assert.equal(costs.actual_cost_usd, null);
  assert.equal(costs.actual_cost_per_successful_story_usd, null);
  assert.equal(costs.counterfactual_standard["gpt-5.6-terra"].cost_usd, null);
});

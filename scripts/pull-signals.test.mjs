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
});

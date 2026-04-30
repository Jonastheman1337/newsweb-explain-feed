import { z } from "zod";

export const rewriteConfidenceSchema = z.enum(["high", "medium", "low"]);
export const rewriteImportanceSchema = z.enum(["viktig", "medium", "uviktig"]);

export const rewriteOutputSchema = z.object({
  title: z.string().min(6).max(140),
  lead: z.string().min(20).max(350),
  body: z.array(z.string().min(10).max(600)).min(1).max(8),
  company_sentence: z.string().min(10).max(220),
  key_facts: z.array(z.string().min(5).max(300)).min(1).max(8),
  negative_or_surprising: z.array(z.string().min(5).max(300)).max(6),
  excluded_hype: z.array(z.string().min(5).max(300)).max(6),
  source_limitations: z.array(z.string().min(5).max(300)).max(6),
  confidence: rewriteConfidenceSchema,
  importance: rewriteImportanceSchema.default("medium"),
  source_spans: z.array(z.string().min(5).max(320)).min(1).max(8)
});

export type RewriteOutput = z.infer<typeof rewriteOutputSchema>;

export type RewriteStatus =
  | "pending"
  | "published"
  | "needs_retry"
  | "failed"
  | "skipped";

/**
 * Normalize stored rewrite JSON that may use the legacy `paragraphs` field
 * into the current schema shape with `body`.
 */
export function normalizeRewriteJson(json: unknown): unknown {
  if (
    typeof json === "object" &&
    json !== null &&
    "paragraphs" in json &&
    !("body" in json)
  ) {
    const { paragraphs, ...rest } = json as Record<string, unknown>;
    return { ...rest, body: paragraphs };
  }
  return json;
}

export const rewriteOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", minLength: 6, maxLength: 140 },
    lead: { type: "string", minLength: 20, maxLength: 350 },
    body: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { type: "string", minLength: 10, maxLength: 600 }
    },
    company_sentence: { type: "string", minLength: 10, maxLength: 220 },
    key_facts: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { type: "string", minLength: 5, maxLength: 300 }
    },
    negative_or_surprising: {
      type: "array",
      maxItems: 6,
      items: { type: "string", minLength: 5, maxLength: 300 }
    },
    excluded_hype: {
      type: "array",
      maxItems: 6,
      items: { type: "string", minLength: 5, maxLength: 300 }
    },
    source_limitations: {
      type: "array",
      maxItems: 6,
      items: { type: "string", minLength: 5, maxLength: 300 }
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    importance: { type: "string", enum: ["viktig", "medium", "uviktig"] },
    source_spans: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { type: "string", minLength: 5, maxLength: 320 }
    }
  },
  required: [
    "title",
    "lead",
    "body",
    "company_sentence",
    "key_facts",
    "negative_or_surprising",
    "excluded_hype",
    "source_limitations",
    "confidence",
    "importance",
    "source_spans"
  ]
} as const;

import { z } from "zod";

export const rewriteConfidenceSchema = z.enum(["high", "medium", "low"]);
export const rewriteImportanceSchema = z.enum(["viktig", "medium", "uviktig"]);

export const rewriteOutputSchema = z.object({
  title: z.string().min(6).max(140),
  lead: z.string().min(20).max(350),
  body: z.array(z.string().min(10).max(600)).min(0).max(8),
  // Empty is valid when the source does not contain a useful company profile.
  // Historical JSON generation schemas below retain their original contract.
  company_sentence: z.string().max(220),
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
      minItems: 0,
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

/** Versioned notice schema; legacy prompt/evaluation schema bytes stay frozen. */
export const noticeRewriteOutputJsonSchema = {
  ...rewriteOutputJsonSchema,
  properties: {
    ...rewriteOutputJsonSchema.properties,
    company_sentence: { type: "string", maxLength: 220 }
  }
} as const;

/**
 * v6 schema: identical key set and constraints, but property order is
 * extract-then-write. Structured outputs generate fields in schema property
 * order, so the model documents its evidence (source_spans, key_facts, ...)
 * before committing to title/lead/body. Consumers are key-based, so the order
 * is invisible to zod, the API mapper, the UI, and jsonb storage.
 */
export const rewriteOutputJsonSchemaV6 = {
  type: "object",
  additionalProperties: false,
  properties: {
    source_spans: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { type: "string", minLength: 5, maxLength: 320 }
    },
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
    importance: { type: "string", enum: ["viktig", "medium", "uviktig"] },
    company_sentence: { type: "string", minLength: 10, maxLength: 220 },
    title: { type: "string", minLength: 6, maxLength: 140 },
    lead: { type: "string", minLength: 20, maxLength: 350 },
    body: {
      type: "array",
      minItems: 0,
      maxItems: 8,
      items: { type: "string", minLength: 10, maxLength: 600 }
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] }
  },
  required: [
    "source_spans",
    "key_facts",
    "negative_or_surprising",
    "excluded_hype",
    "source_limitations",
    "importance",
    "company_sentence",
    "title",
    "lead",
    "body",
    "confidence"
  ]
} as const;

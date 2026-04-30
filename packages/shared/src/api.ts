import { z } from "zod";
import { rewriteOutputSchema } from "./rewrite.js";

export const requestMagicLinkInputSchema = z.object({
  email: z.string().email().max(254)
});

export const verifyMagicLinkInputSchema = z.object({
  token: z.string().min(20).max(200)
});

export const feedQuerySchema = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(60).default(30),
  market: z.string().max(20).optional(),
  category: z.string().max(100).optional(),
  issuer: z.string().max(32).optional(),
  q: z.string().max(120).optional()
});

export const healthResponseSchema = z.object({
  ok: z.boolean(),
  db: z.enum(["up", "down"]),
  redis: z.enum(["up", "down"]),
  queueLagSec: z.number().nonnegative(),
  modelLatencyP95: z.number().nonnegative()
});

export const feedItemSchema = z.object({
  messageId: z.number().int(),
  publishedAt: z.string().datetime(),
  visibilityStatus: z.string(),
  title: z.string(),
  issuerName: z.string(),
  issuerSign: z.string(),
  lead: z.string(),
  body: z.array(z.string()),
  keyFacts: z.array(z.string()),
  negativeOrSurprising: z.array(z.string()),
  sourceLimitations: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low"]),
  importance: z.enum(["viktig", "medium", "uviktig"]),
  hasAttachments: z.boolean(),
  sourceTitle: z.string(),
  sourceBodyText: z.string(),
  skipped: z.boolean().default(false),
  processing: z.boolean().default(false)
});

export const feedResponseSchema = z.object({
  items: z.array(feedItemSchema),
  nextCursor: z.string().datetime().nullable()
});

export const noticeResponseSchema = z.object({
  source: z.object({
    messageId: z.number().int(),
    title: z.string(),
    issuerName: z.string(),
    issuerSign: z.string(),
    publishedAt: z.string().datetime(),
    categories: z.array(z.string()),
    markets: z.array(z.string()),
    bodyText: z.string(),
    hasAttachments: z.boolean()
  }),
  rewrite: rewriteOutputSchema,
  rewrites: z
    .array(
      z.object({
        version: z.number(),
        rewrite: rewriteOutputSchema,
        userInstruction: z.string().nullable(),
        generatedAt: z.string().datetime()
      })
    )
    .optional()
});

export type FeedQuery = z.infer<typeof feedQuerySchema>;
export type FeedResponse = z.infer<typeof feedResponseSchema>;
export type FeedItem = z.infer<typeof feedItemSchema>;

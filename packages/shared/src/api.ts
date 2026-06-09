import { z } from "zod";
import { generationPhaseSchema } from "./generation-progress.js";
import { rewriteOutputSchema } from "./rewrite.js";

export const requestMagicLinkInputSchema = z.object({
  email: z.string().email().max(254)
});

export const verifyMagicLinkInputSchema = z.object({
  token: z.string().min(20).max(200)
});

export const passwordLoginInputSchema = z.object({
  username: z.string().min(1).max(80),
  password: z.string().min(1).max(200)
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
  rewriteVersion: z.number().int().positive().nullable(),
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
  attachments: z.array(
    z.object({
      id: z.number().int(),
      fileName: z.string(),
      fileType: z.string().nullable(),
      fileSize: z.number().nullable()
    })
  ),
  sourceTitle: z.string(),
  sourceBodyText: z.string(),
  notGenerated: z.boolean().default(false),
  skipped: z.boolean().default(false),
  failed: z.boolean().default(false),
  processing: z.boolean().default(false),
  regenerating: z.boolean().default(false)
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
    hasAttachments: z.boolean(),
    attachments: z.array(
      z.object({
        id: z.number().int(),
        fileName: z.string(),
        fileType: z.string().nullable(),
        fileSize: z.number().nullable()
      })
    )
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

export const rewriteStatusResponseSchema = z.object({
  ready: z.boolean(),
  failed: z.boolean(),
  generatedAt: z.string().datetime().nullable(),
  version: z.number().int().nullable(),
  jobState: z.string().nullable(),
  generationRunId: z.string().nullable(),
  phase: generationPhaseSchema.nullable(),
  phaseUpdatedAt: z.string().datetime().nullable()
});

export const outputModeSchema = z.enum(["notice", "extended_notice"]);

export const noticeMaterialKindSchema = z.enum(["pdf", "newsweb", "text"]);
export const noticeMaterialStatusSchema = z.enum(["ready", "failed"]);

export const noticeMaterialSchema = z.object({
  id: z.string(),
  messageId: z.number().int(),
  kind: noticeMaterialKindSchema,
  title: z.string(),
  url: z.string().nullable(),
  fileName: z.string().nullable(),
  mimeType: z.string().nullable(),
  fileSize: z.number().int().nullable(),
  extractedTextChars: z.number().int().nonnegative(),
  status: noticeMaterialStatusSchema,
  errorText: z.string().nullable(),
  enabled: z.boolean(),
  metadata: z.unknown().nullable(),
  createdAt: z.string().datetime()
});

export const noticeMaterialsResponseSchema = z.object({
  materials: z.array(noticeMaterialSchema)
});

export type FeedQuery = z.infer<typeof feedQuerySchema>;
export type FeedResponse = z.infer<typeof feedResponseSchema>;
export type FeedItem = z.infer<typeof feedItemSchema>;
export type RewriteStatusResponse = z.infer<typeof rewriteStatusResponseSchema>;
export type OutputMode = z.infer<typeof outputModeSchema>;
export type NoticeMaterialKind = z.infer<typeof noticeMaterialKindSchema>;
export type NoticeMaterial = z.infer<typeof noticeMaterialSchema>;
export type NoticeMaterialsResponse = z.infer<typeof noticeMaterialsResponseSchema>;

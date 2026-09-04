import { z } from "zod";
import { rewriteStatusResponseSchema } from "./api.js";

/**
 * /sak — free-standing, hand-briefed news articles drafted from user-supplied
 * materials (PDF, URL, pasted text). Everything here is shared between the API,
 * the worker and the web app so the three agree on one contract.
 */

export const SAK_TITLE_MAX_WORDS = 8;
export const SAK_SUBHEADING_MAX_CHARS = 60;
export const SAK_LENGTH_BAND = [0.85, 1.1] as const;
export const SAK_TARGET_CHARS_DEFAULT = 2500;
export const SAK_TARGET_CHARS_MIN = 1500;
export const SAK_TARGET_CHARS_MAX = 12000;
export const SAK_TARGET_CHARS_PRESETS = [1500, 2500, 3500, 5000] as const;

export const SAK_MATERIAL_SOURCE_ID_PREFIX = "material_";
export const SAK_MATERIAL_ID_PATTERN = /^material_[A-Za-z0-9]+$/;

/**
 * Inline link marker inside block text: [[lenketekst|material_<id>]].
 * No nesting; the anchor text may not contain [, ] or |.
 */
export const SAK_LINK_MARKER_PATTERN = /\[\[([^[\]|]{1,80})\|(material_[A-Za-z0-9]+)\]\]/g;

export function sakMaterialSourceId(materialId: string): string {
  return `${SAK_MATERIAL_SOURCE_ID_PREFIX}${materialId}`;
}

export function sakMaterialIdFromSourceId(sourceId: string): string | null {
  if (!SAK_MATERIAL_ID_PATTERN.test(sourceId)) return null;
  return sourceId.slice(SAK_MATERIAL_SOURCE_ID_PREFIX.length);
}

// ---------------------------------------------------------------------------
// Article output schema (model output)
// ---------------------------------------------------------------------------

export const sakBlockKindSchema = z.enum(["paragraph", "subheading", "quote"]);
export type SakBlockKind = z.infer<typeof sakBlockKindSchema>;

export const sakBlockSchema = z.object({
  kind: sakBlockKindSchema,
  text: z.string().min(1).max(900)
});
export type SakBlock = z.infer<typeof sakBlockSchema>;

export const sakSourceEntrySchema = z.object({
  materialId: z.string().regex(SAK_MATERIAL_ID_PATTERN),
  usedFor: z.string().min(3).max(300)
});

export const sakExcludedHypeEntrySchema = z.object({
  speaker: z.string().max(120).nullable(),
  quote: z.string().min(5).max(400),
  reason: z.string().min(3).max(200)
});

/**
 * Property order matters: structured outputs generate fields in schema order,
 * so the ledger (sources, spans, excluded hype) is written before the article.
 */
export const sakArticleSchema = z.object({
  sources: z.array(sakSourceEntrySchema).max(20),
  source_spans: z.array(z.string().min(5).max(320)).min(1).max(16),
  excluded_hype: z.array(sakExcludedHypeEntrySchema).max(12),
  title: z.string().min(4).max(140),
  lead: z.string().min(20).max(600),
  blocks: z.array(sakBlockSchema).min(1).max(40),
  desk_notes: z.array(z.string().min(5).max(300)).max(12),
  change_note: z.string().min(3).max(200)
});

export type SakArticle = z.infer<typeof sakArticleSchema>;

/**
 * Lenient shape for articles read back from storage. The worker may legally
 * store text the strict model schema would reject (an owner title override,
 * a quote that grew by its sitatstrek, an emptied block), and a stored version
 * must still render.
 */
export const sakStoredArticleSchema = z.object({
  sources: z.array(z.object({ materialId: z.string(), usedFor: z.string() })).default([]),
  source_spans: z.array(z.string()).default([]),
  excluded_hype: z
    .array(
      z.object({
        speaker: z.string().nullable().default(null),
        quote: z.string(),
        reason: z.string().default("")
      })
    )
    .default([]),
  title: z.string(),
  lead: z.string(),
  blocks: z.array(z.object({ kind: sakBlockKindSchema, text: z.string() })),
  desk_notes: z.array(z.string()).default([]),
  change_note: z.string().default("")
});

export function parseStoredSakArticle(json: unknown): SakArticle | null {
  if (!json || typeof json !== "object") return null;
  const parsed = sakStoredArticleSchema.safeParse(json);
  return parsed.success ? (parsed.data as SakArticle) : null;
}

export const sakArticleJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sources: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          materialId: { type: "string", pattern: "^material_[A-Za-z0-9]+$" },
          usedFor: { type: "string", minLength: 3, maxLength: 300 }
        },
        required: ["materialId", "usedFor"]
      }
    },
    source_spans: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      items: { type: "string", minLength: 5, maxLength: 320 }
    },
    excluded_hype: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          speaker: { type: ["string", "null"], maxLength: 120 },
          quote: { type: "string", minLength: 5, maxLength: 400 },
          reason: { type: "string", minLength: 3, maxLength: 200 }
        },
        required: ["speaker", "quote", "reason"]
      }
    },
    title: { type: "string", minLength: 4, maxLength: 140 },
    lead: { type: "string", minLength: 20, maxLength: 600 },
    blocks: {
      type: "array",
      minItems: 1,
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["paragraph", "subheading", "quote"] },
          text: { type: "string", minLength: 1, maxLength: 900 }
        },
        required: ["kind", "text"]
      }
    },
    desk_notes: {
      type: "array",
      maxItems: 12,
      items: { type: "string", minLength: 5, maxLength: 300 }
    },
    change_note: { type: "string", minLength: 3, maxLength: 200 }
  },
  required: [
    "sources",
    "source_spans",
    "excluded_hype",
    "title",
    "lead",
    "blocks",
    "desk_notes",
    "change_note"
  ]
} as const;

// ---------------------------------------------------------------------------
// Link markers and text helpers
// ---------------------------------------------------------------------------

export type SakTextSegment = { text: string; materialId?: string };

export function parseSakInlineLinks(text: string): SakTextSegment[] {
  const segments: SakTextSegment[] = [];
  const pattern = new RegExp(SAK_LINK_MARKER_PATTERN.source, "g");
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index) });
    }
    segments.push({ text: match[1], materialId: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex) });
  }
  return segments;
}

export function sakBlockPlainText(text: string): string {
  return text.replace(new RegExp(SAK_LINK_MARKER_PATTERN.source, "g"), "$1");
}

export function sakLinkedMaterialIds(article: Pick<SakArticle, "lead" | "blocks">): string[] {
  const ids: string[] = [];
  const pattern = new RegExp(SAK_LINK_MARKER_PATTERN.source, "g");
  for (const text of [article.lead, ...article.blocks.map((block) => block.text)]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (!ids.includes(match[2])) ids.push(match[2]);
    }
  }
  return ids;
}

const SITATSTREK_PATTERN = /^\s*[–—-]\s*/;

export function ensureSitatstrek(text: string): string {
  const trimmed = text.trim();
  if (SITATSTREK_PATTERN.test(trimmed)) {
    return `– ${trimmed.replace(SITATSTREK_PATTERN, "")}`;
  }
  return `– ${trimmed}`;
}

export function sakBlockDisplayText(block: SakBlock): string {
  const plain = sakBlockPlainText(block.text).trim();
  return block.kind === "quote" ? ensureSitatstrek(plain) : plain;
}

export type SakHrefResolver = (materialId: string) => string | null | undefined;

export function sakArticleToPlainText(
  article: Pick<SakArticle, "title" | "lead" | "blocks">,
  options: { includeTitle?: boolean; resolveHref?: SakHrefResolver } = {}
): string {
  const includeTitle = options.includeTitle ?? true;
  const renderText = (text: string): string => {
    if (!options.resolveHref) return sakBlockPlainText(text);
    return parseSakInlineLinks(text)
      .map((segment) => {
        if (!segment.materialId) return segment.text;
        const href = options.resolveHref?.(segment.materialId);
        return href ? `${segment.text} (${href})` : segment.text;
      })
      .join("");
  };
  const parts: string[] = [];
  if (includeTitle) parts.push(article.title.trim());
  parts.push(renderText(article.lead).trim());
  for (const block of article.blocks) {
    const text = renderText(block.text).trim();
    parts.push(block.kind === "quote" ? ensureSitatstrek(text) : text);
  }
  return parts.filter((part) => part.length > 0).join("\n\n");
}

/** Visible article chars: lead + blocks, without title and link markers. */
export function countSakVisibleChars(article: Pick<SakArticle, "lead" | "blocks">): number {
  return [sakBlockPlainText(article.lead).trim(), ...article.blocks.map(sakBlockDisplayText)]
    .join("\n\n")
    .length;
}

export function escapeSakHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderSakInlineHtml(text: string, resolveHref?: SakHrefResolver): string {
  return parseSakInlineLinks(text)
    .map((segment) => {
      const escaped = escapeSakHtml(segment.text);
      if (!segment.materialId) return escaped;
      const href = resolveHref?.(segment.materialId);
      if (!href) return escaped;
      return `<a href="${escapeSakHtml(href)}">${escaped}</a>`;
    })
    .join("");
}

/**
 * Article body as HTML: lead and paragraphs as <p>, subheadings as <h3>,
 * quotes as <p> starting with a sitatstrek, links as <a href>. Uses only the
 * tag set the web sanitizer keeps (p, h3, a, strong, em, br, lists).
 */
export function sakArticleToHtml(
  article: Pick<SakArticle, "lead" | "blocks">,
  resolveHref?: SakHrefResolver
): string {
  const parts: string[] = [];
  const lead = article.lead.trim();
  if (lead) parts.push(`<p>${renderSakInlineHtml(lead, resolveHref)}</p>`);
  for (const block of article.blocks) {
    const text = block.text.trim();
    if (!text) continue;
    if (block.kind === "subheading") {
      parts.push(`<h3>${escapeSakHtml(sakBlockPlainText(text))}</h3>`);
      continue;
    }
    if (block.kind === "quote") {
      const withDash = ensureSitatstrek(text);
      parts.push(`<p>${renderSakInlineHtml(withDash, resolveHref)}</p>`);
      continue;
    }
    parts.push(`<p>${renderSakInlineHtml(text, resolveHref)}</p>`);
  }
  return parts.join("");
}

export type SakLinkListEntry = { text: string; url: string; materialId: string };

export function buildSakLinkList(
  article: Pick<SakArticle, "lead" | "blocks">,
  resolveHref: SakHrefResolver
): SakLinkListEntry[] {
  const entries: SakLinkListEntry[] = [];
  const seen = new Set<string>();
  for (const text of [article.lead, ...article.blocks.map((block) => block.text)]) {
    for (const segment of parseSakInlineLinks(text)) {
      if (!segment.materialId) continue;
      const url = resolveHref(segment.materialId);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      entries.push({ text: segment.text, url, materialId: segment.materialId });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// API contracts
// ---------------------------------------------------------------------------

export const sakMaterialKindSchema = z.enum(["pdf", "url", "text"]);
export type SakMaterialKind = z.infer<typeof sakMaterialKindSchema>;

export const sakMaterialStatusSchema = z.enum(["ready", "failed"]);
export type SakMaterialStatus = z.infer<typeof sakMaterialStatusSchema>;

export const sakMaterialSchema = z.object({
  id: z.string(),
  sakId: z.string(),
  kind: sakMaterialKindSchema,
  title: z.string(),
  url: z.string().nullable(),
  fileName: z.string().nullable(),
  fileSize: z.number().int().nullable(),
  extractedTextChars: z.number().int().nonnegative(),
  status: sakMaterialStatusSchema,
  errorText: z.string().nullable(),
  enabled: z.boolean(),
  metadata: z.unknown().nullable(),
  createdAt: z.string().datetime()
});
export type SakMaterial = z.infer<typeof sakMaterialSchema>;

export const sakVersionStatusSchema = z.enum([
  "pending",
  "needs_retry",
  "failed",
  "ready",
  "needs_review"
]);
export type SakVersionStatus = z.infer<typeof sakVersionStatusSchema>;

export const sakVersionSchema = z.object({
  id: z.string(),
  sakId: z.string(),
  version: z.number().int().positive(),
  status: sakVersionStatusSchema,
  article: sakArticleSchema.nullable(),
  userInstruction: z.string().nullable(),
  changeNote: z.string().nullable(),
  promptVersion: z.string().nullable(),
  model: z.string().nullable(),
  errorText: z.string().nullable(),
  validation: z.unknown().nullable(),
  generationRunId: z.string().nullable(),
  requestedAt: z.string().datetime(),
  generatedAt: z.string().datetime().nullable()
});
export type SakVersion = z.infer<typeof sakVersionSchema>;

export const sakDraftSchema = z.object({
  id: z.string(),
  titleOverride: z.string().nullable(),
  targetChars: z.number().int().nullable(),
  createdAt: z.string().datetime(),
  lastActivityAt: z.string().datetime(),
  expiresAt: z.string().datetime()
});
export type SakDraft = z.infer<typeof sakDraftSchema>;

export const sakActiveGenerationSchema = z
  .object({
    generationRunId: z.string(),
    jobId: z.string().nullable(),
    version: z.number().int().positive()
  })
  .nullable();
export type SakActiveGeneration = z.infer<typeof sakActiveGenerationSchema>;

export const sakDraftResponseSchema = z.object({
  draft: sakDraftSchema,
  materials: z.array(sakMaterialSchema),
  versions: z.array(sakVersionSchema),
  activeGeneration: sakActiveGenerationSchema
});
export type SakDraftResponse = z.infer<typeof sakDraftResponseSchema>;

export const sakListItemSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  createdAt: z.string().datetime(),
  lastActivityAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  versionCount: z.number().int().nonnegative(),
  materialCount: z.number().int().nonnegative()
});
export type SakListItem = z.infer<typeof sakListItemSchema>;

export const sakListResponseSchema = z.object({
  drafts: z.array(sakListItemSchema)
});
export type SakListResponse = z.infer<typeof sakListResponseSchema>;

export const sakCreateRequestSchema = z.object({
  titleOverride: z.string().trim().max(140).optional(),
  targetChars: z.number().int().min(SAK_TARGET_CHARS_MIN).max(SAK_TARGET_CHARS_MAX).optional()
});
export type SakCreateRequest = z.infer<typeof sakCreateRequestSchema>;

export const sakGenerateRequestSchema = z.object({
  instruction: z.string().trim().max(4000).optional(),
  titleOverride: z.string().trim().max(140).optional(),
  targetChars: z.number().int().min(SAK_TARGET_CHARS_MIN).max(SAK_TARGET_CHARS_MAX).optional(),
  selectedMaterialIds: z.array(z.string()).max(20).optional(),
  reasoningEffortOverride: z.enum(["xhigh"]).optional()
});
export type SakGenerateRequest = z.infer<typeof sakGenerateRequestSchema>;

export const sakGenerateResponseSchema = z.object({
  queued: z.literal(true),
  jobId: z.string().nullable(),
  version: z.number().int().positive(),
  generationRunId: z.string(),
  materials: z.object({
    included: z.array(z.string()),
    truncated: z.array(z.string()),
    dropped: z.array(z.string())
  })
});
export type SakGenerateResponse = z.infer<typeof sakGenerateResponseSchema>;

export const sakStatusResponseSchema = rewriteStatusResponseSchema;
export type SakStatusResponse = z.infer<typeof sakStatusResponseSchema>;

// ---------------------------------------------------------------------------
// Queue job payload (API → worker)
// ---------------------------------------------------------------------------

export type SakMaterialSnapshot = {
  id: string;
  sourceId: string;
  kind: SakMaterialKind;
  title: string;
  url: string | null;
  status: SakMaterialStatus;
  errorText: string | null;
  text: string;
  textChars: number;
};

export type SakDraftJobData = {
  sakId: string;
  generationRunId: string;
  targetVersion: number;
  materials: SakMaterialSnapshot[];
  instruction?: string;
  previousArticleJson?: SakArticle | null;
  titleOverride?: string | null;
  targetChars: number;
  reasoningEffortOverride?: "xhigh";
  todayIso: string;
};

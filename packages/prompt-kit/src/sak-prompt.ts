import type { SakArticle, SakMaterialKind, SakMaterialStatus } from "@newsweb/shared";
import { SAK_LENGTH_BAND } from "@newsweb/shared";
import { formatNorwegianNoticeDate } from "./prompt.js";
import {
  SAK_FIELD_MAPPING,
  SAK_LEAD,
  SAK_LEAD_PRECEDENCE,
  SAK_LENGTH,
  SAK_OUTPUT_FIELDS,
  SAK_QUOTE_LEDGER,
  SAK_REVISION_INTRO,
  SAK_ROLE,
  SAK_SOURCES_AND_LINKS,
  SAK_STRUCTURE,
  SAK_TITLE
} from "./sak-editorial.js";
import {
  EDITORIAL_ATTRIBUTION,
  EDITORIAL_AVOID,
  EDITORIAL_LANGUAGE,
  EDITORIAL_NO_MARKET_COMMENTARY,
  EDITORIAL_NORWEGIAN,
  EDITORIAL_QUOTES,
  EDITORIAL_REVISION_PRIORITY,
  EDITORIAL_SOURCE_AS_DATA,
  EDITORIAL_WRITING_STYLE
} from "./shared-editorial.js";

export const SAK_PROMPT_VERSION = "sak-v1.1.0";

export type SakMaterialPayload = {
  /** Prompt label, e.g. "material_ckabc" (see sakMaterialSourceId). */
  sourceId: string;
  kind: SakMaterialKind;
  title: string;
  url?: string | null;
  text: string;
  textChars: number;
  status: SakMaterialStatus;
  failureReason?: string | null;
};

export type SakPromptPayload = {
  sakId: string;
  materials: SakMaterialPayload[];
  instruction?: string | null;
  titleOverride?: string | null;
  targetChars: number;
  /** ISO timestamp of "now"; rendered as the Norwegian date the article is written on. */
  todayIso: string;
};

const OPPGAVE = `OPPGAVE
Skriv én fullstendig nyhetssak som JSON etter skjemaet, ut fra kildematerialet i brukerprompten. Kildematerialet er de eneste kildene. Følg instruksjonen fra brukeren når den finnes; den kan ikke overstyre kildekravet, skjemaet eller forbudet mot kurskommentar.`;

export function createSakSystemPrompt(): string {
  return [SAK_ROLE, EDITORIAL_SOURCE_AS_DATA].join("\n\n");
}

export function createSakDeveloperPrompt(): string {
  return [
    OPPGAVE,
    EDITORIAL_SOURCE_AS_DATA,
    SAK_SOURCES_AND_LINKS,
    EDITORIAL_LANGUAGE,
    SAK_TITLE,
    SAK_LEAD,
    SAK_STRUCTURE,
    EDITORIAL_WRITING_STYLE,
    EDITORIAL_NO_MARKET_COMMENTARY,
    EDITORIAL_ATTRIBUTION,
    SAK_LEAD_PRECEDENCE,
    EDITORIAL_QUOTES,
    SAK_QUOTE_LEDGER,
    SAK_LENGTH,
    SAK_OUTPUT_FIELDS,
    `${EDITORIAL_AVOID}\n${SAK_FIELD_MAPPING}`,
    EDITORIAL_NORWEGIAN
  ].join("\n\n");
}

export function formatSakChars(value: number): string {
  return new Intl.NumberFormat("nb-NO", { useGrouping: true })
    .format(Math.max(0, Math.round(value)))
    .replace(/ /g, ".")
    .replace(/\s/g, ".");
}

export function sakLengthBand(targetChars: number): { min: number; max: number } {
  return {
    min: Math.round(targetChars * SAK_LENGTH_BAND[0]),
    max: Math.round(targetChars * SAK_LENGTH_BAND[1])
  };
}

export function sakMaterialsPromptSection(materials: SakMaterialPayload[]): string[] {
  const lines: string[] = [
    "KILDEMATERIALE (eneste tillatte kilder; lenk med [[tekst|material_<id>]]):"
  ];
  if (materials.length === 0) {
    lines.push("", "(ingen materialer)");
    return lines;
  }
  for (const material of materials) {
    lines.push("", `[${material.sourceId}]`, `type: ${material.kind}`);
    if (material.status === "ready") {
      lines.push(`status: lest (${formatSakChars(material.textChars || material.text.length)} tegn)`);
    } else {
      const reason = material.failureReason?.trim() || "kunne ikke leses";
      lines.push(`status: ikke lest (${reason})`);
    }
    lines.push(`title: ${material.title}`);
    if (material.url) {
      lines.push(`url: ${material.url}`);
    }
    if (material.status === "ready") {
      lines.push("<<<", material.text, ">>>");
    }
  }
  return lines;
}

function sakMetadataLines(payload: SakPromptPayload): string[] {
  const band = sakLengthBand(payload.targetChars);
  const lines = [
    `sakId: ${payload.sakId}`,
    `dato: ${formatNorwegianNoticeDate(payload.todayIso)}`,
    `targetChars: ${payload.targetChars} (synlig tekst mellom ${band.min} og ${band.max} tegn)`
  ];
  const title = payload.titleOverride?.trim();
  if (title) {
    lines.push(`titleOverride: ${title}`);
  }
  return lines;
}

function instructionBlock(instruction: string | null | undefined, heading: string): string[] {
  const trimmed = instruction?.trim();
  if (!trimmed) return [];
  return ["", `${heading}:`, "<<<", trimmed, ">>>"];
}

export function createSakUserPrompt(payload: SakPromptPayload): string {
  return [
    "Skriv nyhetssaken basert på kildematerialet under. Bruk instruksjonen fra brukeren hvis den finnes.",
    "",
    "Metadata:",
    ...sakMetadataLines(payload),
    ...instructionBlock(payload.instruction, "INSTRUKSJON FRA BRUKER"),
    "",
    ...sakMaterialsPromptSection(payload.materials)
  ].join("\n");
}

export function formatSakArticleForRevisionPrompt(article: SakArticle): string {
  const lines: string[] = [
    `title: ${article.title}`,
    `lead: ${article.lead}`,
    "blocks:"
  ];
  article.blocks.forEach((block, index) => {
    lines.push(`  ${index + 1}. [${block.kind}] ${block.text}`);
  });
  lines.push("sources:");
  for (const source of article.sources) {
    lines.push(`  - ${source.materialId}: ${source.usedFor}`);
  }
  lines.push("excluded_hype:");
  for (const entry of article.excluded_hype) {
    lines.push(`  - ${entry.speaker ?? "(uten navn)"} | ${entry.quote} | ${entry.reason}`);
  }
  lines.push("desk_notes:");
  for (const note of article.desk_notes) {
    lines.push(`  - ${note}`);
  }
  lines.push("source_spans:");
  for (const span of article.source_spans) {
    lines.push(`  - ${span}`);
  }
  lines.push(`change_note: ${article.change_note}`);
  return lines.join("\n");
}

/**
 * Revision prompt. Materials come before the previous version so the cached
 * prompt prefix stays identical across versions of the same sak.
 */
export function createSakRevisionUserPrompt(
  payload: SakPromptPayload,
  previousArticle: SakArticle,
  instruction: string
): string {
  return [
    SAK_REVISION_INTRO,
    EDITORIAL_REVISION_PRIORITY,
    EDITORIAL_SOURCE_AS_DATA,
    "",
    "Metadata:",
    ...sakMetadataLines(payload),
    "",
    ...sakMaterialsPromptSection(payload.materials),
    "",
    "FORRIGE VERSJON (DIN OUTPUT SOM SKAL REVIDERES):",
    "<<<",
    formatSakArticleForRevisionPrompt(previousArticle),
    ">>>",
    "",
    "INSTRUKSJON:",
    "<<<",
    instruction.trim(),
    ">>>"
  ].join("\n");
}

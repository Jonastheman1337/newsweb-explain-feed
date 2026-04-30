import type { RewriteOutput } from "@newsweb/shared";
import { z } from "zod";

const sentenceBoundaryRegex = /(?<=[.!?])\s+/;

export const referenceCheckSentenceSchema = z.object({
  index: z.number().int().min(0),
  sentence: z.string().min(1).max(700),
  grounded: z.boolean(),
  interpretation: z.string().min(1).max(700),
  sourceEvidence: z.string().max(700)
});

export const referenceCheckResultSchema = z.object({
  sentences: z.array(referenceCheckSentenceSchema).min(1).max(64)
});

export type ReferenceCheckResult = z.infer<typeof referenceCheckResultSchema>;

export type ReferenceCoverageItem = {
  index: number;
  sentence: string;
  grounded: boolean;
  interpretation: string;
  sourceEvidence: string;
};

export type ReferenceCoverageReport = {
  totalSentences: number;
  groundedSentences: number;
  coveragePercent: number;
  items: ReferenceCoverageItem[];
  unsupportedSentences: ReferenceCoverageItem[];
};

export const referenceCheckJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sentences: {
      type: "array",
      minItems: 1,
      maxItems: 64,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          index: { type: "integer", minimum: 0 },
          sentence: { type: "string", minLength: 1, maxLength: 700 },
          grounded: { type: "boolean" },
          interpretation: { type: "string", minLength: 1, maxLength: 700 },
          sourceEvidence: { type: "string", maxLength: 700 }
        },
        required: [
          "index",
          "sentence",
          "grounded",
          "interpretation",
          "sourceEvidence"
        ]
      }
    }
  },
  required: ["sentences"]
} as const;

function normalizeSentence(sentence: string): string {
  return sentence.replace(/\s+/g, " ").trim();
}

export function splitIntoSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const chunks = trimmed.split(sentenceBoundaryRegex);
  return chunks
    .map((chunk) => normalizeSentence(chunk))
    .filter((chunk) => chunk.length > 0);
}

export function collectDraftSentences(rewrite: RewriteOutput): string[] {
  const sections = [rewrite.lead, ...rewrite.body, rewrite.company_sentence];
  return sections.flatMap(splitIntoSentences);
}

export function buildCoverageReport(
  draftSentences: string[],
  raw: ReferenceCheckResult
): ReferenceCoverageReport {
  const byIndex = new Map(raw.sentences.map((item) => [item.index, item]));

  const items = draftSentences.map((sentence, index) => {
    const source = byIndex.get(index);
    if (!source) {
      return {
        index,
        sentence,
        grounded: false,
        interpretation: "Ingen referansesjekk ble returnert for setningen.",
        sourceEvidence: ""
      };
    }

    return {
      index,
      sentence,
      grounded: source.grounded,
      interpretation: source.interpretation.trim(),
      sourceEvidence: source.sourceEvidence.trim()
    };
  });

  const groundedSentences = items.filter((item) => item.grounded).length;
  const totalSentences = items.length;
  const coveragePercent =
    totalSentences === 0
      ? 100
      : Math.round((groundedSentences / totalSentences) * 100);
  const unsupportedSentences = items.filter((item) => !item.grounded);

  return {
    totalSentences,
    groundedSentences,
    coveragePercent,
    items,
    unsupportedSentences
  };
}

export function buildCorrectionInstruction(
  report: ReferenceCoverageReport
): string | null {
  if (report.unsupportedSentences.length === 0) {
    return null;
  }

  const unsupportedList = report.unsupportedSentences.map((item) => {
    const evidence = item.sourceEvidence || "Ingen dekkende tekst funnet i kilden.";
    return [
      `Setning ${item.index + 1}: ${item.sentence}`,
      `Hvorfor mangler dekning: ${item.interpretation}`,
      `Hva som finnes i kilden: ${evidence}`
    ].join("\n");
  });

  return [
    "Lag et nytt korrigert utkast basert pa samme kildetekst.",
    "Alle setninger i lead, body og company_sentence ma ha tydelig dekning i kilden.",
    "Fjern eller omskriv setninger som ikke har dekning.",
    "Ikke legg til nye fakta.",
    "",
    "Setninger uten dekning i forrige utkast:",
    unsupportedList.join("\n\n")
  ].join("\n");
}

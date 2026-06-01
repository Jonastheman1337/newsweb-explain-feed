import type { RewriteOutput } from "@newsweb/shared";
import { z } from "zod";

const sentenceBoundaryRegex = /(?<=[.!?])\s+/;
const protectedPeriod = "<NEWSWEB_PERIOD>";
const monthNamePattern =
  "jan(?:uar)?|feb(?:ruar)?|mars|apr(?:il)?|mai|jun(?:i)?|jul(?:i)?|aug(?:ust)?|sep(?:tember)?|okt(?:ober)?|nov(?:ember)?|des(?:ember)?|january|february|march|april|may|june|july|august|september|october|november|december";
const dateWithMonthRegex = new RegExp(
  `\\b(\\d{1,2})\\.\\s+(${monthNamePattern})\\b`,
  "gi"
);
const abbreviationRegex =
  /\b(ca|cirka|kl|nr|mill|mrd|bln|bn|dr|prof|st|vs)\.\s+/gi;

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
  visibleArticleSentenceCount: number;
  groundedSentences: number;
  coveragePercent: number;
  items: ReferenceCoverageItem[];
  unsupportedSentences: ReferenceCoverageItem[];
};

export type ReferenceCheckGateResult = {
  blocking: boolean;
  reason: string | null;
  highRiskUnsupportedSentences: ReferenceCoverageItem[];
};

const HIGH_RISK_UNSUPPORTED_PATTERNS = [
  /\d/,
  /\b(?:resultat|inntekt|inntekter|omsetning|driftsresultat|ebit|ebitda|utbytte)\b/i,
  /\b(?:kroner|dollar|euro|million|millioner|milliard|milliarder|prosent)\b/i,
  /\b(?:kontrakt|avtale|oppkjøp|oppkjop|emisjon|fusjon|transaksjon|salg|kjøp|kjop)\b/i,
  /\b(?:gjeld|lån|lan|obligasjon|forfall|vilkår|vilkar|guiding|utsikter)\b/i,
  /\b(?:styrker|forbedrer|sikrer|reduserer|øker|oker|bidrar|kan gi|kan bidra)\b/i
];

const TRADE_ARITHMETIC_CONTEXT_PATTERNS = [
  /\b(?:aksje|aksjer|shares?)\b/i,
  /\b(?:kurs|snittpris|average price|price per share|per aksje)\b/i,
  /\b(?:kjøpt|kjop|kjøp|kjøper|purchased|acquired|solgt|sold)\b/i
];

const MONEY_CONTEXT_PATTERNS = [
  /\b(?:nok|kroner|kr|usd|dollars?|eur|euros?|gbp|pund|pounds?)\b/i
];

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

function protectSentenceInternalPeriods(text: string): string {
  return text
    .replace(dateWithMonthRegex, (_match, day: string, month: string) => {
      return `${day}${protectedPeriod} ${month}`;
    })
    .replace(abbreviationRegex, (_match, abbreviation: string) => {
      return `${abbreviation}${protectedPeriod} `;
    });
}

function restoreProtectedPeriods(text: string): string {
  return text.replaceAll(protectedPeriod, ".");
}

export function splitIntoSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const chunks = protectSentenceInternalPeriods(trimmed).split(sentenceBoundaryRegex);
  return chunks
    .map((chunk) => normalizeSentence(restoreProtectedPeriods(chunk)))
    .filter((chunk) => chunk.length > 0);
}

function parseLocalizedNumber(raw: string): number | null {
  let normalized = raw.replace(/\s/g, "");
  const negative = normalized.startsWith("-");
  if (negative) {
    normalized = normalized.slice(1);
  }

  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(",", ".");
  } else if (normalized.includes(".")) {
    const parts = normalized.split(".");
    const last = parts[parts.length - 1] ?? "";
    if (parts.length > 2 || last.length === 3) {
      normalized = parts.join("");
    }
  }

  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    return null;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    return null;
  }
  return negative ? -value : value;
}

function extractNumbers(text: string): number[] {
  const matches = text.match(
    /-?\d{1,3}(?:[ .]\d{3})*(?:[,.]\d+)?|-?\d+(?:[,.]\d+)?/g
  );
  return (matches ?? [])
    .map((match) => parseLocalizedNumber(match))
    .filter((value): value is number => value != null);
}

function hasAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function roughlyEqual(left: number, right: number): boolean {
  const tolerance = Math.max(1, Math.abs(right) * 0.002);
  return Math.abs(left - right) <= tolerance;
}

function isSimpleTradeArithmeticClaim(item: ReferenceCoverageItem): boolean {
  const sentence = item.sentence;
  const evidence = item.sourceEvidence;
  if (!evidence) {
    return false;
  }

  const combined = `${sentence}\n${evidence}`;
  if (
    !hasAnyPattern(combined, TRADE_ARITHMETIC_CONTEXT_PATTERNS) ||
    !hasAnyPattern(combined, MONEY_CONTEXT_PATTERNS)
  ) {
    return false;
  }

  const sentenceNumbers = extractNumbers(sentence).filter((value) => value >= 1000);
  const evidenceNumbers = extractNumbers(evidence).filter((value) => value > 0);
  for (const target of sentenceNumbers) {
    for (let leftIndex = 0; leftIndex < evidenceNumbers.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < evidenceNumbers.length;
        rightIndex += 1
      ) {
        const left = evidenceNumbers[leftIndex] ?? 0;
        const right = evidenceNumbers[rightIndex] ?? 0;
        const larger = Math.max(left, right);
        const smaller = Math.min(left, right);
        if (larger < 100 || smaller <= 0 || smaller > 10_000) {
          continue;
        }
        if (roughlyEqual(larger * smaller, target)) {
          return true;
        }
      }
    }
  }

  return false;
}

export function collectVisibleDraftSentences(rewrite: RewriteOutput): string[] {
  const sections = [rewrite.lead, ...rewrite.body];
  return sections.flatMap(splitIntoSentences);
}

export function collectDraftSentences(rewrite: RewriteOutput): string[] {
  return [
    ...collectVisibleDraftSentences(rewrite),
    ...splitIntoSentences(rewrite.company_sentence)
  ];
}

export function buildCoverageReport(
  draftSentences: string[],
  raw: ReferenceCheckResult,
  options?: { visibleArticleSentenceCount?: number }
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
    visibleArticleSentenceCount:
      options?.visibleArticleSentenceCount ?? totalSentences,
    groundedSentences,
    coveragePercent,
    items,
    unsupportedSentences
  };
}

export function assessReferenceCheckGate(
  report: ReferenceCoverageReport | null
): ReferenceCheckGateResult {
  if (!report || report.unsupportedSentences.length === 0) {
    return {
      blocking: false,
      reason: null,
      highRiskUnsupportedSentences: []
    };
  }

  const highRiskUnsupportedSentences = report.unsupportedSentences.filter(
    (item) =>
      !isSimpleTradeArithmeticClaim(item) &&
      HIGH_RISK_UNSUPPORTED_PATTERNS.some((pattern) => pattern.test(item.sentence))
  );

  if (highRiskUnsupportedSentences.length > 0) {
    return {
      blocking: true,
      reason: "Reference check found unsupported high-risk factual claims.",
      highRiskUnsupportedSentences
    };
  }

  if (
    report.visibleArticleSentenceCount > 0 &&
    report.visibleArticleSentenceCount <= 3
  ) {
    const unsupportedVisibleSentences = report.unsupportedSentences.filter(
      (item) =>
        item.index < report.visibleArticleSentenceCount &&
        !isSimpleTradeArithmeticClaim(item)
    );
    if (unsupportedVisibleSentences.length > 0) {
      return {
        blocking: true,
        reason:
          "Reference check found unsupported visible sentence in short article.",
        highRiskUnsupportedSentences: unsupportedVisibleSentences
      };
    }
  }

  if (report.coveragePercent < 75 && report.unsupportedSentences.length >= 2) {
    return {
      blocking: true,
      reason: "Reference check coverage is below 75 percent after correction.",
      highRiskUnsupportedSentences
    };
  }

  return {
    blocking: false,
    reason: null,
    highRiskUnsupportedSentences
  };
}

export function buildCorrectionInstruction(
  report: ReferenceCoverageReport,
  options: { attempt?: number; maxAttempts?: number } = {}
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

  const attempt =
    options.attempt && options.maxAttempts
      ? `Referansereparasjon ${options.attempt} av ${options.maxAttempts}.`
      : "Referansereparasjon.";

  return [
    attempt,
    "Lag et nytt korrigert utkast basert pa samme kildetekst.",
    "Referansesjekkerens tilbakemelding under er fasit for hva som mangler dekning.",
    "Alle setninger i lead, body og company_sentence ma ha tydelig dekning i kilden.",
    "For hver setning uten dekning: slett faktaen helt, eller omskriv den kun med tekst/fakta som finnes i feltet 'Hva som finnes i kilden'.",
    "Ikke bytt til en naer synonym formulering hvis dekningen fortsatt er indirekte.",
    "Ikke forklar generelle begreper, bransjer eller konsekvenser med mindre dette star eksplisitt i kilden.",
    "Hvis company_sentence er vanskelig a dekke noyaktig, gjor den kortere eller mer generell, eller fjern den hvis skjemaet tillater det.",
    "Ikke legg til nye fakta.",
    "",
    "Setninger uten dekning i forrige utkast:",
    unsupportedList.join("\n\n")
  ].join("\n");
}

import type { RewriteOutput } from "@newsweb/shared";

const MARKET_CODE_MAP: Record<string, string> = {
  XHEL: "Helsinki-borsen",
  XSTO: "Stockholm-borsen",
  XCSE: "Kobenhavn-borsen"
};

export type StyleSanitizationStats = {
  changed: boolean;
  removedRegisteredMarks: number;
  replacedFiscalYearAbbrev: number;
  expandedMarketCodes: number;
  removedAsaSuffix: number;
  replacedPercentSigns: number;
  normalizedBillionPhrases: number;
};

export type StyleSanitizationResult = {
  rewrite: RewriteOutput;
  stats: StyleSanitizationStats;
};

function normalizeFiscalYearToken(rawYear: string): string {
  const year = rawYear.trim();
  if (year.length === 2) {
    return `regnskapsaret 20${year}`;
  }
  return `regnskapsaret ${year}`;
}

function parseNorwegianInteger(raw: string): number | null {
  const normalized = raw.replace(/[ .]/g, "");
  if (!/^\d+$/.test(normalized)) {
    return null;
  }
  const value = Number(normalized);
  return Number.isSafeInteger(value) ? value : null;
}

function formatBillionFromMillions(millionAmount: number): string {
  if (millionAmount === 1000) {
    return "én milliard";
  }
  const billions = millionAmount / 1000;
  if (Number.isInteger(billions)) {
    return `${billions} milliarder`;
  }
  return `${billions
    .toFixed(3)
    .replace(/0+$/g, "")
    .replace(/\.$/g, "")
    .replace(".", ",")} milliarder`;
}

function sanitizeText(text: string, stats: StyleSanitizationStats): string {
  let result = text;

  result = result.replace(/[®™]/g, () => {
    stats.removedRegisteredMarks += 1;
    return "";
  });

  result = result.replace(/\bFY[\s-]?(\d{2}|\d{4})\b/gi, (_match, year: string) => {
    stats.replacedFiscalYearAbbrev += 1;
    return normalizeFiscalYearToken(year);
  });

  result = result.replace(/\b(XHEL|XSTO|XCSE)\b/gi, (match: string) => {
    stats.expandedMarketCodes += 1;
    return MARKET_CODE_MAP[match.toUpperCase()] ?? match;
  });

  result = result.replace(/\bASA\b/g, () => {
    stats.removedAsaSuffix += 1;
    return "";
  });

  result = result.replace(/\s*%/g, () => {
    stats.replacedPercentSigns += 1;
    return " prosent";
  });

  result = result.replace(
    /\b(\d{1,3}(?:[ .]\d{3})+|\d{4,})\s+millioner(?:\s+kroner)?\b/gi,
    (match: string, rawAmount: string) => {
      const millionAmount = parseNorwegianInteger(rawAmount);
      if (millionAmount == null || millionAmount < 1000) {
        return match;
      }
      stats.normalizedBillionPhrases += 1;
      const formatted = formatBillionFromMillions(millionAmount);
      return /\bkroner\b/i.test(match) ? `${formatted} kroner` : formatted;
    }
  );

  result = result.replace(/\s+([,.;:!?])/g, "$1");
  result = result.replace(/\s{2,}/g, " ");
  result = result.replace(/\(\s+/g, "(");
  result = result.replace(/\s+\)/g, ")");

  return result.trim();
}

function sanitizeField(
  value: string,
  minLength: number,
  stats: StyleSanitizationStats
): string {
  const sanitized = sanitizeText(value, stats);
  if (sanitized.length < minLength) {
    return value;
  }
  return sanitized;
}

function sanitizeArray(
  values: string[],
  minLength: number,
  stats: StyleSanitizationStats
): string[] {
  return values.map((value) => sanitizeField(value, minLength, stats));
}

export function sanitizeRewriteStyle(rewrite: RewriteOutput): StyleSanitizationResult {
  const stats: StyleSanitizationStats = {
    changed: false,
    removedRegisteredMarks: 0,
    replacedFiscalYearAbbrev: 0,
    expandedMarketCodes: 0,
    removedAsaSuffix: 0,
    replacedPercentSigns: 0,
    normalizedBillionPhrases: 0
  };

  const sanitized: RewriteOutput = {
    ...rewrite,
    title: sanitizeField(rewrite.title, 6, stats),
    lead: sanitizeField(rewrite.lead, 20, stats),
    body: rewrite.body.map((item) => sanitizeField(item, 10, stats)),
    company_sentence: sanitizeField(rewrite.company_sentence, 10, stats),
    key_facts: sanitizeArray(rewrite.key_facts, 5, stats),
    negative_or_surprising: sanitizeArray(rewrite.negative_or_surprising, 5, stats),
    excluded_hype: sanitizeArray(rewrite.excluded_hype, 5, stats),
    source_limitations: sanitizeArray(rewrite.source_limitations, 5, stats)
  };

  stats.changed =
    stats.removedRegisteredMarks > 0 ||
    stats.replacedFiscalYearAbbrev > 0 ||
    stats.expandedMarketCodes > 0 ||
    stats.removedAsaSuffix > 0 ||
    stats.replacedPercentSigns > 0 ||
    stats.normalizedBillionPhrases > 0;

  return {
    rewrite: sanitized,
    stats
  };
}

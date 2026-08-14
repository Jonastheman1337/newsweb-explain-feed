import type { RewriteOutput } from "@newsweb/shared";

const numberTokenRegex =
  /-?(?:\d{1,3}(?: \d{3})+(?:[,.]\d+)?(?!\d)|\d{1,3}(?:\.\d{3})+(?:,\d+)?(?!\d)|\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\d)|\d+(?:[,.]\d+)?)(?:\s*(?:%|prosent|percent))?/gi;
const clockTimeRegex = /\b([01]?\d|2[0-3])[:.](\d{2})\b/g;
const SOURCE_SCALE_CONTEXT_CHARS = 1400;
const SOURCE_SCALE_FORWARD_CONTEXT_CHARS = 300;
const REWRITE_UNIT_CONTEXT_CHARS = 48;
const NUMBER_UNIT_CONTEXT_BEFORE_CHARS = 56;
const NUMBER_UNIT_CONTEXT_AFTER_CHARS = 88;

const CURRENCY_SCALE_CONTEXT =
  "(?:usd|u\\.s\\.\\s*dollars?|us\\s*dollars?|us\\$|dollars?|nok|eur|euro|gbp|sek|dkk|kroner)";
const THOUSANDS_SCALE_CONTEXT = "(?:thousands?|tusen|['’]?000s?)";
const EXPLICIT_THOUSANDS_SCALE_PATTERNS = [
  new RegExp(
    `\\b(?:amounts?|figures?|values?|numbers?)\\b.{0,80}\\b(?:in|presented\\s+in|shown\\s+in|stated\\s+in|reported\\s+in|expressed\\s+in)\\b.{0,50}\\b(?:${CURRENCY_SCALE_CONTEXT}\\s*)?${THOUSANDS_SCALE_CONTEXT}\\b`,
    "i"
  ),
  new RegExp(
    `\\b(?:in|presented\\s+in|shown\\s+in|stated\\s+in|reported\\s+in|expressed\\s+in)\\b.{0,50}\\b(?:${CURRENCY_SCALE_CONTEXT}\\s*)?${THOUSANDS_SCALE_CONTEXT}\\b`,
    "i"
  ),
  new RegExp(
    `\\b${CURRENCY_SCALE_CONTEXT}\\s*${THOUSANDS_SCALE_CONTEXT}\\b`,
    "i"
  ),
  new RegExp(
    `\\b${THOUSANDS_SCALE_CONTEXT}\\s+of\\s+${CURRENCY_SCALE_CONTEXT}\\b`,
    "i"
  )
];
const REWRITE_MILLION_CONTEXT_PATTERN = /\b(?:mill\.|million(?:er)?)\b/i;
const REWRITE_BILLION_CONTEXT_PATTERN =
  /\b(?:mrd\.?|milliard(?:er)?|billion(?:s)?)\b/i;
const SHARED_PERCENT_RANGE_AFTER_PATTERN =
  /^\s*(?:-|–|—|til|to|and|og)\s*-?\d+(?:[,.]\d+)?\s*(?:%|prosent|percent)\b/i;

type NumberTokenMatch = {
  token: string;
  index: number;
};

type ParsedNumberToken = {
  display: string;
  key: string;
  value: number;
  hasPercent: boolean;
};

type ScaledNumberUnit = "nok" | "usd" | "eur" | "gbp" | "sek" | "dkk" | "shares";
type ScaledNumberScale = "million" | "billion";

type SourceNumberIndex = {
  exactKeys: Set<string>;
  scaledMillionKeys: Set<string>;
  scaledUnitKeys: Set<string>;
};

const SCALED_NUMBER_UNIT_PATTERNS: Array<{
  unit: ScaledNumberUnit;
  pattern: RegExp;
}> = [
  {
    unit: "sek",
    pattern: /\b(?:sek|svenske kroner|swedish kronor)\b/gi
  },
  {
    unit: "dkk",
    pattern: /\b(?:dkk|danske kroner|danish kroner)\b/gi
  },
  {
    unit: "usd",
    pattern: /\b(?:usd|u\.s\.\s*dollars?|us\s*dollars?|us\$|dollars?)\b|\$/gi
  },
  {
    unit: "eur",
    pattern: /\b(?:eur|euros?|euro)\b/gi
  },
  {
    unit: "gbp",
    pattern: /\b(?:gbp|pund|pounds?)\b/gi
  },
  {
    unit: "nok",
    pattern: /\b(?:nok|norske kroner|kroner|kr)\b/gi
  },
  {
    unit: "shares",
    pattern: /\b(?:aksje|aksjer|shares)\b/gi
  }
];

function sanitizeNumberToken(token: string): string {
  const trimmed = token.trim();
  const withoutLeading = trimmed.replace(/^[^\d-]+/, "");
  return withoutLeading.replace(/[^\d%]+$/, "").trim();
}

function inferDecimalSeparator(core: string): "." | "," | null {
  const hasDot = core.includes(".");
  const hasComma = core.includes(",");

  if (!hasDot && !hasComma) {
    return null;
  }

  if (hasDot && hasComma) {
    return core.lastIndexOf(".") > core.lastIndexOf(",") ? "." : ",";
  }

  const separator = hasDot ? "." : ",";
  const parts = core.split(separator);
  if (parts.length < 2) {
    return null;
  }

  if (parts.length > 2) {
    const tail = parts[parts.length - 1] ?? "";
    return tail.length === 3 ? null : separator;
  }

  const integerPart = parts[0] ?? "";
  const fractionPart = parts[1] ?? "";
  if (!fractionPart) {
    return null;
  }

  if (fractionPart.length <= 2) {
    return separator;
  }

  const integerDigits = integerPart.replace(/[^\d]/g, "");
  if (fractionPart.length === 3) {
    return integerDigits.length <= 2 || integerPart.startsWith("0")
      ? separator
      : null;
  }

  if (fractionPart.length > 3) {
    return integerDigits.length <= 2 ? separator : null;
  }

  return null;
}

function normalizeNumberCore(
  core: string,
  decimalSeparator: "." | "," | null
): string {
  if (!decimalSeparator) {
    const integerToken = core.replace(/[^\d]/g, "");
    return integerToken || "0";
  }

  const index = core.lastIndexOf(decimalSeparator);
  const integerPart = core.slice(0, index).replace(/[^\d]/g, "");
  const fractionPart = core.slice(index + 1).replace(/[^\d]/g, "");
  const normalizedInteger = integerPart || "0";
  return `${normalizedInteger}.${fractionPart}`;
}

function parseNumberToken(token: string): ParsedNumberToken | null {
  const sanitized = sanitizeNumberToken(token);
  if (!sanitized || !/\d/.test(sanitized)) {
    return null;
  }

  const negative = sanitized.startsWith("-");
  const unsigned = negative ? sanitized.slice(1) : sanitized;
  const hasPercent =
    unsigned.endsWith("%") || /\b(?:prosent|percent)\b/i.test(token);
  const core = unsigned.endsWith("%") ? unsigned.slice(0, -1) : unsigned;

  if (!/\d/.test(core)) {
    return null;
  }

  const decimalSeparator = inferDecimalSeparator(core);
  const normalized = normalizeNumberCore(core, decimalSeparator).replace(
    /^0+(?=\d)/,
    ""
  );
  const normalizedCore = normalized || "0";
  const fractionDigits = decimalSeparator
    ? (normalizedCore.split(".")[1] ?? "").length
    : 0;

  return {
    display: sanitized,
    key: [
      negative ? "-" : "+",
      normalizedCore,
      hasPercent ? "pct" : "abs",
      String(fractionDigits)
    ].join("|"),
    value: (negative ? -1 : 1) * Number(normalizedCore),
    hasPercent
  };
}

function collectNumberTokenMatches(text: string): NumberTokenMatch[] {
  return [...text.matchAll(numberTokenRegex)].map((match) => ({
    token: match[0],
    index: match.index ?? 0
  }));
}

function collectNumberTokens(text: string): string[] {
  return collectNumberTokenMatches(text).map((match) => match.token);
}

function clockTimeNumberKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const match of text.matchAll(clockTimeRegex)) {
    const hour = Number(match[1]);
    const minute = match[2] ?? "";
    if (!Number.isInteger(hour) || !/^\d{2}$/.test(minute)) {
      continue;
    }
    keys.add(`+|${hour}.${minute}|abs|2`);
  }
  return keys;
}

function integerThousandsEquivalentKey(parsed: {
  display: string;
  hasPercent: boolean;
}): string | null {
  if (parsed.hasPercent) {
    return null;
  }

  const negative = parsed.display.startsWith("-");
  const unsigned = negative ? parsed.display.slice(1) : parsed.display;
  if (!/^\d{1,3}(?:[.,]\d{3})+$/.test(unsigned)) {
    return null;
  }

  const integer = unsigned.replace(/[.,]/g, "").replace(/^0+(?=\d)/, "") || "0";
  return [negative ? "-" : "+", integer, "abs", "0"].join("|");
}

function integerThousandsEquivalentValue(parsed: {
  display: string;
  hasPercent: boolean;
}): number | null {
  if (parsed.hasPercent) {
    return null;
  }

  const negative = parsed.display.startsWith("-");
  const unsigned = negative ? parsed.display.slice(1) : parsed.display;
  if (!/^\d{1,3}(?:[.,]\d{3})+$/.test(unsigned)) {
    return null;
  }

  const integer = Number(unsigned.replace(/[.,]/g, ""));
  if (!Number.isFinite(integer)) {
    return null;
  }
  return (negative ? -1 : 1) * integer;
}

function rewriteNumberKeys(parsed: {
  display: string;
  key: string;
  hasPercent: boolean;
}): string[] {
  const equivalentKey = integerThousandsEquivalentKey(parsed);
  return equivalentKey ? [parsed.key, equivalentKey] : [parsed.key];
}

function percentEquivalentKey(parsed: { key: string }): string {
  const [sign, normalizedCore, , fractionDigits] = parsed.key.split("|");
  return [sign, normalizedCore, "pct", fractionDigits].join("|");
}

function hasSharedPercentRangeAfter(
  text: string,
  index: number,
  token: string
): boolean {
  return SHARED_PERCENT_RANGE_AFTER_PATTERN.test(
    text.slice(index + token.length, index + token.length + 60)
  );
}

function hasExplicitThousandsScaleContext(
  text: string,
  index: number,
  token: string
): boolean {
  const start = Math.max(0, index - SOURCE_SCALE_CONTEXT_CHARS);
  const end = Math.min(
    text.length,
    index + token.length + SOURCE_SCALE_FORWARD_CONTEXT_CHARS
  );
  const context = text.slice(start, end);
  return EXPLICIT_THOUSANDS_SCALE_PATTERNS.some((pattern) =>
    pattern.test(context)
  );
}

function hasRewriteMillionContext(
  text: string,
  index: number,
  token: string
): boolean {
  const start = Math.max(0, index - REWRITE_UNIT_CONTEXT_CHARS);
  const end = Math.min(
    text.length,
    index + token.length + REWRITE_UNIT_CONTEXT_CHARS
  );
  return REWRITE_MILLION_CONTEXT_PATTERN.test(text.slice(start, end));
}

function rewriteScaleContext(
  text: string,
  index: number,
  token: string
): ScaledNumberScale | null {
  const start = Math.max(0, index - REWRITE_UNIT_CONTEXT_CHARS);
  const end = Math.min(
    text.length,
    index + token.length + REWRITE_UNIT_CONTEXT_CHARS
  );
  const context = text.slice(start, end);
  if (REWRITE_BILLION_CONTEXT_PATTERN.test(context)) {
    return "billion";
  }
  if (REWRITE_MILLION_CONTEXT_PATTERN.test(context)) {
    return "million";
  }
  return null;
}

function sourceScaleContext(
  text: string,
  index: number,
  token: string
): ScaledNumberScale | null {
  return rewriteScaleContext(text, index, token);
}

function closestUnitDistance(
  context: string,
  pattern: RegExp,
  direction: "before" | "after"
): number | null {
  const matcher = new RegExp(pattern.source, pattern.flags);
  let closest: number | null = null;
  for (const match of context.matchAll(matcher)) {
    const matchIndex = match.index ?? 0;
    const distance =
      direction === "before"
        ? context.length - (matchIndex + match[0].length)
        : matchIndex;
    if (closest == null || distance < closest) {
      closest = distance;
    }
  }
  return closest;
}

function detectScaledNumberUnit(
  text: string,
  index: number,
  token: string
): ScaledNumberUnit | null {
  const before = text.slice(
    Math.max(0, index - NUMBER_UNIT_CONTEXT_BEFORE_CHARS),
    index
  );
  const after = text.slice(
    index + token.length,
    Math.min(text.length, index + token.length + NUMBER_UNIT_CONTEXT_AFTER_CHARS)
  );
  let nearest: { unit: ScaledNumberUnit; distance: number } | null = null;

  for (const { unit, pattern } of SCALED_NUMBER_UNIT_PATTERNS) {
    const beforeDistance = closestUnitDistance(before, pattern, "before");
    const afterDistance = closestUnitDistance(after, pattern, "after");
    const distance =
      beforeDistance == null
        ? afterDistance
        : afterDistance == null
          ? beforeDistance
          : Math.min(beforeDistance, afterDistance);
    if (distance == null) {
      continue;
    }
    if (!nearest || distance < nearest.distance) {
      nearest = { unit, distance };
    }
  }

  return nearest?.unit ?? null;
}

function isYearLikeNumber(value: number): boolean {
  return Number.isInteger(value) && value >= 1900 && value <= 2099;
}

function sourceThousandsToMillionValue(
  parsed: { display: string; hasPercent: boolean },
  token: string
): number | null {
  if (parsed.hasPercent) {
    return null;
  }

  const sanitized = sanitizeNumberToken(token);
  const negative = sanitized.startsWith("-");
  const unsigned = negative ? sanitized.slice(1) : sanitized;
  let rawInteger: string | null = null;

  if (/^\d{1,3}[,.]\d{3}$/.test(unsigned)) {
    rawInteger = unsigned.replace(/[,.]/g, "");
  } else if (/^\d{1,3}(?:[,.]\d{3}){2,}$/.test(unsigned)) {
    rawInteger = unsigned.replace(/[,.]/g, "");
  } else if (/^\d{1,3}(?: \d{3})+$/.test(unsigned)) {
    rawInteger = unsigned.replace(/ /g, "");
  } else if (/^\d{4,}$/.test(unsigned)) {
    rawInteger = unsigned;
  }

  if (!rawInteger) {
    return null;
  }

  const thousandsValue = Number(rawInteger);
  if (!Number.isFinite(thousandsValue) || isYearLikeNumber(thousandsValue)) {
    return null;
  }

  const millionValue = thousandsValue / 1000;
  if (Math.abs(millionValue) < 1) {
    return null;
  }

  return (negative ? -1 : 1) * millionValue;
}

function roundedNumberKey(value: number, fractionDigits: number): string {
  const sign = value < 0 ? "-" : "+";
  const absValue = Math.abs(value);
  const normalized = absValue.toFixed(fractionDigits).replace(/^0+(?=\d)/, "") || "0";
  return [sign, normalized, "abs", String(fractionDigits)].join("|");
}

function roundToFractionDigits(value: number, fractionDigits: number): number {
  const sign = value < 0 ? -1 : 1;
  const multiplier = 10 ** fractionDigits;
  return (
    sign *
    Math.round((Math.abs(value) + Number.EPSILON) * multiplier) /
      multiplier
  );
}

function roundToOneDecimal(value: number): number {
  return roundToFractionDigits(value, 1);
}

function scaledMillionKeysForSourceToken(
  parsed: { display: string; hasPercent: boolean },
  token: string
): string[] {
  const millionValue = sourceThousandsToMillionValue(parsed, token);
  if (millionValue == null) {
    return [];
  }

  const keys = new Set<string>();
  keys.add(roundedNumberKey(roundToOneDecimal(millionValue), 1));

  const roundedInteger = Math.round(millionValue);
  if (Math.abs(millionValue - roundedInteger) < 1e-9) {
    keys.add(roundedNumberKey(roundedInteger, 0));
  }

  return [...keys];
}

function scaledUnitIndexKey(
  scale: ScaledNumberScale,
  unit: ScaledNumberUnit,
  key: string
): string {
  return `${scale}|${unit}|${key}`;
}

function scaledUnitKeysForSourceValue(
  value: number,
  scale: ScaledNumberScale
): string[] {
  const divisor = scale === "billion" ? 1_000_000_000 : 1_000_000;
  const scaledValue = value / divisor;
  if (Math.abs(scaledValue) < 1) {
    return [];
  }

  const keys = new Set<string>();
  for (const fractionDigits of [1, 2, 3]) {
    keys.add(
      roundedNumberKey(
        roundToFractionDigits(scaledValue, fractionDigits),
        fractionDigits
      )
    );
  }

  const roundedInteger = Math.round(scaledValue);
  if (Math.abs(scaledValue - roundedInteger) < 1e-9) {
    keys.add(roundedNumberKey(roundedInteger, 0));
  }

  return [...keys];
}

function sourceNumberValueVariants(parsed: {
  display: string;
  value: number;
  hasPercent: boolean;
}): number[] {
  if (parsed.hasPercent) {
    return [];
  }

  const values = new Set<number>([parsed.value]);
  const integerEquivalent = integerThousandsEquivalentValue(parsed);
  if (integerEquivalent != null) {
    values.add(integerEquivalent);
  }
  return [...values];
}

function scaleDivisor(scale: ScaledNumberScale): number {
  return scale === "billion" ? 1_000_000_000 : 1_000_000;
}

function collectSourceNumberIndex(text: string): SourceNumberIndex {
  const tokens = collectNumberTokenMatches(text);
  const exactKeys = clockTimeNumberKeys(text);
  const scaledMillionKeys = new Set<string>();
  const scaledUnitKeys = new Set<string>();

  for (const token of tokens) {
    const parsed = parseNumberToken(token.token);
    if (parsed) {
      exactKeys.add(parsed.key);
      if (
        !parsed.hasPercent &&
        hasSharedPercentRangeAfter(text, token.index, token.token)
      ) {
        exactKeys.add(percentEquivalentKey(parsed));
      }
      if (hasExplicitThousandsScaleContext(text, token.index, token.token)) {
        for (const key of scaledMillionKeysForSourceToken(parsed, token.token)) {
          scaledMillionKeys.add(key);
        }
      }
      const unit = detectScaledNumberUnit(text, token.index, token.token);
      if (unit) {
        const sourceScale = sourceScaleContext(text, token.index, token.token);
        for (const sourceValue of sourceNumberValueVariants(parsed)) {
          const absoluteValues = [sourceValue];
          if (sourceScale != null) {
            absoluteValues.push(sourceValue * scaleDivisor(sourceScale));
          }
          for (const absoluteValue of absoluteValues) {
            for (const scale of ["million", "billion"] as const) {
              for (const key of scaledUnitKeysForSourceValue(absoluteValue, scale)) {
                scaledUnitKeys.add(scaledUnitIndexKey(scale, unit, key));
              }
            }
          }
        }
      }
    }

    const sanitized = sanitizeNumberToken(token.token);
    const parts = sanitized.split(/[\s:/-]+/).filter((part) => /\d/.test(part));
    if (parts.length > 1) {
      for (const part of parts) {
        const partParsed = parseNumberToken(part);
        if (partParsed) {
          exactKeys.add(partParsed.key);
        }
      }
    }
  }

  return { exactKeys, scaledMillionKeys, scaledUnitKeys };
}

const tradeArithmeticContextPatterns = [
  /\b(?:aksje|aksjer|shares?)\b/i,
  /\b(?:kurs|snittpris|average price|price per share|per aksje)\b/i,
  /\b(?:kjøpt|kjop|kjøp|kjøper|purchased|acquired|solgt|sold)\b/i
];

const moneyContextPatterns = [
  /\b(?:nok|kroner|kr|usd|dollars?|eur|euros?|gbp|pund|pounds?)\b/i
];

const approximateAmountContextPattern =
  /\b(?:rundt|om lag|cirka|ca\.?|circa|about|approximately|anslagsvis|n(?:æ|Ã¦|ae|a)r|i overkant av|dr(?:ø|Ã¸|o)yt)\b/i;

const aggregateTotalContextPattern =
  /\b(?:samlet|til sammen|totalt|total|combined|in total|aggregate)\b/i;

const averagePriceContextPatterns = [
  /\b(?:snittpris|gjennomsnittspris|average price|weighted average)\b/i
];

const tradeTotalContextPatterns = [
  /\b(?:kj(?:ø|Ã¸|o)p(?:esum(?:men)?|te?|er)?|solgt|sold|purchased|acquired|for|tilsvarer|verdi|samlet|til sammen|totalt)\b/i
];

const localizedNumberSource =
  String.raw`-?(?:\d{1,3}(?:[ .]\d{3})+(?:[,.]\d+)?|\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[,.]\d+)?)`;

const shareUnitSource = String.raw`(?:aksjer|shares?)`;
const priceWordSource = String.raw`(?:kurs(?:en)?|snittpris|gjennomsnittspris|average price|weighted average price|price per share|price|subscription price|tegningskurs)`;
const currencySource = String.raw`(?:NOK|nok|kroner|kr|USD|usd|dollars?|EUR|eur|euros?|GBP|gbp|pund|pounds?)`;

const tradePairPatterns = [
  new RegExp(
    String.raw`(?<quantity>${localizedNumberSource})\s+${shareUnitSource}[\s\S]{0,180}?${priceWordSource}[\s\S]{0,80}?(?:${currencySource})?\s*(?<price>${localizedNumberSource})`,
    "gi"
  ),
  new RegExp(
    String.raw`(?<quantity>${localizedNumberSource})\s+${shareUnitSource}[\s\S]{0,180}?\b(?:at|til)\b[\s\S]{0,40}?(?:${currencySource})\s*(?<price>${localizedNumberSource})\s*(?:per share|per aksje)?`,
    "gi"
  ),
  new RegExp(
    String.raw`${priceWordSource}[\s\S]{0,80}?(?:${currencySource})?\s*(?<price>${localizedNumberSource})[\s\S]{0,180}?(?<quantity>${localizedNumberSource})\s+${shareUnitSource}`,
    "gi"
  )
];

type TradeArithmeticCandidate = {
  value: number;
  usesAveragePrice: boolean;
  paired: boolean;
  quantity?: number;
  price?: number;
};

type TradeArithmeticTarget = {
  value: number;
  factor: number | null;
  roundedMagnitude: boolean;
};

function hasAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function roughlyEqual(left: number, right: number): boolean {
  const tolerance = Math.max(1, Math.abs(right) * 0.002);
  return Math.abs(left - right) <= tolerance;
}

function visibleContextAround(text: string, match: NumberTokenMatch): string {
  return text.slice(
    Math.max(0, match.index - 100),
    Math.min(text.length, match.index + match.token.length + 100)
  );
}

function fractionDigitsFor(parsed: ParsedNumberToken): number {
  return Number(parsed.key.split("|")[3] ?? "0");
}

function roundedMagnitudeTolerance(
  parsed: ParsedNumberToken,
  factor: number,
  expectedValue: number
): number {
  const visibleStep = factor / 10 ** fractionDigitsFor(parsed);
  return Math.max(1, visibleStep / 2, Math.abs(expectedValue) * 0.002);
}

function targetValuesForRewriteNumber(
  parsed: ParsedNumberToken,
  rewriteText: string,
  match: NumberTokenMatch
): TradeArithmeticTarget[] {
  const values: TradeArithmeticTarget[] = [
    { value: Math.abs(parsed.value), factor: null, roundedMagnitude: false }
  ];
  const integerEquivalent = integerThousandsEquivalentValue(parsed);
  if (integerEquivalent != null) {
    values.push({
      value: Math.abs(integerEquivalent),
      factor: null,
      roundedMagnitude: false
    });
  }

  const scale = rewriteScaleContext(rewriteText, match.index, match.token);
  if (scale != null) {
    const factor = scaleDivisor(scale);
    values.push({
      value: Math.abs(parsed.value * factor),
      factor,
      roundedMagnitude: true
    });
  }

  return values;
}

function parseShareQuantity(raw: string): number | null {
  const parsed = parseNumberToken(raw);
  if (!parsed || parsed.hasPercent) {
    return null;
  }
  return integerThousandsEquivalentValue(parsed) ?? parsed.value;
}

function parseTradePrice(raw: string): number | null {
  const parsed = parseNumberToken(raw);
  if (!parsed || parsed.hasPercent) {
    return null;
  }
  return parsed.value;
}

function uniqueCandidates(
  candidates: TradeArithmeticCandidate[]
): TradeArithmeticCandidate[] {
  const byValue = new Map<string, TradeArithmeticCandidate>();
  for (const candidate of candidates) {
    const key = candidate.value.toFixed(4);
    const existing = byValue.get(key);
    byValue.set(key, {
      value: candidate.value,
      usesAveragePrice:
        candidate.usesAveragePrice || existing?.usesAveragePrice === true,
      paired: candidate.paired || existing?.paired === true,
      quantity: existing?.quantity ?? candidate.quantity,
      price: existing?.price ?? candidate.price
    });
  }
  return [...byValue.values()];
}

function collectSourceNumberValues(text: string): number[] {
  const tokens = collectNumberTokens(text);
  const values: number[] = [];

  for (const token of tokens) {
    const parsed = parseNumberToken(token);
    if (parsed && !parsed.hasPercent) {
      values.push(parsed.value);
    }
    const sanitizedToken = sanitizeNumberToken(token);
    const unsignedToken = sanitizedToken.startsWith("-")
      ? sanitizedToken.slice(1)
      : sanitizedToken;
    if (/^\d{1,3}[.,]\d{3}$/.test(unsignedToken)) {
      values.push(Number(unsignedToken.replace(/[.,]/g, "")));
    }

    const parts = sanitizedToken.split(/[\s:/-]+/).filter((part) => /\d/.test(part));
    if (parts.length > 1) {
      for (const part of parts) {
        const partParsed = parseNumberToken(part);
        if (partParsed && !partParsed.hasPercent) {
          values.push(partParsed.value);
        }
      }
    }
  }

  return values;
}

function collectPairedTradeArithmeticCandidates(
  sourceText: string
): TradeArithmeticCandidate[] {
  const candidates: TradeArithmeticCandidate[] = [];

  for (const pattern of tradePairPatterns) {
    pattern.lastIndex = 0;
    for (const match of sourceText.matchAll(pattern)) {
      const quantity = parseShareQuantity(match.groups?.quantity ?? "");
      const price = parseTradePrice(match.groups?.price ?? "");
      if (
        quantity == null ||
        price == null ||
        quantity < 100 ||
        price <= 0 ||
        price > 10_000
      ) {
        continue;
      }
      candidates.push({
        value: quantity * price,
        usesAveragePrice: hasAnyPattern(match[0], averagePriceContextPatterns),
        paired: true,
        quantity,
        price
      });
    }
  }

  return uniqueCandidates(candidates);
}

function collectLooseTradeArithmeticCandidates(
  sourceText: string
): TradeArithmeticCandidate[] {
  const sourceNumbers = collectSourceNumberValues(sourceText).filter(
    (value) => value > 0
  );
  const usesAveragePrice = hasAnyPattern(sourceText, averagePriceContextPatterns);
  const candidates: TradeArithmeticCandidate[] = [];

  for (let leftIndex = 0; leftIndex < sourceNumbers.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < sourceNumbers.length;
      rightIndex += 1
    ) {
      const left = sourceNumbers[leftIndex] ?? 0;
      const right = sourceNumbers[rightIndex] ?? 0;
      const larger = Math.max(left, right);
      const smaller = Math.min(left, right);
      if (larger < 100 || smaller <= 0 || smaller > 10_000) {
        continue;
      }
      candidates.push({
        value: larger * smaller,
        usesAveragePrice,
        paired: false,
        quantity: larger,
        price: smaller
      });
    }
  }

  return uniqueCandidates(candidates);
}

function collectTradeArithmeticCandidates(
  sourceText: string
): TradeArithmeticCandidate[] {
  const paired = collectPairedTradeArithmeticCandidates(sourceText);
  return paired.length ? paired : collectLooseTradeArithmeticCandidates(sourceText);
}

function candidateMatchesTarget(
  candidate: TradeArithmeticCandidate,
  target: TradeArithmeticTarget,
  parsed: ParsedNumberToken,
  context: string
): boolean {
  const isAverageDerivedTotal = candidate.usesAveragePrice && target.value >= 1000;
  if (isAverageDerivedTotal && !approximateAmountContextPattern.test(context)) {
    return false;
  }

  if (target.roundedMagnitude && target.factor) {
    return (
      Math.abs(candidate.value - target.value) <=
      roundedMagnitudeTolerance(parsed, target.factor, candidate.value)
    );
  }

  return roughlyEqual(candidate.value, target.value);
}

function findAggregateCandidateMatch(
  candidates: TradeArithmeticCandidate[],
  target: TradeArithmeticTarget,
  parsed: ParsedNumberToken,
  context: string
): { terms: number[]; sum: number } | null {
  const pairedCandidates = candidates.filter((candidate) => candidate.paired);
  if (
    pairedCandidates.length < 2 ||
    pairedCandidates.length > 8 ||
    !aggregateTotalContextPattern.test(context)
  ) {
    return null;
  }

  const maxMask = 1 << pairedCandidates.length;
  for (let mask = 1; mask < maxMask; mask += 1) {
    let count = 0;
    let sum = 0;
    let usesAveragePrice = false;
    const terms: number[] = [];
    for (let index = 0; index < pairedCandidates.length; index += 1) {
      if ((mask & (1 << index)) === 0) {
        continue;
      }
      const candidate = pairedCandidates[index];
      if (!candidate) {
        continue;
      }
      count += 1;
      sum += candidate.value;
      terms.push(candidate.value);
      usesAveragePrice = usesAveragePrice || candidate.usesAveragePrice;
    }
    if (count < 2) {
      continue;
    }
    if (usesAveragePrice && !approximateAmountContextPattern.test(context)) {
      continue;
    }
    if (target.roundedMagnitude && target.factor) {
      if (
        Math.abs(sum - target.value) <=
        roundedMagnitudeTolerance(parsed, target.factor, sum)
      ) {
        return { terms, sum };
      }
      continue;
    }
    if (roughlyEqual(sum, target.value)) {
      return { terms, sum };
    }
  }

  return null;
}

type TradeArithmeticMatch =
  | { kind: "single"; candidate: TradeArithmeticCandidate }
  | { kind: "aggregate"; terms: number[]; sum: number };

function matchTradeArithmetic(
  parsed: ParsedNumberToken,
  rewriteText: string,
  match: NumberTokenMatch,
  sourceText: string
): TradeArithmeticMatch | null {
  if (parsed.hasPercent) {
    return null;
  }
  if (
    !hasAnyPattern(sourceText, tradeArithmeticContextPatterns) ||
    !hasAnyPattern(sourceText, moneyContextPatterns)
  ) {
    return null;
  }

  const context = visibleContextAround(rewriteText, match);
  if (
    !hasAnyPattern(context, moneyContextPatterns) ||
    !hasAnyPattern(context, tradeTotalContextPatterns)
  ) {
    return null;
  }

  const targetValues = targetValuesForRewriteNumber(
    parsed,
    rewriteText,
    match
  ).filter((target) => target.value >= 1000);
  if (targetValues.length === 0) {
    return null;
  }

  const candidates = collectTradeArithmeticCandidates(sourceText);
  for (const target of targetValues) {
    const single = candidates.find((candidate) =>
      candidateMatchesTarget(candidate, target, parsed, context)
    );
    if (single) {
      return { kind: "single", candidate: single };
    }
    const aggregate = findAggregateCandidateMatch(
      candidates,
      target,
      parsed,
      context
    );
    if (aggregate) {
      return { kind: "aggregate", ...aggregate };
    }
  }

  return null;
}

// Rule IDs name the rewrite-side mechanism that accepted a number. Notes:
// - exact_source_match is broader than literal string presence: the source
//   index also holds clock-time keys, sub-token split parts, and source-side
//   percent-range equivalents.
// - trade_arithmetic_pair with provenance.paired === false comes from loose
//   operand pairing (any two source numbers), not a regex-paired share/price.
export type NumberAssessmentRuleId =
  | "exact_source_match"
  | "thousands_separator_equivalent"
  | "scaled_million_report_table"
  | "scaled_unit_amount"
  | "shared_percent_range"
  | "trade_arithmetic_pair"
  | "trade_arithmetic_aggregate";

// Derivation rules are the P2 Phase B extension slot: they may accept numbers
// the frozen legacy chain leaves "unexpected", via explicit arithmetic or
// normalization over source values. The tuple is the runtime registry order
// and the config-validation whitelist. Attribution order is frozen for the
// same reason as the legacy chain: telemetry compares rule mixes across
// releases. Append new ids at the END; never reorder.
export const numberDerivationRuleIds = [] as const;

export type NumberDerivationRuleId = (typeof numberDerivationRuleIds)[number];

// The production default. CI safety gates replay validateRewriteOutput with no
// options, so this constant — not env — is what release flips change; the env
// override (NUMERIC_ACCEPTANCE_RULES) is an emergency kill-switch only.
// Enabling a rule = append here + refresh fixture expectations in the same
// commit; that fixture diff is the release record.
export const defaultEnabledDerivationRules: readonly NumberDerivationRuleId[] =
  [];

export type NumberAssessmentDisposition = "matched" | "derived" | "unexpected";

export type NumberAssessment = {
  display: string;
  disposition: NumberAssessmentDisposition;
  ruleId: NumberAssessmentRuleId | NumberDerivationRuleId | null;
  count: number;
  provenance?: Record<string, number | string | boolean | number[]>;
  // Set only on "unexpected" records when a disabled derivation rule would
  // have accepted the number — the live shadow signal for enablement decisions.
  candidateRuleId?: NumberDerivationRuleId;
};

type TokenAssessment = {
  disposition: NumberAssessmentDisposition;
  ruleId: NumberAssessmentRuleId | NumberDerivationRuleId | null;
  provenance?: Record<string, number | string | boolean | number[]>;
  candidateRuleId?: NumberDerivationRuleId;
};

type SourceNumberToken = ParsedNumberToken & { index: number };

type DerivationRuleContext = {
  parsed: ParsedNumberToken;
  token: NumberTokenMatch;
  rewriteText: string;
  sourceText: string;
  sourceIndex: SourceNumberIndex;
  // Lazy and memoized per assessNumbers call: report-scale source texts are
  // large, and most tokens never reach the derivation registry.
  sourceNumbers: () => readonly SourceNumberToken[];
  tradeCandidates: () => readonly TradeArithmeticCandidate[];
};

type NumberDerivationRule = {
  id: NumberDerivationRuleId;
  match: (
    context: DerivationRuleContext
  ) => {
    provenance?: Record<string, number | string | boolean | number[]>;
  } | null;
};

// Registry order must mirror numberDerivationRuleIds; first match wins.
const numberDerivationRules: readonly NumberDerivationRule[] = [];

function lazyMemo<T>(compute: () => T): () => T {
  let computed = false;
  let value: T;
  return () => {
    if (!computed) {
      value = compute();
      computed = true;
    }
    return value;
  };
}

// The rule evaluation order below is frozen: telemetry attribution depends on
// which rule is named first, and consumers compare rule mixes across releases.
// The order reproduces the original OR-ed boolean evaluation, so accept/reject
// behavior is unchanged; only the first passing rule is credited.
function assessRewriteToken(
  parsed: ParsedNumberToken,
  token: NumberTokenMatch,
  rewriteText: string,
  sourceNumberIndex: SourceNumberIndex,
  sourceText: string
): TokenAssessment {
  if (sourceNumberIndex.exactKeys.has(parsed.key)) {
    return { disposition: "matched", ruleId: "exact_source_match" };
  }
  const equivalentKey = integerThousandsEquivalentKey(parsed);
  if (equivalentKey != null && sourceNumberIndex.exactKeys.has(equivalentKey)) {
    return { disposition: "matched", ruleId: "thousands_separator_equivalent" };
  }
  const rewriteKeys = rewriteNumberKeys(parsed);
  if (
    hasRewriteMillionContext(rewriteText, token.index, token.token) &&
    rewriteKeys.some((key) => sourceNumberIndex.scaledMillionKeys.has(key))
  ) {
    return { disposition: "matched", ruleId: "scaled_million_report_table" };
  }
  const rewriteScale = rewriteScaleContext(rewriteText, token.index, token.token);
  const rewriteUnit = detectScaledNumberUnit(
    rewriteText,
    token.index,
    token.token
  );
  if (
    rewriteScale != null &&
    rewriteUnit != null &&
    rewriteKeys.some((key) =>
      sourceNumberIndex.scaledUnitKeys.has(
        scaledUnitIndexKey(rewriteScale, rewriteUnit, key)
      )
    )
  ) {
    return {
      disposition: "matched",
      ruleId: "scaled_unit_amount",
      provenance: { unit: rewriteUnit, scale: rewriteScale }
    };
  }
  if (
    !parsed.hasPercent &&
    hasSharedPercentRangeAfter(rewriteText, token.index, token.token) &&
    sourceNumberIndex.exactKeys.has(percentEquivalentKey(parsed))
  ) {
    return { disposition: "matched", ruleId: "shared_percent_range" };
  }
  const tradeMatch = matchTradeArithmetic(parsed, rewriteText, token, sourceText);
  if (tradeMatch) {
    if (tradeMatch.kind === "aggregate") {
      return {
        disposition: "matched",
        ruleId: "trade_arithmetic_aggregate",
        provenance: { terms: tradeMatch.terms, sum: tradeMatch.sum }
      };
    }
    const provenance: Record<string, number | string | boolean | number[]> = {
      paired: tradeMatch.candidate.paired
    };
    if (tradeMatch.candidate.quantity != null) {
      provenance.quantity = tradeMatch.candidate.quantity;
    }
    if (tradeMatch.candidate.price != null) {
      provenance.price = tradeMatch.candidate.price;
    }
    return {
      disposition: "matched",
      ruleId: "trade_arithmetic_pair",
      provenance
    };
  }
  return { disposition: "unexpected", ruleId: null };
}

export type AssessNumbersOptions = {
  enabledDerivationRules?: readonly NumberDerivationRuleId[];
};

function assessTokenWithDerivation(
  legacy: TokenAssessment,
  context: DerivationRuleContext,
  enabledDerivationRules: readonly NumberDerivationRuleId[]
): TokenAssessment {
  for (const rule of numberDerivationRules) {
    const match = rule.match(context);
    if (!match) {
      continue;
    }
    if (enabledDerivationRules.includes(rule.id)) {
      return {
        disposition: "derived",
        ruleId: rule.id,
        ...(match.provenance ? { provenance: match.provenance } : {})
      };
    }
    // Disabled rule: the number stays blocked, but the shadow record names
    // the rule that would have cleared it. No provenance on shadow records.
    return {
      disposition: "unexpected",
      ruleId: null,
      candidateRuleId: rule.id
    };
  }
  return legacy;
}

export function assessNumbers(
  rewrite: RewriteOutput,
  sourceText: string,
  options?: AssessNumbersOptions
): NumberAssessment[] {
  const enabledDerivationRules =
    options?.enabledDerivationRules ?? defaultEnabledDerivationRules;
  const sourceNumberIndex = collectSourceNumberIndex(sourceText);
  const rewriteText = JSON.stringify(rewrite);
  const rewriteTokens = collectNumberTokenMatches(rewriteText);
  const assessments = new Map<string, NumberAssessment>();

  const sourceNumbers = lazyMemo((): readonly SourceNumberToken[] =>
    collectNumberTokenMatches(sourceText).flatMap((match) => {
      const parsedToken = parseNumberToken(match.token);
      return parsedToken ? [{ ...parsedToken, index: match.index }] : [];
    })
  );
  const tradeCandidates = lazyMemo(() =>
    collectTradeArithmeticCandidates(sourceText)
  );

  for (const token of rewriteTokens) {
    const parsed = parseNumberToken(token.token);
    if (!parsed) {
      continue;
    }
    let result = assessRewriteToken(
      parsed,
      token,
      rewriteText,
      sourceNumberIndex,
      sourceText
    );
    if (
      result.disposition === "unexpected" &&
      numberDerivationRules.length > 0
    ) {
      result = assessTokenWithDerivation(
        result,
        {
          parsed,
          token,
          rewriteText,
          sourceText,
          sourceIndex: sourceNumberIndex,
          sourceNumbers,
          tradeCandidates
        },
        enabledDerivationRules
      );
    }
    const foldKey = [
      parsed.display,
      result.disposition,
      result.ruleId ?? "",
      result.candidateRuleId ?? ""
    ].join("\u0000");
    const existing = assessments.get(foldKey);
    if (existing) {
      existing.count += 1;
      continue;
    }
    assessments.set(foldKey, {
      display: parsed.display,
      disposition: result.disposition,
      ruleId: result.ruleId,
      count: 1,
      ...(result.provenance ? { provenance: result.provenance } : {}),
      ...(result.candidateRuleId
        ? { candidateRuleId: result.candidateRuleId }
        : {})
    });
  }

  return [...assessments.values()];
}

export function unexpectedNumberDisplays(
  assessments: NumberAssessment[]
): string[] {
  // Deduped: the same display can fold into several unexpected records once
  // candidateRuleId exists as a fold segment; issue messages must not repeat it.
  return [
    ...new Set(
      assessments
        .filter((assessment) => assessment.disposition === "unexpected")
        .map((assessment) => assessment.display)
    )
  ];
}

export function findUnexpectedNumbers(
  rewrite: RewriteOutput,
  sourceText: string,
  options?: AssessNumbersOptions
): string[] {
  return unexpectedNumberDisplays(assessNumbers(rewrite, sourceText, options));
}

import type { RewriteOutput } from "@newsweb/shared";

const numberTokenRegex =
  /-?(?:\d{1,3}(?: \d{3})+(?:[,.]\d+)?(?!\d)|\d{1,3}(?:\.\d{3})+(?:,\d+)?(?!\d)|\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\d)|\d+(?:[,.]\d+)?)(?:\s*(?:%|prosent|percent))?/gi;
const clockTimeRegex = /\b([01]?\d|2[0-3])[:.](\d{2})\b/g;

type ParsedNumberToken = {
  display: string;
  key: string;
  value: number;
  hasPercent: boolean;
};

type NumberTokenMatch = {
  token: string;
  index: number;
};

const magnitudeMarkers: Array<{ factor: number; pattern: RegExp }> = [
  {
    factor: 1_000_000_000,
    pattern: /^\s*(?:mrd\.?|milliard(?:er)?|billion|bn)\b/i
  },
  {
    factor: 1_000_000,
    pattern: /^\s*(?:mill\.?|million(?:er)?|millions?)\b/i
  },
  {
    factor: 1_000,
    pattern: /^\s*(?:tusen|thousand)\b/i
  }
];

const sharedPercentRangeAfterRegex =
  /^\s*(?:-|–|—|til|to|and|og)\s*-?\d+(?:[,.]\d+)?\s*(?:%|prosent|percent)\b/i;

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

function collectNumberTokens(text: string): string[] {
  return collectNumberMatches(text).map((match) => match.token);
}

function collectNumberMatches(text: string): NumberTokenMatch[] {
  return [...text.matchAll(numberTokenRegex)].map((match) => ({
    token: match[0],
    index: match.index ?? 0
  }));
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

function percentKey(parsed: ParsedNumberToken): string {
  const [sign, normalizedCore, , fractionDigits] = parsed.key.split("|");
  return [sign, normalizedCore, "pct", fractionDigits].join("|");
}

function hasSharedPercentRangeAfter(
  text: string,
  match: NumberTokenMatch
): boolean {
  return sharedPercentRangeAfterRegex.test(
    text.slice(match.index + match.token.length, match.index + match.token.length + 60)
  );
}

function collectSourceNumberKeys(text: string): Set<string> {
  const matches = collectNumberMatches(text);
  const keys = clockTimeNumberKeys(text);

  for (const match of matches) {
    const parsed = parseNumberToken(match.token);
    if (parsed) {
      keys.add(parsed.key);
      if (!parsed.hasPercent && hasSharedPercentRangeAfter(text, match)) {
        keys.add(percentKey(parsed));
      }
    }

    const sanitized = sanitizeNumberToken(match.token);
    const parts = sanitized.split(/[\s:/-]+/).filter((part) => /\d/.test(part));
    if (parts.length > 1) {
      for (const part of parts) {
        const partParsed = parseNumberToken(part);
        if (partParsed) {
          keys.add(partParsed.key);
        }
      }
    }
  }

  return keys;
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
  /\b(?:rundt|om lag|cirka|ca\.?|circa|about|approximately|anslagsvis|n(?:æ|ae|a)r|i overkant av|dr(?:ø|o)yt)\b/i;

const aggregateTotalContextPattern =
  /\b(?:samlet|til sammen|totalt|total|combined|in total|aggregate)\b/i;

const averagePriceContextPatterns = [
  /\b(?:snittpris|gjennomsnittspris|average price|weighted average)\b/i
];

const tradeTotalContextPatterns = [
  /\b(?:kj(?:ø|o)pesum(?:men)?|kj(?:ø|o)pte?|kjop|kj(?:ø|o)per|solgt|sold|purchased|acquired|for|tilsvarer|verdi|samlet|til sammen|totalt)\b/i
];

const localizedNumberSource =
  String.raw`-?(?:\d{1,3}(?:[ .]\d{3})+(?:[,.]\d+)?|\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[,.]\d+)?)`;

const shareUnitSource = String.raw`(?:aksjer|shares?)`;
const priceWordSource = String.raw`(?:kurs(?:en)?|snittpris|gjennomsnittspris|average price|weighted average price|price per share|subscription price|tegningskurs)`;
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
};

function hasAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function roughlyEqual(left: number, right: number): boolean {
  const tolerance = Math.max(1, Math.abs(right) * 0.002);
  return Math.abs(left - right) <= tolerance;
}

function magnitudeFactorAfter(text: string, match: NumberTokenMatch): number | null {
  const after = text.slice(
    match.index + match.token.length,
    match.index + match.token.length + 40
  );
  return magnitudeMarkers.find((marker) => marker.pattern.test(after))?.factor ?? null;
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
): Array<{ value: number; factor: number | null; roundedMagnitude: boolean }> {
  const unsignedDisplay = parsed.display.startsWith("-")
    ? parsed.display.slice(1)
    : parsed.display;
  const values: Array<{
    value: number;
    factor: number | null;
    roundedMagnitude: boolean;
  }> = [{ value: Math.abs(parsed.value), factor: null, roundedMagnitude: false }];

  if (/^\d{1,3}[.,]\d{3}$/.test(unsignedDisplay)) {
    values.push({
      value: Number(unsignedDisplay.replace(/[.,]/g, "")),
      factor: null,
      roundedMagnitude: false
    });
  }

  const factor = magnitudeFactorAfter(rewriteText, match);
  if (factor) {
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

  const sanitized = sanitizeNumberToken(raw);
  const unsigned = sanitized.startsWith("-") ? sanitized.slice(1) : sanitized;
  if (/^\d{1,3}[.,]\d{3}$/.test(unsigned)) {
    return Number(unsigned.replace(/[.,]/g, ""));
  }

  return parsed.value;
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
      paired: candidate.paired || existing?.paired === true
    });
  }
  return [...byValue.values()];
}

function collectSourceNumberValues(text: string): number[] {
  const matches = collectNumberMatches(text);
  const values: number[] = [];

  for (const match of matches) {
    const parsed = parseNumberToken(match.token);
    if (parsed && !parsed.hasPercent) {
      values.push(parsed.value);
    }
    const sanitizedToken = sanitizeNumberToken(match.token);
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

function collectSourceComparableNumberValues(text: string): number[] {
  const matches = collectNumberMatches(text);
  const values = collectSourceNumberValues(text);

  for (const match of matches) {
    const parsed = parseNumberToken(match.token);
    if (!parsed || parsed.hasPercent) {
      continue;
    }

    const factor = magnitudeFactorAfter(text, match);
    if (factor) {
      values.push(parsed.value * factor);
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
        paired: true
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
        paired: false
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
  target: { value: number; factor: number | null; roundedMagnitude: boolean },
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

function aggregateCandidateMatchesTarget(
  candidates: TradeArithmeticCandidate[],
  target: { value: number; factor: number | null; roundedMagnitude: boolean },
  parsed: ParsedNumberToken,
  context: string
): boolean {
  const pairedCandidates = candidates.filter((candidate) => candidate.paired);
  if (
    pairedCandidates.length < 2 ||
    pairedCandidates.length > 8 ||
    !aggregateTotalContextPattern.test(context)
  ) {
    return false;
  }

  const maxMask = 1 << pairedCandidates.length;
  for (let mask = 1; mask < maxMask; mask += 1) {
    let count = 0;
    let sum = 0;
    let usesAveragePrice = false;
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
      usesAveragePrice ||= candidate.usesAveragePrice;
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
        return true;
      }
      continue;
    }
    if (roughlyEqual(sum, target.value)) {
      return true;
    }
  }

  return false;
}

function isSimpleTradeArithmeticNumber(
  parsed: ParsedNumberToken,
  rewriteText: string,
  match: NumberTokenMatch,
  sourceText: string
): boolean {
  if (parsed.hasPercent) {
    return false;
  }
  if (
    !hasAnyPattern(sourceText, tradeArithmeticContextPatterns) ||
    !hasAnyPattern(sourceText, moneyContextPatterns)
  ) {
    return false;
  }

  const context = visibleContextAround(rewriteText, match);
  if (
    !hasAnyPattern(context, moneyContextPatterns) ||
    !hasAnyPattern(context, tradeTotalContextPatterns)
  ) {
    return false;
  }

  const targetValues = targetValuesForRewriteNumber(
    parsed,
    rewriteText,
    match
  ).filter((target) => target.value >= 1000);
  if (targetValues.length === 0) {
    return false;
  }

  const candidates = collectTradeArithmeticCandidates(sourceText);
  for (const target of targetValues) {
    if (
      candidates.some((candidate) =>
        candidateMatchesTarget(candidate, target, parsed, context)
      )
    ) {
      return true;
    }
    if (
      aggregateCandidateMatchesTarget(candidates, target, parsed, context)
    ) {
      return true;
    }
  }

  return false;
}

function isSharedPercentRangeNumber(
  parsed: ParsedNumberToken,
  rewriteText: string,
  match: NumberTokenMatch,
  sourceNumberKeys: Set<string>
): boolean {
  return (
    !parsed.hasPercent &&
    sourceNumberKeys.has(percentKey(parsed)) &&
    hasSharedPercentRangeAfter(rewriteText, match)
  );
}

function isRoundedMagnitudeNumber(
  parsed: ParsedNumberToken,
  rewriteText: string,
  match: NumberTokenMatch,
  sourceComparableValues: number[]
): boolean {
  if (parsed.hasPercent) {
    return false;
  }

  const factor = magnitudeFactorAfter(rewriteText, match);
  if (!factor) {
    return false;
  }

  const target = Math.abs(parsed.value * factor);
  return sourceComparableValues.some((sourceValue) =>
    roughlyEqual(target, Math.abs(sourceValue))
  );
}

export function findUnexpectedNumbers(
  rewrite: RewriteOutput,
  sourceText: string
): string[] {
  const sourceNumberKeys = collectSourceNumberKeys(sourceText);
  const sourceComparableValues = collectSourceComparableNumberValues(sourceText);
  const rewriteText = JSON.stringify(rewrite);
  const rewriteMatches = collectNumberMatches(rewriteText);
  const unexpected = new Set<string>();

  for (const match of rewriteMatches) {
    const parsed = parseNumberToken(match.token);
    if (!parsed) {
      continue;
    }
    if (!sourceNumberKeys.has(parsed.key)) {
      if (isSharedPercentRangeNumber(parsed, rewriteText, match, sourceNumberKeys)) {
        continue;
      }
      if (isRoundedMagnitudeNumber(parsed, rewriteText, match, sourceComparableValues)) {
        continue;
      }
      if (isSimpleTradeArithmeticNumber(parsed, rewriteText, match, sourceText)) {
        continue;
      }
      unexpected.add(parsed.display);
    }
  }

  return [...unexpected];
}

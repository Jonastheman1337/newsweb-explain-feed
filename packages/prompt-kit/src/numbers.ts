import type { RewriteOutput } from "@newsweb/shared";

const numberTokenRegex =
  /-?(?:\d{1,3}(?: \d{3})+(?:[,.]\d+)?(?!\d)|\d{1,3}(?:\.\d{3})+(?:,\d+)?(?!\d)|\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\d)|\d+(?:[,.]\d+)?)(?:\s*(?:%|prosent|percent))?/gi;
const clockTimeRegex = /\b([01]?\d|2[0-3])[:.](\d{2})\b/g;

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

function parseNumberToken(
  token: string
): { display: string; key: string; value: number; hasPercent: boolean } | null {
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
  return [...text.matchAll(numberTokenRegex)].map((match) => match[0]);
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

function rewriteNumberKeys(parsed: {
  display: string;
  key: string;
  hasPercent: boolean;
}): string[] {
  const equivalentKey = integerThousandsEquivalentKey(parsed);
  return equivalentKey ? [parsed.key, equivalentKey] : [parsed.key];
}

function collectSourceNumberKeys(text: string): Set<string> {
  const tokens = collectNumberTokens(text);
  const keys = clockTimeNumberKeys(text);

  for (const token of tokens) {
    const parsed = parseNumberToken(token);
    if (parsed) {
      keys.add(parsed.key);
    }

    const sanitized = sanitizeNumberToken(token);
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

function hasAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function roughlyEqual(left: number, right: number): boolean {
  const tolerance = Math.max(1, Math.abs(right) * 0.002);
  return Math.abs(left - right) <= tolerance;
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

function isSimpleTradeArithmeticNumber(
  parsed: { display: string; value: number; hasPercent: boolean },
  sourceText: string
): boolean {
  const unsignedDisplay = parsed.display.startsWith("-")
    ? parsed.display.slice(1)
    : parsed.display;
  const targetValues = [
    Math.abs(parsed.value),
    /^\d{1,3}[.,]\d{3}$/.test(unsignedDisplay)
      ? Number(unsignedDisplay.replace(/[.,]/g, ""))
      : null
  ].filter((value): value is number => value != null);

  if (parsed.hasPercent || targetValues.every((value) => value < 1000)) {
    return false;
  }
  if (
    !hasAnyPattern(sourceText, tradeArithmeticContextPatterns) ||
    !hasAnyPattern(sourceText, moneyContextPatterns)
  ) {
    return false;
  }

  const sourceNumbers = collectSourceNumberValues(sourceText).filter(
    (value) => value > 0
  );
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
      if (targetValues.some((target) => roughlyEqual(larger * smaller, target))) {
        return true;
      }
    }
  }

  return false;
}

export function findUnexpectedNumbers(
  rewrite: RewriteOutput,
  sourceText: string
): string[] {
  const sourceNumberKeys = collectSourceNumberKeys(sourceText);
  const rewriteTokens = collectNumberTokens(JSON.stringify(rewrite));
  const unexpected = new Set<string>();

  for (const token of rewriteTokens) {
    const parsed = parseNumberToken(token);
    if (!parsed) {
      continue;
    }
    if (!rewriteNumberKeys(parsed).some((key) => sourceNumberKeys.has(key))) {
      if (isSimpleTradeArithmeticNumber(parsed, sourceText)) {
        continue;
      }
      unexpected.add(parsed.display);
    }
  }

  return [...unexpected];
}

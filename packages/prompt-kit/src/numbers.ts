import type { RewriteOutput } from "@newsweb/shared";

const numberTokenRegex = /-?\d[\d\s.,:%/-]*(?:\s*(?:prosent|percent))?/gi;

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
): { display: string; key: string } | null {
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
    ].join("|")
  };
}

function collectSourceNumberKeys(text: string): Set<string> {
  const tokens = text.match(numberTokenRegex) ?? [];
  const keys = new Set<string>();

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

export function findUnexpectedNumbers(
  rewrite: RewriteOutput,
  sourceText: string
): string[] {
  const sourceNumberKeys = collectSourceNumberKeys(sourceText);
  const rewriteTokens = JSON.stringify(rewrite).match(numberTokenRegex) ?? [];
  const unexpected = new Set<string>();

  for (const token of rewriteTokens) {
    const parsed = parseNumberToken(token);
    if (!parsed) {
      continue;
    }
    if (!sourceNumberKeys.has(parsed.key)) {
      unexpected.add(parsed.display);
    }
  }

  return [...unexpected];
}

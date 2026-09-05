// Comparison-only normalization. Never change the source or article bytes.
// A hyphen between unsigned endpoints is a range only with a nearby explicit
// unit/range cue. Bare subtraction, equations and signed endpoints stay put.
const unsignedNumber = String.raw`\d+(?:[.,]\d+)*`;
const unsignedRange = new RegExp(
  String.raw`(?<![\p{L}\p{N}.,+\-−–—])(${unsignedNumber})[ \t]*[-–—][ \t]*(${unsignedNumber})(?![\p{L}\p{N}.,])`,
  "gu"
);
const unitAfter = /^\s*(?:%|prosent\b|percent\b|mill(?:\.|ion(?:er|s)?)\b|milliard(?:er)?\b|billion(?:s)?\b|kroner\b|dollars?\b|dollar\b|euros?\b|pounds?\b|nok\b|sek\b|dkk\b|usd\b|eur\b|gbp\b|tonn(?:es|s)?\b|aksjer\b|shares\b)/i;
const rangeBefore = /(?:\b(?:nok|sek|dkk|usd|eur|gbp|between|mellom|interval|range)\s*|[$€£]\s*)$/i;
const arithmetic = /[=+*/×÷−<>≤≥≠≡≈]|\b(?:minus|subtract(?:ed|ion)?|less|equals?|lik)\b/i;

export function normalizeNoticeNumericRanges(text: string): string {
  // U+2212 is a minus sign, not a range dash. Preserve that sign even when
  // the legacy tokenizer would otherwise have silently read a positive value.
  return text.replace(unsignedRange, (match, left: string, right: string, offset: number) => {
    const before = text.slice(Math.max(0, offset - 40), offset);
    const after = text.slice(offset + match.length, offset + match.length + 64);
    const lineStart = text.lastIndexOf("\n", offset - 1);
    const previousLineStart = lineStart < 0 ? 0 : text.lastIndexOf("\n", lineStart - 1) + 1;
    const lineEnd = text.indexOf("\n", offset + match.length);
    const arithmeticContext = text.slice(previousLineStart, lineEnd < 0 ? text.length : lineEnd);
    const leftValue = Number(left.replace(",", "."));
    const rightValue = Number(right.replace(",", "."));
    if ((!unitAfter.test(after) && !rangeBefore.test(before)) ||
        !Number.isFinite(leftValue) || !Number.isFinite(rightValue) || leftValue > rightValue ||
        arithmetic.test(arithmeticContext)) {
      return match;
    }
    return `${left}–${right}`;
  }).replace(/−[ \t]*(?=\d)/g, "-");
}

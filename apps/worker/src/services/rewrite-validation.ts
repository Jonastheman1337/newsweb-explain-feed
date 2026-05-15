import { findUnexpectedNumbers, type PromptPayload } from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";

const MAX_ALLOWED_UNEXPECTED_NUMBERS = 2;
const MAX_TITLE_WORDS = 8;
const MAX_SUMMARY_SENTENCES = 15;
const MAX_VISIBLE_ARTICLE_CHARS = 1000;

const CRITICISM_PATTERNS = [
  /\banklag/i,
  /\bbeskyld/i,
  /\bkritiser/i,
  /\bgransk/i,
  /\bs[øo]ksm[åa]l/i,
  /\bstraffbar/i,
  /\btiltal/i,
  /\baccus/i,
  /\balleg/i,
  /\binvestigat/i,
  /\bfraud/i,
  /\bbribery/i,
  /\bcorruption/i,
  /\blawsuit/i,
  /\bcriminal/i
];

const REPLY_PATTERNS = [
  /\bavvis/i,
  /\bbestrid/i,
  /\buenig/i,
  /\bnekter/i,
  /\bbenekt/i,
  /\buskyldig/i,
  /\bdeni(?:es|ed|al)?\b/i,
  /\bdisput(?:e|es|ed|ing)\b/i,
  /\breject(?:s|ed|ing)?\b/i,
  /\bcontest(?:s|ed|ing)?\b/i,
  /\brefut(?:e|es|ed|ing)\b/i,
  /\bnot guilty\b/i
];

const REVENUE_PATTERNS = [
  /\binntekter?\b/i,
  /\bomsetning(?:en)?\b/i,
  /\brevenues?\b/i,
  /\bturnover\b/i,
  /\bsales\b/i
];

const RESULT_PATTERNS = [
  /\bresultat(?:et|er|ene)?\b/i,
  /\boverskudd(?:et)?\b/i,
  /\btap(?:et|ene)?\b/i,
  /\bprofits?\b/i,
  /\bloss(?:es)?\b/i,
  /\bearnings\b/i,
  /\bnet income\b/i,
  /\boperating income\b/i,
  /\bebit(?:da)?\b/i
];

const CURRENCY_MARKER_GROUPS: Array<{
  label: string;
  patterns: RegExp[];
}> = [
  {
    label: "NOK/kroner",
    patterns: [/\bnok\b/i, /\bmnok\b/i, /\bbnok\b/i, /\bkr\b/i, /\bkron(?:e|er)\b/i]
  },
  {
    label: "USD/dollar",
    patterns: [/\busd\b/i, /\bdollars?\b/i, /\$|＄/i]
  },
  {
    label: "EUR/euro",
    patterns: [/\beur\b/i, /\beuros?\b/i, /€/i]
  },
  {
    label: "GBP/pund",
    patterns: [/\bgbp\b/i, /\bpund\b/i, /\bpounds?\b/i, /£/i]
  },
  {
    label: "SEK/svenske kroner",
    patterns: [/\bsek\b/i, /\bsvenske kroner\b/i]
  },
  {
    label: "DKK/danske kroner",
    patterns: [/\bdkk\b/i, /\bdanske kroner\b/i]
  }
];

export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }

  const matches = trimmed.match(/[.!?](?=\s|$)/g);
  if (!matches || matches.length === 0) {
    return 1;
  }

  return matches.length;
}

export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean).length;
}

export function countSummarySentences(rewrite: RewriteOutput): number {
  return [rewrite.lead, ...rewrite.body].reduce(
    (total, part) => total + countSentences(part),
    0
  );
}

export function collectVisibleArticleFields(rewrite: RewriteOutput): string[] {
  return [rewrite.title, rewrite.lead, ...rewrite.body];
}

export function visibleArticleText(rewrite: RewriteOutput): string {
  return collectVisibleArticleFields(rewrite).join("\n");
}

export function countVisibleArticleChars(rewrite: RewriteOutput): number {
  return [rewrite.lead, ...rewrite.body].join("\n\n").length;
}

export function buildValidationSourceText(payload: PromptPayload): string {
  return [
    payload.title,
    payload.issuerName,
    payload.issuerSign,
    payload.publishedAt,
    payload.categories.join(", "),
    payload.markets.join(", "),
    payload.bodyText,
    payload.pdfSupplementText ?? ""
  ].join("\n");
}

function hasAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function findUnexpectedCurrencyMarkers(
  rewrite: RewriteOutput,
  sourceText: string
): string[] {
  const visibleText = visibleArticleText(rewrite);
  return CURRENCY_MARKER_GROUPS.filter(
    (group) =>
      hasAnyPattern(visibleText, group.patterns) &&
      !hasAnyPattern(sourceText, group.patterns)
  ).map((group) => group.label);
}

function sourceRequiresRightOfReply(sourceText: string): boolean {
  return (
    hasAnyPattern(sourceText, CRITICISM_PATTERNS) &&
    hasAnyPattern(sourceText, REPLY_PATTERNS)
  );
}

function visibleArticleIncludesRightOfReply(rewrite: RewriteOutput): boolean {
  return hasAnyPattern(visibleArticleText(rewrite), REPLY_PATTERNS);
}

function hasRevenueResultMixupRisk(
  rewrite: RewriteOutput,
  sourceText: string
): boolean {
  return (
    hasAnyPattern(sourceText, REVENUE_PATTERNS) &&
    !hasAnyPattern(sourceText, RESULT_PATTERNS) &&
    hasAnyPattern(visibleArticleText(rewrite), RESULT_PATTERNS)
  );
}

export function validateRewriteOutput(
  rewrite: RewriteOutput,
  payload: PromptPayload
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const validationSourceText = buildValidationSourceText(payload);

  const numberErrors = findUnexpectedNumbers(
    rewrite,
    validationSourceText
  );
  if (numberErrors.length > MAX_ALLOWED_UNEXPECTED_NUMBERS) {
    errors.push(`Unexpected numbers: ${numberErrors.join(", ")}`);
  }

  if (collectVisibleArticleFields(rewrite).some((field) => field.includes("%"))) {
    errors.push("Visible article text uses %, write prosent instead.");
  }

  if (payload.hasAttachments && rewrite.source_limitations.length === 0) {
    errors.push("Attachment exists but source_limitations is empty.");
  }

  if (payload.bodyText.trim().length < 80 && rewrite.source_limitations.length === 0) {
    errors.push("Short source body without limitation note.");
  }

  if (countSummarySentences(rewrite) > MAX_SUMMARY_SENTENCES) {
    errors.push(`Summary exceeds ${MAX_SUMMARY_SENTENCES} sentences.`);
  }

  if (countVisibleArticleChars(rewrite) > MAX_VISIBLE_ARTICLE_CHARS) {
    errors.push(`Visible article text exceeds ${MAX_VISIBLE_ARTICLE_CHARS} chars.`);
  }

  if (countSentences(rewrite.company_sentence) !== 1) {
    errors.push("company_sentence must contain exactly one sentence.");
  }

  if (countWords(rewrite.title) > MAX_TITLE_WORDS) {
    errors.push(`Title exceeds ${MAX_TITLE_WORDS} words.`);
  }

  const unexpectedCurrencyMarkers = findUnexpectedCurrencyMarkers(
    rewrite,
    validationSourceText
  );
  if (unexpectedCurrencyMarkers.length > 0) {
    errors.push(
      `Visible article text uses currency not present in source: ${unexpectedCurrencyMarkers.join(", ")}.`
    );
  }

  if (
    sourceRequiresRightOfReply(validationSourceText) &&
    !visibleArticleIncludesRightOfReply(rewrite)
  ) {
    errors.push("Source contains criticism/accusation and a reply, but reply is missing from visible article text.");
  }

  if (hasRevenueResultMixupRisk(rewrite, validationSourceText)) {
    errors.push(
      "Source only appears to mention revenue/income, but visible article text uses result/profit/loss terminology."
    );
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

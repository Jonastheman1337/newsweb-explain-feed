import { findUnexpectedNumbers, type PromptPayload } from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";

const MAX_ALLOWED_UNEXPECTED_NUMBERS = 2;
const MAX_TITLE_WORDS = 8;
const MAX_SUMMARY_SENTENCES = 15;

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

export function buildValidationSourceText(payload: PromptPayload): string {
  return [
    payload.title,
    payload.issuerName,
    payload.issuerSign,
    payload.publishedAt,
    payload.categories.join(", "),
    payload.markets.join(", "),
    payload.bodyText
  ].join("\n");
}

export function validateRewriteOutput(
  rewrite: RewriteOutput,
  payload: PromptPayload
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const numberErrors = findUnexpectedNumbers(
    rewrite,
    buildValidationSourceText(payload)
  );
  if (numberErrors.length > MAX_ALLOWED_UNEXPECTED_NUMBERS) {
    errors.push(`Unexpected numbers: ${numberErrors.join(", ")}`);
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

  if (countSentences(rewrite.company_sentence) !== 1) {
    errors.push("company_sentence must contain exactly one sentence.");
  }

  if (countWords(rewrite.title) > MAX_TITLE_WORDS) {
    errors.push(`Title exceeds ${MAX_TITLE_WORDS} words.`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

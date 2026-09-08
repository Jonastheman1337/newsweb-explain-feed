import { normalizeGuardrailText } from "./text-normalization.js";

// A high-confidence importance floor, not an exhaustive newsworthiness rule.
// The percentage must describe the SALE as a share of the COMPANY, never
// the seller's remaining holding or the fraction of their own stake sold.
const saleHeadline = /\b(?:sale|sell|sells|selling|selldown|sold|placing|placement|nedsalg|selger|solgt|salg)\b/;
const sharesHeadline = /\bshares?\b|\baksje/;
const transactionPercent = new RegExp([
  String.raw`\b(?:sale|offering|placing|placement|shares (?:sold|offered)|salget|nedsalget|aksjene som selges)`,
  String.raw`\s+(?:corresponds? to|represents?|comprises?|constitutes?|of|tilsvarer|utgjor|pa)\s+`,
  String.raw`(?:(?:approximately|approx\.?|about|around|up to|om lag|cirka|ca\.?|inntil)\s+)?`,
  String.raw`(\d{1,3}(?:[.,]\d+)?)\s*(?:%|per cent|percent|prosent)\s+`,
  String.raw`(?:of\s+(?:the\s+)?(?:total|issued|outstanding|company's)\s+(?:(?:issued|and|outstanding|ordinary)\s+){0,4}(?:shares|share capital)`,
  String.raw`|av\s+(?:(?:alle|de|samlede|utstedte|utestaende|selskapets)\s+){1,5}(?:aksjene|aksjer|aksjekapitalen))`,
  String.raw`\b(?!\s+(?:held|owned|som|eid|til)\b)`
].join(""), "g");

export function hasMaterialShareSale(title: string, bodyText: string): boolean {
  const headline = normalizeGuardrailText(title);
  if (!saleHeadline.test(headline) || !sharesHeadline.test(headline)) return false;

  return [...normalizeGuardrailText(bodyText).matchAll(transactionPercent)].some((match) => {
    const percent = Number(match[1].replace(",", "."));
    return percent >= 1 && percent <= 100;
  });
}

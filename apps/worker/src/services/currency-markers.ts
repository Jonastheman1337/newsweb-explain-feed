/** Specific currencies must be recognized before generic dollar/kroner markers. */
export const SPECIFIC_CURRENCY_MARKERS = [
  { label: "CAD/kanadiske dollar", pattern: /\b(?:(?:t|k|m|b)?cad|kanadisk(?:e)? dollar|canadian dollars?)\b|(?<![a-z])(?:C|CA)\$/gi },
  { label: "AUD/australske dollar", pattern: /\b(?:(?:t|k|m|b)?aud|australsk(?:e)? dollar|australian dollars?)\b|(?<![a-z])(?:A|AU)\$/gi },
  { label: "NZD/newzealandske dollar", pattern: /\b(?:(?:t|k|m|b)?nzd|newzealandsk(?:e)? dollar|new zealand dollars?)\b|(?<![a-z])NZ\$/gi },
  { label: "SGD/singaporske dollar", pattern: /\b(?:(?:t|k|m|b)?sgd|singaporsk(?:e)? dollar|singapore dollars?)\b|(?<![a-z])S\$/gi },
  { label: "HKD/Hongkong-dollar", pattern: /\b(?:(?:t|k|m|b)?hkd|hongkong[ -]dollar|hong kong dollars?)\b|(?<![a-z])HK\$/gi },
  { label: "ISK/islandske kroner", pattern: /\b(?:(?:t|k|m|b)?isk|islandsk(?:e)? kron(?:e|er)|icelandic kr[oó]n(?:a|ur))\b/gi },
  { label: "CHF/sveitsiske franc", pattern: /\b(?:(?:t|k|m|b)?chf|sveitsisk(?:e)? franc|swiss francs?)\b/gi },
  { label: "JPY/japanske yen", pattern: /\b(?:(?:t|k|m|b)?jpy|japansk(?:e)? yen|japanese yen)\b/gi },
  { label: "CNY/kinesiske yuan", pattern: /\b(?:(?:t|k|m|b)?cny|rmb|kinesisk(?:e)? yuan|chinese yuan|renminbi)\b/gi },
  { label: "INR/indiske rupier", pattern: /\b(?:(?:t|k|m|b)?inr|indisk(?:e)? rupi(?:er)?|indian rupees?)\b/gi },
  { label: "BRL/brasilianske real", pattern: /\b(?:(?:t|k|m|b)?brl|brasiliansk(?:e)? real|brazilian real(?:s)?)\b|(?<![a-z])R\$/gi },
  { label: "ZAR/sørafrikanske rand", pattern: /\b(?:(?:t|k|m|b)?zar|sørafrikansk(?:e)? rand|south african rand)\b/gi },
  { label: "PLN/polske zloty", pattern: /\b(?:(?:t|k|m|b)?pln|polsk(?:e)? zloty|polish zloty)\b/gi },
  { label: "KRW/sørkoreanske won", pattern: /\b(?:(?:t|k|m|b)?krw|sørkoreansk(?:e)? won|south korean won)\b/gi }
];

export function specificCurrencyLabels(text: string): string[] {
  return SPECIFIC_CURRENCY_MARKERS.filter(({ pattern }) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  }).map(({ label }) => label);
}

/** Mask full foreign names/symbols so their generic suffix is not USD or NOK. */
export function withoutSpecificCurrencies(text: string): string {
  return SPECIFIC_CURRENCY_MARKERS.reduce(
    (result, { pattern }) => result.replace(pattern, " "), text
  );
}

export const QUEUE_NAMES = {
  ingest: "notice-ingest",
  rewrite: "notice-rewrite",
  publish: "notice-publish"
} as const;

export const CACHE_KEYS = {
  metaFilters: "newsweb:meta:filters"
} as const;

export const REDIS_CHANNELS = {
  feedNewItem: "feed:new-item"
} as const;

export const META_CACHE_TTL_SECONDS = 60 * 15;

/**
 * Newsweb categories that are mechanical/administrative and unlikely to be
 * editorially newsworthy. Notices with *only* these categories skip the full
 * AI rewrite pipeline and appear in the feed as lightweight stubs.
 *
 * Note: SUSPENSJONER (trading halts) and BØRSPAUSE are intentionally excluded
 * from this list because they are often breaking-news signals.
 */
export const SKIP_REWRITE_CATEGORIES = new Set([
  "RENTEREGULERING",
  "EKS.DATO",
  "SLUTTKURSER DERIVATER",
  "DERIVATMELDINGER",
  "SÆRLIG OBSERVASJON",
  "NOTERING / OPPTAK AV VERDIPAPIRER",
  "KAPITAL- OG STEMMERETTSENDRINGER",
  "UTSTEDERS MELDEPLIKT VED HANDEL I EGNE AKSJER",
  "MELDING FRA OSLO BØRS",
  "MELDING FRA FINANSTILSYNET",
  "MELDING FRA NORGES BANK",
  "MELDING FRA ANDRE AKTØRER"
]);

/**
 * Broad categories where newsworthiness varies. Notices with *only* these
 * categories go through a lightweight AI triage step before the full pipeline.
 */
export const TRIAGE_CATEGORIES = new Set([
  "ANNEN INFORMASJONSPLIKTIG REGULATORISK INFORMASJON",
  "IKKE-INFORMASJONSPLIKTIGE PRESSEMELDINGER"
]);

export const YEARLY_REPORT_CATEGORIES = new Set([
  "ÅRSRAPPORTER OG REVISJONSBERETNINGER"
]);

export function isYearlyReportCategory(categories: string[]): boolean {
  return categories.some((cat) => YEARLY_REPORT_CATEGORIES.has(cat));
}

/**
 * Categories for quarterly/half-year reports. These notices typically have
 * stub body text ("see attached PDF") and need PDF extraction to produce
 * a news article.
 */
export const QUARTERLY_REPORT_CATEGORIES = new Set([
  "HALVÅRSRAPPORTER OG REVISJONSBERETNINGER / UTTALELSER OM FORENKLET REVISORKONTROLL"
]);

/**
 * Returns true if any of the notice's categories is a quarterly report category.
 * Unlike shouldSkipRewrite/needsNewsworthinessTriage which require *every* category
 * to match, a single quarterly report category is enough to trigger the PDF path.
 */
export function isQuarterlyReportCategory(categories: string[]): boolean {
  return categories.some((cat) => QUARTERLY_REPORT_CATEGORIES.has(cat));
}

/**
 * Returns true if every category on the notice is in the skip set,
 * meaning the notice is purely mechanical and should not get a full rewrite.
 * Returns false if the notice has no categories (fail-open: generate rewrite).
 */
export function shouldSkipRewrite(categories: string[]): boolean {
  if (categories.length === 0) {
    return false;
  }
  return categories.every((cat) => SKIP_REWRITE_CATEGORIES.has(cat));
}

/**
 * Returns true if the notice's categories are ambiguous and should be
 * evaluated by AI for newsworthiness before running the full rewrite pipeline.
 */
export function needsNewsworthinessTriage(categories: string[]): boolean {
  if (categories.length === 0) {
    return false;
  }
  return categories.every((cat) => TRIAGE_CATEGORIES.has(cat));
}


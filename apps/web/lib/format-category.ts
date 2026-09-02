/**
 * Newsweb category values are ALL-CAPS Norwegian ("MELDING FRA OSLO BØRS").
 * Sentence-case them for display only — the raw value stays the filter/mute
 * key, so this must never be applied to values sent back to the API.
 */
export function formatCategoryLabel(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0) + value.slice(1).toLocaleLowerCase("nb-NO");
}

/**
 * Display text for a notice's categories in the dateline. Newsweb attaches
 * exactly one category to practically every message, so this is normally a
 * single label; multiple categories are comma-joined. Empty when none.
 */
export function formatCategoryList(categories: string[] | undefined): string {
  return (categories ?? [])
    .map((value) => formatCategoryLabel(value.trim()))
    .filter(Boolean)
    .join(", ");
}

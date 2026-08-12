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

/**
 * E24's standard AI disclosure. It is not shown in the UI; it is appended,
 * unedited, to both the HTML and plain-text clipboard payloads when a notice
 * is copied.
 */
export const AI_DISCLOSURE_TEXT =
  "Teksten er skrevet ved hjelp av et AI-verktøy. Les E24s AI-retningslinjer ";
export const AI_DISCLOSURE_LINK_TEXT = "her";
export const AI_DISCLOSURE_LINK_HREF = "https://e24.no/informasjon/ai-retningslinjer";

/** Plain-text variant. The link cannot survive as a link, so the URL follows the word. */
export function aiDisclosurePlainText(): string {
  return `${AI_DISCLOSURE_TEXT}${AI_DISCLOSURE_LINK_TEXT} (${AI_DISCLOSURE_LINK_HREF}).`;
}

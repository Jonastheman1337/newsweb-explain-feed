/** Stable migration marker: only links created before this reset lose their cursor. */
export const FEED_CURSOR_EPOCH = "2026-09-17-live";

type FeedPosition = Record<string, string | undefined>;
export function resetOldFeedPosition(params: FeedPosition): string | null {
  if ((!params.cursor && !params.cursorId) || params.cursorEpoch === FEED_CURSOR_EPOCH) return null;
  const latest = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== "cursor" && key !== "cursorId" && key !== "cursorEpoch") latest.set(key, value);
  }
  return latest.size ? `/?${latest}` : "/";
}

"use client";

import { useEffect } from "react";

/**
 * Strips empty-valued query params (the GET filter form always submits
 * q=&market=&... for untouched fields) so the address bar stays clean.
 * Never touches params with values — q and cursor must survive refreshes,
 * pagination and SSE-triggered router.refresh().
 */
export function FeedUrlCleanup() {
  useEffect(() => {
    const url = new URL(window.location.href);
    let removed = false;
    for (const [key, value] of Array.from(url.searchParams.entries())) {
      if (!value) {
        url.searchParams.delete(key);
        removed = true;
      }
    }
    if (!removed) return;

    const queryString = url.searchParams.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${queryString ? `?${queryString}` : ""}${url.hash}`
    );
  }, []);

  return null;
}

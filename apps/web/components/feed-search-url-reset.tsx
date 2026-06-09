"use client";

import { useEffect } from "react";

export function FeedSearchUrlReset() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("q")) return;

    url.searchParams.delete("q");
    url.searchParams.delete("cursor");
    for (const [key, value] of Array.from(url.searchParams.entries())) {
      if (!value) {
        url.searchParams.delete(key);
      }
    }

    const queryString = url.searchParams.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${queryString ? `?${queryString}` : ""}${url.hash}`
    );
  }, []);

  return null;
}

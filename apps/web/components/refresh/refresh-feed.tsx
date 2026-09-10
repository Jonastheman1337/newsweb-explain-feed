"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { FeedItem } from "@newsweb/shared";
import { RefreshCard } from "./refresh-card";
import { rememberSelection, restoreSelection, selectVersion } from "./selection";
import { useFeedStreamSubscription } from "../feed-stream-provider";
import {
  initialFeedState,
  receiveFeedItem,
  selectPending
} from "./feed-state";
import styles from "./refresh.module.css";

export function RefreshFeed({
  initialItems,
  mutedCategories,
  filtered
}: {
  initialItems: FeedItem[];
  mutedCategories: string[];
  filtered: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState(() => initialFeedState(initialItems));
  const feedRef = useRef<HTMLDivElement>(null);
  const scrollAnchor = useRef<{ element: HTMLElement; top: number; scrollY: number } | null>(null);
  function rememberReadingPosition() {
    if (scrollAnchor.current || window.scrollY <= 32) return;
    const element = Array.from(feedRef.current?.querySelectorAll<HTMLElement>("article") ?? [])
      .find((card) => {
        const rect = card.getBoundingClientRect();
        return rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
      });
    if (element) scrollAnchor.current = { element, top: element.getBoundingClientRect().top, scrollY: window.scrollY };
  }
  useLayoutEffect(() => {
    const anchor = scrollAnchor.current;
    scrollAnchor.current = null;
    // Do not undo a scroll made by the reader while React was updating.
    if (!anchor || !anchor.element.isConnected || window.scrollY !== anchor.scrollY) return;
    const offset = anchor.element.getBoundingClientRect().top - anchor.top;
    if (offset) window.scrollTo({ top: window.scrollY + offset, behavior: "instant" });
  }, [state]);
  const searchParams = useSearchParams();
  const generatedOnly = searchParams.get("generated") === "1";
  const importantOnly = !generatedOnly && searchParams.get("important") === "1";
  function setView(view: "all" | "important" | "generated") {
    const query = new URLSearchParams(searchParams.toString());
    query.delete("important");
    query.delete("generated");
    if (view !== "all") query.set(view, "1");
    router.replace(`/${query.size ? `?${query}` : ""}`, { scroll: false });
  }
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isVisible = (item: FeedItem) =>
    !item.categories.some((category) => mutedCategories.includes(category));
  const refresh = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 250);
  };
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    []
  );
  const restored = useRef(false);
  const [selectionReady, setSelectionReady] = useState(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const entries = initialFeedState(initialItems).entries.map(restoreSelection);
    entries.filter((entry) => !entry.pending).forEach(rememberSelection);
    setState((previous) => ({ ...previous, entries }));
    setSelectionReady(true);
  }, []);
  useEffect(() => {
    if (selectionReady) state.entries.filter((entry) => !entry.pending).forEach(rememberSelection);
  }, [selectionReady, state.entries]);
  useEffect(() => {
    // Reconnects merge into existing entries; they do not replace focused editors.
    rememberReadingPosition();
    setState((previous) => {
      const next = initialItems.reduce(receiveFeedItem, previous);
      if (!filtered) return next;
      const matchingIds = new Set(initialItems.map((item) => item.messageId));
      return {
        entries: next.entries.filter((entry) => matchingIds.has(entry.current.messageId))
      };
    });
  }, [initialItems, filtered]);
  useFeedStreamSubscription({
    onItem: (item) => {
      if (filtered) {
        refresh();
        return;
      }
      rememberReadingPosition();
      setState((previous) => receiveFeedItem(previous, item));
    },
    onReconnect: refresh
  });
  const entries = state.entries.filter(
    (entry) => isVisible(entry.latest) && (!generatedOnly || (entry.current.isFinal && !!entry.current.rewriteId)) && (!importantOnly || (entry.latest.isFinal ? entry.latest : entry.current).importance === "viktig")
  );
  return (
    <>
      <div className={styles.viewBar}>
        <div role="group" aria-label="Vis meldinger">
          <button aria-pressed={!importantOnly && !generatedOnly} onClick={() => setView("all")}>
            Alle
          </button>
          <button aria-pressed={importantOnly} onClick={() => setView("important")}>
            Viktige
          </button>
          <button aria-pressed={generatedOnly} onClick={() => setView("generated")}>
            Genererte
          </button>
        </div>
      </div>
      <div className={styles.feed} ref={feedRef}>
        {entries.map((entry) => (
          <RefreshCard
            key={entry.current.messageId}
            entry={entry}
            showEditingHint={entry === entries.find((candidate) => candidate.current.isFinal)}
            onVersion={(selected) => {
              rememberSelection({ current: selected, latest: entry.latest });
              setState((previous) => selectVersion(previous, selected));
            }}
            onSelect={() => {
              if (entry.pending)
                rememberSelection({
                  current: entry.pending,
                  latest: entry.latest
                });
              setState((previous) => selectPending(previous, entry.current.messageId));
            }}
          />
        ))}
      </div>
      {!entries.length && <p className={styles.empty}>{generatedOnly ? "Ingen genererte notiser på denne siden." : importantOnly ? "Ingen viktige meldinger på denne siden." : "Ingen meldinger som passer med søket og filtrene."}</p>}
    </>
  );
}

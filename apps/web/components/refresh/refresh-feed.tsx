"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FeedItem } from "@newsweb/shared";
import { RefreshCard } from "./refresh-card";
import { rememberSelection, restoreSelection, selectVersion } from "./selection";
import { useFeedStreamSubscription } from "../feed-stream-provider";
import {
  fastDraftToFeedItem,
  initialFeedState,
  receiveFeedItem,
  revealIncoming,
  selectPending,
  type FeedEntry
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
  const [importantOnly, setImportantOnly] = useState(false);
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
    setState((previous) => {
      const next = initialItems.reduce(receiveFeedItem, previous);
      if (!filtered) return next;
      const matchingIds = new Set(initialItems.map((item) => item.messageId));
      return {
        entries: next.entries.filter((entry) => matchingIds.has(entry.current.messageId)),
        incoming: next.incoming.filter((item) => matchingIds.has(item.messageId))
      };
    });
  }, [initialItems, filtered]);
  useFeedStreamSubscription({
    onItem: (item) => {
      if (filtered) {
        refresh();
        return;
      }
      setState((previous) => receiveFeedItem(previous, item));
    },
    onReconnect: refresh
  });
  const entries = state.entries.filter(
    (entry) => isVisible(entry.latest) && (!importantOnly || (entry.latest.isFinal ? entry.latest : entry.current).importance === "viktig")
  );
  const incoming = state.incoming.filter(
    (item) => isVisible(item) && (!importantOnly || (item.isFinal ? item : fastDraftToFeedItem(item) ?? item).importance === "viktig")
  );
  return (
    <>
      <div className={styles.viewBar}>
        <div role="group" aria-label="Vis meldinger">
          <button aria-pressed={!importantOnly} onClick={() => setImportantOnly(false)}>
            Alle
          </button>
          <button aria-pressed={importantOnly} onClick={() => setImportantOnly(true)}>
            Viktige
          </button>
        </div>
        <span>{entries.length} meldinger</span>
      </div>
      <div className={styles.arrivals} aria-live="polite">
        {incoming.length > 0 && (
          <button
            onClick={() => {
              initialFeedState(state.incoming).entries.forEach(rememberSelection);
              setState(revealIncoming);
            }}
          >
            {incoming.length} {incoming.length === 1 ? "ny melding" : "nye meldinger"} ↓
          </button>
        )}
      </div>
      <div className={styles.feed}>
        {entries.map((entry) => (
          <RefreshCard
            key={entry.current.messageId}
            entry={entry}
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
      {!entries.length && <p className={styles.empty}>Ingen meldinger</p>}
    </>
  );
}

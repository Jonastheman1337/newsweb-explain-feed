"use client";

import { useEffect, useRef, useState } from "react";
import type { FeedItem } from "@newsweb/shared";
import { NoticeCard } from "./notice-card";

type LiveFeedListProps = {
  initialItems: FeedItem[];
  filters?: {
    market?: string;
    category?: string;
    issuer?: string;
    q?: string;
  };
};

export function LiveFeedList({ initialItems, filters }: LiveFeedListProps) {
  const [newItems, setNewItems] = useState<FeedItem[]>([]);
  const knownIds = useRef(new Set(initialItems.map((i) => i.messageId)));

  // Keep knownIds in sync when initialItems change (e.g. filter/pagination navigation)
  useEffect(() => {
    const ids = new Set(initialItems.map((i) => i.messageId));
    knownIds.current = ids;
    setNewItems([]);
  }, [initialItems]);

  useEffect(() => {
    const hasFilters = filters?.market || filters?.category || filters?.issuer || filters?.q;
    if (hasFilters) return;

    const es = new EventSource("/api/feed/stream");

    es.onmessage = (event) => {
      try {
        const item: FeedItem = JSON.parse(event.data);
        if (!knownIds.current.has(item.messageId)) {
          knownIds.current.add(item.messageId);
          setNewItems((prev) => [item, ...prev]);
        }
      } catch {
        // Ignore parse errors
      }
    };

    return () => es.close();
  }, [filters?.market, filters?.category, filters?.issuer, filters?.q]);

  const seen = new Set<number>();
  const allItems = [...newItems, ...initialItems].filter((item) => {
    if (seen.has(item.messageId)) return false;
    seen.add(item.messageId);
    return true;
  });

  return (
    <>
      {allItems.map((item) => (
        <NoticeCard key={item.messageId} item={item} />
      ))}
    </>
  );
}

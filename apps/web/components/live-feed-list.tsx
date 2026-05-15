"use client";

import { useEffect, useState } from "react";
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

function sortFeedItems(items: FeedItem[]): FeedItem[] {
  return [...items].sort((left, right) => {
    const timeDiff =
      new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return right.messageId - left.messageId;
  });
}

export function LiveFeedList({ initialItems, filters }: LiveFeedListProps) {
  const [items, setItems] = useState<FeedItem[]>(() => sortFeedItems(initialItems));

  useEffect(() => {
    setItems(sortFeedItems(initialItems));
  }, [initialItems]);

  useEffect(() => {
    const hasFilters = filters?.market || filters?.category || filters?.issuer || filters?.q;
    if (hasFilters) return;

    const es = new EventSource("/api/feed/stream");

    es.onmessage = (event) => {
      try {
        const item: FeedItem = JSON.parse(event.data);
        setItems((prev) => {
          const exists = prev.some((existing) => existing.messageId === item.messageId);
          const next = exists
            ? prev.map((existing) =>
                existing.messageId === item.messageId ? item : existing
              )
            : [item, ...prev];
          return sortFeedItems(next);
        });
      } catch {
        // Ignore parse errors
      }
    };

    return () => es.close();
  }, [filters?.market, filters?.category, filters?.issuer, filters?.q]);

  return (
    <>
      {items.map((item) => (
        <NoticeCard key={item.messageId} item={item} />
      ))}
    </>
  );
}

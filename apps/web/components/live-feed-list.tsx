"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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

const FILTERED_FEED_REFRESH_DEBOUNCE_MS = 250;

function sortFeedItems(items: FeedItem[]): FeedItem[] {
  return [...items].sort((left, right) => {
    const timeDiff =
      new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return right.messageId - left.messageId;
  });
}

export function LiveFeedList({ initialItems, filters }: LiveFeedListProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<FeedItem[]>(() => sortFeedItems(initialItems));

  useEffect(() => {
    setItems(sortFeedItems(initialItems));
  }, [initialItems]);

  useEffect(() => {
    const rawPosition = sessionStorage.getItem("feed:return-position");
    if (!rawPosition) return;

    try {
      const position = JSON.parse(rawPosition) as {
        returnPath?: string;
        messageId?: number;
        scrollY?: number;
      };
      const queryString = searchParams.toString();
      const currentPath = `${pathname}${queryString ? `?${queryString}` : ""}`;
      if (position.returnPath !== currentPath) return;

      sessionStorage.removeItem("feed:return-position");
      requestAnimationFrame(() => {
        const target = position.messageId
          ? document.getElementById(`notice-${position.messageId}`)
          : null;
        if (target) {
          target.scrollIntoView({ block: "start" });
          return;
        }
        if (typeof position.scrollY === "number") {
          window.scrollTo({ top: position.scrollY });
        }
      });
    } catch {
      sessionStorage.removeItem("feed:return-position");
    }
  }, [items, pathname, searchParams]);

  useEffect(() => {
    const hasFilters = filters?.market || filters?.category || filters?.issuer || filters?.q;
    const es = new EventSource("/api/feed/stream");
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    function refreshFilteredFeed() {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        router.refresh();
      }, FILTERED_FEED_REFRESH_DEBOUNCE_MS);
    }

    es.onmessage = (event) => {
      try {
        const item: FeedItem = JSON.parse(event.data);
        if (hasFilters) {
          refreshFilteredFeed();
          return;
        }

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

    return () => {
      es.close();
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
    };
  }, [filters?.market, filters?.category, filters?.issuer, filters?.q, router]);

  return (
    <>
      {items.map((item) => (
        <NoticeCard key={item.messageId} item={item} />
      ))}
    </>
  );
}

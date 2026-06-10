"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { FeedItem } from "@newsweb/shared";
import { NoticeCard } from "./notice-card";
import { useFeedStream } from "./use-feed-stream";

type LiveFeedListProps = {
  initialItems: FeedItem[];
  filters?: {
    market?: string;
    category?: string;
    issuer?: string;
    q?: string;
  };
  emptyState?: ReactNode;
};

const FEED_REFRESH_DEBOUNCE_MS = 250;

function sortFeedItems(items: FeedItem[]): FeedItem[] {
  return [...items].sort((left, right) => {
    const timeDiff =
      new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return right.messageId - left.messageId;
  });
}

export function LiveFeedList({ initialItems, filters, emptyState }: LiveFeedListProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<FeedItem[]>(() => sortFeedItems(initialItems));
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasFilters = Boolean(
    filters?.market || filters?.category || filters?.issuer || filters?.q
  );

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

  const refreshFeed = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      router.refresh();
    }, FEED_REFRESH_DEBOUNCE_MS);
  }, [router]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  useFeedStream({
    onItem: (item) => {
      if (hasFilters) {
        refreshFeed();
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
    },
    onReconnect: refreshFeed
  });

  if (items.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <>
      {items.map((item) => (
        <NoticeCard key={item.messageId} item={item} />
      ))}
    </>
  );
}

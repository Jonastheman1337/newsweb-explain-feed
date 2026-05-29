"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { FeedItem } from "@newsweb/shared";

type NoticeRefreshListenerProps = {
  messageId: number;
};

export function NoticeRefreshListener({ messageId }: NoticeRefreshListenerProps) {
  const router = useRouter();

  useEffect(() => {
    const es = new EventSource("/api/feed/stream");
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    es.onmessage = (event) => {
      try {
        const item: FeedItem = JSON.parse(event.data);
        if (item.messageId !== messageId || refreshTimer) {
          return;
        }

        refreshTimer = setTimeout(() => {
          refreshTimer = null;
          router.refresh();
        }, 0);
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
  }, [messageId, router]);

  return null;
}

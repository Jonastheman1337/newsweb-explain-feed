"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useFeedStreamSubscription } from "./feed-stream-provider";

type NoticeRefreshListenerProps = {
  messageId: number;
};

export function NoticeRefreshListener({ messageId }: NoticeRefreshListenerProps) {
  const router = useRouter();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) {
      return;
    }
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      router.refresh();
    }, 0);
  }, [router]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  useFeedStreamSubscription({
    onItem: (item) => {
      if (item.messageId === messageId) {
        scheduleRefresh();
      }
    },
    onReconnect: scheduleRefresh
  });

  return null;
}

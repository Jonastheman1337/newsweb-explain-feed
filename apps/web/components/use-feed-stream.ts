"use client";

import { useEffect, useRef } from "react";
import type { FeedItem } from "@newsweb/shared";

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

// How long a re-established connection must stay open before we treat it as
// healthy and ask the consumer to re-sync. Avoids refresh spam while the API
// is down and the stream cycles between connect and close.
const RECONNECT_RESYNC_GRACE_MS = 2_000;

type UseFeedStreamOptions = {
  onItem: (item: FeedItem) => void;
  /**
   * Called when the stream is healthy again after a drop. Events published
   * while disconnected were missed, so consumers should re-sync their state
   * (typically via router.refresh()).
   */
  onReconnect?: () => void;
  enabled?: boolean;
};

/**
 * Subscribes to /api/feed/stream and keeps the subscription alive.
 *
 * The browser only retries EventSource connections after network-level
 * drops; a non-200 response (e.g. the API restarting behind the proxy)
 * closes the stream permanently. This hook recreates the EventSource with
 * capped exponential backoff so live updates survive transient failures.
 */
export function useFeedStream({
  onItem,
  onReconnect,
  enabled = true
}: UseFeedStreamOptions): void {
  const handlersRef = useRef({ onItem, onReconnect });
  handlersRef.current = { onItem, onReconnect };

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let resyncTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
    let hasConnectedBefore = false;
    let disposed = false;
    let lastEventId: string | null = null;

    function connect() {
      // Hook-managed reconnects cannot set the Last-Event-ID header on a
      // fresh EventSource, so the resume id travels as a query param instead.
      const url = lastEventId
        ? `/api/feed/stream?lastEventId=${encodeURIComponent(lastEventId)}`
        : "/api/feed/stream";
      const es = new EventSource(url);
      source = es;

      es.onopen = () => {
        reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
        if (hasConnectedBefore && !resyncTimer) {
          resyncTimer = setTimeout(() => {
            resyncTimer = null;
            handlersRef.current.onReconnect?.();
          }, RECONNECT_RESYNC_GRACE_MS);
        }
        hasConnectedBefore = true;
      };

      es.onmessage = (event) => {
        if (event.lastEventId) {
          lastEventId = event.lastEventId;
        }
        try {
          const item: FeedItem = JSON.parse(event.data);
          handlersRef.current.onItem(item);
        } catch {
          // Ignore parse errors
        }
      };

      // The server confirms whether a reconnect was fully replayed from its
      // buffer ("resumed" — no refresh needed) or the gap was too big
      // ("reset" — fall through to the grace-timer resync below).
      es.addEventListener("control", (event) => {
        try {
          const control = JSON.parse((event as MessageEvent).data) as {
            type?: string;
          };
          if (control.type === "resumed" && resyncTimer) {
            clearTimeout(resyncTimer);
            resyncTimer = null;
          }
        } catch {
          // Ignore parse errors
        }
      });

      es.onerror = () => {
        if (resyncTimer) {
          clearTimeout(resyncTimer);
          resyncTimer = null;
        }
        // CONNECTING means the browser is retrying on its own; only step in
        // once it has given up (CLOSED).
        if (disposed || es.readyState !== EventSource.CLOSED) {
          return;
        }
        es.close();
        if (reconnectTimer) {
          return;
        }
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (resyncTimer) {
        clearTimeout(resyncTimer);
      }
      source?.close();
    };
  }, [enabled]);
}

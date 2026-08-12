"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode
} from "react";
import type { FeedItem } from "@newsweb/shared";
import { useFeedStream } from "./use-feed-stream";

type FeedStreamHandlers = {
  onItem?: (item: FeedItem) => void;
  onReconnect?: () => void;
};

type SubscriberEntry = {
  current: FeedStreamHandlers;
};

type FeedStreamContextValue = {
  register: (entry: SubscriberEntry) => () => void;
};

const FeedStreamContext = createContext<FeedStreamContextValue | null>(null);

/**
 * Owns the single EventSource for the whole protected shell and fans events
 * out to subscribers. Previously the feed list, notice refresher and
 * notification bell each held their own connection (with matching per-client
 * cost on the API); now toggling a consumer only touches the registry.
 */
export function FeedStreamProvider({ children }: { children: ReactNode }) {
  const subscribersRef = useRef<Set<SubscriberEntry>>(new Set());

  useFeedStream({
    onItem: (item) => {
      for (const entry of subscribersRef.current) {
        try {
          entry.current.onItem?.(item);
        } catch {
          // One consumer's failure must not break the fan-out.
        }
      }
    },
    onReconnect: () => {
      for (const entry of subscribersRef.current) {
        try {
          entry.current.onReconnect?.();
        } catch {
          // One consumer's failure must not break the fan-out.
        }
      }
    }
  });

  const register = useCallback((entry: SubscriberEntry) => {
    subscribersRef.current.add(entry);
    return () => {
      subscribersRef.current.delete(entry);
    };
  }, []);

  return (
    <FeedStreamContext.Provider value={{ register }}>
      {children}
    </FeedStreamContext.Provider>
  );
}

/**
 * Subscribe to the shared feed stream. Falls back to a dedicated
 * EventSource when no provider is mounted (e.g. in isolation/tests).
 */
export function useFeedStreamSubscription(
  handlers: FeedStreamHandlers,
  subscribed = true
): void {
  const context = useContext(FeedStreamContext);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // Fallback path when no provider is mounted.
  useFeedStream({
    onItem: (item) => handlersRef.current.onItem?.(item),
    onReconnect: () => handlersRef.current.onReconnect?.(),
    enabled: subscribed && context === null
  });

  useEffect(() => {
    if (!context || !subscribed) {
      return;
    }
    return context.register(handlersRef);
  }, [context, subscribed]);
}

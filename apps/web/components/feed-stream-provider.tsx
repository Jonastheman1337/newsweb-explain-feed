"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useMemo,
  type ReactNode
} from "react";
import type { FeedItem } from "@newsweb/shared";
import { useFeedStream, type FeedConnectionState } from "./use-feed-stream";

type FeedStreamHandlers = {
  onItem?: (item: FeedItem) => void;
  onReconnect?: () => void;
};

type SubscriberEntry = {
  current: FeedStreamHandlers;
};

type FeedStreamContextValue = {
  register: (entry: SubscriberEntry) => () => void;
  connection: FeedConnectionState;
  reconnect: () => void;
};

const FeedStreamContext = createContext<FeedStreamContextValue | null>(null);

/**
 * Owns the single EventSource for the whole protected shell and fans events
 * out to subscribers. Previously the feed list, notice refresher and
 * notification bell each held their own connection (with matching per-client
 * cost on the API); now toggling a consumer only touches the registry.
 */
export function FeedStreamProvider({ children, view }: { children: ReactNode; view?: "v2" }) {
  const subscribersRef = useRef<Set<SubscriberEntry>>(new Set());
  const [connection, setConnection] = useState<FeedConnectionState>("connecting");
  const [reconnectKey, setReconnectKey] = useState(0);
  const reconnect = useCallback(() => setReconnectKey((key) => key + 1), []);

  useFeedStream({
    reconnectKey,
    view,
    onConnectionChange: setConnection,
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

  const value = useMemo(
    () => ({ register, connection, reconnect }),
    [register, connection, reconnect]
  );
  return <FeedStreamContext.Provider value={value}>{children}</FeedStreamContext.Provider>;
}

export function useFeedConnection() {
  const context = useContext(FeedStreamContext);
  if (!context) throw new Error("Feed connection requires FeedStreamProvider");
  return { state: context.connection, reconnect: context.reconnect };
}

/**
 * Subscribe to the shared feed stream. Falls back to a dedicated
 * EventSource when no provider is mounted (e.g. in isolation/tests).
 */
export function useFeedStreamSubscription(handlers: FeedStreamHandlers, subscribed = true): void {
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

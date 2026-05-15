"use client";

import { useCallback } from "react";

export type EditorialTelemetryPayload = {
  clientEventId: string;
  editorId: string;
  sessionId: string;
  version?: number;
  actionSource?: string;
};

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getStoredId(storage: Storage, key: string): string {
  const existing = storage.getItem(key);
  if (existing) return existing;
  const created = createId();
  storage.setItem(key, created);
  return created;
}

export function createEditorialTelemetry(args: {
  version?: number;
  actionSource?: string;
} = {}): EditorialTelemetryPayload | undefined {
  if (typeof window === "undefined") return undefined;
  return {
    clientEventId: createId(),
    editorId: getStoredId(window.localStorage, "newsweb_editor_id"),
    sessionId: getStoredId(window.sessionStorage, "newsweb_session_id"),
    ...(args.version != null ? { version: args.version } : {}),
    ...(args.actionSource ? { actionSource: args.actionSource } : {})
  };
}

export function useEditorialTelemetry(messageId: number, activeVersion?: number) {
  const buildTelemetry = useCallback(
    (args: {
      version?: number;
      actionSource?: string;
    } = {}) =>
      createEditorialTelemetry({
        version: args.version ?? activeVersion,
        actionSource: args.actionSource
      }),
    [activeVersion]
  );

  const logEvent = useCallback(
    async (args: {
      action: string;
      payload?: unknown;
      version?: number;
      actionSource?: string;
    }) => {
      const telemetry = buildTelemetry({
        version: args.version,
        actionSource: args.actionSource
      });
      await fetch(`/api/notice/${messageId}/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: args.action,
          telemetry,
          payload: args.payload ?? {}
        })
      });
    },
    [buildTelemetry, messageId]
  );

  return { buildTelemetry, logEvent };
}

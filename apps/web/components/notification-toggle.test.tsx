// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { FeedItem } from "@newsweb/shared";
import { NotificationToggle } from "./notification-toggle";

const stream = vi.hoisted(() => ({ onItem: undefined as undefined | ((item: FeedItem) => void) }));
vi.mock("./feed-stream-provider", () => ({
  useFeedStreamSubscription: (handlers: { onItem: (item: FeedItem) => void }, enabled: boolean) => {
    stream.onItem = enabled ? handlers.onItem : undefined;
  }
}));
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

it("alerts once for a new publication and stays silent for regeneration and replay", async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const notification = vi.fn();
  Object.assign(notification, { permission: "granted" });
  vi.stubGlobal("Notification", notification);
  localStorage.setItem("notifications", "on");
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<NotificationToggle />));
    const item = { messageId: 123, title: "Generated title", sourceTitle: "Ny sak", issuerName: "Test ASA" } as FeedItem;
    stream.onItem!({ ...item, notifyNewNotice: false, regenerating: true });
    stream.onItem!(item);
    expect(notification).not.toHaveBeenCalled();
    stream.onItem!({ ...item, notifyNewNotice: true });
    expect(notification).toHaveBeenCalledTimes(1);
    expect(notification).toHaveBeenCalledWith("Ny sak", expect.objectContaining({ body: "Test ASA" }));
    stream.onItem!({ ...item, notifyNewNotice: true });
    stream.onItem!({ ...item, notifyNewNotice: false, publicationRevision: 2 });
    expect(notification).toHaveBeenCalledTimes(1);
    stream.onItem!({ ...item, messageId: 456, notifyNewNotice: true });
    expect(notification).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
  }
});

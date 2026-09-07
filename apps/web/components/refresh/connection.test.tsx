// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  FeedStreamProvider,
  useFeedConnection,
  useFeedStreamSubscription
} from "../feed-stream-provider";
it("shares one stream, preserves replay cursor on manual reconnect, and resyncs a missed gap", async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const streams: FakeStream[] = [];
  class FakeStream {
    static CLOSED = 2;
    readyState = 1;
    onopen = () => {};
    onerror = () => {};
    onmessage = (event: unknown) => {};
    close = vi.fn();
    addEventListener = vi.fn();
    constructor(public url: string) {
      streams.push(this);
    }
  }
  vi.stubGlobal("EventSource", FakeStream);
  const seen = vi.fn(),
    resync = vi.fn();
  let connection: ReturnType<typeof useFeedConnection>;
  function Consumer() {
    connection = useFeedConnection();
    useFeedStreamSubscription({ onItem: seen, onReconnect: resync });
    return <span>{connection.state}</span>;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(() =>
      root.render(
        <FeedStreamProvider>
          <Consumer />
          <Consumer />
        </FeedStreamProvider>
      )
    );
    expect(streams).toHaveLength(1);
    await act(() => streams[0].onopen());
    expect(container.textContent).toBe("connectedconnected");
    await act(() => streams[0].onmessage({ data: '{"messageId":123}', lastEventId: "17" }));
    expect(seen).toHaveBeenCalledTimes(2);
    await act(() => streams[0].onerror());
    expect(connection!.state).toBe("disconnected");
    await act(() => connection!.reconnect());
    expect(streams[0].close).toHaveBeenCalled();
    expect(streams).toHaveLength(2);
    expect(streams[1].url).toContain("lastEventId=17");
    await act(() => streams[1].onopen());
    await act(() => vi.advanceTimersByTime(2000));
    expect(resync).toHaveBeenCalledTimes(2);
  } finally {
    await act(() => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

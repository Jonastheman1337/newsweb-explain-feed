// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  NoticeEditorSnapshot,
  NoticeGenerationRequest,
} from "@newsweb/shared";
import { useNoticeComposer } from "./next-composer";
vi.mock("../../lib/editorial-telemetry", () => ({
  useEditorialTelemetry: () => ({
    buildTelemetry: () => ({ actionSource: "next_composer" }),
  }),
}));
let root: Root,
  container: HTMLDivElement,
  snapshot: NoticeEditorSnapshot,
  interaction: number,
  result: ReturnType<typeof vi.fn>,
  server: NoticeGenerationRequest;
let accepted: ((value: Response) => void) | null,
  delayAcceptance: boolean,
  capable: boolean;
const json = (body: unknown) =>
  ({ ok: true, json: async () => body }) as Response;
function Harness() {
  const composer = useNoticeComposer({
    messageId: 991,
    rewriteId: snapshot.rewriteId,
    enabled: true,
    getSnapshot: () => snapshot,
    getInteractionVersion: () => interaction,
    onResult: result,
  });
  return (
    <>
      {composer.form}
      <div>{composer.status}</div>
    </>
  );
}
function setText(text: string) {
  const field = container.querySelector("textarea")!;
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
const button = (label: string) =>
  Array.from(container.querySelectorAll("button")).find(
    (node) => node.textContent?.trim() === label,
  )!;
async function submit() {
  await act(() =>
    (
      container.querySelector(
        '[aria-label="Lag ny versjon"]',
      ) as HTMLButtonElement
    ).click(),
  );
}
async function complete() {
  server = { ...server, state: "published", rewriteId: "result-2", version: 2 };
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1600);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  snapshot = {
    rewriteId: "base-1",
    contentHash: "hash-1",
    title: "Den synlige tittelen",
    body: "Dette er den synlige og redigerte teksten.",
  };
  interaction = 0;
  result = vi.fn(async () => {});
  accepted = null;
  delayAcceptance = false;
  capable = true;
  server = {
    generationRunId: "run-1",
    clientRequestId: null,
    state: "running",
    version: null,
    rewriteId: null,
    error: null,
    createdAt: "2026-09-09T12:00:00Z",
    updatedAt: "2026-09-09T12:00:00Z",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
      const value = String(url);
      if (value.endsWith("/editor-capabilities"))
        return json({
          queuedGeneration: capable,
          cancellation: capable,
          urlMaterials: true,
        });
      if (value.endsWith("/materials")) return json({ materials: [] });
      if (value.endsWith("/generate")) {
        if (delayAcceptance)
          return new Promise<Response>((resolve) => {
            accepted = resolve;
          });
        return json(server);
      }
      if (value.includes("/status?")) return json({ request: server });
      if (value.endsWith("/cancel")) {
        server = { ...server, state: "cancelling" };
        return json(server);
      }
      return json({});
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("submits the exact visible draft and permits automatic opening only when untouched", async () => {
  await act(() => root.render(<Harness />));
  await act(() => setText("Kort ned ingressen"));
  await submit();
  const post = vi
    .mocked(fetch)
    .mock.calls.find(([url]) => String(url).endsWith("/generate"))!;
  const body = JSON.parse(post[1]?.body as string);
  expect(body.baseSnapshot).toEqual(snapshot);
  expect(body.instruction).toBe("Kort ned ingressen");
  expect(body.clientRequestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(container.querySelector("textarea")?.value).toBe("");
  await complete();
  expect(result).toHaveBeenCalledOnce();
  expect(result.mock.calls[0][2]()).toBe(true);
});
it.each(["editor", "composer", "version"])(
  "keeps requested results pending after %s changes",
  async (kind) => {
    await act(() => root.render(<Harness />));
    await submit();
    if (kind === "editor") {
      snapshot = { ...snapshot, body: "En endring etter innsending." };
      interaction++;
    }
    if (kind === "composer")
      await act(() => setText("En ny usendt instruksjon"));
    if (kind === "version") {
      interaction++;
      snapshot = { ...snapshot, rewriteId: "another-version" };
    }
    await complete();
    expect(result).toHaveBeenCalledOnce();
    expect(result.mock.calls[0][2]()).toBe(false);
    if (kind === "composer")
      expect(container.querySelector("textarea")?.value).toBe(
        "En ny usendt instruksjon",
      );
  },
);
it("keeps the completion guard live while the resulting article is being fetched", async () => {
  let guard: (() => boolean) | undefined;
  let finish: () => void = () => {};
  result = vi.fn(async (_request, _base, canOpen) => {
    guard = canOpen;
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    expect(canOpen()).toBe(false);
  });
  await act(() => root.render(<Harness />));
  await submit();
  await complete();
  expect(guard?.()).toBe(true);
  interaction++;
  snapshot = { ...snapshot, title: "Redigert mens resultatet hentes" };
  expect(guard?.()).toBe(false);
  await act(() => finish());
});
it("preserves newer typing while submission is awaiting acceptance", async () => {
  delayAcceptance = true;
  await act(() => root.render(<Harness />));
  await act(() => setText("Instruksjonen som sendes"));
  await submit();
  await act(() => setText("Dette skrev jeg etterpå"));
  await act(async () => {
    accepted!(json(server));
  });
  expect(container.querySelector("textarea")?.value).toBe(
    "Dette skrev jeg etterpå",
  );
  await complete();
  expect(result.mock.calls[0][2]()).toBe(false);
});
it("retries an uncertain submission with the same request id and body", async () => {
  await act(() => root.render(<Harness />));
  const defaultFetch = vi.mocked(fetch).getMockImplementation()!;
  let failed = false;
  vi.mocked(fetch).mockImplementation(async (...args) => {
    if (String(args[0]).endsWith("/generate") && !failed) {
      failed = true;
      throw new Error("Nettverket forsvant");
    }
    return defaultFetch(...args);
  });
  await act(() => setText("Behold dette"));
  await submit();
  expect(container.querySelector("textarea")?.value).toBe("Behold dette");
  await act(() => button("Prøv igjen").click());
  const calls = vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => String(url).endsWith("/generate"));
  expect(calls).toHaveLength(2);
  expect(calls[1][1]?.body).toBe(calls[0][1]?.body);
});
it("restores a tracked request after remount without automatically replacing text", async () => {
  await act(() => root.render(<Harness />));
  await submit();
  await act(() => root.unmount());
  root = createRoot(container);
  await act(() => root.render(<Harness />));
  await complete();
  expect(result).toHaveBeenCalledOnce();
  expect(result.mock.calls[0][2]()).toBe(false);
});
it("cancels the exact run and waits for acknowledgement", async () => {
  await act(() => root.render(<Harness />));
  await submit();
  await act(() => button("Avbryt").click());
  expect(container.textContent).toContain("Avbryter");
  expect(button("Avbryt").disabled).toBe(true);
  server = { ...server, state: "cancelled" };
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1600);
  });
  expect(container.textContent).toContain("Avbrutt");
  expect(result).not.toHaveBeenCalled();
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(
        ([url, options]) =>
          String(url) === "/api/notice/991/generations/run-1/cancel" &&
          options?.method === "POST",
      ),
  ).toBe(true);
});
it("does not bypass backend capability checks with Ctrl+Enter", async () => {
  capable = false;
  await act(() => root.render(<Harness />));
  await act(() =>
    container.querySelector("textarea")!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(
    vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith("/generate")),
  ).toHaveLength(0);
});
it("retries a failed cancellation without resubmitting generation", async () => {
  await act(() => root.render(<Harness />));
  await submit();
  const fallback = vi.mocked(fetch).getMockImplementation()!;
  let fail = true;
  vi.mocked(fetch).mockImplementation(async (...args) => {
    if (String(args[0]).endsWith("/cancel") && fail) {
      fail = false;
      throw new Error("Avbrudd ikke bekreftet");
    }
    return fallback(...args);
  });
  await act(() => button("Avbryt").click());
  await act(() => button("Prøv å avbryte igjen").click());
  expect(
    vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith("/generate")),
  ).toHaveLength(1);
  expect(container.textContent).toContain("Avbryter");
});
it("removing a pending source also removes the late imported material", async () => {
  await act(() => root.render(<Harness />));
  const fallback = vi.mocked(fetch).getMockImplementation()!;
  let resolve!: (value: Response) => void;
  vi.mocked(fetch).mockImplementation(async (...args) =>
    String(args[0]).endsWith("/materials/url")
      ? new Promise<Response>((done) => {
          resolve = done;
        })
      : fallback(...args),
  );
  await act(() => setText("https://example.com/article"));
  await act(() => button("Legg ved teksten").click());
  expect(
    (
      container.querySelector(
        '[aria-label="Lag ny versjon"]',
      ) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await act(() =>
    (
      container.querySelector(
        '[aria-label="Fjern example.com"]',
      ) as HTMLButtonElement
    ).click(),
  );
  await act(() =>
    resolve(
      json({
        id: "late-material",
        title: "Example",
        status: "ready",
        kind: "url",
      }),
    ),
  );
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(
        ([url, options]) =>
          String(url).endsWith("/materials/late-material") &&
          options?.method === "DELETE",
      ),
  ).toBe(true);
  expect(container.textContent).not.toContain("Leser");
});
it("keeps failed sources blocking submission until removal", async () => {
  const fallback = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (...args) =>
    String(args[0]).endsWith("/materials")
      ? json({
          materials: [
            {
              id: "failed-source",
              title: "Betalingsmur",
              enabled: true,
              status: "failed",
              kind: "url",
              url: "https://example.com",
            },
          ],
        })
      : fallback(...args),
  );
  await act(() => root.render(<Harness />));
  await submit();
  expect(
    vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith("/generate")),
  ).toHaveLength(0);
  await act(() =>
    (
      container.querySelector(
        '[aria-label="Fjern Betalingsmur"]',
      ) as HTMLButtonElement
    ).click(),
  );
  await submit();
  expect(
    vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith("/generate")),
  ).toHaveLength(1);
});
it("applies custom length with Enter without submitting the composer", async () => {
  await act(() => root.render(<Harness />));
  await act(() =>
    (
      container.querySelector(
        '[aria-label^="Maksimal lengde"]',
      ) as HTMLButtonElement
    ).click(),
  );
  await act(() => button("Annet …").click());
  const input = container.querySelector('input[type="number"]')!;
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "1400");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(
    vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith("/generate")),
  ).toHaveLength(0);
  await submit();
  expect(
    JSON.parse(
      vi
        .mocked(fetch)
        .mock.calls.find(([url]) => String(url).endsWith("/generate"))![1]
        ?.body as string,
    ).maxVisibleArticleChars,
  ).toBe(1400);
});

it("retries the frozen failed request without applying newer composer validation", async () => {
  await act(() => root.render(<Harness />));
  await submit();
  server = { ...server, state: "failed" };
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1600);
  });
  await act(() => setText("Ny kilde ".repeat(300)));
  await act(() => button("Prøv igjen").click());
  const calls = vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => String(url).endsWith("/generate"));
  expect(calls).toHaveLength(2);
  expect(JSON.parse(calls[1][1]?.body as string)).toMatchObject({
    retryOf: "run-1",
  });
  expect(container.querySelector("textarea")?.value).toBe(
    "Ny kilde ".repeat(300),
  );
});

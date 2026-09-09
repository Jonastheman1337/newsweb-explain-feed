// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FeedItem } from "@newsweb/shared";
import { RefreshCard } from "./refresh-card";
import { RefreshFeed } from "./refresh-feed";
import { RefreshFilters } from "./filters";
import { InstructionInput } from "../instruction-input";
import { useFeedStreamSubscription } from "../feed-stream-provider";
import styles from "./next-editor.module.css";
import RefreshPage from "../../app/(refresh)/next/page";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  query: new URLSearchParams(),
  getFeed: vi.fn(),
  getNotice: vi.fn(),
  getNoticeModelSource: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
  useSearchParams: () => mocks.query,
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("../../lib/session", () => ({
  getSessionToken: async () => "fixture-session",
}));
vi.mock("../../lib/api", () => ({
  getFeed: mocks.getFeed,
  getNotice: mocks.getNotice,
  getNoticeModelSource: mocks.getNoticeModelSource,
  getMetaFilters: async () => ({ markets: [], categories: [], issuers: [] }),
  getMutedCategories: async () => ({ mutedCategories: ["RENTEREGULERING"] }),
  isApiAuthError: () => false,
}));
vi.mock("../../lib/editorial-telemetry", () => ({
  useEditorialTelemetry: () => ({
    logEvent: vi.fn().mockResolvedValue(undefined),
    buildTelemetry: () => ({}),
  }),
}));
vi.mock("../feed-stream-provider", () => ({
  useFeedStreamSubscription: vi.fn(),
  useFeedConnection: () => ({ state: "connected", reconnect: vi.fn() }),
}));

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          titles: ["Et konkret tittelforslag"],
          materials: [],
          queuedGeneration: true,
          cancellation: true,
          urlMaterials: true,
        }),
      }),
  );
  vi.stubEnv("UI_V2_ENABLED", "true");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
  localStorage.clear();
  sessionStorage.clear();
  mocks.query = new URLSearchParams();
  mocks.getNotice.mockResolvedValue({
    source: {
      title: "Original source",
      bodyText: "Source text",
      attachments: [],
    },
    rewrites: [],
  });
  mocks.getNoticeModelSource.mockResolvedValue({
    rewriteId: null,
    text: null,
    pageCount: null,
    attachmentId: null,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function item(id: number, overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    messageId: id,
    publishedAt: "2026-09-07T08:00:00Z",
    rewriteId: `rewrite-${id}`,
    rewriteVersion: 1,
    publicationRevision: 1,
    contentHash: `hash-${id}`,
    isFinal: true,
    finalizedAt: "2026-09-07T08:00:00Z",
    title: `Headline ${id}`,
    lead: "A checked lead",
    body: ["A checked paragraph"],
    keyFacts: [],
    negativeOrSurprising: [],
    sourceLimitations: [],
    importance: "medium",
    confidence: "high",
    visibilityStatus: "published",
    issuerName: "Test ASA",
    issuerSign: "TEST",
    categories: ["INNSIDEINFORMASJON", "FLAGGING"],
    hasAttachments: false,
    attachments: [],
    sourceTitle: "Source title",
    sourceBodyText: "Source body",
    notGenerated: false,
    skipped: false,
    failed: false,
    processing: false,
    regenerating: false,
    ...overrides,
  };
}
const buttons = (text: string) =>
  Array.from(container.querySelectorAll("button")).filter(
    (button) => button.textContent?.trim() === text,
  );

it("searches an issuer by ticker and preserves the important view in the submitted form", async () => {
  await act(() =>
    root.render(
      <RefreshFilters
        params={{ important: "1" }}
        markets={[]}
        categories={[]}
        mutedCategories={[]}
        connection={null}
        issuers={[
          { value: "EQNR", label: "Equinor ASA (EQNR)" },
          { value: "DNB", label: "DNB Bank ASA (DNB)" },
        ]}
      />,
    ),
  );
  await act(() => container.querySelector("summary")!.click());
  await act(() =>
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Alle utstedere"))!
      .click(),
  );
  const search = container.querySelector(
    '[placeholder="Søk etter selskap eller ticker"]',
  ) as HTMLInputElement;
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(search, "eqnr");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.querySelector('[role="listbox"]')?.textContent).toContain(
    "Equinor ASA (EQNR)",
  );
  expect(
    container.querySelector('[role="listbox"]')?.textContent,
  ).not.toContain("DNB Bank");
  await act(() => buttons("Equinor ASA (EQNR)")[0].click());
  const form = new FormData(container.querySelector("form")!);
  expect(form.get("issuer")).toBe("EQNR");
  expect(form.get("important")).toBe("1");
});

it("keeps the important view and filters when moving to older messages", async () => {
  mocks.query = new URLSearchParams("important=1&q=contract&issuer=TEST");
  mocks.getFeed.mockResolvedValue({
    items: [item(1, { importance: "viktig" })],
    nextCursor: "2026-09-06T08:00:00Z",
    nextCursorId: 42,
  });
  const page = await RefreshPage({
    searchParams: Promise.resolve(Object.fromEntries(mocks.query)),
  });
  await act(() => root.render(page));
  expect(buttons("Viktige")[0].getAttribute("aria-pressed")).toBe("true");
  const older = Array.from(container.querySelectorAll("a")).find(
    (link) => link.textContent === "Eldre meldinger",
  )!;
  const nextQuery = new URL(older.href).searchParams;
  expect(nextQuery.get("important")).toBe("1");
  expect(nextQuery.get("q")).toBe("contract");
  expect(nextQuery.get("issuer")).toBe("TEST");
  mocks.query = nextQuery;
  await act(() =>
    root.render(
      <RefreshFeed
        key="older-page"
        initialItems={[item(2, { importance: "viktig" })]}
        mutedCategories={[]}
        filtered
      />,
    ),
  );
  expect(buttons("Viktige")[0].getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelectorAll("article")).toHaveLength(1);
});

function liveItem(next: FeedItem) {
  vi.mocked(useFeedStreamSubscription).mock.calls.at(-1)![0].onItem?.(next);
}

it("automatically inserts live notices without replacing the focused editor or its edits", async () => {
  await act(() =>
    root.render(
      <RefreshFeed
        initialItems={[item(1)]}
        mutedCategories={[]}
        filtered={false}
      />,
    ),
  );
  const editor = container.querySelector(
    '[aria-label="Rediger notistekst"]',
  ) as HTMLElement;
  await act(() => {
    editor.focus();
    editor.innerHTML = "<p>Keep my current edit.</p>";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => liveItem(item(2)));
  await act(() => liveItem(item(2)));
  expect(
    Array.from(container.querySelectorAll("article")).map((card) => card.id),
  ).toEqual(["notice-2", "notice-1"]);
  expect(
    container.querySelector('#notice-1 [aria-label="Rediger notistekst"]'),
  ).toBe(editor);
  expect(document.activeElement).toBe(editor);
  expect(editor.textContent).toBe("Keep my current edit.");
  expect(container.textContent).not.toMatch(/ny melding|nye meldinger/);
  expect(window.scrollTo).not.toHaveBeenCalled();
  await act(() =>
    liveItem(
      item(1, {
        rewriteId: "updated",
        contentHash: "updated",
        publicationRevision: 2,
        title: "Regenerated title",
      }),
    ),
  );
  expect(editor.textContent).toBe("Keep my current edit.");
  expect(container.querySelector("#notice-1")?.textContent).toContain(
    "Ny versjon klar",
  );
});

it("keeps a scrolled card at the same viewport position when a notice arrives", async () => {
  await act(() =>
    root.render(
      <RefreshFeed
        initialItems={[item(1)]}
        mutedCategories={[]}
        filtered={false}
      />,
    ),
  );
  vi.spyOn(window, "scrollY", "get").mockReturnValue(400);
  const card = container.querySelector("#notice-1")!;
  vi.spyOn(card, "getBoundingClientRect").mockImplementation(() => {
    const top = container.querySelector("#notice-2") ? 140 : -40;
    return { top, bottom: top + 300, height: 300 } as DOMRect;
  });
  await act(() => liveItem(item(2)));
  expect(window.scrollTo).toHaveBeenCalledWith({
    top: 580,
    behavior: "instant",
  });
});

it("automatically merges matching server refreshes and excludes muted notices", async () => {
  const renderFeed = (items: FeedItem[], filtered = true) =>
    root.render(
      <RefreshFeed
        initialItems={items}
        mutedCategories={["HIDDEN"]}
        filtered={filtered}
      />,
    );
  await act(() => renderFeed([item(1)]));
  await act(() => liveItem(item(2)));
  expect(container.querySelector("#notice-2")).toBeNull();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  expect(mocks.refresh).toHaveBeenCalled();
  await act(() => renderFeed([item(2), item(1)]));
  expect(container.querySelector("#notice-2")).not.toBeNull();
  expect(container.textContent).not.toMatch(/ny melding|nye meldinger/);
  await act(() => renderFeed([item(2), item(1)], false));
  await act(() => liveItem(item(3, { categories: ["HIDDEN"] })));
  expect(container.querySelector("#notice-3")).toBeNull();
});

it("uses legacy source dimming without generation badges and leaves processing notices visible", async () => {
  const source = { isFinal: false, rewriteId: null };
  await act(() =>
    root.render(
      <RefreshFeed
        initialItems={[
          item(1),
          item(2, { ...source, notGenerated: true }),
          item(3, { ...source, processing: true }),
          item(4, { ...source, failed: true }),
          item(5, {
            publicationKind: "fast",
            rewriteId: "fast:5",
            regenerating: true,
          }),
          item(6, { regenerating: true }),
          item(7, { ...source, skipped: true }),
        ]}
        mutedCategories={[]}
        filtered={false}
      />,
    ),
  );
  for (const id of [1, 5, 6]) {
    const card = container.querySelector(`#notice-${id}`)!;
    expect(card.getAttribute("data-generation-state")).toBe("generated");
    expect(card.classList.contains(styles.sourceOnly)).toBe(false);
    expect(
      card.querySelector('[aria-label="Rediger notistekst"]'),
    ).not.toBeNull();
  }
  for (const id of [2, 3, 4, 7]) {
    const card = container.querySelector(`#notice-${id}`)!;
    expect(card.getAttribute("data-generation-state")).toBe("not-generated");
    expect(card.classList.contains(styles.sourceOnly)).toBe(id !== 3);
    expect(card.querySelector('[aria-label="Rediger notistekst"]')).toBeNull();
  }
  expect(container.querySelector("#notice-5")?.textContent).not.toContain(
    "Førsteutkast",
  );
  expect(
    Array.from(container.querySelectorAll("article"))
      .map((card) => card.textContent)
      .join(" "),
  ).not.toMatch(/Generert|Ikke generert|Oppdateres automatisk/);
});

const setValue = (field: HTMLTextAreaElement, value: string) => {
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
};
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
const card = (id: number) =>
  container.querySelector(`#notice-${id}`) as HTMLElement;
const renderCard = (current: FeedItem, key = "card") =>
  act(async () => {
    root.render(
      <RefreshCard
        key={key}
        entry={{ current, latest: current }}
        onSelect={vi.fn()}
        onVersion={vi.fn()}
      />,
    );
  });

it("preserves edited DOM and full dateline across original and comparison views", async () => {
  await renderCard(item(1));
  const editor = container.querySelector(
    '[aria-label="Rediger notistekst"]',
  ) as HTMLElement;
  await act(() => {
    editor.innerHTML = "<p>Min redigerte tekst.</p>";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const dateline = container.querySelector(".editableTitleRow + a")!;
  expect(dateline.textContent).toContain("Test ASA (TEST)");
  expect(dateline.textContent).toContain("Innsideinformasjon");
  expect(dateline.getAttribute("href")).toBe(
    "https://newsweb.oslobors.no/message/1",
  );
  await act(async () => { buttons("Original")[0].click(); });
  expect(editor.closest("[hidden]")).not.toBeNull();
  expect(container.querySelector("aside")?.hidden).toBe(false);
  await act(async () => { buttons("Sammenlign")[0].click(); });
  expect(editor.closest("[hidden]")).toBeNull();
  expect(container.querySelector('[aria-label="Rediger notistekst"]')).toBe(
    editor,
  );
  expect(editor.textContent).toBe("Min redigerte tekst.");
  expect(container.querySelector('[role="separator"]')).toBeNull();
  expect(container.textContent).not.toMatch(/A−|A\+|Utvid|Tilbake til feed/);
});
it("opens title suggestions at the headline and sends the visible body without hover editing", async () => {
  await renderCard(item(1));
  const editor = container.querySelector(
    '[aria-label="Rediger notistekst"]',
  ) as HTMLElement;
  await act(() => {
    editor.innerHTML = "<p>En ny redigert ingress.</p>";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const trigger = container.querySelector(
    ".titleSuggestBtn",
  ) as HTMLButtonElement;
  await act(() => trigger.click());
  expect(container.querySelector("dialog[open]")).toBeNull();
  expect(
    container.querySelector(".editableTitleRow .titleSuggestDropdown")
      ?.textContent,
  ).toContain("Et konkret tittelforslag");
  const call = vi
    .mocked(fetch)
    .mock.calls.find(([url]) => String(url).includes("/suggest-titles"))!;
  expect(JSON.parse(call[1]?.body as string).baseSnapshot).toMatchObject({
    rewriteId: "rewrite-1",
    contentHash: "hash-1",
    body: "En ny redigert ingress.",
  });
  const choice = buttons("Et konkret tittelforslag")[0];
  const heading = container.querySelector("h2")!;
  await act(() =>
    choice.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
  );
  expect(heading.textContent).toBe("Headline 1");
  await act(() => choice.click());
  expect(heading.textContent).toBe("Et konkret tittelforslag");
  expect(editor.textContent).toBe("En ny redigert ingress.");
});
it("retains instructions across collapse, remount and version changes", async () => {
  await renderCard(item(1));
  await act(() => buttons("Endre")[0].click());
  const field = container.querySelector("textarea")!;
  await act(() => setValue(field, "Behold denne instruksjonen"));
  await act(() => buttons("Endre")[0].click());
  expect(container.querySelector("textarea")).toBe(field);
  await renderCard(
    item(1, { rewriteId: "second", contentHash: "second", rewriteVersion: 2 }),
    "second",
  );
  await act(() => buttons("Endre")[0].click());
  expect(container.querySelector("textarea")?.value).toBe("");
  await renderCard(item(1), "back");
  await act(() => buttons("Endre")[0].click());
  expect(container.querySelector("textarea")?.value).toBe(
    "Behold denne instruksjonen",
  );
});
it("custom length Enter applies the value without submitting generation", async () => {
  await renderCard(item(1));
  await act(() => buttons("Endre")[0].click());
  await act(() =>
    (
      container.querySelector(
        '[aria-label="Maksimal lengde, 1000 tegn"]',
      ) as HTMLButtonElement
    ).click(),
  );
  await act(() => buttons("Annet …")[0].click());
  const input = container.querySelector(
    "input[type=number]",
  ) as HTMLInputElement;
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "1234");
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
    container.querySelector('[aria-label="Maksimal lengde, 1234 tegn"]'),
  ).not.toBeNull();
  expect(
    vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith("/generate")),
  ).toHaveLength(0);
  expect(container.querySelector("input[type=number]")).toBeNull();
});
it("Escape dismisses the custom length before the composer", async () => {
  await renderCard(item(1));
  await act(() => buttons("Endre")[0].click());
  await act(() =>
    (
      container.querySelector(
        '[aria-label="Maksimal lengde, 1000 tegn"]',
      ) as HTMLButtonElement
    ).click(),
  );
  await act(() => buttons("Annet …")[0].click());
  await act(() =>
    container
      .querySelector("input[type=number]")!
      .dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
  );
  expect(buttons("Endre")[0].getAttribute("aria-expanded")).toBe("true");
  await act(() =>
    container
      .querySelector("textarea")!
      .dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
  );
  expect(buttons("Endre")[0].getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(buttons("Endre")[0]);
});
it("keeps PDF source text available with lazy loading and retry", async () => {
  await renderCard(item(1, { hasAttachments: true }));
  expect(mocks.getNoticeModelSource).not.toHaveBeenCalled();
  await act(async () => { buttons("Original")[0].click(); });
  mocks.getNoticeModelSource.mockRejectedValueOnce(new Error("offline"));
  await act(async () => { buttons("PDF-tekst")[0].click(); });
  expect(container.querySelector("aside")?.textContent).toContain(
    "Kunne ikke hente PDF-tekst",
  );
  mocks.getNoticeModelSource.mockResolvedValue({
    text: "[PDF page 1]\nKildetekst",
    pageCount: 1,
    rewriteId: "rewrite-1",
    attachmentId: 1,
  });
  await act(async () => { buttons("Prøv igjen")[0].click(); });
  expect(container.querySelector("aside")?.textContent).toContain("Kildetekst");
});
it("offers generation without editing on failed source cards", async () => {
  await renderCard(
    item(2, {
      isFinal: false,
      rewriteId: null,
      failed: true,
      notGenerated: true,
    }),
  );
  expect(buttons("Generer")).toHaveLength(1);
  expect(buttons("Endre")).toHaveLength(0);
  expect(container.querySelector('[aria-label="Instruksjon, lenke eller kildetekst"]')).toBeNull();
});
it("retains generation and safe retries from source-only notices", async () => {
  await renderCard(
    item(2, { isFinal: false, rewriteId: null, notGenerated: true }),
  );
  expect(buttons("Generer")).toHaveLength(1);
  expect(buttons("Endre")).toHaveLength(0);
  expect(container.querySelector('[aria-label="Instruksjon, lenke eller kildetekst"]')).toBeNull();
  await act(() => buttons("Generer")[0].click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Serveren støtter ikke");
  await act(() => buttons("Generer")[0].click());
  const requests = vi.mocked(fetch).mock.calls
    .filter(([url]) => String(url) === "/api/notice/2/generate")
    .map(([, options]) => JSON.parse(String(options?.body)));
  expect(requests).toHaveLength(2);
  expect(requests[1].clientRequestId).toBe(requests[0].clientRequestId);
});
it("uses the remembered character limit on a new composer", async () => {
  localStorage.setItem(
    "newsweb:next-prefs",
    JSON.stringify({ noticeChars: 1300 }),
  );
  await renderCard(item(1));
  await act(() => buttons("Endre")[0].click());
  expect(
    container.querySelector('[aria-label="Maksimal lengde, 1300 tegn"]'),
  ).not.toBeNull();
});
it("keeps a failed URL visible and blocks generation until the source is removed", async () => {
  vi.mocked(fetch).mockImplementation(
    async (url) =>
      ({
        ok: true,
        json: async () =>
          String(url).endsWith("/materials/url")
            ? {
                id: "url-1",
                title: "example.com",
                kind: "url",
                url: "https://example.com",
                status: "failed",
                enabled: true,
                errorText: "Kunne ikke lese nettsiden.",
              }
            : String(url).endsWith("/materials")
              ? { materials: [] }
              : {
                  queuedGeneration: true,
                  cancellation: true,
                  urlMaterials: true,
                },
      }) as Response,
  );
  await renderCard(item(1));
  await act(() => buttons("Endre")[0].click());
  const field = container.querySelector("textarea")!;
  await act(() => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: () => "https://example.com" },
    });
    field.dispatchEvent(event);
  });
  expect(container.textContent).toContain("Kunne ikke lese nettsiden.");
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
  expect(
    (
      container.querySelector(
        '[aria-label="Lag ny versjon"]',
      ) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});
it("keeps the legacy feed form unchanged", async () => {
  await act(() =>
    root.render(<InstructionInput messageId={1} presentation="legacy" />),
  );
  await flush();
  await act(() => buttons("+ Materiale")[0].click());
  expect(buttons("PDF")).toHaveLength(1);
  expect(buttons("Newsweb")).toHaveLength(1);
  expect(buttons("Tekst")).toHaveLength(1);
  expect(container.querySelector('[aria-label="Ny kilde"]')).toBeNull();
  expect(buttons("Notis")).toHaveLength(1);
  expect(buttons("Utvidet")).toHaveLength(1);
  expect(container.querySelector('[aria-label="Maks antall tegn"]')).toBeNull();
  expect(buttons("Grundig")).toHaveLength(0);
  expect(container.querySelector(".xhighToggle")).not.toBeNull();
  expect(buttons("Regenerer notis")).toHaveLength(1);
});

function publishedVersion(current: FeedItem) {
  return {
    rewriteId: current.rewriteId,
    version: current.rewriteVersion,
    contentHash: current.contentHash,
    generatedAt: current.finalizedAt,
    userInstruction: null,
    isFinal: true,
    rewrite: {
      title: current.title,
      lead: current.lead,
      body: current.body,
      key_facts: [],
      negative_or_surprising: [],
      source_limitations: [],
      confidence: "high",
      importance: "medium",
    },
  };
}

it("does not offer Vis første when version 2 is the only published version", async () => {
  const current = item(1, { rewriteVersion: 2 });
  mocks.getNotice.mockResolvedValue({ source: {}, rewrites: [publishedVersion(current)] });
  await renderCard(current);
  expect(mocks.getNotice).toHaveBeenCalledWith(null, 1, "v2");
  expect(buttons("Vis første")).toHaveLength(0);
  expect(container.querySelector('[aria-label="Velg blant alle versjoner"]')).toBeNull();
});

it("switches between the earliest available published version and the latest", async () => {
  const latest = item(1, { rewriteId: "version-3", rewriteVersion: 3, title: "Latest title" });
  const first = item(1, { rewriteId: "version-2", rewriteVersion: 2, title: "First available title" });
  mocks.getNotice.mockResolvedValue({ source: {}, rewrites: [publishedVersion(first), publishedVersion(latest)] });
  await act(async () => { root.render(<RefreshFeed initialItems={[latest]} mutedCategories={[]} filtered={false} />); });
  await act(async () => { buttons("Vis første")[0].click(); });
  expect(container.querySelector(".editableTitle")?.textContent).toBe("First available title");
  expect(buttons("Vis nyeste")).toHaveLength(1);
  await act(async () => { buttons("Vis nyeste")[0].click(); });
  expect(container.querySelector(".editableTitle")?.textContent).toBe("Latest title");
});

it("makes unavailable version history retryable instead of offering a no-op", async () => {
  const current = item(1, { rewriteVersion: 2 });
  mocks.getNotice.mockRejectedValueOnce(new Error("offline"));
  await renderCard(current);
  expect(buttons("Vis første")).toHaveLength(0);
  expect(buttons("Versjoner")).toHaveLength(1);
  mocks.getNotice.mockRejectedValueOnce(new Error("offline"));
  await act(async () => { buttons("Versjoner")[0].click(); });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Kunne ikke hente versjoner");
  mocks.getNotice.mockResolvedValue({ source: {}, rewrites: [publishedVersion(current)] });
  await act(async () => { buttons("Prøv igjen")[0].click(); });
  expect(buttons("Vis første")).toHaveLength(0);
  expect(buttons("Versjoner")).toHaveLength(0);
});

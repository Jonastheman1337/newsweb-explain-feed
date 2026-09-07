// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FeedItem } from "@newsweb/shared";
import { RefreshCard } from "./refresh-card";
import { RefreshFeed } from "./refresh-feed";
import { RefreshFilters } from "./filters";
import RefreshPage from "../../app/(refresh)/next/page";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(), refresh: vi.fn(), query: new URLSearchParams(),
  getFeed: vi.fn(), getNotice: vi.fn()
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
  useSearchParams: () => mocks.query,
  redirect: vi.fn(), notFound: vi.fn()
}));
vi.mock("../../lib/session", () => ({ getSessionToken: async () => "fixture-session" }));
vi.mock("../../lib/api", () => ({
  getFeed: mocks.getFeed, getNotice: mocks.getNotice,
  getMetaFilters: async () => ({ markets: [], categories: [], issuers: [] }),
  getMutedCategories: async () => ({ mutedCategories: ["RENTEREGULERING"] }),
  isApiAuthError: () => false
}));
vi.mock("../../lib/editorial-telemetry", () => ({
  useEditorialTelemetry: () => ({ logEvent: vi.fn().mockResolvedValue(undefined), buildTelemetry: () => ({}) })
}));
vi.mock("../feed-stream-provider", () => ({
  useFeedStreamSubscription: vi.fn(),
  useFeedConnection: () => ({ state: "connected", reconnect: vi.fn() })
}));

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ titles: ["Et konkret tittelforslag"], materials: [] }) }));
  vi.stubEnv("UI_V2_ENABLED", "true");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  localStorage.clear();
  sessionStorage.clear();
  mocks.query = new URLSearchParams();
  mocks.getNotice.mockResolvedValue({ source: { title: "Original source", bodyText: "Source text", attachments: [] }, rewrites: [] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function item(id: number, overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    messageId: id, publishedAt: "2026-09-07T08:00:00Z", rewriteId: `rewrite-${id}`,
    rewriteVersion: 1, publicationRevision: 1, contentHash: `hash-${id}`,
    isFinal: true, finalizedAt: "2026-09-07T08:00:00Z",
    title: `Headline ${id}`, lead: "A checked lead", body: ["A checked paragraph"],
    keyFacts: [], negativeOrSurprising: [], sourceLimitations: [],
    importance: "medium", confidence: "high", visibilityStatus: "published",
    issuerName: "Test ASA", issuerSign: "TEST", categories: ["INNSIDEINFORMASJON", "FLAGGING"],
    hasAttachments: false, attachments: [], sourceTitle: "Source title", sourceBodyText: "Source body",
    notGenerated: false, skipped: false, failed: false, processing: false, regenerating: false,
    ...overrides
  };
}
const buttons = (text: string) => Array.from(container.querySelectorAll("button")).filter((button) => button.textContent?.trim() === text);

it("keeps the full source dateline and edited DOM while opening and closing inline sources", async () => {
  await act(() => root.render(<RefreshFeed initialItems={[item(1), item(2)]} mutedCategories={[]} filtered={false} />));
  const firstCard = container.querySelector("#notice-1")!;
  const dateline = firstCard.querySelector('a[href="https://newsweb.oslobors.no/message/1"]')!;
  expect(dateline.textContent).toBe("7. sep. 2026, 10:00 | Test ASA (TEST) | Innsideinformasjon, Flagging");
  const editor = firstCard.querySelector('[aria-label="Rediger notistekst"]') as HTMLElement;
  await act(() => {
    editor.innerHTML = "<p>My checked edit stays here.</p>";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    (firstCard.querySelector("[data-source-trigger]") as HTMLButtonElement).click();
  });
  expect(firstCard.querySelector('[aria-label="Rediger notistekst"]')).toBe(editor);
  expect(editor.textContent).toBe("My checked edit stays here.");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
  expect(container.querySelectorAll("article")).toHaveLength(2);
  expect(firstCard.querySelector("aside")?.hidden).toBe(false);
  expect(firstCard.querySelector("[data-source-trigger]")?.textContent?.trim()).toBe("Lukk kilder");
  expect(window.scrollTo).not.toHaveBeenCalled();
  await act(() => (firstCard.querySelector('[aria-label="Lukk kildepanelet"]') as HTMLButtonElement).click());
  expect(firstCard.querySelector("aside")?.hidden).toBe(true);
  expect(firstCard.querySelector('[aria-label="Rediger notistekst"]')).toBe(editor);
  expect(editor.textContent).toBe("My checked edit stays here.");
});

it("offers title suggestions directly at the headline in one click", async () => {
  await act(() => root.render(<RefreshCard entry={{ current: item(1), latest: item(1) }} onSelect={vi.fn()} onVersion={vi.fn()} />));
  const trigger = container.querySelector('button[title="Foreslå titler"]') as HTMLButtonElement;
  expect(trigger).not.toBeNull();
  expect(trigger.closest("[data-actions-menu]")).toBeNull();
  await act(() => trigger.click());
  expect(container.querySelector("dialog[open]")?.textContent).toContain("Et konkret tittelforslag");
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("suggest-titles"), expect.any(Object));
});

it("gives a failed source card one retry and a separate instruction action", async () => {
  const failed = item(3, { isFinal: false, rewriteId: null, failed: true });
  await act(() => root.render(<RefreshCard entry={{ current: failed, latest: failed }} onSelect={vi.fn()} onVersion={vi.fn()} />));
  expect(buttons("Prøv igjen")).toHaveLength(1);
  expect(buttons("Tilpass instruksjon")).toHaveLength(1);
  expect(container.querySelector('a[href="https://newsweb.oslobors.no/message/3"]')?.textContent).toContain(" | Innsideinformasjon, Flagging");
});

it("searches an issuer by ticker and preserves the important view in the submitted form", async () => {
  await act(() => root.render(<RefreshFilters params={{ important: "1" }} markets={[]} categories={[]} mutedCategories={[]} connection={null} issuers={[
    { value: "EQNR", label: "Equinor ASA (EQNR)" }, { value: "DNB", label: "DNB Bank ASA (DNB)" }
  ]} />));
  await act(() => container.querySelector("summary")!.click());
  await act(() => (Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Alle utstedere"))!).click());
  const search = container.querySelector('[placeholder="Søk etter selskap eller ticker"]') as HTMLInputElement;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "eqnr");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.querySelector('[role="listbox"]')?.textContent).toContain("Equinor ASA (EQNR)");
  expect(container.querySelector('[role="listbox"]')?.textContent).not.toContain("DNB Bank");
  await act(() => buttons("Equinor ASA (EQNR)")[0].click());
  const form = new FormData(container.querySelector("form")!);
  expect(form.get("issuer")).toBe("EQNR");
  expect(form.get("important")).toBe("1");
});

it("keeps the important view and filters when moving to older messages", async () => {
  mocks.query = new URLSearchParams("important=1&q=contract&issuer=TEST");
  mocks.getFeed.mockResolvedValue({ items: [item(1, { importance: "viktig" })], nextCursor: "2026-09-06T08:00:00Z", nextCursorId: 42 });
  const page = await RefreshPage({ searchParams: Promise.resolve(Object.fromEntries(mocks.query)) });
  await act(() => root.render(page));
  expect(buttons("Viktige")[0].getAttribute("aria-pressed")).toBe("true");
  const older = Array.from(container.querySelectorAll("a")).find((link) => link.textContent === "Eldre meldinger")!;
  const nextQuery = new URL(older.href).searchParams;
  expect(nextQuery.get("important")).toBe("1");
  expect(nextQuery.get("q")).toBe("contract");
  expect(nextQuery.get("issuer")).toBe("TEST");
  mocks.query = nextQuery;
  await act(() => root.render(<RefreshFeed key="older-page" initialItems={[item(2, { importance: "viktig" })]} mutedCategories={[]} filtered />));
  expect(buttons("Viktige")[0].getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelectorAll("article")).toHaveLength(1);
});

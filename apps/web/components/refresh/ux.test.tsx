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
import styles from "./refresh.module.css";
import RefreshPage from "../../app/(refresh)/next/page";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(), refresh: vi.fn(), query: new URLSearchParams(),
  getFeed: vi.fn(), getNotice: vi.fn(), getNoticeModelSource: vi.fn()
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
  useSearchParams: () => mocks.query,
  redirect: vi.fn(), notFound: vi.fn()
}));
vi.mock("../../lib/session", () => ({ getSessionToken: async () => "fixture-session" }));
vi.mock("../../lib/api", () => ({
  getFeed: mocks.getFeed, getNotice: mocks.getNotice, getNoticeModelSource: mocks.getNoticeModelSource,
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
  mocks.getNoticeModelSource.mockResolvedValue({ rewriteId: null, text: null, pageCount: null, attachmentId: null });
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

function liveItem(next: FeedItem) {
  vi.mocked(useFeedStreamSubscription).mock.calls.at(-1)![0].onItem?.(next);
}

it("automatically inserts live notices without replacing the focused editor or its edits", async () => {
  await act(() => root.render(<RefreshFeed initialItems={[item(1)]} mutedCategories={[]} filtered={false} />));
  const editor = container.querySelector('[aria-label="Rediger notistekst"]') as HTMLElement;
  await act(() => {
    editor.focus();
    editor.innerHTML = "<p>Keep my current edit.</p>";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => liveItem(item(2)));
  await act(() => liveItem(item(2)));
  expect(Array.from(container.querySelectorAll("article")).map((card) => card.id)).toEqual(["notice-2", "notice-1"]);
  expect(container.querySelector('#notice-1 [aria-label="Rediger notistekst"]')).toBe(editor);
  expect(document.activeElement).toBe(editor);
  expect(editor.textContent).toBe("Keep my current edit.");
  expect(container.textContent).not.toMatch(/ny melding|nye meldinger/);
  expect(window.scrollTo).not.toHaveBeenCalled();
  await act(() => liveItem(item(1, { rewriteId: "updated", contentHash: "updated", publicationRevision: 2, title: "Regenerated title" })));
  expect(editor.textContent).toBe("Keep my current edit.");
  expect(container.querySelector("#notice-1")?.textContent).toContain("Ny versjon klar");
});

it("keeps a scrolled card at the same viewport position when a notice arrives", async () => {
  await act(() => root.render(<RefreshFeed initialItems={[item(1)]} mutedCategories={[]} filtered={false} />));
  vi.spyOn(window, "scrollY", "get").mockReturnValue(400);
  const card = container.querySelector("#notice-1")!;
  vi.spyOn(card, "getBoundingClientRect").mockImplementation(() => {
    const top = container.querySelector("#notice-2") ? 140 : -40;
    return { top, bottom: top + 300, height: 300 } as DOMRect;
  });
  await act(() => liveItem(item(2)));
  expect(window.scrollTo).toHaveBeenCalledWith({ top: 580, behavior: "instant" });
});

it("automatically merges matching server refreshes and excludes muted notices", async () => {
  const renderFeed = (items: FeedItem[], filtered = true) =>
    root.render(<RefreshFeed initialItems={items} mutedCategories={["HIDDEN"]} filtered={filtered} />);
  await act(() => renderFeed([item(1)]));
  await act(() => liveItem(item(2)));
  expect(container.querySelector("#notice-2")).toBeNull();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
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
  await act(() => root.render(<RefreshFeed initialItems={[
    item(1),
    item(2, { ...source, notGenerated: true }),
    item(3, { ...source, processing: true }),
    item(4, { ...source, failed: true }),
    item(5, { publicationKind: "fast", rewriteId: "fast:5", regenerating: true }),
    item(6, { regenerating: true }),
    item(7, { ...source, skipped: true })
  ]} mutedCategories={[]} filtered={false} />));
  for (const id of [1, 5, 6]) {
    const card = container.querySelector(`#notice-${id}`)!;
    expect(card.getAttribute("data-generation-state")).toBe("generated");
    expect(card.classList.contains(styles.sourceOnly)).toBe(false);
    expect(card.querySelector('[aria-label="Rediger notistekst"]')).not.toBeNull();
  }
  for (const id of [2, 3, 4, 7]) {
    const card = container.querySelector(`#notice-${id}`)!;
    expect(card.getAttribute("data-generation-state")).toBe("not-generated");
    expect(card.classList.contains(styles.sourceOnly)).toBe(id !== 3);
    expect(card.querySelector('[aria-label="Rediger notistekst"]')).toBeNull();
  }
  expect(container.querySelector("#notice-5")?.textContent).toContain("Førsteutkast");
  expect(Array.from(container.querySelectorAll("article")).map((card) => card.textContent).join(" ")).not.toMatch(/Generert|Ikke generert|Oppdateres automatisk/);
});

const setValue = (field: HTMLTextAreaElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
};
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const card = (id: number) => container.querySelector(`#notice-${id}`) as HTMLElement;
const renderCard = (current: FeedItem, key = "card") =>
  act(() => root.render(<RefreshCard key={key} entry={{ current, latest: current }} onSelect={vi.fn()} onVersion={vi.fn()} />));

it("reveals the instruction form inline without opening sources and drops the menu duplicates", async () => {
  await renderCard(item(1));
  expect(buttons("Lag ny versjon")).toHaveLength(0);
  expect(buttons("Åpne arbeidsvisning")).toHaveLength(0);
  const trigger = buttons("Ny versjon")[0];
  await act(() => trigger.click());
  expect(container.querySelector("aside")).toBeNull();
  const form = container.querySelector("[data-compose]") as HTMLElement;
  expect(form.hidden).toBe(false);
  expect(document.activeElement).toBe(form.querySelector("textarea"));
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(buttons("Lag versjon")).toHaveLength(1);
  await act(() => trigger.click());
  expect(form.hidden).toBe(true);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger);
});

it("keeps typed instruction text while the form is hidden", async () => {
  await renderCard(item(1));
  await act(() => buttons("Ny versjon")[0].click());
  const textarea = container.querySelector("[data-compose] textarea") as HTMLTextAreaElement;
  await act(() => setValue(textarea, "Kortere ingress"));
  await act(() => buttons("Ny versjon")[0].click());
  await act(() => buttons("Ny versjon")[0].click());
  expect(container.querySelector("[data-compose] textarea")).toBe(textarea);
  expect(textarea.value).toBe("Kortere ingress");
});

it("closes the form before the panel on Escape and returns focus to the trigger", async () => {
  await renderCard(item(1));
  await act(() => (container.querySelector("[data-source-trigger]") as HTMLButtonElement).click());
  await act(() => buttons("Ny versjon")[0].click());
  const textarea = container.querySelector("[data-compose] textarea") as HTMLTextAreaElement;
  await act(() => { textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect((container.querySelector("[data-compose]") as HTMLElement).hidden).toBe(true);
  expect(container.querySelector("aside")?.hidden).toBe(false);
  expect(document.activeElement).toBe(container.querySelector("[data-compose-trigger]"));
  const editor = container.querySelector('[aria-label="Rediger notistekst"]') as HTMLElement;
  await act(() => { editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(container.querySelector("aside")?.hidden).toBe(true);
  expect(document.activeElement).toBe(container.querySelector("[data-source-trigger]"));
});

it("renders the source as paragraphs with attachments in a row under the heading", async () => {
  mocks.getNotice.mockResolvedValue({
    source: { title: "Original source", bodyText: "First\n\nSecond\n \nThird", attachments: [{ id: 1, fileName: "report.pdf", fileType: "application/pdf", fileSize: 1024 }] },
    rewrites: []
  });
  await renderCard(item(1));
  await act(() => (container.querySelector("[data-source-trigger]") as HTMLButtonElement).click());
  await flush();
  expect(Array.from(container.querySelectorAll(`#sources-panel-1 .${styles.sourceBody} p`)).map((p) => p.textContent)).toEqual(["First", "Second", "Third"]);
  const heading = container.querySelector(`#sources-panel-1 .${styles.sourceHeading}`)!;
  const attachments = container.querySelector("#sources-panel-1 .attachmentLinks")!;
  const title = container.querySelector("#sources-panel-1 h3")!;
  expect(heading.compareDocumentPosition(attachments) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(attachments.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("offers PDF-tekst only for notices with attachments and loads it lazily per version", async () => {
  await renderCard(item(1));
  await act(() => (container.querySelector("[data-source-trigger]") as HTMLButtonElement).click());
  expect(buttons("PDF-tekst")).toHaveLength(0);
  const withPdf = item(2, { hasAttachments: true });
  await renderCard(withPdf, "pdf");
  await act(() => (container.querySelector("[data-source-trigger]") as HTMLButtonElement).click());
  expect(mocks.getNoticeModelSource).not.toHaveBeenCalled();
  mocks.getNoticeModelSource.mockRejectedValueOnce(new Error("down"));
  await act(() => buttons("PDF-tekst")[0].click());
  await flush();
  expect(mocks.getNoticeModelSource).toHaveBeenCalledWith(2, "rewrite-2");
  const panel = container.querySelector("#pdf-panel-2") as HTMLElement;
  expect(panel.hidden).toBe(false);
  expect(panel.querySelector('[role="alert"]')?.textContent).toContain("Kunne ikke hente PDF-tekst");
  mocks.getNoticeModelSource.mockResolvedValueOnce({ rewriteId: "rewrite-2", text: "[PDF page 1]\nIntro\n\n[PDF page 2]\nMore", pageCount: 2, attachmentId: 1 });
  await act(() => buttons("Prøv igjen")[0].click());
  await flush();
  expect(Array.from(panel.querySelectorAll("h4")).map((heading) => heading.textContent)).toEqual(["Side 1", "Side 2"]);
  expect(Array.from(panel.querySelectorAll("p")).map((paragraph) => paragraph.textContent)).toEqual(["Intro", "More"]);
  expect(panel.textContent).toContain("PDF · 2 sider");
  mocks.getNoticeModelSource.mockResolvedValueOnce({ rewriteId: "rewrite-2b", text: null, pageCount: null, attachmentId: null });
  await renderCard(item(2, { hasAttachments: true, rewriteId: "rewrite-2b", contentHash: "hash-2b", rewriteVersion: 2 }), "pdf");
  await flush();
  expect(mocks.getNoticeModelSource).toHaveBeenLastCalledWith(2, "rewrite-2b");
  expect(panel.textContent).toContain("Ingen PDF-tekst lagret for denne versjonen");
});

it("gives the wider column to the longer text unless a width is stored", async () => {
  const longSource = item(1, { sourceBodyText: "x".repeat(600) });
  await act(() => root.render(<RefreshFeed initialItems={[longSource, item(2)]} mutedCategories={[]} filtered={false} />));
  expect(card(1).style.getPropertyValue("--source-ratio")).toBe("0.57");
  expect(card(2).style.getPropertyValue("--source-ratio")).toBe("0.43");
  localStorage.setItem("newsweb:next-prefs", JSON.stringify({ sourceRatio: 0.6 }));
  await act(() => root.render(<RefreshFeed key="stored" initialItems={[longSource, item(2)]} mutedCategories={[]} filtered={false} />));
  expect(card(1).style.getPropertyValue("--source-ratio")).toBe("0.6");
  expect(card(2).style.getPropertyValue("--source-ratio")).toBe("0.6");
});

it("resizes the split by keyboard and pointer and remembers the width", async () => {
  await renderCard(item(1));
  await act(() => (container.querySelector("[data-source-trigger]") as HTMLButtonElement).click());
  const handle = container.querySelector('[role="separator"]') as HTMLElement;
  const article = container.querySelector("article") as HTMLElement;
  expect(handle.getAttribute("aria-valuenow")).toBe("43");
  await act(() => { handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); });
  expect(article.style.getPropertyValue("--source-ratio")).toBe("0.45");
  expect(handle.getAttribute("aria-valuenow")).toBe("45");
  expect(JSON.parse(localStorage.getItem("newsweb:next-prefs")!).sourceRatio).toBe(0.45);
  vi.spyOn(article, "getBoundingClientRect").mockReturnValue({ left: 0, width: 1000 } as DOMRect);
  await act(() => { handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 550 })); });
  expect(article.hasAttribute("data-dragging")).toBe(true);
  await act(() => { handle.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 400 })); });
  expect(article.style.getPropertyValue("--source-ratio")).toBe("0.6");
  await act(() => { handle.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 400 })); });
  expect(article.hasAttribute("data-dragging")).toBe(false);
  expect(JSON.parse(localStorage.getItem("newsweb:next-prefs")!).sourceRatio).toBe(0.6);
  await act(() => { handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
  expect(article.style.getPropertyValue("--source-ratio")).toBe("0.43");
});

it("steps the source text size for every open card and stops at the largest step", async () => {
  await act(() => root.render(<RefreshFeed initialItems={[item(1), item(2)]} mutedCategories={[]} filtered={false} />));
  for (const id of [1, 2]) await act(() => (card(id).querySelector("[data-source-trigger]") as HTMLButtonElement).click());
  const bigger = card(1).querySelector('[aria-label="Større kildetekst"]') as HTMLButtonElement;
  await act(() => bigger.click());
  expect(card(1).style.getPropertyValue("--source-font")).toBe("15px");
  expect(card(2).style.getPropertyValue("--source-font")).toBe("15px");
  expect(JSON.parse(localStorage.getItem("newsweb:next-prefs")!).sourceFontPx).toBe(15);
  await act(() => bigger.click());
  expect(bigger.disabled).toBe(true);
  expect(card(2).style.getPropertyValue("--source-font")).toBe("16px");
  await act(() => (card(2).querySelector('[aria-label="Mindre kildetekst"]') as HTMLButtonElement).click());
  expect(card(1).style.getPropertyValue("--source-font")).toBe("15px");
});

it("expands to arbeidsvisning from the panel header and returns to the feed", async () => {
  await act(() => root.render(<RefreshFeed initialItems={[item(1), item(2)]} mutedCategories={[]} filtered={false} />));
  vi.spyOn(window, "scrollY", "get").mockReturnValue(400);
  await act(() => (card(1).querySelector("[data-source-trigger]") as HTMLButtonElement).click());
  expect(buttons("Utvid")).toHaveLength(1);
  const editor = card(1).querySelector('[aria-label="Rediger notistekst"]') as HTMLElement;
  await act(() => editor.focus());
  await act(() => buttons("Utvid")[0].click());
  expect(card(1).classList.contains(styles.focused)).toBe(true);
  expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
  expect((card(1).querySelector("[data-compose]") as HTMLElement).hidden).toBe(false);
  expect(document.activeElement).toBe(editor);
  const back = buttons("Tilbake til feed")[0];
  expect(back.getAttribute("aria-pressed")).toBe("true");
  await act(() => back.click());
  expect(card(1).classList.contains(styles.focused)).toBe(false);
  expect(card(1).querySelector("aside")?.hidden).toBe(false);
  expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 400, behavior: "instant" });
  await act(() => buttons("Utvid")[0].click());
  await act(() => buttons("← Feed")[0].click());
  expect(card(1).querySelector("aside")?.hidden).toBe(true);
  expect(document.activeElement).toBe(card(1).querySelector("[data-source-trigger]"));
});

it("lets a source-only notice be generated with an instruction in one step", async () => {
  await renderCard(item(2, { isFinal: false, rewriteId: null, notGenerated: true, skipped: true }));
  expect(buttons("Instruksjon")).toHaveLength(1);
  expect(buttons("Lag notis")).toHaveLength(1);
  await act(() => buttons("Instruksjon")[0].click());
  expect(document.activeElement).toBe(container.querySelector("[data-compose] textarea"));
  expect(buttons("Lag versjon")).toHaveLength(1);
  await renderCard(item(3, { isFinal: false, rewriteId: null, failed: true }), "failed");
  expect(buttons("Instruksjon")).toHaveLength(0);
  await act(() => buttons("Tilpass instruksjon")[0].click());
  expect((container.querySelector("[data-compose]") as HTMLElement).hidden).toBe(false);
});

it("adds pasted links or text as one source and sends the chosen length and reasoning", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const material = (id: string, kind: string, title: string) => ({
    id, messageId: 1, kind, title, url: null, fileName: null, mimeType: null, fileSize: null,
    extractedTextChars: 40, status: "ready", errorText: null, enabled: true, metadata: null,
    createdAt: "2026-09-08T10:00:00Z"
  });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = url.includes("/materials/newsweb") ? material("m-nw", "newsweb", "Newsweb 123456")
      : url.includes("/materials/text") ? material("m-txt", "text", "Bloomberg skriver")
      : url.endsWith("/materials") ? { materials: [] }
      : url.endsWith("/status") ? { ready: true, version: 1, generatedAt: "2026-09-08T08:00:00Z" }
      : url.endsWith("/generate") ? { jobId: "job-1", version: 2 }
      : { titles: [] };
    return { ok: true, json: async () => body } as Response;
  }));
  const setField = (field: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  };
  await renderCard(item(1));
  await act(() => buttons("Ny versjon")[0].click());
  await flush();
  expect(buttons("Utvidet")).toHaveLength(0);
  expect(Array.from(container.querySelectorAll("summary")).some((summary) => summary.textContent?.trim() === "Valg")).toBe(false);
  await act(() => buttons("+ Kilde")[0].click());
  expect(container.querySelectorAll(".materialActions")).toHaveLength(0);
  const paste = container.querySelector('[aria-label="Ny kilde"]') as HTMLTextAreaElement;
  await act(() => setField(paste, "https://newsweb.oslobors.no/message/123456"));
  await act(() => buttons("Legg til")[0].click());
  await flush();
  expect(calls.find((call) => call.url.includes("/materials/newsweb"))?.init?.body).toBe(JSON.stringify({ url: "https://newsweb.oslobors.no/message/123456" }));
  expect(paste.value).toBe("");
  await act(() => setField(paste, "Bloomberg skriver\n\nOljeprisen steg to prosent."));
  await act(() => buttons("Legg til")[0].click());
  await flush();
  expect(JSON.parse(calls.find((call) => call.url.includes("/materials/text"))!.init!.body as string)).toEqual({
    title: "Bloomberg skriver",
    text: "Bloomberg skriver\n\nOljeprisen steg to prosent."
  });
  expect(container.querySelectorAll(".materialItem")).toHaveLength(2);
  const length = container.querySelector('[aria-label="Maks antall tegn"]') as HTMLInputElement;
  expect(length.value).toBe("1000");
  await act(() => {
    setField(length, "1300");
    length.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  expect(JSON.parse(localStorage.getItem("newsweb:next-prefs")!).noticeChars).toBe(1300);
  const grundig = buttons("Grundig")[0];
  await act(() => grundig.click());
  expect(grundig.getAttribute("aria-pressed")).toBe("true");
  await act(() => buttons("Lag versjon")[0].click());
  await flush();
  const generate = calls.find((call) => call.url.endsWith("/generate"));
  expect(JSON.parse(generate!.init!.body as string)).toMatchObject({
    maxVisibleArticleChars: 1300,
    reasoningEffortOverride: "xhigh",
    selectedMaterialIds: ["m-nw", "m-txt"]
  });
  expect(grundig.getAttribute("aria-pressed")).toBe("false");
});

it("starts a new card from the remembered length", async () => {
  localStorage.setItem("newsweb:next-prefs", JSON.stringify({ noticeChars: 1800 }));
  await renderCard(item(1));
  await act(() => buttons("Ny versjon")[0].click());
  expect((container.querySelector('[aria-label="Maks antall tegn"]') as HTMLInputElement).value).toBe("1800");
});

it("keeps the legacy feed form unchanged", async () => {
  await act(() => root.render(<InstructionInput messageId={1} presentation="legacy" />));
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

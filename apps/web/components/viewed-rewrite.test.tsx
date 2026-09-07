// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedItem, RewriteOutput } from "@newsweb/shared";
import { RewriteTabs } from "./rewrite-tabs";
import { NoticeCard } from "./notice-card";

vi.mock("next/navigation", () => ({
  usePathname: () => "/feed",
  useSearchParams: () => new URLSearchParams()
}));
vi.mock("../lib/editorial-telemetry", () => ({
  useEditorialTelemetry: () => ({ logEvent: vi.fn().mockResolvedValue(undefined) })
}));
vi.mock("./editable-rewrite", () => ({
  EditableRewrite: (props: {
    originalTitle: string; originalBody: string; activeVersion: number;
    rewriteId: string; contentHash: string;
  }) => <div data-version={props.activeVersion} data-rewrite-id={props.rewriteId}
    data-content-hash={props.contentHash}>{props.originalTitle}|{props.originalBody}</div>
}));
vi.mock("./instruction-input", () => ({ InstructionInput: () => null }));
vi.mock("./generate-button", () => ({ GenerateButton: () => null }));
vi.mock("./feed-processing-indicator", () => ({ FeedProcessingIndicator: () => null }));
vi.mock("./split-view-panel", () => ({ SplitViewPanel: () => null }));

function version(number: number) {
  const rewrite: RewriteOutput = {
    title: `Version ${number} title`, lead: `Version ${number} lead`,
    body: [`Version ${number} body`], importance: "medium", confidence: "high",
    company_sentence: "", key_facts: [], negative_or_surprising: [],
    source_limitations: [], excluded_hype: [], source_spans: []
  };
  return {
    rewriteId: `rewrite-${number}`, version: number, rewrite,
    userInstruction: null, generatedAt: "2026-09-07T08:00:00.000Z",
    contentHash: `hash-${number}`, isFinal: true as const
  };
}

function feedItem(number = 3): FeedItem {
  const active = version(number);
  return {
    messageId: 123, publishedAt: active.generatedAt, visibilityStatus: "published",
    rewriteVersion: number, rewriteId: active.rewriteId, publicationRevision: number,
    contentHash: active.contentHash, finalizedAt: active.generatedAt, isFinal: true,
    title: active.rewrite.title, lead: active.rewrite.lead, body: active.rewrite.body,
    keyFacts: [], negativeOrSurprising: [], sourceLimitations: [],
    confidence: "high", importance: "medium", issuerName: "Company", issuerSign: "CO",
    hasAttachments: false, attachments: [], sourceTitle: "Source", sourceBodyText: "Source body",
    categories: [], notGenerated: false, skipped: false, failed: false,
    processing: false, regenerating: false
  };
}

describe("viewed notice version in the feed", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    sessionStorage.clear();
    localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function selectVersionTwo() {
    await act(() => root.render(<RewriteTabs rewrites={[1, 2, 3].map(version)}
      messageId={123} publicationRevision={3} dateline={null} />));
    await act(() => (container.querySelectorAll(".rewriteTab")[1] as HTMLButtonElement).click());
  }

  it("returns to version 2 of 3 with the matching content and publication identity", async () => {
    await selectVersionTwo();
    await act(() => root.render(<NoticeCard item={feedItem()} />));
    const article = container.querySelector("[data-version]")!;
    expect(article.getAttribute("data-version")).toBe("2");
    expect(article.getAttribute("data-rewrite-id")).toBe("rewrite-2");
    expect(article.getAttribute("data-content-hash")).toBe("hash-2");
    expect(article.textContent).toContain("Version 2 title|Version 2 lead\n\nVersion 2 body");

    // A feed refresh keeps the selection, as does returning to the detail page.
    await act(() => root.render(<NoticeCard item={{ ...feedItem() }} />));
    expect(container.querySelector("[data-version]")?.getAttribute("data-version")).toBe("2");
    await act(() => root.render(<RewriteTabs rewrites={[1, 2, 3].map(version)}
      messageId={123} publicationRevision={3} dateline={null} />));
    expect(container.querySelector(".rewriteTab.active")?.textContent).toBe("2");
  });

  it("handles an older cached feed and allows a new publication through", async () => {
    await selectVersionTwo();
    await act(() => root.render(<NoticeCard item={feedItem(1)} />));
    expect(container.querySelector("[data-version]")?.getAttribute("data-version")).toBe("2");
    await act(() => root.render(<NoticeCard item={feedItem(4)} />));
    expect(container.querySelector("[data-version]")?.getAttribute("data-version")).toBe("4");
  });

  it("selects the newly generated version in detail and carries it to the feed", async () => {
    await selectVersionTwo();
    await act(() => root.render(<RewriteTabs rewrites={[1, 2, 3, 4].map(version)}
      messageId={123} publicationRevision={4} dateline={null} />));
    expect(container.querySelector(".rewriteTab.active")?.textContent).toBe("4");
    await act(() => root.render(<NoticeCard item={feedItem(3)} />));
    expect(container.querySelector("[data-version]")?.getAttribute("data-version")).toBe("4");
  });

  it("does not apply the selection to another notice", async () => {
    await selectVersionTwo();
    await act(() => root.render(<NoticeCard item={{ ...feedItem(), messageId: 456 }} />));
    expect(container.querySelector("[data-version]")?.getAttribute("data-version")).toBe("3");
  });

  it("keeps navigation working when session storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Blocked"); });
    await selectVersionTwo();
    expect(container.querySelector(".rewriteTab.active")?.textContent).toBe("2");
    await act(() => root.render(<NoticeCard item={feedItem()} />));
    expect(container.querySelector("[data-version]")?.getAttribute("data-version")).toBe("3");
  });
});

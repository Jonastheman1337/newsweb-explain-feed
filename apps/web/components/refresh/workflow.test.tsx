// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditableRewrite, type RewriteActionControls } from "../editable-rewrite";
import { rememberSelection, restoreSelection, selectVersion } from "./selection";
import { initialFeedState, receiveFeedItem } from "./feed-state";
import type { FeedItem } from "@newsweb/shared";
vi.mock("../../lib/editorial-telemetry", () => ({
  useEditorialTelemetry: () => ({
    logEvent: vi.fn().mockResolvedValue(undefined),
    buildTelemetry: () => ({})
  })
}));
let root: Root, container: HTMLDivElement, controls: RewriteActionControls;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  localStorage.clear();
  sessionStorage.clear();
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
const render = () =>
  root.render(
    <React.StrictMode>
      <EditableRewrite
        messageId={123}
        originalTitle="Original title"
        originalBody="Original body"
        rewriteId="v1"
        activeVersion={1}
        contentHash="h1"
        isFinal
        renderActions={(value) => {
          controls = value;
          return <span>{value.hasDraft ? "Edited" : "Original"}</span>;
        }}
      />
    </React.StrictMode>
  );
it("keeps the edited DOM through rerenders, copies visible text and can undo reset", async () => {
  await act(render);
  const body = container.querySelector('[aria-label="Rediger notistekst"]') as HTMLElement;
  expect(body).not.toBeNull();
  await act(() => {
    body.innerHTML = "<p>My checked edit</p>";
    body.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
  await act(render);
  expect(body.textContent).toBe("My checked edit");
  expect(controls.hasDraft).toBe(true);
  const copied: Record<string, string> = {};
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: vi.fn((command: string) => {
      if (command !== "copy") return false;
      const event = new Event("copy", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: {
          setData: (kind: string, value: string) => (copied[kind] = value)
        }
      });
      document.dispatchEvent(event);
      return true;
    })
  });
  await act(() => controls.copy());
  expect(copied["text/plain"]).toContain("My checked edit");
  expect(copied["text/plain"]).not.toContain("Original body");
  await act(() => controls.toggleOriginal());
  expect(body.textContent).toBe("Original body");
  await act(() => controls.toggleOriginal());
  expect(body.textContent).toBe("My checked edit");
  await act(() => controls.reset());
  expect(body.textContent).toBe("Original body");
  await act(() => controls.undoReset());
  expect(body.textContent).toBe("My checked edit");
  await act(() => root.render(null));
  await act(render);
  expect(container.querySelector('[aria-label="Rediger notistekst"]')?.textContent).toBe(
    "My checked edit"
  );
});
function item(version: number): FeedItem {
  return {
    messageId: 123,
    publishedAt: "2026-09-07T08:00:00Z",
    rewriteId: `v${version}`,
    rewriteVersion: version,
    publicationRevision: version,
    contentHash: `h${version}`,
    isFinal: true,
    finalizedAt: "2026-09-07T08:00:00Z",
    title: `Title ${version}`,
    lead: "Lead",
    body: ["Body"],
    keyFacts: [],
    negativeOrSurprising: [],
    sourceLimitations: [],
    importance: "medium",
    confidence: "high",
    visibilityStatus: "published",
    issuerName: "Company",
    issuerSign: "CO",
    categories: [],
    hasAttachments: false,
    attachments: [],
    sourceTitle: "Source",
    sourceBodyText: "Source body",
    notGenerated: false,
    skipped: false,
    failed: false,
    processing: false,
    regenerating: false
  };
}
it("restores the selected old version and only prompts for an unseen newer publication", () => {
  const v1 = item(1),
    v2 = item(2),
    v3 = item(3);
  rememberSelection({ current: v1, latest: v2 });
  let entry = restoreSelection(initialFeedState([v2]).entries[0]);
  expect(entry.current.rewriteId).toBe("v1");
  expect(entry.pending).toBeUndefined();
  const state = receiveFeedItem({ entries: [entry], incoming: [] }, v2);
  expect(state.entries[0].pending).toBeUndefined();
  entry = restoreSelection(initialFeedState([v3]).entries[0]);
  expect(entry.current.rewriteId).toBe("v1");
  expect(entry.pending?.rewriteId).toBe("v3");
  const selected = selectVersion({ entries: [entry], incoming: [] }, v2);
  rememberSelection(selected.entries[0]);
  expect(restoreSelection(initialFeedState([v3]).entries[0]).pending).toBeUndefined();
});

it("restores a selected first draft after reload and offers the first full publication", () => {
  const full = item(1);
  const fastDraft: NonNullable<FeedItem["fastDraft"]> = { id: "short", status: "ready", startedAt: full.publishedAt, finishedAt: full.publishedAt, rewrite: { title: "Short title", lead: "Short checked lead", body: [], company_sentence: "", key_facts: ["Checked fact"], negative_or_surprising: [], excluded_hype: [], source_limitations: [], confidence: "high", importance: "viktig", source_spans: ["Source excerpt"] } };
  const source = { ...full, isFinal: false, rewriteVersion: 1, rewriteId: null, publicationRevision: 0, fastDraft };
  const initial = initialFeedState([source]).entries[0];
  rememberSelection(initial);
  expect(restoreSelection(initialFeedState([source]).entries[0]).current.publicationKind).toBe("fast");
  const ready = { ...full, fastDraft };
  const restored = restoreSelection(initialFeedState([ready]).entries[0]);
  expect(restored.current.publicationKind).toBe("fast");
  expect(restored.pending?.rewriteId).toBe(full.rewriteId);
  // The flag can be turned off without restoring a cached first draft into the feed.
  expect(restoreSelection(initialFeedState([full]).entries[0]).current.rewriteId).toBe(full.rewriteId);
});
it("stores edits independently for a first draft and full version one", async () => {
  const { saveRewriteDraft, getRewriteDraft } = await import("../../lib/rewrite-drafts");
  for (const id of ["fast:short", "full-one"]) saveRewriteDraft({ messageId: 123, version: 1, rewriteId: id, title: `Edited ${id}`, body: `Edited text for ${id}`, originalTitle: "Title", originalBody: "Body" });
  expect(getRewriteDraft({ messageId: 123, version: 1, rewriteId: "fast:short" })?.body).toBe("Edited text for fast:short");
  expect(getRewriteDraft({ messageId: 123, version: 1, rewriteId: "full-one" })?.body).toBe("Edited text for full-one");
});

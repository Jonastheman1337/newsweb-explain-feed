// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { useTitleSuggestions } from "./title-suggestions";
vi.mock("../lib/editorial-telemetry", () => ({
  useEditorialTelemetry: () => ({ buildTelemetry: () => ({}) }),
}));
let root: Root,
  container: HTMLDivElement,
  resolve: (value: Response) => void,
  title: string,
  body: string,
  rewriteId: string;
const commit = vi.fn(),
  preview = vi.fn();
function Harness() {
  const state = useTitleSuggestions({
    messageId: 17,
    currentTitle: title,
    currentBody: body,
    rewriteId,
    contentHash: "hash",
    previewOnHover: false,
    onCommit: commit,
    onPreview: preview,
    onRevert: () => {},
  });
  return (
    <div className="editableTitleRow">
      {state.button}
      {state.dropdown}
    </div>
  );
}
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  title = "Synlig tittel";
  body = "Synlig redigert tekst";
  rewriteId = "version-1";
  commit.mockClear();
  preview.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith("/suggest-titles")
        ? new Promise<Response>((done) => {
            resolve = done;
          })
        : ({ ok: true, json: async () => ({}) } as Response),
    ),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it.each(["version", "body"])(
  "invalidates a pending response after the %s changes",
  async (change) => {
    await act(() => root.render(<Harness />));
    await act(() => container.querySelector("button")!.click());
    const request = JSON.parse(
      vi.mocked(fetch).mock.calls[0][1]?.body as string,
    );
    expect(request.baseSnapshot).toEqual({
      rewriteId: "version-1",
      contentHash: "hash",
      title,
      body,
    });
    if (change === "version") rewriteId = "version-2";
    else body = "Nyere tekst";
    await act(() => root.render(<Harness />));
    await act(() =>
      resolve({
        ok: true,
        json: async () => ({ titles: ["Gammelt forslag"] }),
      } as Response),
    );
    expect(container.textContent).not.toContain("Gammelt forslag");
    expect(commit).not.toHaveBeenCalled();
  },
);
it("requires explicit selection and returns focus on Escape", async () => {
  await act(() => root.render(<Harness />));
  const trigger = container.querySelector("button")!;
  await act(() => trigger.click());
  await act(() =>
    resolve({
      ok: true,
      json: async () => ({ titles: ["Et forslag"] }),
    } as Response),
  );
  const option = Array.from(container.querySelectorAll("button")).find(
    (node) => node.textContent === "Et forslag",
  )!;
  await act(() =>
    option.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
  );
  expect(preview).not.toHaveBeenCalled();
  option.focus();
  await act(() =>
    option.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(document.activeElement).toBe(trigger);
  expect(container.textContent).not.toContain("Et forslag");
  await act(() => trigger.click());
  await act(() =>
    Array.from(container.querySelectorAll("button"))
      .find((node) => node.textContent === "Et forslag")!
      .click(),
  );
  expect(commit).toHaveBeenCalledWith("Et forslag");
});

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sakArticleChanges, sakEditedArticleFromHtml } from "./sak-editor";

describe("Sak edited revision payload", () => {
  it("preserves manual edits, source links, quotes and headings from the visible editor", () => {
    const result = sakEditedArticleFromHtml("Min rettede tittel", '<p>Min redigerte ingress.</p><p>Dette er rettet, <a href="https://bloomberg.com/story">skriver Bloomberg</a>.</p><h3>Bakgrunnen</h3><p>– Et oversatt sitat.</p>', [{ id: "m1", url: "https://bloomberg.com/story" }]);
    expect(result.title).toBe("Min rettede tittel");
    expect(result.lead).toBe("Min redigerte ingress.");
    expect(result.blocks).toEqual([{ kind: "paragraph", text: "Dette er rettet, [[skriver Bloomberg|material_m1]]." }, { kind: "subheading", text: "Bakgrunnen" }, { kind: "quote", text: "– Et oversatt sitat." }]);
  });
  it("does not silently discard a manually added link outside the supplied sources", () => {
    expect(() => sakEditedArticleFromHtml("En tittel", '<p>En ingress.</p><p><a href="https://example.org/another">Ny kilde</a></p>', [])).toThrow(/Legg lenken til som kilde/);
  });
  it("does not concatenate words across line breaks or crash on a failed URL", () => {
    const result = sakEditedArticleFromHtml("En tittel", "<p>En ingress.</p><p>Et ord<br>Et annet ord.</p>", [{ id: "bad", url: "invalid" }]);
    expect(result.blocks[0]?.text).toBe("Et ord\nEt annet ord.");
  });
  it("shows unchanged, removed and added paragraphs in version comparison", () => {
    const before = { title: "Tittel", lead: "Gammel ingress", blocks: [{ kind: "paragraph" as const, text: "Behold dette." }] };
    const after = { ...before, lead: "Ny ingress" };
    expect(sakArticleChanges(before, after)).toEqual([{ kind: "same", text: "Tittel" }, { kind: "removed", text: "Gammel ingress" }, { kind: "added", text: "Ny ingress" }, { kind: "same", text: "Behold dette." }]);
  });
});

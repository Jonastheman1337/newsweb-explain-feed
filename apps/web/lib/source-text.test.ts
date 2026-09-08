import { describe, expect, it } from "vitest";
import { splitParagraphs, splitPdfPages } from "./source-text";

describe("splitParagraphs", () => {
  it("splits on blank lines in any line-ending style and drops empties", () => {
    expect(splitParagraphs("First\n\nSecond\n \nThird\r\n\r\n\r\nFourth  ")).toEqual([
      "First",
      "Second",
      "Third",
      "Fourth"
    ]);
    expect(splitParagraphs("")).toEqual([]);
  });
});

describe("splitPdfPages", () => {
  it("keeps text before the first marker and numbers the rest", () => {
    expect(
      splitPdfPages("KEY METRICS\nRevenue up\n\n---\n\n[PDF page 3]\nIntro\n\nMore\n[PDF page 4]\n\n[PDF page 5]\nLast")
    ).toEqual([
      { page: null, paragraphs: ["KEY METRICS\nRevenue up"] },
      { page: 3, paragraphs: ["Intro", "More"] },
      { page: 5, paragraphs: ["Last"] }
    ]);
  });

  it("returns one unnumbered section for plain text", () => {
    expect(splitPdfPages("Just text\n\nTwo paragraphs")).toEqual([
      { page: null, paragraphs: ["Just text", "Two paragraphs"] }
    ]);
  });
});

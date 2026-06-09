import { describe, expect, it } from "vitest";
import {
  MAX_MATERIAL_TEXT_CHARS,
  parseNewswebMaterialMessageId,
  pdfTitleFromFileName,
  sanitizeMaterialTitle,
  truncateMaterialText
} from "./notice-materials.js";

describe("notice material helpers", () => {
  it("parses numeric ids and Newsweb message links only", () => {
    expect(parseNewswebMaterialMessageId("12345")).toBe(12345);
    expect(parseNewswebMaterialMessageId("https://newsweb.oslobors.no/message/678")).toBe(
      678
    );
    expect(
      parseNewswebMaterialMessageId("https://newsweb.oslobors.no/sak?messageId=901")
    ).toBe(901);
    expect(parseNewswebMaterialMessageId("https://example.com/message/678")).toBeNull();
    expect(parseNewswebMaterialMessageId("https://evil-oslobors.no/message/678")).toBeNull();
    expect(parseNewswebMaterialMessageId("0")).toBeNull();
  });

  it("normalizes titles and pdf filenames", () => {
    expect(sanitizeMaterialTitle("  Analyst\n report\tQ1  ")).toBe("Analyst report Q1");
    expect(sanitizeMaterialTitle("\n", "Fallback")).toBe("Fallback");
    expect(pdfTitleFromFileName("C:\\temp\\Company update.pdf")).toBe("Company update");
  });

  it("truncates long material text with an audit marker", () => {
    const text = "x".repeat(MAX_MATERIAL_TEXT_CHARS + 10);
    const truncated = truncateMaterialText(text);

    expect(truncated.length).toBeGreaterThan(MAX_MATERIAL_TEXT_CHARS);
    expect(truncated).toContain("[... materialet er avkortet ...]");
    expect(truncated.startsWith("x".repeat(100))).toBe(true);
  });
});

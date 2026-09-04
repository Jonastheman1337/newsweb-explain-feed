import { describe, expect, it } from "vitest";

import {
  AI_DISCLOSURE_LINK_HREF,
  AI_DISCLOSURE_TEXT,
  createNoticeClipboardPlainText
} from "./ai-disclosure";
import { createNoticeClipboardHtml } from "./rich-text";

describe("AI disclosure clipboard payloads", () => {
  it("appends the disclosure to the plain-text copy payload", () => {
    expect(createNoticeClipboardPlainText("Tittel", "Brødtekst")).toBe(
      `Tittel\n\nBrødtekst\n\n${AI_DISCLOSURE_TEXT}her (${AI_DISCLOSURE_LINK_HREF}).`
    );
  });

  it("appends the linked disclosure to the HTML copy payload", () => {
    expect(createNoticeClipboardHtml("Tittel", "<p>Brødtekst</p>")).toBe(
      `<article><h2>Tittel</h2><p>Brødtekst</p><p><em>${AI_DISCLOSURE_TEXT}<a href="${AI_DISCLOSURE_LINK_HREF}">her</a>.</em></p></article>`
    );
  });
});

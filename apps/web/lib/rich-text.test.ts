// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { AI_DISCLOSURE_LINK_HREF, AI_DISCLOSURE_TEXT } from "./ai-disclosure";
import {
  createNoticeClipboardHtml,
  createSakClipboard,
  richHtmlToPlainText,
  sanitizeRichHtml
} from "./rich-text";

const SAK_BODY =
  '<p>Danske Bank venter tre rentekutt, ifølge <a href="https://danskebank.no/outlook">Nordic Outlook</a>.</p>' +
  "<h3>Renten ned i 2027</h3>" +
  "<p>– Vi ser en klar dreining, sier sjeføkonom Frank Jullum.</p>";

describe("sanitizeRichHtml – subheadings", () => {
  it("keeps <h3> as a block and is idempotent", () => {
    const once = sanitizeRichHtml(SAK_BODY);
    expect(once).toBe(SAK_BODY);
    expect(sanitizeRichHtml(once)).toBe(once);
  });

  it("collapses h2 and h4 to h3", () => {
    expect(sanitizeRichHtml("<h2>Én</h2><p>a</p><h4>To</h4>")).toBe(
      "<h3>Én</h3><p>a</p><h3>To</h3>"
    );
  });

  it("does not wrap a heading inside a paragraph when it follows inline text", () => {
    expect(sanitizeRichHtml("tekst<h3>Mellomtittel</h3>mer")).toBe(
      "<p>tekst</p><h3>Mellomtittel</h3><p>mer</p>"
    );
  });

  it("drops empty headings", () => {
    expect(sanitizeRichHtml("<p>a</p><h3> </h3>")).toBe("<p>a</p>");
  });
});

describe("richHtmlToPlainText – linkUrls", () => {
  it("renders anchors as text only by default", () => {
    expect(richHtmlToPlainText(SAK_BODY)).toBe(
      "Danske Bank venter tre rentekutt, ifølge Nordic Outlook.\n\n" +
        "Renten ned i 2027\n\n" +
        "– Vi ser en klar dreining, sier sjeføkonom Frank Jullum."
    );
  });

  it("renders anchors as 'text (url)' when linkUrls is set", () => {
    expect(richHtmlToPlainText(SAK_BODY, { linkUrls: true })).toContain(
      "ifølge Nordic Outlook (https://danskebank.no/outlook)."
    );
  });
});

describe("createSakClipboard", () => {
  it("keeps links and subheads, and carries no AI disclosure", () => {
    const { html, text } = createSakClipboard("Danske Bank venter tre rentekutt", SAK_BODY);

    expect(html).toBe(
      `<article><h2>Danske Bank venter tre rentekutt</h2>${SAK_BODY}</article>`
    );
    expect(html).not.toContain(AI_DISCLOSURE_TEXT);
    expect(html).not.toContain(AI_DISCLOSURE_LINK_HREF);

    expect(text.startsWith("Danske Bank venter tre rentekutt\n\n")).toBe(true);
    expect(text).toContain("Nordic Outlook (https://danskebank.no/outlook)");
    expect(text).toContain("\n\nRenten ned i 2027\n\n");
    expect(text).not.toContain(AI_DISCLOSURE_TEXT);
  });

  it("escapes the title", () => {
    expect(createSakClipboard('A <b> & "c"', "<p>x</p>").html).toBe(
      '<article><h2>A &lt;b&gt; &amp; &quot;c&quot;</h2><p>x</p></article>'
    );
  });

  it("leaves the notice clipboard with its disclosure", () => {
    expect(createNoticeClipboardHtml("Tittel", "<p>x</p>")).toContain(AI_DISCLOSURE_LINK_HREF);
  });
});

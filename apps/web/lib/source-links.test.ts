import { describe, expect, it } from "vitest";

import {
  findPrimaryAttributionAnchor,
  findPriorAttributionAnchor,
  linkSourceAttributions
} from "./source-links";

const URL = "https://newsweb.oslobors.no/message/681428";
const PRIMARY = { url: URL, issuerName: "Equinor ASA", issuerSign: "EQNR" };
const link = (href: string, word: string) => `<a href="${href}">${word}</a>`;

const JUNE = { url: "https://newsweb.oslobors.no/message/670001", publishedAt: "2026-06-23T07:30:00.000Z" };
const MAY = { url: "https://newsweb.oslobors.no/message/660001", publishedAt: "2026-05-26T07:30:00.000Z" };
// 2026-08-27 is a Thursday.
const THURSDAY = { url: "https://newsweb.oslobors.no/message/680001", publishedAt: "2026-08-27T12:00:00.000Z" };

describe("linkSourceAttributions – primary link", () => {
  it("links the noun in 'ifølge en børsmelding'", () => {
    const html = "<p>Selskapet har inngått en avtale, ifølge en børsmelding torsdag.</p>";
    expect(linkSourceAttributions(html, { primary: PRIMARY })).toBe(
      `<p>Selskapet har inngått en avtale, ifølge en ${link(URL, "børsmelding")} torsdag.</p>`
    );
  });

  it("links the verb in 'opplyser selskapet'", () => {
    const html = "<p>Avtalen er verdt 50 millioner kroner, opplyser selskapet.</p>";
    expect(linkSourceAttributions(html, { primary: PRIMARY })).toBe(
      `<p>Avtalen er verdt 50 millioner kroner, ${link(URL, "opplyser")} selskapet.</p>`
    );
  });

  it("prefers the noun when 'opplyser selskapet i en børsmelding'", () => {
    const html = "<p>Det opplyser selskapet i en børsmelding torsdag.</p>";
    expect(linkSourceAttributions(html, { primary: PRIMARY })).toBe(
      `<p>Det opplyser selskapet i en ${link(URL, "børsmelding")} torsdag.</p>`
    );
  });

  it("links 'ifølge <issuer>' via name and sign aliases", () => {
    expect(
      linkSourceAttributions("<p>Ifølge Equinor er avtalen signert.</p>", { primary: PRIMARY })
    ).toBe(`<p>${link(URL, "Ifølge")} Equinor er avtalen signert.</p>`);
    expect(
      linkSourceAttributions("<p>Ifølge EQNR er avtalen signert.</p>", { primary: PRIMARY })
    ).toBe(`<p>${link(URL, "Ifølge")} EQNR er avtalen signert.</p>`);
  });

  it("links only the first attribution across paragraphs", () => {
    const html =
      "<p>Det opplyser selskapet.</p><p>Ifølge meldingen skal avtalen vare i tre år. Selskapet skriver at det er fornøyd.</p>";
    expect(linkSourceAttributions(html, { primary: PRIMARY })).toBe(
      `<p>Det ${link(URL, "opplyser")} selskapet.</p><p>Ifølge meldingen skal avtalen vare i tre år. Selskapet skriver at det er fornøyd.</p>`
    );
  });

  it("leaves entities, tags and <br> untouched", () => {
    const html =
      "<p>Selskapet&#39;s styre &amp; ledelse<br>ifølge meldingen &lt;er&gt; &quot;enige&quot;.</p>";
    expect(linkSourceAttributions(html, { primary: PRIMARY })).toBe(
      `<p>Selskapet&#39;s styre &amp; ledelse<br>ifølge ${link(URL, "meldingen")} &lt;er&gt; &quot;enige&quot;.</p>`
    );
  });

  it("escapes the href", () => {
    const html = "<p>Det opplyser selskapet.</p>";
    expect(
      linkSourceAttributions(html, { primary: { url: 'https://x.test/a?b=1&c="2"' } })
    ).toBe('<p>Det <a href="https://x.test/a?b=1&amp;c=&quot;2&quot;">opplyser</a> selskapet.</p>');
  });
});

describe("linkSourceAttributions – prior link", () => {
  it("links the prior verb to the related notice matching the month", () => {
    const html = "<p>Selskapet meldte i juni om en innledende avtale.</p>";
    expect(linkSourceAttributions(html, { related: [JUNE] })).toBe(
      `<p>Selskapet ${link(JUNE.url, "meldte")} i juni om en innledende avtale.</p>`
    );
  });

  it("picks the related notice published on the mentioned weekday", () => {
    const html = "<p>Aksjen falt kraftig da emisjonen ble varslet torsdag.</p>";
    expect(linkSourceAttributions(html, { related: [JUNE, THURSDAY] })).toBe(
      `<p>Aksjen falt kraftig da emisjonen ble ${link(THURSDAY.url, "varslet")} torsdag.</p>`
    );
  });

  it("picks the earliest related notice when no month or weekday is mentioned", () => {
    const html = "<p>Avtalen ble annonsert tidligere i år.</p>";
    expect(linkSourceAttributions(html, { related: [JUNE, MAY] })).toBe(
      `<p>Avtalen ble ${link(MAY.url, "annonsert")} tidligere i år.</p>`
    );
  });

  it("anchors only the verb of 'som meldt'", () => {
    const html = "<p>Som meldt tidligere er avtalen signert.</p>";
    expect(linkSourceAttributions(html, { related: [MAY] })).toBe(
      `<p>Som ${link(MAY.url, "meldt")} tidligere er avtalen signert.</p>`
    );
  });

  it("skips the sentence that carries the primary link", () => {
    const html =
      "<p>Emisjonen som ble varslet torsdag er fulltegnet, opplyser selskapet i en børsmelding.</p>";
    expect(
      linkSourceAttributions(html, { primary: PRIMARY, related: [THURSDAY] })
    ).toBe(
      `<p>Emisjonen som ble varslet torsdag er fulltegnet, opplyser selskapet i en ${link(URL, "børsmelding")}.</p>`
    );
  });

  it("links both when primary and prior sit in different sentences", () => {
    const html =
      "<p>Det opplyser selskapet. Emisjonen ble varslet torsdag.</p>";
    expect(
      linkSourceAttributions(html, { primary: PRIMARY, related: [THURSDAY] })
    ).toBe(
      `<p>Det ${link(URL, "opplyser")} selskapet. Emisjonen ble ${link(THURSDAY.url, "varslet")} torsdag.</p>`
    );
  });
});

describe("linkSourceAttributions – invariants", () => {
  const html =
    "<p>Det opplyser selskapet i en børsmelding.</p><p>Selskapet meldte i juni om en innledende avtale.</p>";
  const targets = { primary: PRIMARY, related: [JUNE] };

  it("is idempotent", () => {
    const once = linkSourceAttributions(html, targets);
    expect(once).toContain(link(URL, "børsmelding"));
    expect(once).toContain(link(JUNE.url, "meldte"));
    expect(linkSourceAttributions(once, targets)).toBe(once);
  });

  it("returns the input unchanged for empty targets", () => {
    expect(linkSourceAttributions(html, {})).toBe(html);
    expect(linkSourceAttributions(html, { primary: null, related: [] })).toBe(html);
    expect(linkSourceAttributions(html, { primary: { url: "   " } })).toBe(html);
  });

  it("returns the input unchanged when nothing matches", () => {
    const plain = "<p>Aksjen steg tre prosent på Oslo Børs.</p>";
    expect(linkSourceAttributions(plain, targets)).toBe(plain);
  });

  it("leaves a sentence that already contains an anchor untouched", () => {
    const linked =
      '<p>Det opplyser <a href="https://example.test">selskapet</a> i en børsmelding.</p>';
    expect(linkSourceAttributions(linked, { primary: PRIMARY })).toBe(linked);

    const prior =
      '<p>Selskapet <a href="https://example.test">meldte</a> i juni om en avtale.</p>';
    expect(linkSourceAttributions(prior, { related: [JUNE] })).toBe(prior);
  });

  it("never matches inside tags", () => {
    const html = '<p data-note="ifølge meldingen">Aksjen steg.</p>';
    expect(linkSourceAttributions(html, { primary: PRIMARY })).toBe(html);
  });
});

describe("findPrimaryAttributionAnchor", () => {
  it("returns the anchor range of the first phrase", () => {
    const text = "Det opplyser selskapet i en børsmelding.";
    const anchor = findPrimaryAttributionAnchor(text, []);
    expect(anchor).toEqual({ start: text.indexOf("børsmelding"), end: text.indexOf("børsmelding") + "børsmelding".length });
  });

  it("recognises 'går det frem av meldingen' and 'heter det i meldingen'", () => {
    const a = "Avtalen er treårig, går det frem av meldingen.";
    expect(a.slice(...toTuple(findPrimaryAttributionAnchor(a, [])))).toBe("meldingen");
    const b = "Avtalen er treårig, heter det i børsmeldingen.";
    expect(b.slice(...toTuple(findPrimaryAttributionAnchor(b, [])))).toBe("børsmeldingen");
  });

  it("uses issuer aliases for 'ifølge <issuer>'", () => {
    const text = "Avtalen er signert, ifølge Nordic Semiconductor.";
    expect(text.slice(...toTuple(findPrimaryAttributionAnchor(text, ["Nordic Semiconductor", "NOD"])))).toBe("ifølge");
    expect(findPrimaryAttributionAnchor(text, [])).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(findPrimaryAttributionAnchor("Aksjen steg tre prosent.", [])).toBeNull();
  });
});

describe("findPriorAttributionAnchor", () => {
  it("returns the verb and the bounds of the first sentence with a marker", () => {
    const text = "Aksjen steg tre prosent. Selskapet meldte i juni om en avtale. Det ble varslet i mai.";
    const result = findPriorAttributionAnchor(text);
    expect(result).not.toBeNull();
    expect(text.slice(result!.start, result!.end)).toBe("meldte");
    expect(text.slice(result!.sentenceStart, result!.sentenceEnd)).toBe(
      "Selskapet meldte i juni om en avtale."
    );
  });

  it("does not split sentences on dates or abbreviations", () => {
    const text = "Selskapet hentet ca. 50 mill. kroner 5. juni og meldte om det da. Aksjen steg.";
    const result = findPriorAttributionAnchor(text);
    expect(text.slice(result!.sentenceStart, result!.sentenceEnd)).toBe(
      "Selskapet hentet ca. 50 mill. kroner 5. juni og meldte om det da."
    );
  });

  it("returns null when nothing matches", () => {
    expect(findPriorAttributionAnchor("Aksjen steg tre prosent.")).toBeNull();
  });
});

function toTuple(range: { start: number; end: number } | null): [number, number] {
  if (!range) throw new Error("expected an anchor");
  return [range.start, range.end];
}

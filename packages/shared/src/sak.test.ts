import { describe, expect, it } from "vitest";
import {
  buildSakLinkList,
  countSakVisibleChars,
  parseSakInlineLinks,
  parseStoredSakArticle,
  sakArticleJsonSchema,
  sakArticleSchema,
  sakArticleToHtml,
  sakArticleToPlainText,
  sakBlockPlainText,
  sakLinkedMaterialIds,
  sakMaterialIdFromSourceId,
  sakMaterialSourceId,
  type SakArticle
} from "./sak.js";

const article: SakArticle = {
  sources: [{ materialId: "material_ckabc123", usedFor: "rutedager og flytype" }],
  source_spans: ['material_ckabc123: "four times per week"'],
  excluded_hype: [
    {
      speaker: "Mark Galardo",
      quote: "Air Canada styrker sin posisjon i Skandinavia",
      reason: "posisjonsspråk uten innhold"
    }
  ],
  title: "Air Canada åpner rute mellom Oslo og Toronto",
  lead: "Det blir den første direkteruten mellom Norge og Canada noensinne.",
  blocks: [
    {
      kind: "paragraph",
      text: "Ruten blir en sommerrute, går det frem av en [[pressemelding|material_ckabc123]] torsdag."
    },
    { kind: "subheading", text: "Fire avganger i uken" },
    { kind: "quote", text: "Vi har en ambisjon om flere ruter, sier Joachim Lupnaav Johnsen." },
    {
      kind: "paragraph",
      text: "Se også [[forrige sak|material_ckmissing]] og [[meldingen|material_ckabc123]]."
    }
  ],
  desk_notes: ["Ingen merknader"],
  change_note: "Første utkast"
};

describe("sakArticleSchema", () => {
  it("accepts a complete article", () => {
    expect(sakArticleSchema.parse(article)).toEqual(article);
  });

  it("rejects too many blocks", () => {
    const tooMany = {
      ...article,
      blocks: Array.from({ length: 41 }, () => ({ kind: "paragraph", text: "x" }))
    };
    expect(sakArticleSchema.safeParse(tooMany).success).toBe(false);
  });

  it("rejects an over-long block and a bad material id", () => {
    expect(
      sakArticleSchema.safeParse({
        ...article,
        blocks: [{ kind: "paragraph", text: "a".repeat(901) }]
      }).success
    ).toBe(false);
    expect(
      sakArticleSchema.safeParse({
        ...article,
        sources: [{ materialId: "mat-1", usedFor: "noe" }]
      }).success
    ).toBe(false);
  });

  it("rejects a missing change_note", () => {
    const { change_note: _omit, ...rest } = article;
    expect(sakArticleSchema.safeParse(rest).success).toBe(false);
  });
});

describe("parseStoredSakArticle", () => {
  it("accepts stored text the strict schema would reject", () => {
    const stored = {
      ...article,
      title: "Ok",
      blocks: [{ kind: "quote", text: `– ${"x".repeat(899)}` }],
      excluded_hype: [{ speaker: null, quote: "Vi er stolte" }]
    };
    expect(sakArticleSchema.safeParse(stored).success).toBe(false);
    const parsed = parseStoredSakArticle(stored);
    expect(parsed?.title).toBe("Ok");
    expect(parsed?.blocks[0]?.text.length).toBe(901);
    expect(parsed?.excluded_hype[0]).toEqual({ speaker: null, quote: "Vi er stolte", reason: "" });
  });

  it("returns null for junk", () => {
    expect(parseStoredSakArticle(null)).toBeNull();
    expect(parseStoredSakArticle("nope")).toBeNull();
    expect(parseStoredSakArticle({ title: "x" })).toBeNull();
  });
});

describe("sakArticleJsonSchema", () => {
  it("is strict and requires every key in ledger-first order", () => {
    expect(sakArticleJsonSchema.additionalProperties).toBe(false);
    const keys = Object.keys(sakArticleJsonSchema.properties);
    expect(keys[0]).toBe("sources");
    expect(keys[keys.length - 1]).toBe("change_note");
    expect([...sakArticleJsonSchema.required]).toEqual(keys);
  });

  it("allows a null speaker in excluded_hype", () => {
    const speaker = sakArticleJsonSchema.properties.excluded_hype.items.properties.speaker;
    expect([...speaker.type]).toEqual(["string", "null"]);
  });
});

describe("link markers", () => {
  it("parses inline markers into segments", () => {
    expect(parseSakInlineLinks("A [[b|material_x1]] c")).toEqual([
      { text: "A " },
      { text: "b", materialId: "material_x1" },
      { text: " c" }
    ]);
  });

  it("strips markers to anchor text", () => {
    expect(sakBlockPlainText("A [[b|material_x1]] c")).toBe("A b c");
  });

  it("lists linked material ids once each", () => {
    expect(sakLinkedMaterialIds(article)).toEqual(["material_ckabc123", "material_ckmissing"]);
  });

  it("round-trips material source ids", () => {
    expect(sakMaterialSourceId("ck1")).toBe("material_ck1");
    expect(sakMaterialIdFromSourceId("material_ck1")).toBe("ck1");
    expect(sakMaterialIdFromSourceId("prior_1")).toBeNull();
  });
});

describe("text and char helpers", () => {
  it("counts lead and blocks without title or markers", () => {
    const expected = [
      article.lead,
      "Ruten blir en sommerrute, går det frem av en pressemelding torsdag.",
      "Fire avganger i uken",
      "– Vi har en ambisjon om flere ruter, sier Joachim Lupnaav Johnsen.",
      "Se også forrige sak og meldingen."
    ].join("\n\n").length;
    expect(countSakVisibleChars(article)).toBe(expected);
  });

  it("renders plain text with bracketed urls when a resolver is given", () => {
    const text = sakArticleToPlainText(article, {
      resolveHref: (id) => (id === "material_ckabc123" ? "https://example.no/pm" : null)
    });
    expect(text.startsWith("Air Canada åpner rute mellom Oslo og Toronto\n\n")).toBe(true);
    expect(text).toContain("pressemelding (https://example.no/pm)");
    expect(text).toContain("Se også forrige sak og meldingen (https://example.no/pm).");
    expect(text).toContain("\n\n– Vi har en ambisjon");
  });
});

describe("sakArticleToHtml", () => {
  const resolve = (id: string) => (id === "material_ckabc123" ? "https://example.no/pm?a=1&b=2" : null);

  it("renders paragraphs, h3 subheadings, quotes with sitatstrek and anchors", () => {
    const html = sakArticleToHtml(article, resolve);
    expect(html).toContain("<p>Det blir den første direkteruten mellom Norge og Canada noensinne.</p>");
    expect(html).toContain('<a href="https://example.no/pm?a=1&amp;b=2">pressemelding</a>');
    expect(html).toContain("<h3>Fire avganger i uken</h3>");
    expect(html).toContain("<p>– Vi har en ambisjon om flere ruter, sier Joachim Lupnaav Johnsen.</p>");
    expect(html).toContain("Se også forrige sak og ");
    expect(html).not.toContain("material_ckmissing");
  });

  it("does not double a sitatstrek and escapes markup", () => {
    const html = sakArticleToHtml({
      lead: "Lead <b>x</b>",
      blocks: [{ kind: "quote", text: "– Allerede med strek" }]
    });
    expect(html).toBe("<p>Lead &lt;b&gt;x&lt;/b&gt;</p><p>– Allerede med strek</p>");
  });
});

describe("buildSakLinkList", () => {
  it("dedupes by url in order of appearance", () => {
    const list = buildSakLinkList(article, (id) =>
      id === "material_ckabc123" ? "https://example.no/pm" : null
    );
    expect(list).toEqual([
      { text: "pressemelding", url: "https://example.no/pm", materialId: "material_ckabc123" }
    ]);
  });
});

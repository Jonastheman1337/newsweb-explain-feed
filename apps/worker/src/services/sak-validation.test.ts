import type { SakPromptPayload } from "@newsweb/prompt-kit";
import type { SakArticle } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import {
  SAK_FIRST_DRAFT_CHANGE_NOTE,
  buildSakNumericSourceText,
  buildSakRepairInstruction,
  countSakSentences,
  sakArticleAsRewriteShape,
  validateSakArticle
} from "./sak-validation.js";

const MATERIAL_TEXT = [
  "Air Canada announces new non-stop route between Oslo and Toronto for summer 2027.",
  "Flights from Oslo to Toronto will operate four times per week from June 3 to October 11, 2027.",
  "The route will be operated by the Airbus A321XLR with 182 seats.",
  '"We see strong demand for Norway," said Marc Sam, Country Manager at Air Canada.',
  "Avinor: Norge kan tape 250 milliarder kroner i verdiskaping frem mot 2040."
].join("\n");

function payload(overrides: Partial<SakPromptPayload> = {}): SakPromptPayload {
  return {
    sakId: "cksak1",
    materials: [
      {
        sourceId: "material_ckm1",
        kind: "pdf",
        title: "Air Canada pressemelding",
        url: null,
        text: MATERIAL_TEXT,
        textChars: MATERIAL_TEXT.length,
        status: "ready"
      },
      {
        sourceId: "material_ckm2",
        kind: "url",
        title: "E24: SAS-sjefen til Air Canada",
        url: "https://e24.no/x",
        text: "",
        textChars: 0,
        status: "failed",
        failureReason: "betalingsmur"
      }
    ],
    targetChars: 1500,
    todayIso: "2026-09-04T08:00:00.000Z",
    ...overrides
  };
}

function article(overrides: Partial<SakArticle> = {}): SakArticle {
  const paragraph =
    "Ruten blir en sommerrute, og selskapet blir det eneste nordamerikanske flyselskapet med direktefly til Norge, [[ifølge pressemeldingen|material_ckm1]]. ";
  return {
    sources: [{ materialId: "material_ckm1", usedFor: "rutedager, flytype og sitat" }],
    source_spans: ['material_ckm1: "We see strong demand for Norway," said Marc Sam'],
    excluded_hype: [],
    title: "Air Canada åpner rute mellom Oslo og Toronto",
    lead: "Canadas største flyselskap starter direkterute mellom Oslo og Toronto neste sommer.",
    blocks: [
      { kind: "paragraph", text: paragraph.repeat(3).trim() },
      { kind: "subheading", text: "Fire avganger i uken" },
      {
        kind: "paragraph",
        text: "Flyet går fra Oslo fire ganger i uken fra 3. juni til 11. oktober, med Airbus A321XLR som har 182 seter. ".repeat(4).trim()
      },
      { kind: "quote", text: "– Vi ser sterk etterspørsel etter Norge, sier Marc Sam, landssjef i Air Canada." },
      {
        kind: "paragraph",
        text: "Avinor har advart om at Norge kan tape 250 milliarder kroner i verdiskaping frem mot 2040 hvis Oslo taper terreng, [[skrev avisen i januar|material_ckm2]]. ".repeat(4).trim()
      }
    ],
    desk_notes: ["Setetallet står bare i den norske meldingen."],
    change_note: "Første utkast",
    ...overrides
  };
}

const firstDraft = { targetChars: 1500, isFirstDraft: true };

function codes(result: ReturnType<typeof validateSakArticle>): string[] {
  return result.issues.map((issue) => issue.code);
}

describe("validateSakArticle", () => {
  it("passes a clean first draft and forces the change note", () => {
    const result = validateSakArticle(article({ change_note: "Noe annet" }), payload(), firstDraft);
    expect(result.blockingErrors).toEqual([]);
    expect(result.article.change_note).toBe(SAK_FIRST_DRAFT_CHANGE_NOTE);
    expect(result.visibleChars).toBeGreaterThan(1275);
    expect(codes(result)).not.toContain("SAK_LENGTH_OUT_OF_BAND");
  });

  it("blocks a title over eight words unless the owner supplied it", () => {
    const long = article({ title: "Air Canada starter ny direkterute mellom Oslo og Toronto neste sommer" });
    expect(codes(validateSakArticle(long, payload(), firstDraft))).toContain("SAK_TITLE_TOO_LONG");

    const overridden = validateSakArticle(long, payload(), {
      ...firstDraft,
      titleOverride: "Air Canada åpner rute til Toronto"
    });
    expect(overridden.article.title).toBe("Air Canada åpner rute til Toronto");
    expect(codes(overridden)).not.toContain("SAK_TITLE_TOO_LONG");
  });

  it("turns links to unknown materials into plain text and keeps failed materials linkable", () => {
    const result = validateSakArticle(
      article({
        lead: "Canadas største flyselskap starter [[direkterute|material_ukjent]] mellom Oslo og Toronto neste sommer."
      }),
      payload(),
      firstDraft
    );
    expect(result.article.lead).toContain("starter direkterute mellom");
    expect(result.article.lead).not.toContain("[[");
    expect(codes(result)).toContain("SAK_LINK_UNKNOWN_MATERIAL");
    expect(result.article.blocks[4]?.text).toContain("[[skrev avisen i januar|material_ckm2]]");
    expect(result.blockingErrors).toEqual([]);
  });

  it("strips malformed markers and markers inside headings", () => {
    const result = validateSakArticle(
      article({
        title: "Air Canada [[åpner|material_ckm1]] rute",
        blocks: [
          ...article().blocks,
          { kind: "subheading", text: "Henter [[SAS-sjefen|material_ckm2]]" },
          { kind: "paragraph", text: "Se [[pressemeldingen|https://example.com]] og [[stray tekst." }
        ]
      }),
      payload(),
      firstDraft
    );
    expect(result.article.title).toBe("Air Canada åpner rute");
    expect(result.article.blocks[5]?.text).toBe("Henter SAS-sjefen");
    expect(result.article.blocks[6]?.text).toBe("Se pressemeldingen og stray tekst.");
    expect(codes(result)).toContain("SAK_LINK_MALFORMED");
    expect(codes(result)).toContain("SAK_LINK_IN_HEADING");
  });

  it("blocks numbers that no read material contains, and lets today's date through", () => {
    const unexpected = validateSakArticle(
      article({ lead: "Canadas største flyselskap starter direkterute med 900 seter neste sommer." }),
      payload(),
      firstDraft
    );
    expect(codes(unexpected)).toContain("SAK_UNEXPECTED_NUMBERS");
    expect(unexpected.blockingErrors[0]).toContain("900");

    const dated = validateSakArticle(
      article({ lead: "Canadas største flyselskap starter direkterute mellom Oslo og Toronto, opplyste selskapet 4. september 2026." }),
      payload(),
      firstDraft
    );
    expect(codes(dated)).not.toContain("SAK_UNEXPECTED_NUMBERS");
  });

  it("does not count figures from failed materials as covered", () => {
    const result = validateSakArticle(
      article({ lead: "Canadas største flyselskap starter direkterute mellom Oslo og Toronto, 18.000 avganger senere." }),
      payload({
        materials: [
          ...payload().materials,
          {
            sourceId: "material_ckm3",
            kind: "url",
            title: "18.000 avganger",
            url: "https://e24.no/y",
            text: "18.000 avganger",
            textChars: 15,
            status: "failed"
          }
        ]
      }),
      firstDraft
    );
    expect(codes(result)).toContain("SAK_UNEXPECTED_NUMBERS");
  });

  it("blocks meta-source language such as «ikke oppgitt» and marker leaks", () => {
    const meta = validateSakArticle(
      article({ lead: "Prisen er ikke oppgitt, men Canadas største flyselskap starter direkterute mellom Oslo og Toronto." }),
      payload(),
      firstDraft
    );
    expect(codes(meta)).toContain("VISIBLE_META_SOURCE_LANGUAGE");

    const leak = validateSakArticle(
      article({ lead: "Canadas største flyselskap starter direkterute mellom Oslo og Toronto assistant to=system neste sommer." }),
      payload(),
      firstDraft
    );
    expect(codes(leak)).toContain("MARKER_LEAK");
  });

  it("warns on shape problems and repairs the sitatstrek", () => {
    const result = validateSakArticle(
      article({
        lead: "Canadas største flyselskap starter direkterute. Det skjer neste sommer. Avinor er glad.",
        blocks: [
          { kind: "subheading", text: "En veldig lang mellomtittel som går langt utover grensen på seksti tegn" },
          { kind: "paragraph", text: "182 seter har flyet som skal brukes på ruten mellom Oslo og Toronto." },
          { kind: "quote", text: "Vi ser sterk etterspørsel etter Norge, sier Marc Sam." }
        ]
      }),
      payload(),
      firstDraft
    );
    const found = codes(result);
    expect(found).toContain("SAK_LEAD_TOO_MANY_SENTENCES");
    expect(found).toContain("SAK_SUBHEADING_TOO_LONG");
    expect(found).toContain("SAK_SUBHEADING_AFTER_LEAD");
    expect(found).toContain("SAK_BODY_OPENS_WITH_NUMBER");
    expect(found).toContain("SAK_QUOTE_BLOCK_NO_DASH");
    expect(found).toContain("SAK_LENGTH_OUT_OF_BAND");
    expect(result.article.blocks[2]?.text.startsWith("– ")).toBe(true);
    expect(result.blockingErrors).toEqual([]);
  });

  it("warns when a quote has no source span or a read material is missing from sources", () => {
    const result = validateSakArticle(
      article({ source_spans: ["material_ckm1: helt annen ordlyd om noe annet"], sources: [] }),
      payload(),
      firstDraft
    );
    expect(codes(result)).toContain("SAK_QUOTE_WITHOUT_SOURCE_SPAN");
    expect(codes(result)).toContain("SAK_SOURCE_LEDGER_INCOMPLETE");
    expect(result.warnings.join(" ")).toContain("material_ckm1");
  });

  it("blocks a revision that keeps what the instruction asked to drop", () => {
    const previous = article();
    const revised = validateSakArticle(article({ change_note: "Kortet ned\nlitt" }), payload(), {
      targetChars: 1500,
      isFirstDraft: false,
      previousArticle: previous,
      instruction: "Dropp omtalen av Toronto"
    });
    expect(codes(revised)).toContain("REVISION_INSTRUCTION_COMPLIANCE");
    expect(revised.blockingErrors.some((message) => message.includes("Toronto"))).toBe(true);
    expect(revised.article.change_note).toBe("Kortet ned litt");

    const compliant = validateSakArticle(
      article({
        title: "Air Canada åpner rute fra Oslo",
        lead: "Canadas største flyselskap starter direkterute fra Oslo til Canada neste sommer.",
        blocks: article().blocks.map((block) => ({
          ...block,
          text: block.text.replace(/Toronto/g, "Canada")
        }))
      }),
      payload(),
      { targetChars: 1500, isFirstDraft: false, previousArticle: previous, instruction: "Dropp omtalen av Toronto" }
    );
    expect(compliant.blockingErrors).toEqual([]);
  });
});

describe("helpers", () => {
  it("counts sentences without splitting on ordinal dates", () => {
    expect(countSakSentences("Norges Bank hever renten 24. september. Deretter venter banken kutt i 2027.")).toBe(2);
    expect(countSakSentences("Ruten flys fra 3. juni til 11. oktober neste år.")).toBe(1);
    expect(countSakSentences("")).toBe(0);
  });

  it("adapts the article to the notice shape without markers", () => {
    const shape = sakArticleAsRewriteShape(article());
    expect(shape.body[0]).not.toContain("[[");
    expect(shape.body[3]?.startsWith("– ")).toBe(true);
    expect(shape.company_sentence).toBe("");
  });

  it("builds the numeric source from read materials, today and the owner title", () => {
    const source = buildSakNumericSourceText(payload(), { titleOverride: "Tittel 99" });
    expect(source).toContain("A321XLR");
    expect(source).toContain("4. september 2026");
    expect(source).toContain("Tittel 99");
    expect(source).not.toContain("E24: SAS-sjefen");
  });

  it("lists only blocking issues in the repair instruction", () => {
    const instruction = buildSakRepairInstruction([
      { code: "A", severity: "blocking", message: "Første feil." },
      { code: "B", severity: "warning", message: "Bare en advarsel." }
    ]);
    expect(instruction.startsWith("KORRIGERINGSMODUS")).toBe(true);
    expect(instruction).toContain("- Første feil.");
    expect(instruction).not.toContain("advarsel");
  });
});

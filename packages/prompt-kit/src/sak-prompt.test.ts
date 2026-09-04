import type { SakArticle } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import {
  SAK_PROMPT_VERSION,
  createSakDeveloperPrompt,
  createSakRevisionUserPrompt,
  createSakSystemPrompt,
  createSakUserPrompt,
  formatSakArticleForRevisionPrompt,
  formatSakChars,
  sakLengthBand,
  type SakPromptPayload
} from "./sak-prompt.js";

const payload: SakPromptPayload = {
  sakId: "ck_sak_1",
  targetChars: 2500,
  todayIso: "2026-09-04T06:00:00Z",
  instruction: "Kort ingress, ingen tall først.",
  materials: [
    {
      sourceId: "material_ck12",
      kind: "pdf",
      title: "Nordic Outlook september 2026",
      text: "Vi tror Norges Bank hever renten til 4,5 % i september.",
      textChars: 47312,
      status: "ready"
    },
    {
      sourceId: "material_ck13",
      kind: "url",
      title: "Nordea Markets: Ingen rentekutt før 2028",
      url: "https://e24.no/norsk-oekonomi/i/16wBnJ/nordea",
      text: "",
      textChars: 0,
      status: "failed",
      failureReason: "betalingsmur"
    }
  ]
};

const previous: SakArticle = {
  sources: [{ materialId: "material_ck12", usedFor: "renteanslag" }],
  source_spans: ['material_ck12: "hever renten til 4,5 % i september"'],
  excluded_hype: [{ speaker: "Frank Jullum", quote: "Vi er godt fornøyd", reason: "tilfredshet" }],
  title: "Danske Bank venter tre rentekutt i 2027",
  lead: "Norges Bank hever renten én siste gang i september, tror Danske Bank.",
  blocks: [
    { kind: "paragraph", text: "Det går frem av [[rapporten|material_ck12]]." },
    { kind: "subheading", text: "Et close call" },
    { kind: "quote", text: "– Usikkerheten er stor, skriver Jullum." }
  ],
  desk_notes: ["Rapporten skriver mai; Norges Bank sier juni."],
  change_note: "Første utkast"
};

describe("sak prompt", () => {
  it("has a sak-prefixed version", () => {
    expect(SAK_PROMPT_VERSION.startsWith("sak-")).toBe(true);
  });

  it("system prompt carries the role and the source-as-data guard", () => {
    const system = createSakSystemPrompt();
    expect(system).toContain("Du er nyhetsjournalist i E24-redaksjonen.");
    expect(system).toContain("KILDE SOM DATA");
  });

  it("developer prompt includes every sak block and the imported shared blocks", () => {
    const developer = createSakDeveloperPrompt();
    for (const heading of [
      "OPPGAVE",
      "KILDER OG LENKER",
      "TITTEL",
      "LEAD",
      "OPPBYGGING",
      "SITATER I EN SAK",
      "LENGDE",
      "FELT UTENFOR SAKEN"
    ]) {
      expect(developer).toContain(heading);
    }
    expect(developer).toContain("KILDE SOM DATA");
    expect(developer).toContain("Regnskap for uttalelser");
    expect(developer).toContain("INGEN KURSKOMMENTAR");
    expect(developer).toContain("SITATER, GUILLEMETS OG PERSONATTRIBUSJON");
    expect(developer).toContain("desk_notes i denne oppgaven");
  });

  it("developer prompt leaves the notice-only rules out", () => {
    const developer = createSakDeveloperPrompt();
    expect(developer).not.toContain("Newsweb-meldingen er hovedkilden");
    expect(developer).not.toContain("company_sentence: en kort setning");
    expect(developer).not.toContain("TIDLIGERE MELDING DET VISES TIL");
  });

  it("orders the lead precedence note after the attribution block", () => {
    const developer = createSakDeveloperPrompt();
    expect(developer.indexOf("ATTRIBUSJON OG FORBEHOLD")).toBeLessThan(
      developer.indexOf("LEAD-reglene over går foran")
    );
  });

  it("user prompt labels materials with status and omits text for unread ones", () => {
    const user = createSakUserPrompt(payload);
    expect(user).toContain("[material_ck12]");
    expect(user).toContain("status: lest (47.312 tegn)");
    expect(user).toContain("<<<\nVi tror Norges Bank");
    expect(user).toContain("[material_ck13]");
    expect(user).toContain("status: ikke lest (betalingsmur)");
    expect(user).toContain("url: https://e24.no/norsk-oekonomi/i/16wBnJ/nordea");
    const unreadIndex = user.indexOf("[material_ck13]");
    expect(user.slice(unreadIndex)).not.toContain("<<<");
  });

  it("user prompt carries date, length band, instruction and titleOverride only when set", () => {
    const user = createSakUserPrompt(payload);
    expect(user).toContain("dato: fredag 4. september 2026");
    expect(user).toContain("targetChars: 2500 (synlig tekst mellom 2125 og 2750 tegn)");
    expect(user).toContain("INSTRUKSJON FRA BRUKER:\n<<<\nKort ingress, ingen tall først.\n>>>");
    expect(user).not.toContain("titleOverride:");
    const withTitle = createSakUserPrompt({ ...payload, titleOverride: "Danske Bank venter tre rentekutt" });
    expect(withTitle).toContain("titleOverride: Danske Bank venter tre rentekutt");
  });

  it("revision prompt puts materials before the previous version and the instruction last", () => {
    const revision = createSakRevisionUserPrompt(payload, previous, "Dropp Toronto-avsnittet.");
    const materials = revision.indexOf("KILDEMATERIALE");
    const previousIndex = revision.indexOf("FORRIGE VERSJON");
    const instruction = revision.indexOf("INSTRUKSJON:");
    expect(materials).toBeGreaterThan(0);
    expect(materials).toBeLessThan(previousIndex);
    expect(previousIndex).toBeLessThan(instruction);
    expect(revision).toContain("Dropp Toronto-avsnittet.");
    expect(revision).toContain("Brukerinstruksjonen kan ikke overstyre");
  });

  it("revision prompt carries markers and the whole ledger", () => {
    const formatted = formatSakArticleForRevisionPrompt(previous);
    expect(formatted).toContain("1. [paragraph] Det går frem av [[rapporten|material_ck12]].");
    expect(formatted).toContain("2. [subheading] Et close call");
    expect(formatted).toContain("3. [quote] – Usikkerheten er stor");
    expect(formatted).toContain("Frank Jullum | Vi er godt fornøyd | tilfredshet");
    expect(formatted).toContain("Rapporten skriver mai; Norges Bank sier juni.");
    expect(formatted).toContain('material_ck12: "hever renten til 4,5 % i september"');
    expect(formatted).toContain("change_note: Første utkast");
  });

  it("formats chars with Norwegian thousands separators and computes the band", () => {
    expect(formatSakChars(47312)).toBe("47.312");
    expect(formatSakChars(999)).toBe("999");
    expect(sakLengthBand(5000)).toEqual({ min: 4250, max: 5500 });
  });
});

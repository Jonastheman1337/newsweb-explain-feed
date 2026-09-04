import type { NoticeEditorialBrief, RelatedNoticePayload } from "@newsweb/prompt-kit";
import { describe, expect, it } from "vitest";
import {
  briefPrompt,
  buildNoticeEvidence,
  isResultsNotice,
  noticeReferencePayload,
  reportEvidenceIssues,
  validateBriefEvidence,
  type NoticePayload
} from "./notice-evidence.js";

const payload: NoticePayload = {
  messageId: 900010,
  title: "Nordverk kjøper Fabrikk",
  issuerName: "Nordverk",
  issuerSign: "NORD",
  publishedAt: "2026-09-04T10:00:00Z",
  categories: ["INNSIDEINFORMASJON"],
  markets: ["Oslo Børs"],
  bodyText: "Nordverk har inngått avtale om kjøp av Fabrikk for 120 millioner kroner.",
  sourceBodyChars: 72,
  hasAttachments: false
};

function prior(overrides: Partial<RelatedNoticePayload> = {}): RelatedNoticePayload {
  return {
    messageId: 900000,
    relation: "reference",
    title: "Forhandlinger om Fabrikk",
    issuerName: "Nordverk",
    issuerSign: "NORD",
    publishedAt: "2026-08-20T10:00:00Z",
    text: "Nordverk forhandler om kjøp av Fabrikk.",
    textChars: 37,
    resolvedBy: "db",
    score: 1,
    ...overrides
  };
}

function brief(overrides: Partial<NoticeEditorialBrief> = {}): NoticeEditorialBrief {
  return {
    newsworthy: true,
    reason: "Inngått avtale om kjøp",
    eventType: "acquisition",
    eventStatus: "agreed",
    angle: "Nordverk kjøper Fabrikk",
    mustInclude: [{ id: "purchase", fact: "Kjøpesummen er 120 millioner kroner", sourceId: "primary", sourceEvidence: payload.bodyText }],
    usefulQuote: null,
    sourceLimitations: [],
    ...overrides
  };
}

describe("notice evidence compilation", () => {
  it("retains facts after 1200 characters for the planner and the reference checker", () => {
    const lateFact = "Fabrikken skal stenge, og 240 arbeidsplasser blir borte.";
    const bodyText = `${"Administrativ bakgrunn uten hovednyheten. ".repeat(60)}\n\n${lateFact}`;
    expect(bodyText.indexOf(lateFact)).toBeGreaterThan(1200);
    const input = { ...payload, bodyText, sourceBodyChars: bodyText.length };
    const evidence = buildNoticeEvidence(input);
    const planner = JSON.parse(briefPrompt(input, "regular", evidence));
    expect(planner.sources[0].text).toContain(lateFact);
    expect(noticeReferencePayload(input).bodyText).toContain(lateFact);
    expect(evidence.sources[0].text).toContain(bodyText);
  });

  it("keeps notice/attachment evidence primary and materials/prior notices separately owned", () => {
    const reportReferenceText = "Side 4: Resultat før skatt var 45 millioner kroner.";
    const input: NoticePayload = {
      ...payload,
      hasAttachments: true,
      reportText: "Formatert utdrag til skriveprompten",
      reportReferenceText,
      pdfSupplementText: reportReferenceText,
      remunerationText: "Samlet godtgjørelse var 8,4 millioner kroner.",
      supplementalMaterials: [{ id: "database-row-id", sourceId: "material_financials", kind: "text", title: "Kontekst", text: "En redaktørvalgt bakgrunnskilde." }],
      relatedNotices: [prior()]
    };
    const snapshot = JSON.stringify(input);
    const evidence = buildNoticeEvidence(input);
    expect(evidence.sources.map(source => [source.id, source.kind])).toEqual([
      ["primary", "primary"], ["material_financials", "material"], ["prior_900000", "prior"]
    ]);
    expect(evidence.sources[0].text).toContain(payload.bodyText);
    expect(evidence.sources[0].text.split(reportReferenceText)).toHaveLength(2);
    expect(evidence.sources[0].text).toContain(input.remunerationText);
    expect(evidence.sources[0].text).not.toContain("redaktørvalgt");
    expect(evidence.sources[0].text).not.toContain(prior().text);
    expect(evidence.sources[0].text).not.toContain("Formatert utdrag");
    const reference = noticeReferencePayload(input);
    expect(reference.bodyText).toBe(evidence.sources[0].text);
    expect(reference.sourceBodyChars).toBe(reference.bodyText.length);
    expect(reference.pdfSupplementText).toBeUndefined();
    expect(reference.relatedNotices).toEqual(input.relatedNotices);
    expect(reference.supplementalMaterials?.[0].sourceId).toBe("material_financials");
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("accepts only prior text with a valid non-future publication timestamp", () => {
    const input = {
      ...payload,
      relatedNotices: [
        prior(),
        prior({ messageId: 900001, publishedAt: payload.publishedAt }),
        prior({ messageId: 900002, publishedAt: "2026-09-04T10:00:01Z" }),
        prior({ messageId: 900003, publishedAt: "not-a-date" }),
        prior({ messageId: 900004, text: "   " })
      ]
    };
    expect(buildNoticeEvidence(input).sources.map(source => source.id)).toEqual(["primary", "prior_900000", "prior_900001"]);
  });

  it("keeps same-Oslo-day siblings across UTC dates and excludes earlier local days", () => {
    const input = {
      ...payload,
      publishedAt: "2026-09-04T00:30:00Z",
      relatedNotices: [
        prior({ messageId: 900001, relation: "sibling", publishedAt: "2026-09-03T22:30:00Z" }),
        prior({ messageId: 900002, relation: "sibling", publishedAt: "2026-09-03T21:30:00Z" })
      ]
    };
    expect(buildNoticeEvidence(input).sources.map(source => source.id)).toEqual(["primary", "prior_900001"]);
  });

  it.each([
    { supplementalMaterials: [{ id: "a", sourceId: "primary", kind: "text", title: "A", text: "Kollisjon med hovedkilden" }] },
    { supplementalMaterials: [{ id: "a", sourceId: "material_a", kind: "text", title: "A", text: "Første tekst" }, { id: "b", sourceId: "material_a", kind: "text", title: "B", text: "Andre tekst" }] },
    { relatedNotices: [prior(), prior()] }
  ])("rejects duplicate source IDs before claiming unambiguous provenance", (overrides) => {
    expect(() => buildNoticeEvidence({ ...payload, ...overrides })).toThrow("NOTICE_EVIDENCE_DUPLICATE_SOURCE_ID");
  });

  it("fingerprints the full source text and source ownership deterministically", () => {
    const first = buildNoticeEvidence(payload);
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(buildNoticeEvidence({ ...payload }).sha256).toBe(first.sha256);
    expect(buildNoticeEvidence({ ...payload, bodyText: `${payload.bodyText} Ny opplysning.` }).sha256).not.toBe(first.sha256);
    const materials = [{ id: "a", sourceId: "material_a", kind: "text", title: "A", text: "Kontekst med eget kildeeierskap" }];
    expect(buildNoticeEvidence({ ...payload, supplementalMaterials: materials }).sha256).not.toBe(
      buildNoticeEvidence({ ...payload, supplementalMaterials: [{ ...materials[0], sourceId: "material_b" }] }).sha256
    );
  });

  it("reports unavailable attachments without pretending editor materials are attachments", () => {
    const missing = buildNoticeEvidence({
      ...payload, hasAttachments: true, pdfSupplementText: " \n ",
      supplementalMaterials: [{ id: "a", sourceId: "material_a", kind: "text", title: "A", text: "Bakgrunnstekst" }]
    });
    expect(missing.attachmentTextAvailable).toBe(false);
    expect(missing.sourceLimitations).toContain("Vedlegg er ikke tilgjengelige i kildegrunnlaget.");
    const present = buildNoticeEvidence({ ...payload, hasAttachments: true, pdfSupplementText: "Faktisk tekst fra et vedlegg." });
    expect(present.attachmentTextAvailable).toBe(true);
    expect(present.sourceLimitations).toEqual([]);
    expect(buildNoticeEvidence({ ...payload, reportCompleteness: "partial" }).sourceLimitations).toHaveLength(1);
  });
});

describe("brief source evidence validation", () => {
  it("accepts literal evidence with PDF whitespace, soft hyphens and compatibility characters normalized", () => {
    const input = { ...payload, bodyText: "Selskapet\n  kutter 240 arbeids\u00adplasser. Kostnaden er 90\u00a0millioner kroner. Det gjelder ﬁre fabrikker." };
    const evidence = buildNoticeEvidence(input);
    const supported = brief({ mustInclude: [
      { id: "jobs", fact: "240 arbeidsplasser kuttes", sourceId: "primary", sourceEvidence: "Selskapet kutter 240 arbeidsplasser." },
      { id: "cost", fact: "Kostnaden er 90 millioner", sourceId: "primary", sourceEvidence: "Kostnaden er 90 millioner kroner." },
      { id: "sites", fact: "Fire fabrikker berøres", sourceId: "primary", sourceEvidence: "Det gjelder fire fabrikker." }
    ] });
    expect(validateBriefEvidence(supported, evidence)).toEqual([]);
  });

  it.each([
    { sourceId: "missing_source", sourceEvidence: payload.bodyText },
    { sourceId: "primary", sourceEvidence: "Kjøpesummen er 150 millioner kroner." },
    { sourceId: "primary", sourceEvidence: "Nordverk har inngått ... for 120 millioner kroner." },
    { sourceId: "primary", sourceEvidence: "Nordverk" }
  ])("rejects absent, paraphrased, stitched or too-short evidence", (factFields) => {
    const invalid = brief({ mustInclude: [{ ...brief().mustInclude[0], ...factFields }] });
    expect(validateBriefEvidence(invalid, buildNoticeEvidence(payload))).toContain("Fact purchase does not quote its named source exactly.");
  });

  it.each([
    ["Last year's result incl uded a gain of NOK 46 million.", "Last year's result included a gain of NOK 46 million."],
    ["Prisen i selskapets an -\nlegg økte fra 84,3 til 135,7 øre.", "Prisen i selskapets anlegg økte fra 84,3 til 135,7 øre."],
    ["Revenue 100 200 NOK million", "Revenue 100200 NOK million"]
  ])("retains exact PDF evidence without silently joining words or numeric cells: %s", (sourceText, rewrittenQuote) => {
    const evidence = buildNoticeEvidence({ ...payload, bodyText: sourceText });
    const supported = brief({ mustInclude: [{ ...brief().mustInclude[0]!, sourceEvidence: sourceText }] });
    expect(validateBriefEvidence(supported, evidence)).toEqual([]);
    const rewritten = brief({ mustInclude: [{ ...brief().mustInclude[0]!, sourceEvidence: rewrittenQuote }] });
    expect(validateBriefEvidence(rewritten, evidence)).toContain("Fact purchase does not quote its named source exactly.");
  });

  it("uses a material's source ID rather than its database ID", () => {
    const material = { id: "db_7", sourceId: "material_7", kind: "text", title: "Bakgrunn", text: "Fabrikk har 80 ansatte ved anlegget." };
    const evidence = buildNoticeEvidence({ ...payload, supplementalMaterials: [material] });
    const fact = { id: "employees", fact: "Fabrikk har 80 ansatte", sourceId: "material_7", sourceEvidence: material.text };
    expect(validateBriefEvidence(brief({ mustInclude: [fact] }), evidence)).toEqual([]);
    expect(validateBriefEvidence(brief({ mustInclude: [{ ...fact, sourceId: "db_7" }] }), evidence)).not.toEqual([]);
  });

  it("rejects duplicate fact IDs and newsworthy briefs with no facts", () => {
    const evidence = buildNoticeEvidence(payload);
    expect(validateBriefEvidence(brief({ mustInclude: [brief().mustInclude[0], brief().mustInclude[0]] }), evidence)).toContain("Duplicate fact id: purchase");
    expect(validateBriefEvidence(brief({ mustInclude: [] }), evidence)).toContain("A newsworthy brief needs at least one supported fact.");
    expect(validateBriefEvidence(brief({ newsworthy: false, mustInclude: [] }), evidence)).toEqual([]);
  });

  it("requires current-source evidence even when a historical fact is literally supported", () => {
    const earlier = prior();
    const evidence = buildNoticeEvidence({ ...payload, relatedNotices: [earlier] });
    const background = { id: "background", fact: "Nordverk forhandlet om kjøpet", sourceId: "prior_900000", sourceEvidence: earlier.text };
    expect(validateBriefEvidence(brief({ mustInclude: [background] }), evidence)).toContain("The current event cannot rest only on prior notices.");
    expect(validateBriefEvidence(brief({ mustInclude: [...brief().mustInclude, background] }), evidence)).toEqual([]);
  });

  it("accepts a useful quote only with literal source evidence, text and speaker", () => {
    const quoteText = "Lavere priser forklarer nedgangen i resultatet.";
    const sourceEvidence = `– ${quoteText} Det sier konsernsjef Kari Holm.`;
    const evidence = buildNoticeEvidence({ ...payload, bodyText: `${payload.bodyText}\n${sourceEvidence}` });
    expect(validateBriefEvidence(brief({ usefulQuote: { text: quoteText, speaker: "Kari Holm", sourceId: "primary", sourceEvidence } }), evidence)).toEqual([]);
    expect(validateBriefEvidence(brief({ usefulQuote: { text: quoteText, speaker: "Kari Holm", sourceId: "unknown", sourceEvidence } }), evidence)).not.toEqual([]);
    expect(validateBriefEvidence(brief({ usefulQuote: { text: quoteText, speaker: "Kari Holm", sourceId: "primary", sourceEvidence: "Et sitat som ikke finnes i meldingen." } }), evidence)).not.toEqual([]);
    expect(validateBriefEvidence(brief({ usefulQuote: { text: "Resultatet ble doblet.", speaker: "Kari Holm", sourceId: "primary", sourceEvidence } }), evidence)).not.toEqual([]);
    expect(validateBriefEvidence(brief({ usefulQuote: { text: quoteText, speaker: "Per Oppdiktet", sourceId: "primary", sourceEvidence } }), evidence)).not.toEqual([]);
  });
});

describe("report evidence completeness", () => {
  it.each([
    ["regular", "Halvårsrapport 2026", true],
    ["regular", "First quarter financial results", true],
    ["regular", "Interim report 2026", true],
    ["regular", "Ny kontrakt", false],
    ["report", "Finansiell oppdatering", true],
    ["yearly", "Årsrapport og resultater", false]
  ] as const)("classifies %s/%s without treating the remuneration flow as results", (kind, title, expected) => {
    expect(isResultsNotice({ ...payload, title }, kind)).toBe(expected);
  });

  it("blocks attached results when the report evidence is unavailable or insufficient", () => {
    const missing: NoticePayload = { ...payload, title: "Halvårsrapport 2026", hasAttachments: true };
    expect(reportEvidenceIssues(missing, "regular", buildNoticeEvidence(missing))).toEqual([
      "INCOMPLETE_REPORT_SOURCE: The results notice has attachments but no report evidence was obtained."
    ]);
    const insufficient: NoticePayload = { ...missing, reportText: "Forside og innholdsfortegnelse", reportCompleteness: "insufficient" };
    expect(reportEvidenceIssues(insufficient, "report", buildNoticeEvidence(insufficient))).toEqual([
      "INCOMPLETE_REPORT_SOURCE: No usable financial evidence was obtained from the report."
    ]);
    const complete: NoticePayload = { ...missing, reportText: "Inntektene var 100 millioner kroner, mot 90 millioner i fjor.", reportCompleteness: "complete" };
    expect(reportEvidenceIssues(complete, "report", buildNoticeEvidence(complete))).toEqual([]);
  });

  it("does not let an absent attachment flag override explicitly insufficient report evidence", () => {
    const insufficient: NoticePayload = { ...payload, reportText: "Forside", reportCompleteness: "insufficient", hasAttachments: false };
    expect(reportEvidenceIssues(insufficient, "report", buildNoticeEvidence(insufficient))).toEqual([
      "INCOMPLETE_REPORT_SOURCE: No usable financial evidence was obtained from the report."
    ]);
  });

  it("does not block an ordinary text notice just because it has an unavailable attachment", () => {
    const ordinary: NoticePayload = { ...payload, title: "Ny kontrakt", hasAttachments: true };
    expect(reportEvidenceIssues(ordinary, "regular", buildNoticeEvidence(ordinary))).toEqual([]);
  });
});

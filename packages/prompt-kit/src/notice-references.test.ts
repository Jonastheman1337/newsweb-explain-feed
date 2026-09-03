import { describe, expect, it } from "vitest";
import {
  MONTH_NAME_PATTERN,
  extractNoticeReferences,
  monthIndexFromName
} from "./notice-references.js";

const PUBLISHED_AT = "2026-06-02T07:00:00Z";

function extract(text: string, publishedAt = PUBLISHED_AT, max?: number) {
  return extractNoticeReferences(text, { publishedAt, max });
}

describe("MONTH_NAME_PATTERN", () => {
  it("matches every Norwegian and English month name, full and abbreviated", () => {
    const regex = new RegExp(`^(?:${MONTH_NAME_PATTERN})$`, "i");
    const names = [
      "jan", "januar", "january",
      "feb", "februar", "february",
      "mar", "mars", "march",
      "apr", "april",
      "mai", "may",
      "jun", "juni", "june",
      "jul", "juli", "july",
      "aug", "august",
      "sep", "sept", "september",
      "okt", "oktober", "oct", "october",
      "nov", "november",
      "des", "desember", "dec", "december"
    ];
    for (const name of names) {
      expect(regex.test(name), name).toBe(true);
      expect(regex.test(name.toUpperCase()), name.toUpperCase()).toBe(true);
    }
    expect(regex.test("mayo")).toBe(false);
    expect(regex.test("juno")).toBe(false);
  });

  it("stays a superset of the worker reference-check month pattern", () => {
    const workerPattern =
      "jan(?:uar)?|feb(?:ruar)?|mars|apr(?:il)?|mai|jun(?:i)?|jul(?:i)?|aug(?:ust)?|sep(?:tember)?|okt(?:ober)?|nov(?:ember)?|des(?:ember)?|january|february|march|april|may|june|july|august|september|october|november|december";
    const ours = new RegExp(`^(?:${MONTH_NAME_PATTERN})$`, "i");
    const expanded = [
      "jan", "januar", "feb", "februar", "mars", "apr", "april", "mai", "jun", "juni",
      "jul", "juli", "aug", "august", "sep", "september", "okt", "oktober", "nov",
      "november", "des", "desember", "january", "february", "march", "may", "june",
      "july", "october", "december"
    ];
    const theirs = new RegExp(`^(?:${workerPattern})$`, "i");
    for (const name of expanded) {
      expect(theirs.test(name), `worker pattern sanity: ${name}`).toBe(true);
      expect(ours.test(name), `superset: ${name}`).toBe(true);
    }
  });
});

describe("monthIndexFromName", () => {
  it("maps Norwegian and English names and abbreviations to 0-11", () => {
    expect(monthIndexFromName("januar")).toBe(0);
    expect(monthIndexFromName("January")).toBe(0);
    expect(monthIndexFromName("mars")).toBe(2);
    expect(monthIndexFromName("March")).toBe(2);
    expect(monthIndexFromName("mai")).toBe(4);
    expect(monthIndexFromName("MAY")).toBe(4);
    expect(monthIndexFromName("juni")).toBe(5);
    expect(monthIndexFromName("Sept.")).toBe(8);
    expect(monthIndexFromName(" okt ")).toBe(9);
    expect(monthIndexFromName("oct")).toBe(9);
    expect(monthIndexFromName("desember")).toBe(11);
    expect(monthIndexFromName("DECEMBER")).toBe(11);
  });

  it("returns null for unknown input", () => {
    expect(monthIndexFromName("foo")).toBeNull();
    expect(monthIndexFromName("")).toBeNull();
    expect(monthIndexFromName("constructor")).toBeNull();
  });
});

describe("extractNoticeReferences", () => {
  it("returns [] for empty, whitespace-only and non-string input", () => {
    expect(extract("")).toEqual([]);
    expect(extract("   \n\n  ")).toEqual([]);
    expect(
      extractNoticeReferences(undefined as unknown as string, { publishedAt: PUBLISHED_AT })
    ).toEqual([]);
    expect(
      extractNoticeReferences(42 as unknown as string, { publishedAt: PUBLISHED_AT })
    ).toEqual([]);
  });

  it("extracts an English 'published by X on <date> regarding' reference", () => {
    const text =
      'Oslo, 2 June 2026: Reference is made to the stock exchange announcement published by Circio Holding ASA (the "Company") on 26 May 2026 regarding commencement of the exercise period for warrants from 26 May to 9 June 2026.';
    const refs = extract(text);

    expect(refs).toHaveLength(1);
    expect(refs[0].date).toBe("2026-05-26");
    expect(refs[0].relativeDay).toBeNull();
    expect(refs[0].topic?.startsWith("commencement of the exercise period")).toBe(true);
    expect(refs[0].raw.startsWith("Reference is made to the stock exchange announcement")).toBe(true);
    expect(refs[0].raw.length).toBeLessThanOrEqual(300);
    expect(refs[0].messageId).toBeUndefined();
  });

  it("cuts the topic at the sentence end", () => {
    const text =
      'Oslo, 2 June 2026 Reference is made to the stock exchange notice published by CodeLab Capital AS (the "Company") on 29 April 2026 regarding the Company\'s acquisition of 100% of Agil Helse AS. All closing conditions have been met.';
    const refs = extract(text);

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      date: "2026-04-29",
      relativeDay: null,
      topic: "the Company's acquisition of 100% of Agil Helse AS"
    });
    expect(refs[0].raw.endsWith("Agil Helse AS.")).toBe(true);
  });

  it("derives the date from publishedAt for 'earlier today'", () => {
    const text =
      "Reference is made to the stock exchange announcement made by the Company earlier today regarding updated key information related to the rights issue.";
    const refs = extract(text, "2026-06-02T12:00:00Z");

    expect(refs).toEqual([
      {
        raw: text,
        date: "2026-06-02",
        relativeDay: "today",
        topic: "updated key information related to the rights issue"
      }
    ]);
  });

  it("uses the Europe/Oslo calendar date, not UTC, for relative days", () => {
    const text =
      "Reference is made to the stock exchange announcement published earlier today regarding the private placement.";
    // 22:30 UTC on 1 June is 00:30 CEST on 2 June in Oslo.
    const refs = extract(text, "2026-06-01T22:30:00Z");

    expect(refs).toHaveLength(1);
    expect(refs[0].date).toBe("2026-06-02");
    expect(refs[0].relativeDay).toBe("today");
  });

  it("handles 'yesterday'", () => {
    const text =
      "As announced yesterday, the Company has completed the private placement.";
    const refs = extract(text, "2026-06-02T12:00:00Z");

    expect(refs).toHaveLength(1);
    expect(refs[0].date).toBe("2026-06-01");
    expect(refs[0].relativeDay).toBe("yesterday");
  });

  it("merges 'today, 2 June 2026,' into one reference with the explicit date", () => {
    const text =
      'Reference is made to the stock exchange announcement published by Magnora ASA\'s subsidiary Magnora Data Center ASA (the "Company", with OSE ticker: "MDATA") today, 2 June 2026, regarding its private placement';
    const refs = extract(text, "2026-06-02T15:00:00Z");

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      date: "2026-06-02",
      relativeDay: "today",
      topic: "its private placement"
    });
  });

  it("extracts 'Det vises til børsmelding <dato> vedrørende'", () => {
    const text =
      "Det vises til børsmelding 23. juni 2026 vedrørende bygging av datasenter i Kvandal - Narvik. HENT har nå signert kontrakt med byggherre for prosjektet.";
    const refs = extract(text, "2026-07-01T08:00:00Z");

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      date: "2026-06-23",
      relativeDay: null,
      topic: "bygging av datasenter i Kvandal - Narvik"
    });
    expect(refs[0].raw).toBe(
      "Det vises til børsmelding 23. juni 2026 vedrørende bygging av datasenter i Kvandal - Narvik."
    );
  });

  it("extracts 'Det vises til dagens børsmelding om «…»'", () => {
    const refs = extract(
      "Det vises til dagens børsmelding om «tildeling av egenkapitalbevis i spareprogram for ansatte». Primærinnsidere har mottatt egenkapitalbevis.",
      "2026-06-11T11:05:00Z"
    );

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      date: "2026-06-11",
      relativeDay: "today",
      topic: "tildeling av egenkapitalbevis i spareprogram for ansatte"
    });
  });

  it("accepts a Norwegian day without the trailing dot", () => {
    const text =
      "Det vises til børsmelding 23 desember 2025 vedrørende bygging av datasenter i Narvik.";
    const refs = extract(text);

    expect(refs).toHaveLength(1);
    expect(refs[0].date).toBe("2025-12-23");
    expect(refs[0].topic).toBe("bygging av datasenter i Narvik");
  });

  it("extracts 'Det vises til børsmelding av <dato> om'", () => {
    const text =
      "Det vises til børsmelding av 23. juni 2026 om inngåelse av kontrakt med Statkraft. Selskapet har i dag mottatt endelig godkjenning.";
    const refs = extract(text, "2026-06-30T08:00:00Z");

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      date: "2026-06-23",
      topic: "inngåelse av kontrakt med Statkraft"
    });
  });

  it("extracts 'Det vises til melding publisert dd.mm.yyyy'", () => {
    const refs = extract("Det vises til melding publisert 23.06.2026. Styret har vedtatt utbytte.", "2026-06-30T08:00:00Z");

    expect(refs).toHaveLength(1);
    expect(refs[0].date).toBe("2026-06-23");
    expect(refs[0].topic).toBeNull();
  });

  it("extracts 'Som meldt <dato>'", () => {
    const refs = extract("Som meldt 23. juni 2026 har selskapet gjennomført emisjonen.", "2026-06-30T08:00:00Z");

    expect(refs).toHaveLength(1);
    expect(refs[0].date).toBe("2026-06-23");
  });

  it("extracts 'stock exchange notice published on <date> regarding'", () => {
    const text =
      "Reference is made to the stock exchange notice published on 2 June 2026 regarding a potential secondary placement of existing ordinary shares.";
    const refs = extract(text, "2026-06-03T08:00:00Z");

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      date: "2026-06-02",
      topic: "a potential secondary placement of existing ordinary shares"
    });
  });

  it("extracts 'as announced on', 'previously announced on' and 'Further to the announcement of'", () => {
    expect(extract("The offer period, as announced on 26 May 2026, has now expired.")[0]).toMatchObject({
      date: "2026-05-26"
    });
    expect(extract("The Company has, as previously announced on 26 May 2026, completed the transaction.")[0]).toMatchObject({
      date: "2026-05-26"
    });
    expect(extract("Further to the announcement of 26 May 2026, the Company confirms the allocation.")[0]).toMatchObject({
      date: "2026-05-26"
    });
  });

  it("extracts 'press release issued <date> regarding'", () => {
    const text =
      "Reference is made to the press release issued 17 April 2026 regarding the tax case.";
    expect(extract(text)).toHaveLength(1);
    expect(extract(text)[0]).toMatchObject({ date: "2026-04-17", topic: "the tax case" });
  });

  it("parses every supported date format", () => {
    const cases: Array<[string, string]> = [
      ["26 May 2026", "2026-05-26"],
      ["26th May 2026", "2026-05-26"],
      ["May 26, 2026", "2026-05-26"],
      ["26.05.2026", "2026-05-26"],
      ["2026-05-26", "2026-05-26"],
      ["1 January 2026", "2026-01-01"],
      ["2nd of June 2026", "2026-06-02"]
    ];
    for (const [literal, iso] of cases) {
      const refs = extract(`Reference is made to the announcement published on ${literal} regarding the placement.`);
      expect(refs, literal).toHaveLength(1);
      expect(refs[0].date, literal).toBe(iso);
    }
  });

  it("rejects impossible calendar dates", () => {
    expect(extract("Reference is made to the announcement published on 31 February 2026 regarding X.")).toEqual([]);
    expect(extract("Reference is made to the announcement published on 32.05.2026 regarding X.")).toEqual([]);
  });

  it("returns two references with the same raw for a sentence citing two dates", () => {
    const text =
      'Reference is made to the press release issued 17 April 2026 regarding the unanimous verdict of the Gulating Court of Appeal in favour of Odfjell Offshore Ltd ("OFO") in the longstanding tax case, and to the Norwegian Tax Authorities\' subsequent appeal to the Supreme Court in the press release issued 19 May 2026.';
    const refs = extract(text);

    expect(refs).toHaveLength(2);
    expect(refs[0].date).toBe("2026-04-17");
    expect(refs[1].date).toBe("2026-05-19");
    expect(refs[0].raw).toBe(refs[1].raw);
    expect(refs[0].raw.length).toBeLessThanOrEqual(300);
    expect(refs[0].topic?.startsWith("the unanimous verdict of the Gulating Court of Appeal")).toBe(true);
    expect(refs[1].topic).toBe(
      "the Norwegian Tax Authorities' subsequent appeal to the Supreme Court"
    );
  });

  it("shares the topic between sibling dates joined by 'and'", () => {
    const text =
      "Reference is made to the stock exchange announcements published on 26 May 2026 and 28 May 2026 regarding the rights issue.";
    const refs = extract(text);

    expect(refs).toHaveLength(2);
    expect(refs.map((ref) => ref.date)).toEqual(["2026-05-26", "2026-05-28"]);
    expect(refs[0].topic).toBe("the rights issue");
    expect(refs[1].topic).toBe("the rights issue");
  });

  it("gives year-less sibling dates the year of the dated sibling", () => {
    const english = extract(
      "Reference is made to the stock exchange notices on 16 July and 31 July 2026 regarding the optional cash offer from Aker Capital AS.",
      "2026-08-17T07:00:00Z"
    );
    expect(english.map((ref) => ref.date)).toEqual(["2026-07-16", "2026-07-31"]);
    expect(english.map((ref) => ref.topic)).toEqual([
      "the optional cash offer from Aker Capital AS",
      "the optional cash offer from Aker Capital AS"
    ]);

    const norwegian = extract(
      "Det vises til børsmelding offentliggjort av Romerike Sparebank 12. februar og 26. mars 2026 vedrørende konvertering av grunnfondskapital.",
      "2026-06-24T07:00:00Z"
    );
    expect(norwegian.map((ref) => ref.date)).toEqual(["2026-02-12", "2026-03-26"]);
    expect(norwegian[0].topic).toBe("konvertering av grunnfondskapital");

    const three = extract("As announced on 7 April, 20 May and 1 June 2026, the case is closed.");
    expect(three.map((ref) => ref.date)).toEqual(["2026-04-07", "2026-05-20", "2026-06-01"]);
  });

  it("does not treat 'in this announcement' as a citation", () => {
    expect(
      extract(
        "Any subscription for shares in this announcement will be made by means of the Prospectus approved by the Norwegian Financial Supervisory Authority on 22 May 2026."
      )
    ).toEqual([]);
  });

  it("ignores dates that belong to documents rather than notices", () => {
    expect(
      extract(
        'As described in the prospectus for the Offering dated 8 June 2026 (the "Prospectus"), the Offer Shares will be delivered on 20 June 2026.',
        "2026-06-16T07:00:00Z"
      )
    ).toEqual([]);

    const refs = extract(
      'Reference is made to the joint announcement on 21 July 2026 by BlueNord ASA and Vår Energi ASA regarding the proposed statutory merger (the "Merger") pursuant to the merger plan dated 20 July 2026 (the "Merger Plan").',
      "2026-08-24T07:00:00Z"
    );
    expect(refs).toHaveLength(1);
    expect(refs[0].date).toBe("2026-07-21");
    expect(refs[0].topic?.startsWith("the proposed statutory merger")).toBe(true);
  });

  it("requires the date to follow 'as previously announced' directly", () => {
    expect(
      extract(
        "As previously announced, the Company has agreed that the initial amount under the shareholder loan agreement entered into with certain lenders on 20 January 2026 will be set off."
      )
    ).toEqual([]);
    expect(extract("As announced yesterday, on 1 June 2026, Euronext Oslo Børs has approved the listing.")).toMatchObject([
      { date: "2026-06-01", relativeDay: "yesterday" }
    ]);
  });

  it("only uses weak topic triggers (on/om/of/where) directly after the date", () => {
    const where = extract(
      'Reference is made to the stock exchange announcement published today on 3 June 2026, where Magnora Data Center ASA (the "Company") announced that a share incentive programme was approved.',
      "2026-06-03T09:00:00Z"
    );
    expect(where).toHaveLength(1);
    expect(where[0]).toMatchObject({ date: "2026-06-03", relativeDay: "today" });
    expect(where[0].topic?.startsWith("Magnora Data Center ASA")).toBe(true);

    const farAway = extract(
      "As announced on 31 July 2026, the board of directors has, on behalf of the Company, entered into a convertible loan agreement.",
      "2026-08-05T07:00:00Z"
    );
    expect(farAway).toHaveLength(1);
    expect(farAway[0]).toMatchObject({ date: "2026-07-31", topic: null });
  });

  it("returns nothing for 'previously announced' without a date or relative day", () => {
    expect(
      extract("The Company has placed the previously announced retail private placement.")
    ).toEqual([]);
  });

  it("ignores dates that are not publication dates", () => {
    expect(
      extract(
        "Reference is made to the notice of the extraordinary general meeting to be held on 15 May 2026."
      )
    ).toEqual([]);
  });

  it("drops references dated after the publication date", () => {
    const text =
      "Reference is made to the announcement published on 10 June 2026 regarding the placement.";
    expect(extract(text, "2026-06-02T07:00:00Z")).toEqual([]);
    expect(extract(text, "2026-06-10T07:00:00Z")).toHaveLength(1);
  });

  it("drops duplicates with the same date and topic (case-insensitive)", () => {
    const text = [
      "Reference is made to the announcement published on 26 May 2026 regarding the private placement.",
      "The Company has completed the delivery of the new shares.",
      'Reference is made to the stock exchange announcement published on 26 May 2026 regarding the Private Placement (the "Private Placement").'
    ].join("\n\n");
    const refs = extract(text);

    expect(refs).toHaveLength(1);
    expect(refs[0].date).toBe("2026-05-26");
    expect(refs[0].topic).toBe("the private placement");
  });

  it("merges a later-cited message id into an earlier duplicate reference", () => {
    const text = [
      "Reference is made to the announcement published on 26 May 2026 regarding the private placement.",
      "See the announcement published on 26 May 2026 regarding the private placement (https://newsweb.oslobors.no/message/681058)."
    ].join(" ");
    const refs = extract(text);

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ date: "2026-05-26", messageId: 681058 });
  });

  it("keeps same-date references with different topics", () => {
    const text = [
      "Reference is made to the announcement published on 26 May 2026 regarding the private placement.",
      "Reference is also made to the announcement published on 26 May 2026 regarding the change of CEO."
    ].join(" ");
    const refs = extract(text);

    expect(refs).toHaveLength(2);
    expect(refs.map((ref) => ref.topic)).toEqual(["the private placement", "the change of CEO"]);
  });

  it("caps the number of references in document order", () => {
    const text = [
      "Reference is made to the announcement published on 1 May 2026 regarding A.",
      "Reference is made to the announcement published on 2 May 2026 regarding B.",
      "Reference is made to the announcement published on 3 May 2026 regarding C.",
      "Reference is made to the announcement published on 4 May 2026 regarding D."
    ].join("\n\n");

    expect(extract(text).map((ref) => ref.date)).toEqual(["2026-05-01", "2026-05-02", "2026-05-03"]);
    expect(extract(text, PUBLISHED_AT, 2).map((ref) => ref.date)).toEqual(["2026-05-01", "2026-05-02"]);
    expect(extract(text, PUBLISHED_AT, 10)).toHaveLength(4);
    expect(extract(text, PUBLISHED_AT, 0)).toEqual([]);
  });

  it("extracts a literal Newsweb URL as a messageId", () => {
    const text =
      "For details, see https://newsweb.oslobors.no/message/681058. The transaction closed today.";
    const refs = extract(text);

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ messageId: 681058, date: null, relativeDay: null });
    expect(refs[0].raw).toContain("newsweb.oslobors.no/message/681058");
  });

  it("extracts 'message id 681058'", () => {
    const refs = extract("Reference is made to Newsweb message id 681058 regarding the placement.");

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ messageId: 681058, date: null, topic: "the placement" });
  });

  it("attaches a cited message id to the dated reference in the same sentence", () => {
    const text =
      "Reference is made to the announcement published on 26 May 2026 (https://newsweb.oslobors.no/message/681058) regarding the placement.";
    const refs = extract(text);

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      date: "2026-05-26",
      messageId: 681058,
      topic: "the placement"
    });
  });

  it("does not set messageId when none is cited", () => {
    const refs = extract("Reference is made to the announcement published on 26 May 2026 regarding the placement.");
    expect(refs).toHaveLength(1);
    expect("messageId" in refs[0]).toBe(false);
  });

  it("strips a trailing defined-term parenthetical from the topic", () => {
    const text =
      'Reference is made to the announcement published on 26 May 2026 regarding the private placement (the "Private Placement").';
    expect(extract(text)[0].topic).toBe("the private placement");
  });

  it("caps the topic at 160 characters", () => {
    const longTopic = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const text = `Reference is made to the announcement published on 26 May 2026 regarding ${longTopic}.`;
    const refs = extract(text);

    expect(refs).toHaveLength(1);
    expect(refs[0].topic?.length).toBeLessThanOrEqual(160);
    expect(refs[0].topic?.startsWith("word0 word1")).toBe(true);
  });

  it("handles hard-wrapped bodies with newlines inside the sentence", () => {
    const text =
      "Oslo, 9 June 2026: Reference is made to the stock exchange announcement\npublished by Circio Holding ASA (OSE: CRNA) (the \"Company\") on 26 May 2026\nregarding the exercise period for warrants.\nThe Company has today received notice of exercise.";
    const refs = extract(text, "2026-06-09T07:00:00Z");

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      date: "2026-05-26",
      topic: "the exercise period for warrants"
    });
    expect(refs[0].raw).not.toContain("\n");
  });

  it("does not let a date in the next sentence leak into an 'earlier today' reference", () => {
    const text =
      "Reference is made to the stock exchange announcement made by the Company earlier\ntoday regarding updated key information related to the rights issue. The USD/NOK\ndaily exchange rate published by Norges Bank on 2 June 2026 at 16:00 (CEST) was 10.5.";
    const refs = extract(text, "2026-06-03T07:00:00Z");

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      date: "2026-06-03",
      relativeDay: "today",
      topic: "updated key information related to the rights issue"
    });
  });

  it("keeps explicit dates but leaves relative dates null when publishedAt is unusable", () => {
    const text =
      "Reference is made to the announcement published earlier today regarding the placement. Reference is also made to the announcement published on 26 May 2026 regarding the rights issue.";
    const refs = extractNoticeReferences(text, { publishedAt: "not a date" });

    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ date: null, relativeDay: "today", topic: "the placement" });
    expect(refs[1]).toMatchObject({ date: "2026-05-26", relativeDay: null, topic: "the rights issue" });
  });

  it("does not throw on odd input", () => {
    expect(() => extractNoticeReferences("Reference is made to \u0000\uFFFF 99.99.9999", { publishedAt: "" })).not.toThrow();
    expect(() =>
      extractNoticeReferences("Det vises til børsmelding", undefined as unknown as { publishedAt: string })
    ).not.toThrow();
    expect(extractNoticeReferences("Reference is made to ".repeat(2000), { publishedAt: PUBLISHED_AT })).toEqual([]);
  });

  it("scans a long body without blowing up", () => {
    const filler = "The Company continues to execute on its strategy across all business areas. ".repeat(400);
    const text = `${filler}Reference is made to the announcement published on 26 May 2026 regarding the placement. ${filler}`;
    const started = Date.now();
    const refs = extract(text);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(refs).toHaveLength(1);
    expect(refs[0].date).toBe("2026-05-26");
  });
});

describe("extractNoticeReferences includeUndated", () => {
  const nykode =
    'Oslo, 27 August 2026\n\nReference is made to the stock exchange notice published by Nykode Therapeutics ASA ("Nykode" or the "Company", ticker code "NYKD") related to the contemplated private placement in the Company (the "Private Placement"). \n\nThe Company is pleased to announce that the Private Placement has been successfully placed.';

  it("drops undated formula references by default", () => {
    expect(
      extractNoticeReferences(nykode, { publishedAt: "2026-08-27T21:51:37.331Z" })
    ).toEqual([]);
  });

  it("keeps an undated formula reference with a topic when opted in", () => {
    const references = extractNoticeReferences(nykode, {
      publishedAt: "2026-08-27T21:51:37.331Z",
      includeUndated: true
    });
    expect(references).toHaveLength(1);
    expect(references[0].date).toBeNull();
    expect(references[0].relativeDay).toBeNull();
    expect(references[0].topic).toMatch(/contemplated private placement/i);
  });

  it("still drops undated mentions that are not the citation formula", () => {
    expect(
      extractNoticeReferences(
        "The Company has placed the previously announced retail private placement of new shares.",
        { publishedAt: "2026-06-02T12:00:00.000Z", includeUndated: true }
      )
    ).toEqual([]);
  });
});

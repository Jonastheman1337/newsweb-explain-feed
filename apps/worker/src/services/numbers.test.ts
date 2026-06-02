import { findUnexpectedNumbers } from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";

describe("findUnexpectedNumbers", () => {
  it("flags numbers that are missing from source", () => {
    const rewrite: RewriteOutput = {
      title: "Selskapet melder oppdatering",
      lead: "Dette er en test med tall i teksten for validering.",
      body: [
        "Selskapet oppgir 100 i inntekt for perioden.",
        "Resultatet var 50 og marginen var 10%.",
        "Videre forventes 200 i neste kvartal."
      ],
      company_sentence: "Test AS er selskapet bak meldingen.",
      key_facts: ["Inntekt 100", "Resultat 50", "Forventning 200"],
      negative_or_surprising: [],
      excluded_hype: [],
      source_limitations: [],
      confidence: "medium",
      importance: "medium",
      source_spans: ["Inntekt 100", "Resultat 50"]
    };

    const missing = findUnexpectedNumbers(rewrite, "Inntekt 100. Resultat 50.");
    expect(missing).toContain("200");
  });

  it("accepts locale decimal/thousand formatting variants from source", () => {
    const rewrite: RewriteOutput = {
      title: "Pris fastsatt i meldingen",
      lead: "Selskapet opplyser om tegningskurs og antall instrumenter.",
      body: [
        "Tegningskursen er satt til 0,3342 kroner per aksje.",
        "Det ble utstedt 129000033 warrants i transaksjonen.",
        "Handel stopper 6. mars 2026 klokken 16:30."
      ],
      company_sentence: "Test ASA er notert pa Euronext Oslo Bors.",
      key_facts: ["Pris 0,3342", "Antall 129000033", "Stopp 6. mars 2026"],
      negative_or_surprising: [],
      excluded_hype: [],
      source_limitations: [],
      confidence: "medium",
      importance: "medium",
      source_spans: ["129,000,033 warrants", "NOK 0.3342 per share"]
    };

    const source =
      "A total of 129,000,033 warrants were issued at NOK 0.3342 per share. Trading ends on 6 March 2026 at 16:30.";

    const missing = findUnexpectedNumbers(rewrite, source);
    expect(missing).toEqual([]);
  });

  it("accepts exact report numbers when source uses spaced thousands and rewrite uses dots", () => {
    const rewrite: RewriteOutput = {
      title: "BeeLux-resultat for skatt faller",
      lead:
        "BeeLux fikk et resultat for skatt pa 1.402.704 euro i 2025, ned fra 7.064.970 euro aret for.",
      body: [
        "Driftsinntektene falt til 48.858.000 euro fra 59.268.000 euro.",
        "Driftsresultatet falt til 982.426 euro, mot 7.492.653 euro i 2024.",
        "Resultatet etter skatt endte pa 5.173.704 euro, ned fra 5.635.970 euro."
      ],
      company_sentence: "BeeLux er et Luxembourg-registrert selskap.",
      key_facts: [
        "Resultat for skatt 1.402.704 euro",
        "Driftsinntekter 48.858.000 euro"
      ],
      negative_or_surprising: ["Resultat for skatt falt fra aret for"],
      excluded_hype: [],
      source_limitations: [],
      confidence: "high",
      importance: "uviktig",
      source_spans: [
        "PROFIT (LOSS) BEFORE TAX 1 402 704 7 064 970",
        "Operating revenue 48 858 000 59 268 000"
      ]
    };

    const source = [
      "PROFIT (LOSS) BEFORE TAX 2025/12 1 402 704 2024/12 7 064 970",
      "Operating revenue 48 858 000 59 268 000",
      "PROFIT (LOSS) FROM OPERATIONS 982 426 7 492 653",
      "PROFIT AFTER TAX 5 173 704 5 635 970"
    ].join("\n");

    const missing = findUnexpectedNumbers(rewrite, source);
    expect(missing).toEqual([]);
  });

  it("still flags off-by-one report numbers after thousands normalization", () => {
    const rewrite: RewriteOutput = {
      title: "BeeLux-resultat for skatt faller",
      lead:
        "BeeLux fikk et resultat for skatt pa 1.402.705 euro i 2025, ned fra 7.064.970 euro aret for.",
      body: ["Driftsinntektene falt til 48.858.000 euro fra 59.268.000 euro."],
      company_sentence: "BeeLux er et Luxembourg-registrert selskap.",
      key_facts: ["Resultat for skatt 1.402.705 euro"],
      negative_or_surprising: ["Resultat for skatt falt fra aret for"],
      excluded_hype: [],
      source_limitations: [],
      confidence: "high",
      importance: "uviktig",
      source_spans: ["PROFIT (LOSS) BEFORE TAX 1 402 704 7 064 970"]
    };

    const source =
      "PROFIT (LOSS) BEFORE TAX 2025/12 1 402 704 2024/12 7 064 970. Operating revenue 48 858 000 59 268 000.";

    const missing = findUnexpectedNumbers(rewrite, source);
    expect(missing).toContain("1.402.705");
  });

  it("accepts rounded million figures from explicitly thousand-scaled report tables", () => {
    const rewrite: RewriteOutput = {
      title: "CMM oker inntektene",
      lead:
        "CMM okte inntektene til 33,6 millioner dollar i kvartalet, fra 12,1 millioner dollar aret for.",
      body: [
        "Driftsresultatet var 3,1 millioner dollar, mot 3,2 millioner i samme kvartal i fjor.",
        "Resultatet for skatt steg til 6,2 millioner dollar, fra 4,0 millioner aret for."
      ],
      company_sentence: "CMM har flere fartoykontrakter med Petrobras.",
      key_facts: [
        "Inntekter 33,6 millioner dollar",
        "Driftsresultat 3,1 millioner dollar",
        "Resultat for skatt 6,2 millioner dollar"
      ],
      negative_or_surprising: [],
      excluded_hype: [],
      source_limitations: [],
      confidence: "high",
      importance: "medium",
      source_spans: [
        "Revenue 33,613 12,118",
        "Operating Profit 3,100 3,244",
        "Result before corporate income tax 6,232 4,027"
      ]
    };

    const source = [
      "Consolidated statement of income",
      "(in USD thousands)",
      "Revenue 33,613 12,118",
      "Operating Profit 3,100 3,244",
      "Result before corporate income tax 6,232 4,027"
    ].join("\n");

    const missing = findUnexpectedNumbers(rewrite, source);
    expect(missing).toEqual([]);
  });

  it("rejects rounded million figures when the table scale is not explicit", () => {
    const rewrite: RewriteOutput = {
      title: "CMM oker inntektene",
      lead:
        "CMM okte inntektene til 33,6 millioner dollar i kvartalet, fra 12,1 millioner dollar aret for.",
      body: ["Driftsresultatet var 3,1 millioner dollar."],
      company_sentence: "CMM har flere fartoykontrakter med Petrobras.",
      key_facts: ["Inntekter 33,6 millioner dollar"],
      negative_or_surprising: [],
      excluded_hype: [],
      source_limitations: [],
      confidence: "high",
      importance: "medium",
      source_spans: ["Revenue 33,613 12,118"]
    };

    const source = [
      "Consolidated statement of income",
      "Revenue 33,613 12,118",
      "Operating Profit 3,100 3,244"
    ].join("\n");

    const missing = findUnexpectedNumbers(rewrite, source);
    expect(missing).toContain("33,6");
  });

  it("rejects incorrectly rounded million figures from thousand-scaled tables", () => {
    const rewrite: RewriteOutput = {
      title: "CMM oker inntektene",
      lead:
        "CMM okte inntektene til 33,7 millioner dollar i kvartalet, fra 12,1 millioner dollar aret for.",
      body: [],
      company_sentence: "CMM har flere fartoykontrakter med Petrobras.",
      key_facts: ["Inntekter 33,7 millioner dollar"],
      negative_or_surprising: [],
      excluded_hype: [],
      source_limitations: [],
      confidence: "high",
      importance: "medium",
      source_spans: ["Revenue 33,613 12,118"]
    };

    const source = [
      "Consolidated statement of income",
      "Amounts are in USD thousands",
      "Revenue 33,613 12,118"
    ].join("\n");

    const missing = findUnexpectedNumbers(rewrite, source);
    expect(missing).toContain("33,7");
  });

  it("rejects scaled table matches when rewrite text omits the million unit", () => {
    const rewrite: RewriteOutput = {
      title: "CMM oker inntektene",
      lead:
        "CMM okte inntektene til 33,6 dollar i kvartalet, fra 12,1 dollar aret for.",
      body: [],
      company_sentence: "CMM har flere fartoykontrakter med Petrobras.",
      key_facts: ["Inntekter 33,6 dollar"],
      negative_or_surprising: [],
      excluded_hype: [],
      source_limitations: [],
      confidence: "high",
      importance: "medium",
      source_spans: ["Revenue 33,613 12,118"]
    };

    const source = [
      "Consolidated statement of income",
      "Amounts are in USD thousands",
      "Revenue 33,613 12,118"
    ].join("\n");

    const missing = findUnexpectedNumbers(rewrite, source);
    expect(missing).toContain("33,6");
  });

  it("normalizes punctuation around date tokens", () => {
    const rewrite: RewriteOutput = {
      title: "Rapportdato bekreftet",
      lead: "Selskapet la frem rapporten 27. februar 2026.",
      body: [
        "Rapporten gjelder fjerde kvartal 2025.",
        "Presentasjon holdes samme dag klokken 10:00.",
        "Neste oppdatering ventes i april."
      ],
      company_sentence: "Test AS leverer digitale tjenester til energisektoren.",
      key_facts: ["Dato 27. februar 2026", "Kvartal Q4 2025", "Tid 10:00"],
      negative_or_surprising: [],
      excluded_hype: [],
      source_limitations: [],
      confidence: "medium",
      importance: "medium",
      source_spans: ["27 February 2026", "Q4 2025"]
    };

    const source =
      "The report was published on 27 February 2026 and covers Q4 2025. Presentation starts at 10:00.";
    const missing = findUnexpectedNumbers(rewrite, source);
    expect(missing).toEqual([]);
  });

  it("accepts Norwegian clock punctuation when source uses colon time", () => {
    const rewrite: RewriteOutput = {
      title: "Webcast torsdag morgen",
      lead: "Selskapet holder webcast torsdag 4. juni klokken 9.30.",
      body: ["Presentasjonen holdes på engelsk."],
      company_sentence: "Test AS utvikler medisinsk teknologi.",
      key_facts: ["Webcast klokken 9.30"],
      negative_or_surprising: [],
      excluded_hype: [],
      source_limitations: [],
      confidence: "medium",
      importance: "uviktig",
      source_spans: ["webcast at 9:30 AM CET"]
    };

    const source =
      "The company will host a webcast on Thursday, 4 June 2026, at 9:30 AM CET.";

    const missing = findUnexpectedNumbers(rewrite, source);
    expect(missing).toEqual([]);
  });

  it("accepts Norwegian thousands separators when source uses unseparated integers", () => {
    const rewrite: RewriteOutput = {
      title: "Lavere inntekter for Loch Duart",
      lead: "Selskapet fikk lavere inntekter etter redusert hostet tonnasje.",
      body: [
        "Selskapet hostet 8.142 tonn GWT i regnskapsaret, opp fra 5.620 tonn aret for."
      ],
      company_sentence: "Loch Duart rapporterer om hostet tonnasje og fiskedodelighet.",
      key_facts: ["Hostet 8.142 tonn GWT", "Opp fra 5.620 tonn"],
      negative_or_surprising: [],
      excluded_hype: [],
      source_limitations: [],
      confidence: "medium",
      importance: "medium",
      source_spans: [
        "with 8142T GWT harvested, a rise from 5620T GWT in the prior year"
      ]
    };

    const source =
      "The report states that 8142T GWT was harvested, a rise from 5620T GWT in the prior year.";

    const missing = findUnexpectedNumbers(rewrite, source);
    expect(missing).toEqual([]);
  });

  it("treats percent signs and prosent wording as the same number", () => {
    const rewrite: RewriteOutput = {
      title: "Marginen steg",
      lead: "Selskapet opplyser at marginen var 10 prosent.",
      body: ["Omsetningen steg 12 prosent i perioden."],
      company_sentence: "Test AS leverer digitale tjenester.",
      key_facts: ["Margin 10 prosent", "Omsetning opp 12 prosent"],
      negative_or_surprising: [],
      excluded_hype: [],
      source_limitations: [],
      confidence: "medium",
      importance: "medium",
      source_spans: ["margin was 10%", "revenue increased 12 percent"]
    };

    const source = "The margin was 10% and revenue increased 12 percent.";
    const missing = findUnexpectedNumbers(rewrite, source);
    expect(missing).toEqual([]);
  });
});

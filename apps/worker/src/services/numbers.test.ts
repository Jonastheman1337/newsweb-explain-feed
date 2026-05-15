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

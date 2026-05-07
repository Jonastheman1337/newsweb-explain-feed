import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import {
  createRevisionUserPrompt,
  type PromptPayload
} from "./prompt.js";
import {
  createReportRevisionUserPrompt,
  type ReportPromptPayload
} from "./report-prompt.js";
import {
  createYearlyReportRevisionUserPrompt,
  type YearlyReportPromptPayload
} from "./yearly-report-prompt.js";

const samplePayload: PromptPayload = {
  messageId: 12345,
  title: "Test melding",
  issuerName: "Test ASA",
  issuerSign: "TEST",
  publishedAt: "2026-01-15T10:00:00Z",
  categories: ["Innsideinformasjon"],
  markets: ["Oslo Børs"],
  bodyText: "Selskapet har inngått en avtale om kjøp av 100% av aksjene.",
  hasAttachments: false,
  sourceBodyChars: 55
};

const sampleOutput: RewriteOutput = {
  title: "Test kjøper selskap",
  lead: "Test ASA kjøper et selskap, ifølge en børsmelding.",
  body: [
    "Avtalen gjelder kjøp av alle aksjene.",
    "Transaksjonen forventes gjennomført i løpet av kvartalet."
  ],
  company_sentence: "Test ASA er et norsk teknologiselskap.",
  key_facts: ["Kjøper 100% av aksjene"],
  negative_or_surprising: [],
  excluded_hype: [],
  source_limitations: [],
  confidence: "high",
  importance: "medium",
  source_spans: ["inngått en avtale om kjøp av 100% av aksjene"]
};

const sampleReportPayload: ReportPromptPayload = {
  ...samplePayload,
  reportText: "Inntektene steg til 100 millioner kroner. Resultat for skatt var 20 millioner.",
  reportPageCount: 12
};

const sampleYearlyPayload: YearlyReportPromptPayload = {
  ...samplePayload,
  letterText: null,
  remunerationText: "CEO fikk samlet godtgjorelse pa 5 millioner kroner.",
  reportPageCount: 80
};

describe("createRevisionUserPrompt", () => {
  it("includes formatted previous output with labeled fields", () => {
    const result = createRevisionUserPrompt(samplePayload, sampleOutput, "Gjør det kortere");

    expect(result).toContain("title: Test kjøper selskap");
    expect(result).toContain("lead: Test ASA kjøper et selskap");
    expect(result).toContain("1. Avtalen gjelder kjøp av alle aksjene.");
    expect(result).toContain("2. Transaksjonen forventes gjennomført");
    expect(result).toContain("company_sentence: Test ASA er et norsk teknologiselskap.");
    expect(result).toContain("importance: medium");
  });

  it("includes instruction after INSTRUKSJON marker", () => {
    const result = createRevisionUserPrompt(samplePayload, sampleOutput, "Fjern siste avsnitt");

    expect(result).toContain("INSTRUKSJON:");
    expect(result).toContain("Fjern siste avsnitt");
    const instrIndex = result.indexOf("INSTRUKSJON:");
    const instrTextIndex = result.indexOf("Fjern siste avsnitt");
    expect(instrTextIndex).toBeGreaterThan(instrIndex);
  });

  it("includes source text in KILDE section", () => {
    const result = createRevisionUserPrompt(samplePayload, sampleOutput, "Kortere");

    expect(result).toContain("KILDE (FULL ORIGINALTEKST):");
    expect(result).toContain("Selskapet har inngått en avtale om kjøp av 100% av aksjene.");
  });

  it("does not contain raw JSON of the previous output", () => {
    const result = createRevisionUserPrompt(samplePayload, sampleOutput, "Kortere");

    expect(result).not.toContain('"title":"Test kjøper selskap"');
    expect(result).not.toContain('{"title":');
  });

  it("includes key_facts joined with semicolons", () => {
    const multiFactOutput: RewriteOutput = {
      ...sampleOutput,
      key_facts: ["Kjøper 100% av aksjene", "Pris: 50 mill. kroner"]
    };
    const result = createRevisionUserPrompt(samplePayload, multiFactOutput, "Kortere");

    expect(result).toContain("key_facts: Kjøper 100% av aksjene; Pris: 50 mill. kroner");
  });

  it("includes strengthened revision instructions with examples", () => {
    const result = createRevisionUserPrompt(samplePayload, sampleOutput, "Test");

    expect(result).toContain("VIKTIG: Instruksjonen er styrende");
    expect(result).toContain("Ikke gjor tilfeldige smaendringer");
    expect(result).toContain("Fjern dette fra teksten");
    expect(result).toContain("Gjor det kortere");
    expect(result).toContain("For komplisert");
    expect(result).toContain("Vinkle pa kontrakten");
  });
});

describe("createReportRevisionUserPrompt", () => {
  it("keeps report source context and user instruction in revision mode", () => {
    const result = createReportRevisionUserPrompt(
      sampleReportPayload,
      sampleOutput,
      "Vinkle mer pa inntektsveksten"
    );

    expect(result).toContain("rapportnyheten");
    expect(result).toContain("KILDE (UTDRAG FRA RAPPORT):");
    expect(result).toContain(sampleReportPayload.reportText);
    expect(result).toContain("FORRIGE VERSJON");
    expect(result).toContain("Vinkle mer pa inntektsveksten");
  });
});

describe("createYearlyReportRevisionUserPrompt", () => {
  it("keeps remuneration source context and user instruction in revision mode", () => {
    const result = createYearlyReportRevisionUserPrompt(
      sampleYearlyPayload,
      sampleOutput,
      "Gjor saken tydeligere pa CEO-lonn"
    );

    expect(result).toContain("lederlonnssaken");
    expect(result).toContain("KILDE (GODTGJ");
    expect(result).toContain(sampleYearlyPayload.remunerationText);
    expect(result).toContain("FORRIGE VERSJON");
    expect(result).toContain("Gjor saken tydeligere pa CEO-lonn");
  });
});

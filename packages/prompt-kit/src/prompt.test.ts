import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import {
  PROMPT_VERSION,
  createDeveloperPrompt,
  createRevisionUserPrompt,
  type PromptPayload
} from "./prompt.js";
import {
  createReportDeveloperPrompt,
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

describe("OpenAI prompt contract", () => {
  it("bumps the prompt version for the editorial guardrail update", () => {
    expect(PROMPT_VERSION).toBe("v5.6.0");
  });

  it("does not embed the JSON schema in the developer prompt", () => {
    const result = createDeveloperPrompt('{"type":"object"}');

    expect(result).not.toContain("JSON schema");
    expect(result).not.toContain('{"type":"object"}');
  });

  it("includes signal-derived guidance for routine compression and plain explanation", () => {
    const result = createDeveloperPrompt();

    expect(result).toContain("Rutinesaker skal komprimeres hardt");
    expect(result).toContain("avlyst reparasjonsemisjon");
    expect(result).toContain("fullmakt");
    expect(result).toContain("stemme på vegne av andre aksjonærer");
    expect(result).toContain("Endurance-plattformen");
    expect(result).toContain("Forklar hver navngitte label");
    expect(result).toContain("1,3 milliarder kroner");
    expect(result).toContain("styrke likviditeten");
    expect(result).toContain("låneendringer");
  });

  it("includes regression examples for short routine cases", () => {
    const result = createDeveloperPrompt();

    expect(result).toContain("Avlyst reparasjonsemisjon");
    expect(result).toContain("Idex dropper reparasjonsemisjon");
    expect(result).toContain("Fullmakt til generalforsamling");
    expect(result).toContain("Ren tegningspåminnelse");
    expect(result).toContain("Meldingen inneholder ingen nye vilkår");
  });

  it("asks for varied early attribution instead of repeated stock endings", () => {
    const result = createDeveloperPrompt();

    expect(result).toContain("ikke la hver sak ende med samme standardhale");
    expect(result).toContain("Kildehenvisningen kan sta i andre setning");
    expect(result).toContain("gar det frem av meldingen");
  });
});

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

  it("labels supplemental source text without visible PDF language", () => {
    const result = createRevisionUserPrompt(
      {
        ...samplePayload,
        hasAttachments: true,
        pdfSupplementText: "Selskapet opplyser at avtalen er signert."
      },
      sampleOutput,
      "Bruk ekstra kildetekst"
    );

    expect(result).toContain("EKSTRA KILDETEKST FRA SELSKAPET");
    expect(result).not.toContain("PDF-VEDLEGG");
  });
});

describe("createReportRevisionUserPrompt", () => {
  it("asks report rewrites to include context beyond a pure number list", () => {
    const result = createReportDeveloperPrompt();

    expect(result).toContain("Ikke la saken bli en ren talliste");
    expect(result).toContain("utsikter");
    expect(result).toContain("markedsforhold");
  });

  it("tightens report angle, dividend and accounting-language guidance", () => {
    const result = createReportDeveloperPrompt();

    expect(result).toContain("ikke det største isolerte tallet");
    expect(result).toContain("Lead skal fortelle utviklingen eller spenningen");
    expect(result).toContain("Ikke bruk 'fikk et resultat på X, mot Y'");
    expect(result).toContain("små per-aksje-beløp");
    expect(result).toContain("driftsresultat (ebit)");
    expect(result).toContain("ebitda");
    expect(result).toContain("første kvartal' to ganger");
  });

  it("forbids report bullet preambles in the examples and instructions", () => {
    const result = createReportDeveloperPrompt();

    expect(result).toContain("Start punktlisten direkte med forste kulepunkt");
    expect(result).toContain("Ikke lag et eget body-element");
    expect(result.match(/\"Dette er noen/g)).toBeNull();
  });

  it("keeps report source context and user instruction in revision mode", () => {
    const result = createReportRevisionUserPrompt(
      sampleReportPayload,
      sampleOutput,
      "Vinkle mer pa inntektsveksten"
    );

    expect(result).toContain("rapportnyheten");
    expect(result).toContain("KILDE (KURATERT RAPPORTKONTEKST):");
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

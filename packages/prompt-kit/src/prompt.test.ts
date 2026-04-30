import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import { createRevisionUserPrompt, type PromptPayload } from "./prompt.js";

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

    expect(result).toContain("VIKTIG: Behold alt som ikke er berort av instruksjonen");
    expect(result).toContain("Fjern dette fra teksten");
    expect(result).toContain("Gjor det kortere");
    expect(result).toContain("For komplisert");
  });
});

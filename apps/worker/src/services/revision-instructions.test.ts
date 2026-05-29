import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import {
  appendRevisionChecklist,
  isAmbiguousBareRemovalInstruction,
  parseRevisionInstruction,
  validateRevisionInstructionCompliance
} from "./revision-instructions.js";

function createRewrite(overrides?: Partial<RewriteOutput>): RewriteOutput {
  return {
    title: "Test forklarer terminer",
    lead: "Selskapet bruker terminer, som er avtaler om kjøp eller salg på et senere tidspunkt.",
    body: ["Meldingen omtaler ikke andre forhold."],
    company_sentence: "Test er et norsk selskap.",
    key_facts: ["Terminer forklart"],
    negative_or_surprising: [],
    excluded_hype: [],
    source_limitations: [],
    confidence: "high",
    importance: "medium",
    source_spans: ["terminer"],
    ...overrides
  };
}

describe("parseRevisionInstruction", () => {
  it("detects remove_text instructions", () => {
    const result = parseRevisionInstruction("Dropp fri kontantstrøm");

    expect(result.intents).toContainEqual({
      type: "remove_text",
      target: "fri kontantstrøm"
    });
  });

  it("detects Kutt dette as a narrow removal instruction", () => {
    const result = parseRevisionInstruction(
      "Kutt dette: Bare 0,57 prosent er vanlige aksjer. Resten ligger i finansielle instrumenter."
    );

    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({
      type: "remove_text",
      target: expect.stringContaining("Bare 0,57 prosent")
    });
  });

  it("detects clear removal variants with pasted targets", () => {
    const instructions = [
      "fjern dette: Bare 0,57 prosent er vanlige aksjer.",
      "dropp dette: Bare 0,57 prosent er vanlige aksjer.",
      "ta bort dette: Bare 0,57 prosent er vanlige aksjer."
    ];

    for (const instruction of instructions) {
      const result = parseRevisionInstruction(instruction);
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]).toMatchObject({
        type: "remove_text",
        target: expect.stringContaining("Bare 0,57 prosent")
      });
      expect(result.ambiguousBareRemoval).toBe(false);
    }
  });

  it("detects quoted and inline removal targets", () => {
    expect(parseRevisionInstruction('Fjern "fri kontantstrøm"').intents).toContainEqual({
      type: "remove_text",
      target: "fri kontantstrøm"
    });
    expect(parseRevisionInstruction("Kutt omtalen om guiding").intents).toContainEqual({
      type: "remove_text",
      target: "guiding"
    });
  });

  it("marks bare fjern dette as ambiguous with no target", () => {
    const result = parseRevisionInstruction("fjern dette");

    expect(result.intents).toHaveLength(0);
    expect(result.ambiguousBareRemoval).toBe(true);
    expect(isAmbiguousBareRemovalInstruction("Kutt dette fra saken")).toBe(true);
  });

  it("detects explain_term instructions", () => {
    const result = parseRevisionInstruction("Hva er terminer? Forklar");

    expect(result.intents).toContainEqual({
      type: "explain_term",
      term: "terminer"
    });
  });

  it("detects simplify instructions", () => {
    const result = parseRevisionInstruction("Skriv mye enklere");

    expect(result.intents).toContainEqual({ type: "simplify" });
  });

  it("detects title_only instructions", () => {
    const result = parseRevisionInstruction("Endre tittelen");

    expect(result.intents).toContainEqual({ type: "title_only" });
  });

  it("detects focus_shift instructions", () => {
    const result = parseRevisionInstruction("Vinkle på kontrakten");

    expect(result.intents).toContainEqual({
      type: "focus_shift",
      target: "kontrakten"
    });
  });

  it("detects length_target instructions", () => {
    const result = parseRevisionInstruction("Skriv rundt 1400 tegn");

    expect(result.intents).toContainEqual({
      type: "length_target",
      mode: "around",
      targetChars: 1400
    });
  });

  it("detects attachment_required instructions", () => {
    const result = parseRevisionInstruction("Åpne vedlegget");

    expect(result.intents).toContainEqual({ type: "attachment_required" });
  });
});

describe("appendRevisionChecklist", () => {
  it("keeps raw instructions and appends checklist for recognized intents", () => {
    const result = appendRevisionChecklist("Hva er terminer? Forklar");

    expect(result).toContain("Hva er terminer? Forklar");
    expect(result).toContain("MASKINLEST SJEKKLISTE:");
    expect(result).toContain("Forklar \"terminer\"");
  });

  it("returns unknown instructions unchanged", () => {
    const instruction = "Gjør denne mer interessant for leseren";

    expect(appendRevisionChecklist(instruction)).toBe(instruction);
  });
});

describe("validateRevisionInstructionCompliance", () => {
  it("fails when removed phrase remains visible", () => {
    const rewrite = createRewrite({
      lead: "Selskapet omtaler fri kontantstrøm i kvartalet."
    });

    const result = validateRevisionInstructionCompliance(rewrite, {
      instruction: "Dropp fri kontantstrøm"
    });

    expect(result?.passed).toBe(false);
    expect(result?.warnings[0]).toContain("fri kontantstrøm");
  });

  it("passes Kutt dette when only the requested sentence is removed", () => {
    const previousOutput = createRewrite({
      title: "Ensuro henter nye penger",
      lead:
        "Ensuro henter 200 millioner kroner i en emisjon. Bare 0,57 prosent er vanlige aksjer. Resten ligger i finansielle instrumenter.",
      body: ["Selskapet opplyser at kapitalen skal brukes til vekst."]
    });
    const rewrite = createRewrite({
      title: "Ensuro henter nye penger",
      lead: "Ensuro henter 200 millioner kroner i en emisjon.",
      body: ["Selskapet opplyser at kapitalen skal brukes til vekst."]
    });

    const result = validateRevisionInstructionCompliance(rewrite, {
      instruction:
        "Kutt dette: Bare 0,57 prosent er vanlige aksjer. Resten ligger i finansielle instrumenter.",
      previousOutput
    });

    expect(result?.passed).toBe(true);
  });

  it("fails Kutt dette when unrelated text changes materially", () => {
    const previousOutput = createRewrite({
      title: "Ensuro henter nye penger",
      lead:
        "Ensuro henter 200 millioner kroner i en emisjon. Bare 0,57 prosent er vanlige aksjer. Resten ligger i finansielle instrumenter.",
      body: ["Selskapet opplyser at kapitalen skal brukes til vekst."]
    });
    const rewrite = createRewrite({
      title: "Ensuro endrer aksjestrukturen",
      lead: "Selskapet varsler flere tekniske endringer etter generalforsamlingen.",
      body: ["AksjonÃ¦rene fÃ¥r en ny oppdatering senere."]
    });

    const result = validateRevisionInstructionCompliance(rewrite, {
      instruction:
        "Kutt dette: Bare 0,57 prosent er vanlige aksjer. Resten ligger i finansielle instrumenter.",
      previousOutput
    });

    expect(result?.passed).toBe(false);
    expect(result?.warnings.some((warning) => warning.includes("for mye"))).toBe(true);
  });

  it("passes when requested term is explained nearby", () => {
    const result = validateRevisionInstructionCompliance(createRewrite(), {
      instruction: "Hva er terminer? Forklar"
    });

    expect(result?.passed).toBe(true);
  });

  it("warns when title-only instruction changes body materially", () => {
    const previousOutput = createRewrite({
      lead: "Selskapet har signert en kontrakt.",
      body: ["Kontrakten varer i tre år."]
    });
    const rewrite = createRewrite({
      title: "Ny tittel",
      lead: "Selskapet har lagt frem kvartalstall.",
      body: ["Resultatet falt kraftig fra året før."]
    });

    const result = validateRevisionInstructionCompliance(rewrite, {
      instruction: "Endre tittelen",
      previousOutput
    });

    expect(result?.passed).toBe(false);
    expect(result?.warnings[0]).toContain("tittelen");
  });

  it("warns when attachment text was requested but unavailable", () => {
    const result = validateRevisionInstructionCompliance(createRewrite(), {
      instruction: "Åpne vedlegget",
      attachmentTextAvailable: false
    });

    expect(result?.passed).toBe(false);
    expect(result?.warnings[0]).toContain("vedlegg");
  });

  it("does nothing for unknown instructions", () => {
    const result = validateRevisionInstructionCompliance(createRewrite(), {
      instruction: "Gjør denne mer interessant for leseren"
    });

    expect(result).toBeNull();
  });
});

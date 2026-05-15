import {
  createDeveloperPrompt,
  createSystemPrompt,
  createUserPrompt,
  type PromptPayload
} from "@newsweb/prompt-kit";
import { describe, expect, it } from "vitest";

describe("prompt style guidance", () => {
  it("enforces active voice, present tense and inverted pyramid", () => {
    const systemPrompt = createSystemPrompt();
    const developerPrompt = createDeveloperPrompt("{}");

    expect(systemPrompt).toContain("aktiv form");
    expect(systemPrompt).toContain("presens");
    expect(systemPrompt).toContain("omvendt nyhetspyramide");
    expect(developerPrompt.toLowerCase()).toContain("omvendt nyhetspyramide");
    expect(developerPrompt).toContain("forste setning");
    expect(developerPrompt).toContain("gar av");
  });

  it("encourages quotes including dash style and bracket quotes", () => {
    const developerPrompt = createDeveloperPrompt("{}");
    const payload: PromptPayload = {
      messageId: 1,
      title: "Test",
      issuerName: "Test",
      issuerSign: "TST",
      publishedAt: "2026-02-27T00:00:00.000Z",
      categories: [],
      markets: [],
      bodyText: "Selskapet skriver: Vi vil takke ham for innsatsen.",
      hasAttachments: false,
      sourceBodyChars: 52
    };
    const userPrompt = createUserPrompt(payload);

    expect(developerPrompt).toContain("Lav terskel for direkte sitater");
    expect(developerPrompt).toContain("Sitatstrek");
    expect(developerPrompt).toContain("Guillemets");
    expect(userPrompt).toContain("Hvis kilden har direkte sitater");
  });

  it("includes E24-style market-moving and factuality guardrails", () => {
    const developerPrompt = createDeveloperPrompt("{}");

    expect(developerPrompt).toContain("kursdrivende");
    expect(developerPrompt).toContain("vinkles pa det negative");
    expect(developerPrompt).toContain("Skriv 'prosent', ikke '%'");
    expect(developerPrompt).toContain(
      "Ikke bland regnskapsbegrepene inntekter/omsetning og resultat"
    );
    expect(developerPrompt).toContain("Ikke regn om valuta");
    expect(developerPrompt).toContain("tilsvaret med i lead/body");
    expect(developerPrompt).toContain("Bruk publiseringstidspunktet");
  });
});

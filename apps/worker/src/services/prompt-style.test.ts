import {
  createDeveloperPrompt,
  createReportDeveloperPrompt,
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

    expect(developerPrompt).toContain("SITATER, GUILLEMETS OG PERSONATTRIBUSJON");
    expect(developerPrompt).toContain("en nær direkte oversettelse av en engelsk formulering");
    expect(developerPrompt).toContain("Sitatstrek");
    expect(developerPrompt).toContain("Guillemets");
    expect(developerPrompt).toContain("Sitatstrek (–) er hovedformen");
    expect(developerPrompt).toContain("Fri personattribuert parafrase er fallback");
    expect(developerPrompt).toContain("Ikke erstatt et godt kort sitat");
    expect(developerPrompt).not.toContain("Guillemets («») = parafrasering");
    expect(userPrompt).toContain("Sjekk kilden for navngitte uttalelser");
    expect(userPrompt).toContain("skal saken normalt bruke ett kort sitatstrek-avsnitt");
    expect(userPrompt).toContain("Bruk ren personattribuert parafrase bare");
    expect(userPrompt).not.toContain("bruk dem nar de gir nyhetsverdi");
  });

  it("includes E24-style materiality and factuality guardrails", () => {
    const developerPrompt = createDeveloperPrompt("{}");

    expect(developerPrompt).toContain("mest vesentlig for selskapet og aksjonærene");
    expect(developerPrompt).toContain("KILDE SOM DATA");
    expect(developerPrompt).toContain("vinkles pa det negative");
    expect(developerPrompt).toContain("Skriv 'prosent', ikke '%'");
    expect(developerPrompt).toContain(
      "Ikke bland regnskapsbegrepene inntekter/omsetning og resultat"
    );
    expect(developerPrompt).toContain("Ikke regn om valuta");
    expect(developerPrompt).toContain("tilsvaret med i lead/body");
    expect(developerPrompt).toContain("Bruk publiseringstidspunktet");
  });

  it("includes guardrails for jargon, attachments and repetition", () => {
    const developerPrompt = createDeveloperPrompt("{}");

    expect(developerPrompt).toContain("Før du leverer");
    expect(developerPrompt).toContain("terminer");
    expect(developerPrompt).toContain("Aldri skriv 'PDF'");
    expect(developerPrompt).toContain("Ikke gjenta samme tall eller faktum");
  });

  it("includes signal-derived guidance for short routine notices", () => {
    const developerPrompt = createDeveloperPrompt("{}");

    expect(developerPrompt).toContain("Rutinesaker skal komprimeres hardt");
    expect(developerPrompt).toContain("1,3 milliarder kroner");
    expect(developerPrompt).toContain("stemme på vegne av andre aksjonærer");
    expect(developerPrompt).toContain("styrke likviditeten");
    expect(developerPrompt).toContain("nettoresultat");
    expect(developerPrompt).toContain("Evo-transaksjonen");
    expect(developerPrompt).toContain("tøft");
  });

  it("includes report-specific angle and accounting guidance", () => {
    const reportPrompt = createReportDeveloperPrompt("{}");

    expect(reportPrompt).toContain("ikke det største isolerte tallet");
    expect(reportPrompt).toContain("små per-aksje-beløp");
    expect(reportPrompt).toContain("driftsresultat (ebit)");
    expect(reportPrompt).toContain("første kvartal' to ganger");
    expect(reportPrompt).toContain("Etter nøkkeltallene skal du se etter én kort ledelseskommentar");
    expect(reportPrompt).toContain("CEO, CFO eller styreleder");
    expect(reportPrompt).toContain(
      "Ikke klassifiser konkrete markeds-, etterspørsels- eller utsiktskommentarer som hype"
    );
    expect(reportPrompt).toContain("HOVEDREGEL FOR PERSONUTTALELSER");
    expect(reportPrompt).toContain("Regnskap for uttalelser");
    expect(reportPrompt).toContain("Kutt adjektiver, kundeløfter og selvskryt");
    expect(reportPrompt).toContain("skal du normalt bruke ett kort sitatstrek-avsnitt");
    expect(reportPrompt).toContain("Bruk personattribuert parafrase bare");
    expect(reportPrompt).toContain("speaker/rolle + utsagn");
  });
});

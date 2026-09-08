import { readFileSync } from "node:fs";
import type { PromptPayload } from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import { applyImportanceHighBar, hasImportantSourceSignals } from "./importance.js";
import { hasMaterialShareSale } from "./material-share-sale.js";
import { getDeterministicTriageSkip } from "./newsworthiness-triage.js";
import { needsNewsworthinessTriage, shouldSkipRewrite } from "@newsweb/shared";

const autostore = JSON.parse(readFileSync(new URL("../fixtures/autostore-681861.json", import.meta.url), "utf8")) as PromptPayload;

function createPayload(overrides?: Partial<PromptPayload>): PromptPayload {
  const bodyText =
    "Company reports update. No major strategic, financial or regulatory event is described.";
  return {
    messageId: 1,
    title: "General update",
    issuerName: "Test ASA",
    issuerSign: "TEST",
    publishedAt: "2026-02-27T12:00:00.000Z",
    categories: ["OTHER"],
    markets: ["XOSL"],
    bodyText,
    hasAttachments: false,
    sourceBodyChars: bodyText.length,
    ...overrides
  };
}

function createRewrite(overrides?: Partial<RewriteOutput>): RewriteOutput {
  return {
    title: "Kort oppdatering",
    lead: "Selskapet la frem en oppdatering i dag.",
    body: [
      "Teksten oppsummerer endringer uten store konsekvenser.",
      "Det er ingen nye strategiske hendelser nevnt i meldingen.",
      "Selskapet viser til videre informasjon i markedskommunikasjon."
    ],
    company_sentence: "Test ASA er et norsk selskap notert pa Oslo Bors.",
    key_facts: ["Punkt 1", "Punkt 2", "Punkt 3"],
    negative_or_surprising: [],
    excluded_hype: [],
    source_limitations: [],
    confidence: "medium",
    importance: "medium",
    source_spans: ["General update"],
    ...overrides
  };
}

describe("applyImportanceHighBar", () => {
  it("routes real AutoStore 681861 to assessment and guarantees important after writing or repair", () => {
    expect(shouldSkipRewrite(autostore.categories)).toBe(false);
    expect(needsNewsworthinessTriage(autostore.categories)).toBe(true);
    expect(getDeterministicTriageSkip(autostore.title, autostore.bodyText, autostore.categories, false, autostore.issuerName)).toBeNull();
    expect(hasImportantSourceSignals(autostore)).toBe(true);
    for (const importance of ["uviktig", "medium", "viktig"] as const) {
      const rewrite = createRewrite({ importance });
      const result = applyImportanceHighBar(rewrite, autostore);
      expect(result.rewrite).toEqual({ ...rewrite, importance: "viktig" });
      expect(result.adjusted).toBe(importance !== "viktig");
    }
  });

  it.each(["1", "1,0", "3,5"])("recognizes Norwegian block sales at %s percent without requiring a known ticker", (percent) => {
    const payload = createPayload({
      title: "Storaksjonær selger aksjer",
      bodyText: `Salget tilsvarer om lag ${percent} prosent av selskapets samlede aksjer.`
    });
    expect(applyImportanceHighBar(createRewrite(), payload).rewrite.importance).toBe("viktig");
  });

  it.each([
    "The Sale corresponds to approximately 0.3% of the total issued and outstanding shares. THL expects to hold 24.9% of the shares.",
    "The Sale represents approximately 10.8% of THL's stake. THL expects to hold 24.9% of the shares.",
    "The Sale represents approximately 10.8% of the shares held by THL.",
    "THL expects to hold approximately 24.9% of the total issued and outstanding shares following the sale.",
    "THL offers 103 million shares. Price will be announced later.",
    "The Sale represents 0.99% of the total issued and outstanding shares."
  ])("does not infer a large company stake from unrelated numbers: %s", (bodyText) => {
    const payload = { ...autostore, bodyText };
    expect(hasMaterialShareSale(payload.title, bodyText)).toBe(false);
    expect(applyImportanceHighBar(createRewrite(), payload).rewrite.importance).toBe("medium");
  });

  it("does not promote routine ownership reports solely for mentioning a previous sale", () => {
    const payload = { ...autostore, title: "Quarterly ownership report" };
    expect(hasMaterialShareSale(payload.title, payload.bodyText)).toBe(false);
  });

  it("downgrades 'viktig' when severe signal is missing", () => {
    const payload = createPayload();
    const rewrite = createRewrite({ importance: "viktig" });

    const result = applyImportanceHighBar(rewrite, payload);
    expect(result.rewrite.importance).toBe("medium");
    expect(result.adjusted).toBe(true);
  });

  it("keeps 'viktig' on clear severe signal", () => {
    const payload = createPayload({
      title: "Company issues profit warning",
      bodyText: "The company has issued a profit warning and cuts guidance."
    });
    const rewrite = createRewrite({ importance: "viktig" });

    const result = applyImportanceHighBar(rewrite, payload);
    expect(result.rewrite.importance).toBe("viktig");
    expect(result.adjusted).toBe(false);
  });

  it("keeps 'viktig' on Norwegian severe signals", () => {
    for (const bodyText of [
      "Selskapet melder om et oppkjøp av en konkurrent.",
      "Selskapet gjennomfører en rettet emisjon etter børsslutt."
    ]) {
      const payload = createPayload({
        title: "Selskapet melder viktig hendelse",
        bodyText
      });
      const rewrite = createRewrite({ importance: "viktig" });

      const result = applyImportanceHighBar(rewrite, payload);

      expect(result.rewrite.importance).toBe("viktig");
      expect(result.adjusted).toBe(false);
    }
  });

  it("downgrades routine medium notice to uviktig", () => {
    const payload = createPayload({
      title: "Share repurchases on 27.2.2026",
      bodyText: "The issuer reports share repurchases in line with prior plan."
    });
    const rewrite = createRewrite({ importance: "medium" });

    const result = applyImportanceHighBar(rewrite, payload);
    expect(result.rewrite.importance).toBe("uviktig");
    expect(result.adjusted).toBe(true);
  });

  it("downgrades Norwegian routine medium notices to uviktig", () => {
    for (const bodyText of [
      "Selskapet publiserer kvartalsrapport for første kvartal.",
      "Dette er en meldepliktig handel fra en primærinnsider.",
      "Selskapet opplyser at årsrapport publisert i dag."
    ]) {
      const payload = createPayload({
        title: "Rutinemelding",
        bodyText
      });
      const rewrite = createRewrite({ importance: "medium" });

      const result = applyImportanceHighBar(rewrite, payload);

      expect(result.rewrite.importance).toBe("uviktig");
      expect(result.adjusted).toBe(true);
    }
  });
});

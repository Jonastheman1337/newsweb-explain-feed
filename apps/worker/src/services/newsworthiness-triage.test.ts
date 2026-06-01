import { needsNewsworthinessTriage } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import {
  TRIAGE_PROMPT,
  buildTriageUserPrompt,
  getDeterministicTriageSkip,
  parseTriageResponse
} from "./newsworthiness-triage.js";

describe("needsNewsworthinessTriage", () => {
  it("returns true for ambiguous categories", () => {
    expect(
      needsNewsworthinessTriage([
        "ANNEN INFORMASJONSPLIKTIG REGULATORISK INFORMASJON"
      ])
    ).toBe(true);
    expect(
      needsNewsworthinessTriage(["IKKE-INFORMASJONSPLIKTIGE PRESSEMELDINGER"])
    ).toBe(true);
    expect(needsNewsworthinessTriage(["FLAGGING"])).toBe(true);
  });

  it("returns false for yearly report categories (handled by yearly report pipeline)", () => {
    expect(
      needsNewsworthinessTriage(["ÅRSRAPPORTER OG REVISJONSBERETNINGER"])
    ).toBe(false);
  });

  it("returns false for clearly editorial categories", () => {
    expect(needsNewsworthinessTriage(["INNSIDEINFORMASJON"])).toBe(false);
    expect(
      needsNewsworthinessTriage(["MELDEPLIKTIG HANDEL FOR PRIMÆRINNSIDERE"])
    ).toBe(false);
  });

  it("returns false for mechanical categories (handled by skip)", () => {
    expect(needsNewsworthinessTriage(["RENTEREGULERING"])).toBe(false);
  });

  it("returns false for empty categories", () => {
    expect(needsNewsworthinessTriage([])).toBe(false);
  });

  it("returns false for mixed editorial + triage categories", () => {
    expect(
      needsNewsworthinessTriage([
        "ANNEN INFORMASJONSPLIKTIG REGULATORISK INFORMASJON",
        "INNSIDEINFORMASJON"
      ])
    ).toBe(false);
  });
});

describe("buildTriageUserPrompt", () => {
  it("includes title, categories and body excerpt", () => {
    const prompt = buildTriageUserPrompt(
      "Test title",
      "Body text here",
      ["CAT1", "CAT2"]
    );
    expect(prompt).toContain("Test title");
    expect(prompt).toContain("CAT1, CAT2");
    expect(prompt).toContain("Body text here");
  });

  it("truncates body to 1200 chars", () => {
    const longBody = "A".repeat(2000);
    const prompt = buildTriageUserPrompt("Title", longBody, []);
    expect(prompt.length).toBeLessThan(1300);
  });

  it("includes attachment context when provided", () => {
    const prompt = buildTriageUserPrompt(
      "Disclosure of Large Shareholdings",
      "See attached notification form.",
      ["FLAGGING"],
      true
    );

    expect(prompt).toContain("Har vedlegg: ja");
  });
});

describe("getDeterministicTriageSkip", () => {
  it("skips document-only report publication notices", () => {
    const result = getDeterministicTriageSkip(
      "28-2026 5th Planet Games A/S - Interim Report Q1 2026",
      "COPENHAGEN, May 21, 2026: The interim report for Q1 2026 has been released today. The full report can be viewed by clicking the link at the end of this document.",
      ["IKKE-INFORMASJONSPLIKTIGE PRESSEMELDINGER"],
      false
    );

    expect(result?.newsworthy).toBe(false);
    expect(result?.kind).toBe("document-only");
  });

  it("keeps document notices with substantive financial facts", () => {
    const result = getDeterministicTriageSkip(
      "DOF Group ASA - Financial Report for 1st quarter 2026",
      "Revenue increased to USD 475 million. Operating income was USD 94 million and the company declares a dividend of USD 0.37 per share.",
      ["HALVÅRSRAPPORTER OG REVISJONSBERETNINGER / UTTALELSER OM FORENKLET REVISORKONTROLL"],
      true
    );

    expect(result).toBeNull();
  });

  it("skips pure subscription-period reminders", () => {
    const result = getDeterministicTriageSkip(
      "AWILCO LNG ASA - LAST DAY OF SUBSCRIPTION PERIOD IN SUBSEQUENT OFFERING",
      "The subscription period expires today at 16:30. Subscription rights not used before expiry will have no value.",
      ["ANNEN INFORMASJONSPLIKTIG REGULATORISK INFORMASJON"],
      false
    );

    expect(result?.newsworthy).toBe(false);
    expect(result?.kind).toBe("routine-reminder");
  });

  it("keeps subscription-period notices with a new outcome", () => {
    const result = getDeterministicTriageSkip(
      "Result of subsequent offering",
      "The subsequent offering was fully subscribed and gross proceeds were NOK 40 million.",
      ["ANNEN INFORMASJONSPLIKTIG REGULATORISK INFORMASJON"],
      false
    );

    expect(result).toBeNull();
  });

  it("skips public-sector result reports without capital-market events", () => {
    const result = getDeterministicTriageSkip(
      "STVKO: 1. tertial 2026 Stavanger kommune",
      "Stavanger kommune legger frem rapport for 1. tertial 2026 med ordinære resultattall.",
      ["ANNEN INFORMASJONSPLIKTIG REGULATORISK INFORMASJON"],
      true
    );

    expect(result?.newsworthy).toBe(false);
    expect(result?.kind).toBe("public-sector-results");
  });

  it("skips public-sector annual reports when municipality is only in issuer name", () => {
    const result = getDeterministicTriageSkip(
      "HGSKO: Årsmelding 2025",
      "Revisjonsberetningen viser ordinære regnskapstall for året.",
      ["ANNEN INFORMASJONSPLIKTIG REGULATORISK INFORMASJON"],
      true,
      "Haugesund kommune"
    );

    expect(result?.newsworthy).toBe(false);
    expect(result?.kind).toBe("public-sector-results");
  });

  it("keeps public-sector notices with a capital-market event", () => {
    const result = getDeterministicTriageSkip(
      "Stavanger kommune vurderer obligasjonslån",
      "Stavanger kommune vurderer å utstede et obligasjonslån på 1,2 milliarder kroner.",
      ["ANNEN INFORMASJONSPLIKTIG REGULATORISK INFORMASJON"],
      false
    );

    expect(result).toBeNull();
  });

  it("skips small routine bond issuances under one billion kroner", () => {
    const result = getDeterministicTriageSkip(
      "SBSB: Vellykket utstedelse av fondsobligasjonslån",
      "Stadsbygd Sparebank har utstedt et fondsobligasjonslån på 75 millioner kroner.",
      ["ANNEN INFORMASJONSPLIKTIG REGULATORISK INFORMASJON"],
      false
    );

    expect(result?.newsworthy).toBe(false);
    expect(result?.kind).toBe("small-routine-bond");
  });

  it("keeps routine bond issuances at or above one billion kroner", () => {
    const result = getDeterministicTriageSkip(
      "Vellykket utstedelse av obligasjonslån",
      "Selskapet har utstedt et obligasjonslån på 1 milliard kroner.",
      ["ANNEN INFORMASJONSPLIKTIG REGULATORISK INFORMASJON"],
      false
    );

    expect(result).toBeNull();
  });

  it("parses NOK million amounts without treating them as billions", () => {
    const result = getDeterministicTriageSkip(
      "Successful issue of bond",
      "The bank has issued a bond of NOK 750 million.",
      ["ANNEN INFORMASJONSPLIKTIG REGULATORISK INFORMASJON"],
      false
    );

    expect(result?.kind).toBe("small-routine-bond");
  });
});

describe("TRIAGE_PROMPT", () => {
  it("explicitly rejects document-only and attachment-only notices", () => {
    expect(TRIAGE_PROMPT).toContain("Form 6-K");
    expect(TRIAGE_PROMPT).toContain("Invitasjoner til resultatpresentasjoner");
    expect(TRIAGE_PROMPT).toContain("bare kan skrives ved å lese et vedlegg");
  });
});

describe("parseTriageResponse", () => {
  it("parses valid JSON response", () => {
    const result = parseTriageResponse(
      '{"newsworthy": false, "reason": "Rutinemessig obligasjonsutvidelse"}'
    );
    expect(result.newsworthy).toBe(false);
    expect(result.reason).toBe("Rutinemessig obligasjonsutvidelse");
  });

  it("parses fenced JSON", () => {
    const result = parseTriageResponse(
      '```json\n{"newsworthy": true, "reason": "Stor kontrakt"}\n```'
    );
    expect(result.newsworthy).toBe(true);
    expect(result.reason).toBe("Stor kontrakt");
  });

  it("defaults to newsworthy on invalid JSON", () => {
    const result = parseTriageResponse("this is not json");
    expect(result.newsworthy).toBe(true);
  });

  it("defaults to newsworthy on missing field", () => {
    const result = parseTriageResponse('{"reason": "test"}');
    expect(result.newsworthy).toBe(true);
  });
});

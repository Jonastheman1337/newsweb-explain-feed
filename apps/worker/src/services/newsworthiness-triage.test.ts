import { needsNewsworthinessTriage } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import {
  TRIAGE_PROMPT,
  buildTriageUserPrompt,
  defaultEnabledTriageClasses,
  evaluateTriageClasses,
  getDeterministicTriageSkip,
  parseTriageResponse,
  triageClassIds
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

describe("triage class registry", () => {
  it("pins registry ids, order and the default enabled set", () => {
    // Updating these expectations is a deliberate release act: enabling a
    // class must come with refreshed fixture expectations (see the plan doc).
    expect([...triageClassIds]).toEqual([
      "document-only",
      "routine-prospectus",
      "routine-reminder",
      "public-sector-results",
      "small-routine-bond"
    ]);
    expect([...defaultEnabledTriageClasses]).toEqual([...triageClassIds]);
  });

  it("returns no enabled skip when every class is disabled, but reports candidates", () => {
    const evaluation = evaluateTriageClasses(
      "28-2026 5th Planet Games A/S - Interim Report Q1 2026",
      "COPENHAGEN, May 21, 2026: The interim report for Q1 2026 has been released today. The full report can be viewed by clicking the link at the end of this document.",
      ["IKKE-INFORMASJONSPLIKTIGE PRESSEMELDINGER"],
      false,
      undefined,
      undefined,
      { enabledClasses: [] }
    );
    expect(evaluation.enabledSkip).toBeNull();
    expect(evaluation.candidateClassIds).toEqual(["document-only"]);
    expect(evaluation.shadowSkipClassIds).toEqual(["document-only"]);
  });

  it("carries classId and reasonCode on enabled skips", () => {
    const skip = getDeterministicTriageSkip(
      "28-2026 5th Planet Games A/S - Interim Report Q1 2026",
      "COPENHAGEN, May 21, 2026: The interim report for Q1 2026 has been released today. The full report can be viewed by clicking the link at the end of this document.",
      ["IKKE-INFORMASJONSPLIKTIGE PRESSEMELDINGER"],
      false
    );
    expect(skip?.classId).toBe("document-only");
    expect(skip?.reasonCode).toBe("TRIAGE_DOCUMENT_ONLY");
  });
});

describe("false-skip narrowing (P3, production cases)", () => {
  it("keeps 675253: a CEO departure is not document-only despite the MAR footer", () => {
    const result = getDeterministicTriageSkip(
      "Per Axel Koch varsler planlagt fratreden som konsernsjef i Polaris Media",
      "Per Axel Koch har informert styret i Polaris Media ASA om at han ønsker å fratre stillingen som konsernsjef i løpet av 2027. Styret har startet arbeidet med å finne hans etterfølger. Meldingen er offentliggjort av Robert Berg i henhold til MAR.",
      ["INNSIDEINFORMASJON"],
      false
    );
    expect(result).toBeNull();
  });

  it("keeps 678418: field-trial results with percentages are not document-only", () => {
    const result = getDeterministicTriageSkip(
      "Desert Control Field Trials Demonstrate Significant Yield and Water Efficiency Gains",
      "The trials showed a 29.8% increase in yield and a 33% improvement in water efficiency, with production costs of $18/box and savings of $1,800 per acre. The whitepaper from the first trial is available at https://example.com.",
      ["IKKE-INFORMASJONSPLIKTIGE PRESSEMELDINGER"],
      false
    );
    expect(result).toBeNull();
  });

  it("keeps 679225: a tap issue under an existing bond with distress language is not a routine bond", () => {
    const result = getDeterministicTriageSkip(
      "Nordic Mining ASA - Update on Production Ramp-Up, Liquidity and Regulatory Status",
      "The company is in dialogue with bondholders regarding a waiver and a deferral of the NOK 46.4 million coupon payment, and contemplates a tap issue of up to USD 10-15 million under the existing senior secured bond. Liquidity extends to 4 September.",
      ["INNSIDEINFORMASJON"],
      false
    );
    expect(result).toBeNull();
  });

  it("still skips a plain routine bond issuance without exclusion terms", () => {
    const result = getDeterministicTriageSkip(
      "Vellykket utstedelse av obligasjonslån",
      "Selskapet har gjennomført en vellykket utstedelse av obligasjonslån på NOK 500 millioner kroner.",
      ["ANNEN INFORMASJONSPLIKTIG REGULATORISK INFORMASJON"],
      false
    );
    expect(result?.kind).toBe("small-routine-bond");
  });

  it("still skips document publication with a document-anchored availability line", () => {
    const result = getDeterministicTriageSkip(
      "EAM: EAM Solar AS - 2025 Annual Report",
      "EAM Solar AS has published its annual report for 2025. The report is attached and available on the company's website.",
      ["ANNEN INFORMASJONSPLIKTIG REGULATORISK INFORMASJON"],
      true
    );
    expect(result?.kind).toBe("document-only");
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

  it("skips 675304 EAM annual report publication without report facts", () => {
    const result = getDeterministicTriageSkip(
      "EAM: EAM Solar AS - 2025 Annual Report",
      "EAM Solar AS has published its annual report for 2025. The report is attached and available on the company's website.",
      ["ANNEN INFORMASJONSPLIKTIG REGULATORISK INFORMASJON"],
      true
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

  it("skips 675463 MOBAN prospectus publication for an already announced rights issue", () => {
    const result = getDeterministicTriageSkip(
      "MOBAN: Morrow Bank AB publishes prospectus for the Rights Issue",
      "Reference is made to the previously announced rights issue. The Financial Supervisory Authority of Norway has approved a prospectus prepared in connection with the rights issue. The subscription period runs from 9 June to 23 June.",
      ["ANNEN INFORMASJONSPLIKTIG REGULATORISK INFORMASJON"],
      true
    );

    expect(result?.newsworthy).toBe(false);
    expect(result?.kind).toBe("routine-prospectus");
  });

  it("keeps offering notices with a new result even when a prospectus is mentioned", () => {
    const result = getDeterministicTriageSkip(
      "Result of rights issue and publication of prospectus",
      "The rights issue was fully subscribed and gross proceeds were NOK 100 million. The prospectus is available on the company's website.",
      ["ANNEN INFORMASJONSPLIKTIG REGULATORISK INFORMASJON"],
      true
    );

    expect(result).toBeNull();
  });

  it("keeps fresh prospectus notices that are not tied to a previously announced offering", () => {
    const result = getDeterministicTriageSkip(
      "Company announces rights issue and publication of prospectus",
      "The company launches a rights issue and publishes a prospectus with the terms for the offering.",
      ["ANNEN INFORMASJONSPLIKTIG REGULATORISK INFORMASJON"],
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
    expect(TRIAGE_PROMPT).toContain("prospekt for en allerede annonsert emisjon");
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

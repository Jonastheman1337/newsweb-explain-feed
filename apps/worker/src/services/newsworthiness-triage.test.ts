import { needsNewsworthinessTriage } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import {
  buildTriageUserPrompt,
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

  it("truncates body to 500 chars", () => {
    const longBody = "A".repeat(1000);
    const prompt = buildTriageUserPrompt("Title", longBody, []);
    expect(prompt.length).toBeLessThan(600);
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

import { needsNewsworthinessTriage, shouldSkipRewrite } from "@newsweb/shared";
import { describe, expect, it } from "vitest";

describe("shouldSkipRewrite", () => {
  it("assesses third-party disclosures instead of excluding major shareholder sales", () => {
    const categories = ["MELDING FRA ANDRE AKTØRER"];
    expect(shouldSkipRewrite(categories)).toBe(false);
    expect(needsNewsworthinessTriage(categories)).toBe(true);
    expect(shouldSkipRewrite([...categories, "EKS.DATO"])).toBe(false);
  });

  it("skips purely mechanical categories", () => {
    expect(shouldSkipRewrite(["RENTEREGULERING"])).toBe(true);
    expect(shouldSkipRewrite(["EKS.DATO"])).toBe(true);
    expect(
      shouldSkipRewrite(["KAPITAL- OG STEMMERETTSENDRINGER", "EKS.DATO"])
    ).toBe(true);
    expect(
      shouldSkipRewrite(["UTSTEDERS MELDEPLIKT VED HANDEL I EGNE AKSJER"])
    ).toBe(true);
  });

  it("does not skip editorial categories", () => {
    expect(shouldSkipRewrite(["INNSIDEINFORMASJON"])).toBe(false);
    expect(
      shouldSkipRewrite(["MELDEPLIKTIG HANDEL FOR PRIMÆRINNSIDERE"])
    ).toBe(false);
  });

  it("does not skip when any category is editorial", () => {
    expect(
      shouldSkipRewrite(["RENTEREGULERING", "INNSIDEINFORMASJON"])
    ).toBe(false);
  });

  it("does not skip trading halts", () => {
    expect(shouldSkipRewrite(["SUSPENSJONER"])).toBe(false);
    expect(shouldSkipRewrite(["BØRSPAUSE / HANDELSPAUSE"])).toBe(false);
  });

  it("does not skip empty categories (fail-open)", () => {
    expect(shouldSkipRewrite([])).toBe(false);
  });
});

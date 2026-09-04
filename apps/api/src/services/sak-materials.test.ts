import { describe, expect, it } from "vitest";
import { MATERIAL_TRUNCATION_MARKER } from "./notice-materials.js";
import {
  SAK_MAX_MATERIAL_TEXT_CHARS,
  SAK_TOTAL_TRUNCATION_MARKER,
  buildSakMaterialSnapshots,
  hasReadableSakMaterial,
  type SakMaterialRow
} from "./sak-materials.js";

function row(overrides: Partial<SakMaterialRow> & { id: string }): SakMaterialRow {
  return {
    kind: "text",
    title: `Materiale ${overrides.id}`,
    url: null,
    status: "ready",
    errorText: null,
    extractedText: "tekst ".repeat(20),
    enabled: true,
    ...overrides
  };
}

describe("buildSakMaterialSnapshots", () => {
  it("caps a single material at 60k chars with the audit marker", () => {
    const result = buildSakMaterialSnapshots([
      row({ id: "a", extractedText: "x".repeat(SAK_MAX_MATERIAL_TEXT_CHARS + 5000) })
    ]);
    const snapshot = result.snapshots[0];
    expect(snapshot?.text.length).toBeLessThanOrEqual(SAK_MAX_MATERIAL_TEXT_CHARS);
    expect(snapshot?.text.endsWith(MATERIAL_TRUNCATION_MARKER)).toBe(true);
    expect(snapshot?.textChars).toBe(snapshot?.text.length);
    expect(snapshot?.sourceId).toBe("material_a");
    expect(result.included).toEqual(["a"]);
    expect(result.truncated).toEqual(["a"]);
    expect(result.dropped).toEqual([]);
  });

  it("fits materials into the total budget in order and reports what happened", () => {
    const result = buildSakMaterialSnapshots(
      [
        row({ id: "one", extractedText: "a".repeat(800) }),
        row({ id: "two", extractedText: "b".repeat(1500) }),
        row({ id: "three", extractedText: "c".repeat(900) }),
        row({ id: "four", extractedText: "d".repeat(900) })
      ],
      { maxMaterialChars: 1000, maxTotalChars: 2500 }
    );

    expect(result.included).toEqual(["one", "two", "three"]);
    expect(result.truncated).toEqual(["two", "three"]);
    expect(result.dropped).toEqual(["four"]);
    const total = result.snapshots.reduce((sum, snapshot) => sum + snapshot.text.length, 0);
    expect(total).toBeLessThanOrEqual(2500);
    expect(result.snapshots[1]?.text.endsWith(MATERIAL_TRUNCATION_MARKER)).toBe(true);
    expect(result.snapshots[2]?.text.endsWith(SAK_TOTAL_TRUNCATION_MARKER)).toBe(true);
  });

  it("keeps failed materials as empty coverage links and skips disabled or empty ones", () => {
    const result = buildSakMaterialSnapshots([
      row({ id: "paywall", kind: "url", url: "https://e24.no/x", status: "failed", errorText: "Betalingsmur", extractedText: "" }),
      row({ id: "off", enabled: false }),
      row({ id: "empty", extractedText: "   " }),
      row({ id: "ok" })
    ]);

    expect(result.included).toEqual(["paywall", "ok"]);
    expect(result.dropped).toEqual(["empty"]);
    expect(result.snapshots[0]).toMatchObject({
      id: "paywall",
      status: "failed",
      errorText: "Betalingsmur",
      text: "",
      textChars: 0,
      url: "https://e24.no/x"
    });
    expect(hasReadableSakMaterial(result.snapshots)).toBe(true);
    expect(hasReadableSakMaterial([result.snapshots[0]!])).toBe(false);
  });
});

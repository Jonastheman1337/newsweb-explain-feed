import { fixDoubleEncodedUtf8 } from "@newsweb/shared";
import { describe, expect, it } from "vitest";

describe("fixDoubleEncodedUtf8", () => {
  it("repairs double-encoded Norwegian characters", () => {
    expect(fixDoubleEncodedUtf8("SÃ†RLIG OBSERVASJON")).toBe("SÆRLIG OBSERVASJON");
    expect(fixDoubleEncodedUtf8("MELDING FRA OSLO BÃ˜RS")).toBe("MELDING FRA OSLO BØRS");
    expect(fixDoubleEncodedUtf8("Ã…RSRAPPORTER")).toBe("ÅRSRAPPORTER");
  });

  it("returns correctly encoded strings unchanged", () => {
    expect(fixDoubleEncodedUtf8("MELDING FRA OSLO BØRS")).toBe("MELDING FRA OSLO BØRS");
    expect(fixDoubleEncodedUtf8("SÆRLIG OBSERVASJON")).toBe("SÆRLIG OBSERVASJON");
  });

  it("passes plain ASCII through untouched", () => {
    expect(fixDoubleEncodedUtf8("RENTEREGULERING")).toBe("RENTEREGULERING");
    expect(fixDoubleEncodedUtf8("")).toBe("");
  });
});

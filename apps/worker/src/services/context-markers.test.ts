import { describe, expect, it } from "vitest";
import {
  CONTEXT_MARKER_MONTHS,
  CONTEXT_MARKER_WEEKDAYS,
  findContextMarker,
  hasContextMarker,
  issuerAliases,
  type ContextMarker
} from "./context-markers.js";

const ODFJELL = issuerAliases("Odfjell Drilling Ltd", "ODL");

const MARKED: Array<[sentence: string, expected: ContextMarker]> = [
  ["Selskapet meldte i juni om en innledende avtale.", { kind: "prior_verb", match: "meldte" }],
  ["Kjøpet ble annonsert i april.", { kind: "prior_verb", match: "ble annonsert" }],
  ["Emisjonen ble varslet torsdag.", { kind: "prior_verb", match: "ble varslet" }],
  [
    "Det uttalte selskapet da emisjonen ble varslet torsdag.",
    { kind: "prior_verb", match: "uttalte" }
  ],
  ["Som meldt i mai ble avtalen utvidet.", { kind: "prior_verb", match: "som meldt" }],
  ["Selskapet opplyste i fjor at avtalen var innledende.", { kind: "prior_verb", match: "opplyste" }],
  ["Tidligere meldte selskapet at kjøpet var innledende.", { kind: "prior_verb", match: "meldte" }],
  ["Det ble kjent torsdag at riggen er solgt.", { kind: "prior_verb", match: "ble kjent" }],
  ["Selskapet har tidligere varslet at riggen skal selges.", { kind: "prior_verb", match: "har tidligere varslet" }],
  ["Avtalen ble inngått i juni 2026.", { kind: "month", match: "i juni 2026" }],
  ["Avtalen ble signert i mai i fjor.", { kind: "month", match: "i mai i fjor" }],
  ["Riggen ble kontrahert i løpet av mai.", { kind: "month", match: "i lopet av mai" }],
  ["Kontrakten gjelder fra juni.", { kind: "month", match: "fra juni" }],
  ["Torsdag kveld kom meldingen om salget.", { kind: "weekday", match: "torsdag kveld" }],
  ["Selskapet hentet penger på tirsdag.", { kind: "weekday", match: "pa tirsdag" }],
  ["Riggen ble solgt sist fredag.", { kind: "weekday", match: "sist fredag" }],
  ["I forrige uke inngikk selskapet en avtale.", { kind: "relative_time", match: "i forrige uke" }],
  ["Nylig mottok selskapet en ny kontrakt.", { kind: "relative_time", match: "nylig" }],
  ["I forrige måned hentet selskapet 50 millioner kroner.", { kind: "relative_time", match: "i forrige maned" }],
  ["For to uker siden inngikk selskapet en avtale.", { kind: "relative_time", match: "for to uker siden" }],
  ["I går kom det en oppdatering om avtalen.", { kind: "relative_time", match: "i gar" }],
  ["I dag ble avtalen offentlig.", { kind: "relative_time", match: "i dag" }],
  ["Emisjonen ble gjennomført i høst.", { kind: "relative_time", match: "i host" }],
  ["Emisjonen ble gjennomført i vår.", { kind: "relative_time", match: "i var" }],
  ["Odfjell Drilling opplyser at beløpet ikke er fastsatt.", { kind: "issuer_attribution", match: "odfjell drilling opplyser" }],
  ["Beløpet er ikke fastsatt, opplyser Odfjell Drilling.", { kind: "issuer_attribution", match: "opplyser odfjell drilling" }],
  ["Ifølge Odfjell Drilling er kontrakten verdt 200 millioner dollar.", { kind: "issuer_attribution", match: "ifolge odfjell drilling" }],
  ["Riggen har full utnyttelse, sa Odfjell.", { kind: "issuer_attribution", match: "sa odfjell" }],
  ["Ifølge ODL er riggen fullt utnyttet.", { kind: "issuer_attribution", match: "ifolge odl" }],
  ["Ifølge den tidligere meldingen skulle riggen leveres i 2027.", { kind: "prior_notice_attribution", match: "ifolge den tidligere meldingen" }],
  ["I meldingen fra juni het det at riggen skulle leveres i 2027.", { kind: "prior_notice_attribution", match: "i meldingen fra juni" }],
  ["Ifølge selskapet er beløpet ikke fastsatt.", { kind: "company_attribution", match: "ifolge selskapet" }],
  ["Beløpet er ikke fastsatt, opplyser selskapet.", { kind: "company_attribution", match: "opplyser selskapet" }]
];

const UNMARKED: string[] = [
  "Agil Helse er en bedriftshelsetjeneste i Bergen.",
  "Kjøpet prises til 7,6 millioner kroner.",
  "Selskapet har 40 ansatte.",
  "Aksjene leveres 5. juni.",
  "Generalforsamlingen avholdes 12. mai 2026.",
  "Odfjell Drilling har åtte rigger i drift.",
  "Selskapet har flere prosjekter i vår portefølje.",
  "Dette er en viktig milepæl for selskapet.",
  ""
];

describe("issuerAliases", () => {
  it("strips legal suffixes and adds the first distinctive word and the ticker", () => {
    expect(issuerAliases("Odfjell Drilling Ltd", "ODL")).toEqual([
      "odfjell drilling",
      "odfjell",
      "odl"
    ]);
    expect(issuerAliases("Nykode Therapeutics ASA", "NYKD")).toEqual([
      "nykode therapeutics",
      "nykode",
      "nykd"
    ]);
  });

  it("dedupes when the distinctive word equals the full name", () => {
    expect(issuerAliases("Sentia ASA", "SNTIA")).toEqual(["sentia", "sntia"]);
  });

  it("never yields a generic stop word such as bare 'norwegian'", () => {
    const aliases = issuerAliases("Norwegian Air Shuttle ASA", "NAS");
    expect(aliases).not.toContain("norwegian");
    expect(aliases).toEqual(["norwegian air shuttle", "shuttle", "nas"]);
    expect(issuerAliases("Norsk Hydro ASA", "NHY")).toEqual(["norsk hydro", "hydro", "nhy"]);
  });

  it("keeps 'Holding' in the full name and adds shortened forms without trailing generic words", () => {
    expect(issuerAliases("Crayon Group Holding ASA", "CRAYN")).toEqual([
      "crayon group holding",
      "crayon group",
      "crayon",
      "crayn"
    ]);
    expect(issuerAliases("Ørn Software Holding ASA", "ORN")).toEqual([
      "orn software holding",
      "orn software",
      "orn"
    ]);
    expect(issuerAliases("DNB Bank ASA", "DNB")).toEqual(["dnb bank", "dnb"]);
    expect(issuerAliases("Nordic Capital Holding AB", null)).toEqual(["nordic capital holding"]);
  });

  it("handles dotted suffixes, missing signs and empty names without empty strings", () => {
    expect(issuerAliases("Frontline Ltd.", null)).toEqual(["frontline"]);
    expect(issuerAliases("  Golden Ocean Group Limited ", undefined)).toEqual([
      "golden ocean group",
      "golden ocean",
      "golden"
    ]);
    expect(issuerAliases("", null)).toEqual([]);
    expect(issuerAliases("ASA", "  ")).toEqual([]);
    for (const aliases of [
      issuerAliases("", ""),
      issuerAliases("Ltd", "X"),
      issuerAliases("Sentia ASA", "SNTIA")
    ]) {
      expect(aliases.every((alias) => alias.length > 0)).toBe(true);
    }
  });
});

describe("findContextMarker", () => {
  it.each(MARKED)("marks %j", (sentence, expected) => {
    expect(findContextMarker(sentence, ODFJELL)).toEqual(expected);
  });

  it.each(UNMARKED.map((sentence) => [sentence]))("does not mark %j", (sentence) => {
    expect(findContextMarker(sentence, ODFJELL)).toBeNull();
  });

  it("does not treat a bare calendar date as a month marker", () => {
    expect(findContextMarker("Aksjene leveres 5. juni.", [])).toBeNull();
    expect(findContextMarker("Aksjene leveres 5 juni 2026.", [])).toBeNull();
    expect(findContextMarker("Aksjene leveres i juni.", [])).toEqual({
      kind: "month",
      match: "i juni"
    });
  });

  it("applies precedence: prior_verb > month > weekday > relative_time > issuer > prior notice > company", () => {
    expect(findContextMarker("Selskapet meldte i juni om en innledende avtale.", ODFJELL)?.kind).toBe(
      "prior_verb"
    );
    expect(findContextMarker("Torsdag opplyste selskapet at avtalen var innledende.", ODFJELL)?.kind).toBe(
      "prior_verb"
    );
    expect(findContextMarker("Avtalen ble inngått i juni, ifølge selskapet.", ODFJELL)).toEqual({
      kind: "month",
      match: "i juni"
    });
    expect(findContextMarker("Avtalen ble inngått torsdag, ifølge Odfjell Drilling.", ODFJELL)).toEqual({
      kind: "weekday",
      match: "torsdag"
    });
    expect(findContextMarker("Ifølge Odfjell Drilling ble avtalen inngått i fjor.", ODFJELL)).toEqual({
      kind: "relative_time",
      match: "i fjor"
    });
    expect(findContextMarker("Ifølge Odfjell Drilling stemmer dette med det som sto i den tidligere meldingen.", ODFJELL)?.kind).toBe(
      "issuer_attribution"
    );
    expect(findContextMarker("Ifølge selskapet stemmer dette med det som sto i den tidligere meldingen.", ODFJELL)?.kind).toBe(
      "prior_notice_attribution"
    );
    expect(findContextMarker("Ifølge selskapet stemmer dette med den tidligere meldingen.", ODFJELL)?.kind).toBe(
      "relative_time"
    );
  });

  it("lets an enclosing phrase win over a marker nested inside it", () => {
    expect(findContextMarker("Ifølge den tidligere meldingen skulle riggen leveres i 2027.", [])).toEqual({
      kind: "prior_notice_attribution",
      match: "ifolge den tidligere meldingen"
    });
    expect(findContextMarker("Avtalen ble signert i mai i fjor.", [])).toEqual({
      kind: "month",
      match: "i mai i fjor"
    });
  });

  it("matches issuer aliases regardless of case and diacritics", () => {
    expect(findContextMarker("Beløpet er ikke kjent, opplyser Odfjell Drilling.", ["Odfjell Drilling"])).toEqual({
      kind: "issuer_attribution",
      match: "opplyser odfjell drilling"
    });
    expect(findContextMarker("Ørn Software opplyser at avtalen løper i tre år.", issuerAliases("Ørn Software Holding ASA", "ORN"))).toEqual({
      kind: "issuer_attribution",
      match: "orn software opplyser"
    });
    expect(findContextMarker("Ifølge Odfjell Drillings børsmelding er riggen solgt.", ODFJELL)).toEqual({
      kind: "issuer_attribution",
      match: "ifolge odfjell drillings"
    });
    expect(findContextMarker("Odfjell Drilling Ltd. opplyser at riggen er solgt.", ODFJELL)).toEqual({
      kind: "issuer_attribution",
      match: "odfjell drilling ltd. opplyser"
    });
  });

  it("requires an attribution verb next to the alias, on word boundaries", () => {
    expect(findContextMarker("Odfjell Drilling har åtte rigger.", ODFJELL)).toBeNull();
    expect(findContextMarker("Ifølge Odfjellsenteret er riggen solgt.", ODFJELL)).toBeNull();
    expect(findContextMarker("Ifølge Odfjell Drilling er riggen solgt.", [])).toBeNull();
    expect(findContextMarker("Ifølge Odfjell Drilling er riggen solgt.", ["", "  "])).toBeNull();
  });

  it("never throws on odd input", () => {
    expect(findContextMarker(undefined as unknown as string, ODFJELL)).toBeNull();
    expect(findContextMarker("Ifølge Odfjell Drilling.", undefined as unknown as string[])).toBeNull();
    expect(findContextMarker("Ifølge (Odfjell).", ["(odfjell)", "a.b*c"])).not.toBeNull();
    expect(findContextMarker("   \n\t ", ODFJELL)).toBeNull();
  });
});

describe("hasContextMarker", () => {
  it("mirrors findContextMarker", () => {
    for (const [sentence] of MARKED) {
      expect(hasContextMarker(sentence, ODFJELL)).toBe(true);
      expect(hasContextMarker(sentence, ODFJELL)).toBe(findContextMarker(sentence, ODFJELL) !== null);
    }
    for (const sentence of UNMARKED) {
      expect(hasContextMarker(sentence, ODFJELL)).toBe(false);
      expect(hasContextMarker(sentence, ODFJELL)).toBe(findContextMarker(sentence, ODFJELL) !== null);
    }
  });
});

describe("constants", () => {
  it("exports Norwegian month and weekday names", () => {
    expect(CONTEXT_MARKER_MONTHS).toHaveLength(12);
    expect(CONTEXT_MARKER_MONTHS[0]).toBe("januar");
    expect(CONTEXT_MARKER_MONTHS[11]).toBe("desember");
    expect(CONTEXT_MARKER_WEEKDAYS).toEqual([
      "mandag",
      "tirsdag",
      "onsdag",
      "torsdag",
      "fredag",
      "lørdag",
      "søndag"
    ]);
  });
});

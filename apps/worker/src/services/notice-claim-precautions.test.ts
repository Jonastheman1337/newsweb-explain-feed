import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import {
  buildNoticeAttributionCorrectionInstruction,
  findAttributionRisks,
  findNoticeAttributionRisks
} from "./claim-precautions.js";

function draft(body: string[], overrides?: Partial<RewriteOutput>): RewriteOutput {
  return {
    title: "Selskapet legger frem kvartalstall",
    lead: "Resultatet ender på 20 millioner kroner, ifølge kvartalsrapporten.",
    body,
    company_sentence: "",
    key_facts: [],
    negative_or_surprising: [],
    excluded_hype: [],
    source_limitations: [],
    confidence: "medium",
    importance: "medium",
    source_spans: [],
    ...overrides
  };
}

describe("notice attribution and certainty", () => {
  it.each([
    "Inntektene øker til 100 millioner kroner fra 80 millioner.",
    "Inntektene øker til 100 millioner kroner, ifølge selskapet.",
    "Leieinntektene øker til 96,7 millioner kroner fra 95 millioner.",
    "Finanskostnadene har økt til 92,5 millioner kroner fra 88,8 millioner.",
    "Styret øker utbyttet til 3 kroner per aksje.",
    "Selskapet reduserer bemanningen med 40 årsverk.",
    "Transaksjonen gir selgeren 100 millioner kroner i kontanter.",
    "Generalforsamlingen gir styret fullmakt til å utstede aksjer.",
    "Selskapet sikrer 200 millioner kroner i finansiering.",
    "Inntektene steg i kvartalet, mens kostnadene falt."
  ])("does not demand hedging or attribution for a concrete fact: %s", (fact) => {
    expect(findNoticeAttributionRisks(draft([fact]))).toEqual([]);
  });

  it("accepts the reported Carucel figures without creating kan ha uncertainty", () => {
    const rewrite = draft([
      "Totale driftsinntekter falt til 132,3 millioner kroner fra 175,3 millioner, mens leieinntektene øker til 96,7 millioner fra 95 millioner.",
      "Finanskostnadene øker til 92,5 millioner kroner fra 88,8 millioner."
    ]);
    const risks = findNoticeAttributionRisks(rewrite);
    expect(risks).toEqual([]);
    expect(buildNoticeAttributionCorrectionInstruction(risks)).toBeNull();
  });

  it.each([
    "Teknologien gjør det mulig å redusere materialsvinn og energibruk.",
    "Dette bidrar til bedre kapitalutnyttelse for kundene.",
    "Avtalen vil bidra til bedre kapitalutnyttelse for kundene.",
    "Teknologien kan bidra til bedre kapitalutnyttelse for kundene.",
    "Avtalen styrker selskapets posisjon.",
    "Avtalen styrker selskapet.",
    "Teknologien forbedrer produktiviteten.",
    "Dette viser at avtalen styrker selskapets posisjon.",
    "Resultatet viser at teknologien forbedrer konkurranseevnen.",
    "Transaksjonen sikrer langsiktig vekst.",
    "Tiltaket reduserer risikoen.",
    "Avtalen gir kundene bedre kapitalutnyttelse.",
    "Oppkjøpet markerer en viktig milepæl.",
    "Teknologien forbedrer konkurranseevnen med 20 prosent.",
    "Dette kan bidra til bedre kapitalutnyttelse, hevdes det."
  ])("requires an owner for a causal or qualitative claim: %s", (claim) => {
    const risks = findNoticeAttributionRisks(draft([claim]));
    expect(risks).toHaveLength(1);
    expect(risks[0]).toMatchObject({ index: 2, sentence: claim });
  });

  it.each([
    "Teknologien gjør det mulig å redusere materialsvinn og energibruk, ifølge selskapet.",
    "Dette bidrar til bedre kapitalutnyttelse for kundene, skriver selskapet.",
    "Selskapet mener avtalen styrker posisjonen.",
    "Selskapet venter at avtalen vil bidra til bedre kapitalutnyttelse.",
    "Ifølge selskapet kan teknologien bidra til bedre kapitalutnyttelse.",
    "Ifølge halvårsrapporten bidro høyere priser til resultatveksten.",
    "Ifølge Equinor styrker avtalen selskapets posisjon.",
    "Equinor mener avtalen styrker posisjonen.",
    "Equinor anslår at tiltaket reduserer risikoen.",
    "Konsernsjef Kari Hansen mener avtalen styrker posisjonen.",
    "– Teknologien styrker selskapets posisjon, sier konsernsjef Kari Hansen.",
    "– Teknologien bidrar til bedre kapitalutnyttelse, skriver Kari Hansen, finansdirektør i selskapet.",
    "Dette bidrar til bedre kapitalutnyttelse, hevdes det i meldingen."
  ])("accepts attributed claims with the source's existing certainty: %s", (claim) => {
    expect(findNoticeAttributionRisks(draft([claim]))).toEqual([]);
  });

  it.each([
    "Inntektene øker til 100 millioner ifølge selskapet, mens teknologien styrker konkurranseevnen.",
    "Selskapet melder at inntektene øker til 100 millioner; teknologien styrker konkurranseevnen.",
    "Inntektene øker ifølge selskapet og avtalen styrker konkurranseevnen.",
    "Teknologien styrker konkurranseevnen, mens selskapet opplyser at inntektene øker."
  ])("does not borrow attribution from another independent clause: %s", (sentence) => {
    const risks = findNoticeAttributionRisks(draft([sentence]));
    expect(risks).toHaveLength(1);
    expect(risks[0]?.clause).toContain("styrker konkurranseevnen");
  });

  it.each([
    "Ifølge selskapet øker inntektene, mens teknologien styrker konkurranseevnen.",
    "Selskapet mener inntektene vil øke, og teknologien styrker konkurranseevnen.",
    "Inntektene øker, mens teknologien styrker konkurranseevnen, ifølge selskapet."
  ])("recognizes attribution that scopes over the complete sentence: %s", (sentence) => {
    expect(findNoticeAttributionRisks(draft([sentence]))).toEqual([]);
  });

  it("checks title and lead independently of body attribution", () => {
    const rewrite = draft(["Dette styrker konkurranseevnen, ifølge selskapet."], {
      title: "Avtalen styrker konkurranseevnen",
      lead: "Dette gir bedre kapitalutnyttelse."
    });
    expect(findNoticeAttributionRisks(rewrite).map((risk) => risk.index)).toEqual([0, 1]);
  });

  it("keeps the excluded sak attribution contract intact", () => {
    const rewrite = draft([
      "Inntektene øker til 100 millioner kroner, ifølge selskapet."
    ]);
    expect(findAttributionRisks(rewrite)).toHaveLength(1);
    expect(findAttributionRisks(rewrite)[0]?.reason).toContain("mangler forbehold");
    expect(findNoticeAttributionRisks(rewrite)).toEqual([]);
  });
});

describe("notice attribution repair instruction", () => {
  it("targets the unowned claim while protecting fact certainty and forecast conditions", () => {
    const risks = findNoticeAttributionRisks(draft([
      "Inntektene øker ifølge selskapet, mens avtalen styrker selskapets posisjon."
    ]));
    const instruction = buildNoticeAttributionCorrectionInstruction(risks);
    expect(instruction).toContain("Påstand: avtalen styrker selskapets posisjon.");
    expect(instruction).toContain("Rapporterte tall og bekreftede hendelser skal ikke svekkes");
    expect(instruction).toContain("Prognoser, mål, muligheter og betingede hendelser skal heller ikke gjøres til sikre eller gjennomførte fakta");
    expect(instruction).toContain("Ikke legg til eller fjern forbehold uten dekning i kilden");
    expect(instruction).toContain("la faktadeler av samme setning stå uendret");
    expect(instruction).not.toContain("Bruk alltid attribusjon og nøkternt forbehold");
  });

  it("does not issue a repair instruction for an attributed unhedged opinion", () => {
    const risks = findNoticeAttributionRisks(draft([
      "Selskapet mener avtalen styrker konkurranseevnen."
    ]));
    expect(buildNoticeAttributionCorrectionInstruction(risks)).toBeNull();
  });
});

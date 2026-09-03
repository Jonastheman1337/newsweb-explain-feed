import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import {
  PROMPT_VERSION,
  createDeveloperPrompt,
  createSystemPrompt,
  createUserPrompt,
  createRevisionUserPrompt,
  type PromptPayload
} from "./prompt.js";
import {
  createRegularPromptVariantMessages,
  getRegularPromptVariantProfile,
  regularPromptVariantIds
} from "./regular-prompt-variants.js";
import {
  createReportDeveloperPrompt,
  createReportRevisionUserPrompt,
  type ReportPromptPayload
} from "./report-prompt.js";
import {
  createYearlyReportRevisionUserPrompt,
  type YearlyReportPromptPayload
} from "./yearly-report-prompt.js";

const samplePayload: PromptPayload = {
  messageId: 12345,
  title: "Test melding",
  issuerName: "Test ASA",
  issuerSign: "TEST",
  publishedAt: "2026-01-15T10:00:00Z",
  categories: ["Innsideinformasjon"],
  markets: ["Oslo Børs"],
  bodyText: "Selskapet har inngått en avtale om kjøp av 100% av aksjene.",
  hasAttachments: false,
  sourceBodyChars: 55
};

const sampleOutput: RewriteOutput = {
  title: "Test kjøper selskap",
  lead: "Test ASA kjøper et selskap, ifølge en børsmelding.",
  body: [
    "Avtalen gjelder kjøp av alle aksjene.",
    "Transaksjonen forventes gjennomført i løpet av kvartalet."
  ],
  company_sentence: "Test ASA er et norsk teknologiselskap.",
  key_facts: ["Kjøper 100% av aksjene"],
  negative_or_surprising: [],
  excluded_hype: [],
  source_limitations: [],
  confidence: "high",
  importance: "medium",
  source_spans: ["inngått en avtale om kjøp av 100% av aksjene"]
};

const sampleReportPayload: ReportPromptPayload = {
  ...samplePayload,
  reportText: "Inntektene steg til 100 millioner kroner. Resultat for skatt var 20 millioner.",
  reportPageCount: 12
};

const sampleYearlyPayload: YearlyReportPromptPayload = {
  ...samplePayload,
  letterText: null,
  remunerationText: "CEO fikk samlet godtgjorelse pa 5 millioner kroner.",
  reportPageCount: 80
};

describe("OpenAI prompt contract", () => {
  it("bumps the prompt version for the editorial guardrail update", () => {
    expect(PROMPT_VERSION).toBe("v5.10.0");
  });

  it("states the related-notice rules once, in the developer prompt only", () => {
    const developer = createDeveloperPrompt();
    expect(developer).toContain("TIDLIGERE MELDING DET VISES TIL");
    expect(developer).toContain("Tittel, lead og første avsnitt bygger bare på den nye meldingen");
    expect(developer.match(/TIDLIGERE MELDING DET VISES TIL/g)).toHaveLength(1);
    expect(createSystemPrompt()).not.toContain("TIDLIGERE MELDING");
    expect(createUserPrompt(samplePayload)).not.toContain("TIDLIGERE MELDING");
    expect(createReportDeveloperPrompt()).toContain("TIDLIGERE MELDING DET VISES TIL");
  });

  it("renders auto-attached related notices as dated background blocks", () => {
    const relatedNotices = [
      {
        messageId: 676863,
        relation: "reference" as const,
        title: "HENT inngår innledende avtale med Nscale",
        issuerName: "Sentia ASA",
        issuerSign: "SNTIA",
        publishedAt: "2026-06-23T14:25:02.930Z",
        text: "HENT har nå inngått en Limited Notice to Proceed (LNTP) med Nscale.",
        textChars: 68,
        resolvedBy: "db" as const,
        score: 0.6
      }
    ];
    const payload: PromptPayload = {
      ...samplePayload,
      publishedAt: "2026-09-02T05:00:04.025Z",
      relatedNotices
    };
    const prompt = createUserPrompt(payload);

    expect(prompt).toContain(
      "TIDLIGERE MELDING DET VISES TIL (bakgrunn, reglene står i oppgavebeskrivelsen):"
    );
    expect(prompt).toContain("[prior_676863]");
    expect(prompt).toContain("relation: viser til");
    expect(prompt).toContain("publisert: tirsdag 23. juni 2026 (71 dager før den nye meldingen)");
    expect(prompt).toContain("anbefalt tidsmarkør: i juni");
    expect(prompt).toContain("utsteder: Sentia ASA (SNTIA)");
    expect(prompt).toContain("Limited Notice to Proceed");
    // Rules are not duplicated into the uncached user turn.
    expect(prompt).not.toContain("Nyheten er det den nye meldingen sier");

    const revision = createRevisionUserPrompt(payload, sampleOutput, "Kort ned.");
    expect(revision).toContain("[prior_676863]");
    expect(revision.indexOf("[prior_676863]")).toBeLessThan(
      revision.indexOf("INSTRUKSJON:")
    );

    const controlWithoutRelated = createRegularPromptVariantMessages(
      "regular_v5_related_off",
      payload
    );
    expect(controlWithoutRelated.userPrompt).not.toContain("[prior_676863]");
    expect(
      createRegularPromptVariantMessages("regular_v5_6_control", payload).userPrompt
    ).toContain("[prior_676863]");
  });

  it("uses materiality and mechanism-first regular notice framing by default", () => {
    const combined = [
      createSystemPrompt(),
      createDeveloperPrompt(),
      createUserPrompt(samplePayload)
    ].join("\n");

    expect(combined).not.toContain("hva betyr det for aksjen");
    expect(combined).not.toContain("vurderer a kjope aksjen");
    expect(combined).not.toContain("aksjeeier");
    expect(combined).not.toContain("kursdrivende");
    expect(combined).not.toContain("kurseffekt");
    expect(combined).toContain("mest vesentlig for selskapet og aksjonærene");
    expect(combined).toContain("KILDE SOM DATA");
    expect(combined).toContain("MEKANISMEFORKLARING");
    expect(combined).toContain("Forklar hva begrepet gjor i akkurat denne meldingen");
  });

  it("does not embed the JSON schema in the developer prompt", () => {
    const result = createDeveloperPrompt('{"type":"object"}');

    expect(result).not.toContain("JSON schema");
    expect(result).not.toContain('{"type":"object"}');
  });

  it("includes signal-derived guidance for routine compression and plain explanation", () => {
    const result = createDeveloperPrompt();

    expect(result).toContain("Rutinesaker skal komprimeres hardt");
    expect(result).toContain("avlyst reparasjonsemisjon");
    expect(result).toContain("fullmakt");
    expect(result).toContain("stemme på vegne av andre aksjonærer");
    expect(result).toContain("Endurance-plattformen");
    expect(result).toContain("Forklar hver navngitte label");
    expect(result).toContain("1,3 milliarder kroner");
    expect(result).toContain("styrke likviditeten");
    expect(result).toContain("låneendringer");
  });

  it("includes regression examples for short routine cases", () => {
    const result = createDeveloperPrompt();

    expect(result).toContain("Avlyst reparasjonsemisjon");
    expect(result).toContain("Idex dropper reparasjonsemisjon");
    expect(result).toContain("Fullmakt til generalforsamling");
    expect(result).toContain("Ren tegningspåminnelse");
    expect(result).toContain("Meldingen inneholder ingen nye vilkår");
  });

  it("omits the routine share-count example that overfit notices", () => {
    const result = createDeveloperPrompt();

    expect(result).not.toContain("Kort rutinemelding (1 body-avsnitt)");
    expect(result).not.toContain("Aqua Bio Technology");
    expect(result).not.toContain("5,2 millioner aksjer");
  });

  it("asks for varied early attribution instead of repeated stock endings", () => {
    const result = createDeveloperPrompt();

    expect(result).toContain("ikke la hver sak ende med samme standardhale");
    expect(result).toContain("Kildehenvisningen kan sta i andre setning");
    expect(result).toContain("gar det frem av meldingen");
  });

  it("uses source-close quote guidance without the old guillemets taxonomy", () => {
    const combined = [
      createDeveloperPrompt(),
      createUserPrompt({
        ...samplePayload,
        hasAttachments: true,
        pdfSupplementText: "CEO Kari Hansen says demand was weaker than expected."
      })
    ].join("\n");

    expect(combined).toContain("SITATER, GUILLEMETS OG PERSONATTRIBUSJON");
    expect(combined).toContain("en nær direkte oversettelse av en engelsk formulering");
    expect(combined).toContain("HOVEDREGEL FOR PERSONUTTALELSER");
    expect(combined).toContain("Tre verktøy, rangert");
    expect(combined).toContain("Sitatstrek (–) er hovedformen");
    expect(combined).toContain("Fri personattribuert parafrase er fallback");
    expect(combined).toContain("Ikke erstatt et godt kort sitat");
    expect(combined).toContain("Regnskap for uttalelser");
    expect(combined).toContain("skal saken normalt bruke ett kort sitatstrek-avsnitt");
    expect(combined).toContain("Sjekk kilden for navngitte uttalelser");
    expect(combined).toContain("Bruk ren personattribuert parafrase bare");
    expect(combined).toContain("tilfører nyhetsverdig substans, forklaring eller relevant personuttalelse");
    expect(combined).not.toContain("Bruk normalt ett kort sitat");
    expect(combined).not.toContain("Guillemets («») = parafrasering");
    expect(combined).not.toContain("Hvis kilden har direkte sitater");
    expect(combined).not.toContain("bruk dem nar de gir nyhetsverdi");
    expect(combined).not.toContain("kun hvis den inneholder nyhetsverdige opplysninger som ikke dekkes");
  });

  it("includes quote-bearing style examples and the quote self-check", () => {
    const result = createDeveloperPrompt();

    expect(result).toContain("Resultatvarsel med kildefast formulering");
    expect(result).toContain("«klart svakere enn tidligere antatt»");
    expect(result).toContain("Kontrakt med ledelseskommentar");
    expect(result).toContain(
      "– Dette er den største enkeltkontrakten vår i USA"
    );
    expect(result).toContain("Avtale med sitat etter kontekst");
    expect(result).toContain("Det er nå opp til eierne bak Knif");
    expect(result).toContain("– Vi håper eierne i Knif ser verdien i å fusjonere");
    expect(result).toContain("Tilleggsmateriale med analytikersitat");
    expect(result).toContain("Han skriver videre at opptrappingen skjer raskere");
    expect(result).toContain("SELVSJEKK SITAT");
    expect(result).toContain("Hvis du bare har parafrasert den");
    expect(
      result.match(/– [^"]{8,}?, sier /g)?.length ?? 0
    ).toBeGreaterThanOrEqual(3);
  });

  it("renders selected supplemental materials as secondary sources", () => {
    const prompt = createUserPrompt({
      ...samplePayload,
      outputMode: "extended_notice",
      supplementalMaterials: [
        {
          id: "mat1",
          sourceId: "material_mat1",
          kind: "text",
          title: "Analyst note",
          text: "Analysts expected revenue of 120 million kroner.",
          textChars: 48
        }
      ]
    });

    expect(prompt).toContain("outputMode: extended_notice");
    expect(prompt).toContain("maxVisibleArticleChars: 1800");
    expect(prompt).toContain("Synlig artikkeltekst maks 1800 tegn");
    expect(prompt).toContain("SUPPLERENDE MATERIALE");
    expect(prompt).toContain("[material_mat1]");
    expect(prompt).toContain("Analysts expected revenue");
  });

  it("exposes regular prompt variants for offline editorial evals", () => {
    expect(regularPromptVariantIds).toEqual([
      "regular_v5_6_control",
      "regular_v5_related_off",
      "audience_mechanism_v1",
      "regular_v6_full",
      "regular_v6_draft",
      "regular_v6_draft_2"
    ]);
    expect(
      regularPromptVariantIds.map(
        (variantId) => getRegularPromptVariantProfile(variantId).responseSchemaId
      )
    ).toEqual([
      "rewrite_v5_title_first_v1",
      "rewrite_v5_title_first_v1",
      "rewrite_v5_title_first_v1",
      "rewrite_v6_extract_first_v1",
      "rewrite_v6_extract_first_v1",
      "rewrite_v6_extract_first_v1"
    ]);
    for (const variantId of regularPromptVariantIds) {
      const profile = getRegularPromptVariantProfile(variantId);
      expect(profile.variantId).toBe(variantId);
      expect(profile.parserProfileId).toBe("rewrite_output_zod_v1");
      expect(profile.validationProfileId).toBe(
        "regular_rewrite_validation_v1"
      );
      expect(createRegularPromptVariantMessages(variantId, samplePayload).promptVersion).toBe(
        profile.promptVersion
      );
    }

    const control = createRegularPromptVariantMessages(
      "regular_v5_6_control",
      samplePayload
    );

    expect(control.systemPrompt).toBe(createSystemPrompt());
    expect(control.developerPrompt).toBe(createDeveloperPrompt());
    expect(control.userPrompt).toBe(createUserPrompt(samplePayload));
  });

  it("adds a mechanism-first challenger without stock-advice audience framing", () => {
    const challenger = createRegularPromptVariantMessages(
      "audience_mechanism_v1",
      samplePayload
    );
    const combined = [
      challenger.systemPrompt,
      challenger.developerPrompt,
      challenger.userPrompt
    ].join("\n");

    expect(challenger.promptVersion).toContain("audience_mechanism_v1");
    expect(combined).not.toContain("hva betyr det for aksjen");
    expect(combined).not.toContain("vurderer a kjope aksjen");
    expect(combined).not.toContain("aksjeeier");
    expect(combined).toContain("MEKANISMEFORKLARING");
    expect(combined.match(/MEKANISMEFORKLARING/g)).toHaveLength(2);
    expect(combined).toContain("Forklar hva begrepet gjor i akkurat denne meldingen");
    expect(combined).toContain(
      "Leseren er finansielt interessert og leser dette som nyheter, ikke som investeringsrad."
    );
    expect(combined).toContain(
      "Plukk ut det som hjelper leseren a forsta hva selskapet har meldt og hvilken mekanisme som betyr noe."
    );
  });
});

describe("createRevisionUserPrompt", () => {
  it("includes formatted previous output with labeled fields", () => {
    const result = createRevisionUserPrompt(samplePayload, sampleOutput, "Gjør det kortere");

    expect(result).toContain("title: Test kjøper selskap");
    expect(result).toContain("lead: Test ASA kjøper et selskap");
    expect(result).toContain("1. Avtalen gjelder kjøp av alle aksjene.");
    expect(result).toContain("2. Transaksjonen forventes gjennomført");
    expect(result).toContain("company_sentence: Test ASA er et norsk teknologiselskap.");
    expect(result).toContain("importance: medium");
  });

  it("includes instruction after INSTRUKSJON marker", () => {
    const result = createRevisionUserPrompt(samplePayload, sampleOutput, "Fjern siste avsnitt");

    expect(result).toContain("INSTRUKSJON:");
    expect(result).toContain("Fjern siste avsnitt");
    const instrIndex = result.indexOf("INSTRUKSJON:");
    const instrTextIndex = result.indexOf("Fjern siste avsnitt");
    expect(instrTextIndex).toBeGreaterThan(instrIndex);
  });

  it("includes source text in KILDE section", () => {
    const result = createRevisionUserPrompt(samplePayload, sampleOutput, "Kortere");

    expect(result).toContain("KILDE (FULL ORIGINALTEKST):");
    expect(result).toContain("Selskapet har inngått en avtale om kjøp av 100% av aksjene.");
  });

  it("does not contain raw JSON of the previous output", () => {
    const result = createRevisionUserPrompt(samplePayload, sampleOutput, "Kortere");

    expect(result).not.toContain('"title":"Test kjøper selskap"');
    expect(result).not.toContain('{"title":');
  });

  it("includes key_facts joined with semicolons", () => {
    const multiFactOutput: RewriteOutput = {
      ...sampleOutput,
      key_facts: ["Kjøper 100% av aksjene", "Pris: 50 mill. kroner"]
    };
    const result = createRevisionUserPrompt(samplePayload, multiFactOutput, "Kortere");

    expect(result).toContain("key_facts: Kjøper 100% av aksjene; Pris: 50 mill. kroner");
  });

  it("includes strengthened revision instructions with examples", () => {
    const result = createRevisionUserPrompt(samplePayload, sampleOutput, "Test");

    expect(result).toContain("VIKTIG: Instruksjonen er styrende");
    expect(result).toContain("Ikke gjor tilfeldige smaendringer");
    expect(result).toContain("Fjern dette fra teksten");
    expect(result).toContain("Gjor det kortere");
    expect(result).toContain("For komplisert");
    expect(result).toContain("Vinkle pa kontrakten");
  });

  it("labels supplemental source text without visible PDF language", () => {
    const result = createRevisionUserPrompt(
      {
        ...samplePayload,
        hasAttachments: true,
        pdfSupplementText: "Selskapet opplyser at avtalen er signert."
      },
      sampleOutput,
      "Bruk ekstra kildetekst"
    );

    expect(result).toContain("EKSTRA KILDETEKST FRA SELSKAPET");
    expect(result).not.toContain("PDF-VEDLEGG");
  });
});

describe("createReportRevisionUserPrompt", () => {
  it("asks report rewrites to include context beyond a pure number list", () => {
    const result = createReportDeveloperPrompt();

    expect(result).toContain("Ikke la saken bli en ren talliste");
    expect(result).toContain("utsikter");
    expect(result).toContain("markedsforhold");
  });

  it("tightens report angle, dividend and accounting-language guidance", () => {
    const result = createReportDeveloperPrompt();

    expect(result).toContain("ikke det største isolerte tallet");
    expect(result).toContain("Lead skal fortelle utviklingen eller spenningen");
    expect(result).toContain("Ikke bruk 'fikk et resultat på X, mot Y'");
    expect(result).toContain("små per-aksje-beløp");
    expect(result).toContain("driftsresultat (ebit)");
    expect(result).toContain("ebitda");
    expect(result).toContain("første kvartal' to ganger");
  });

  it("forbids the body opening from restating the lead", () => {
    const result = createReportDeveloperPrompt();

    expect(result).toContain("Lead skal bære ETT hovedtall eller én hovedutvikling");
    expect(result).toContain("2-5 avsnitt som bygger videre på lead");
    expect(result).toContain("Ikke gjenta tall eller utvikling som allerede står i lead");
    expect(result).toContain("Kulepunktene dekker tallene som IKKE står i lead");
    expect(result).not.toContain("Samtidig falt omsetningen kraftig, viser meldingen");
  });

  it("forbids report bullet preambles in the examples and instructions", () => {
    const result = createReportDeveloperPrompt();

    expect(result).toContain("Start punktlisten direkte med forste kulepunkt");
    expect(result).toContain("Ikke lag et eget body-element");
    expect(result.match(/\"Dette er noen/g)).toBeNull();
  });

  it("adds quote-aware management-comment guidance for report rewrites", () => {
    const result = createReportDeveloperPrompt();

    expect(result).toContain("Etter nøkkeltallene skal du se etter én kort ledelseskommentar");
    expect(result).toContain("CEO, CFO eller styreleder");
    expect(result).toContain("en kildefast formulering i «...»");
    expect(result).toContain("skal du normalt bruke ett kort sitatstrek-avsnitt");
    expect(result).toContain("Bruk personattribuert parafrase bare");
    expect(result).toContain(
      "Å droppe en konkret, forklarende ledelseskommentar som finnes i kilden, er en kvalitetsfeil"
    );
    expect(result).not.toContain("bruk normalt ett direkte sitat");
    expect(result).not.toContain("skryter av");
  });

  it("keeps report source context and user instruction in revision mode", () => {
    const result = createReportRevisionUserPrompt(
      sampleReportPayload,
      sampleOutput,
      "Vinkle mer pa inntektsveksten"
    );

    expect(result).toContain("rapportnyheten");
    expect(result).toContain("KILDE (KURATERT RAPPORTKONTEKST):");
    expect(result).toContain(sampleReportPayload.reportText);
    expect(result).toContain("FORRIGE VERSJON");
    expect(result).toContain("Vinkle mer pa inntektsveksten");
  });
});

describe("createYearlyReportRevisionUserPrompt", () => {
  it("keeps remuneration source context and user instruction in revision mode", () => {
    const result = createYearlyReportRevisionUserPrompt(
      sampleYearlyPayload,
      sampleOutput,
      "Gjor saken tydeligere pa CEO-lonn"
    );

    expect(result).toContain("lederlonnssaken");
    expect(result).toContain("KILDE (GODTGJ");
    expect(result).toContain(sampleYearlyPayload.remunerationText);
    expect(result).toContain("FORRIGE VERSJON");
    expect(result).toContain("Gjor saken tydeligere pa CEO-lonn");
  });
});

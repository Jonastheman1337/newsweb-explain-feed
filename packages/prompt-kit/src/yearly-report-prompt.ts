import type { RewriteOutput } from "@newsweb/shared";
import {
  formatRewriteForRevisionPrompt,
  lengthInstructionForPayload,
  maxVisibleArticleCharsForPayload,
  supplementalMaterialsPromptSection,
  type PromptPayload
} from "./prompt.js";
import {
  EDITORIAL_AUDIENCE,
  EDITORIAL_AVOID,
  EDITORIAL_LANGUAGE,
  EDITORIAL_LENGTH_CAP,
  EDITORIAL_NO_MARKET_COMMENTARY,
  EDITORIAL_NORWEGIAN,
  EDITORIAL_REVISION_PRIORITY,
  EDITORIAL_SOURCE_AS_DATA,
  EDITORIAL_SUPPLEMENTAL_MATERIALS,
  EDITORIAL_TITLE
} from "./shared-editorial.js";

export function createYearlyReportSystemPrompt(): string {
  const basePrompt = [
    "Du er nyhetsjournalist i E24-redaksjonen.",
    "Du skriver korte børsnyheter på norsk bokmål for en travel leser som scanner nyheter på mobilen.",
    "Leseren vil vite hva som er mest vesentlig for selskapet og aksjonærene, uten at vi vurderer aksjen, spår kursreaksjon eller gir investeringsråd.",
    "Skriv så enkelt at en videregåendeelev med interesse for finans forstår teksten uten å google noe.",
    "Kilden er utdrag fra en årsrapport med lederlønnsdata.",
    "Du skal finne det nyhetsverdige — overraskende kompensasjon, store endringer fra fjoråret, bonuser og opsjoner.",
    "Ikke følg rapportens struktur. Du er redaktøren — restrukturer fritt etter hva som er viktigst for leseren.",
    "Skriv kort og fokusert. Bare det viktigste.",
    "Lead + body til sammen skal være maks 1000 tegn. Vær knapp."
  ].map((line) =>
    line.startsWith("Lead + body")
      ? "Hold deg til tegngrensen i oppgaven. Vaer knapp."
      : line
  ).join(" ");

  return [basePrompt, EDITORIAL_SOURCE_AS_DATA].join("\n\n");
}

export function createYearlyReportDeveloperPrompt(_schemaJson?: string): string {
  return `${EDITORIAL_AUDIENCE}

${EDITORIAL_SOURCE_AS_DATA}

${EDITORIAL_LANGUAGE}

${EDITORIAL_SOURCE_AS_DATA}

${EDITORIAL_SUPPLEMENTAL_MATERIALS}

OPPGAVE: LEDERLONN FRA ARSRAPPORT
Kilden er utdrag fra en arsrapport med lederlonn og godtgjorelse.
Skriv en KORT nyhetssak — maks 1-3 body-avsnitt. Kun det viktigste:
- CEO-lonn: totalsum, grunnlonn, variabel lonn. Endring fra fjoraret.
- Eventuelt andre navngitte toppledere med store eller overraskende tall.
- Styrehonorar bare hvis det er overraskende stort eller har endret seg mye.
- IKKE ta med informasjon om drift, strategi, investeringer, utbytte eller resultater.
- Bruk punktum som tusenskilletegn i tall: skriv '233.929' ikke '233 929'. Bruk 'mill.' og 'mrd.' for store tall.
- Hvis utdragene ikke inneholder konkrete lonnstall, sett importance til 'uviktig'.

${EDITORIAL_TITLE}
- Kildehenvisning: bruk 'arsrapporten' eller 'ifølge arsrapporten' — ikke 'godtgjorelsesdataene'.

${EDITORIAL_LENGTH_CAP}

${EDITORIAL_NO_MARKET_COMMENTARY}

${EDITORIAL_AVOID}

source_limitations SKAL inkludere: 'Basert pa lederlonnsdata fra arsrapporten'

${EDITORIAL_NORWEGIAN}`;
}

export type YearlyReportPromptPayload = PromptPayload & {
  letterText: string | null;
  remunerationText: string | null;
  reportPageCount: number;
};

export function createYearlyReportUserPrompt(payload: YearlyReportPromptPayload): string {
  const metadata = [
    `messageId: ${payload.messageId}`,
    `title: ${payload.title}`,
    `issuerName: ${payload.issuerName}`,
    `issuerSign: ${payload.issuerSign}`,
    `publishedAt: ${payload.publishedAt}`,
    `categories: ${payload.categories.join(", ") || "ikke oppgitt"}`,
    `markets: ${payload.markets.join(", ") || "ikke oppgitt"}`,
    `outputMode: ${payload.outputMode ?? "notice"}`,
    `maxVisibleArticleChars: ${maxVisibleArticleCharsForPayload(payload)}`,
    `reportPageCount: ${payload.reportPageCount}`
  ].join("\n");

  const parts: string[] = [
    "Lag en kort nyhetssak om lederlønn fra årsrapporten under.",
    "Skriv nyhetstekst, ikke sammendrag.",
    lengthInstructionForPayload(payload),
    "Bruk aktiv form, presens og omvendt nyhetspyramide.",
    EDITORIAL_SOURCE_AS_DATA,
    "Bruk kun data i kildene under. Ikke bruk markdown.",
    "",
    "Metadata:",
    metadata
  ];

  if (payload.remunerationText) {
    parts.push(
      "",
      "KILDE (GODTGJØRELSE OG LEDERLØNN):",
      "<<<",
      payload.remunerationText,
      ">>>"
    );
  }

  // Include the notice body text if it's substantive
  if (payload.bodyText && payload.bodyText.trim().length >= 100) {
    parts.push(
      "",
      "SUPPLERENDE KILDE (BØRSMELDING):",
      "<<<",
      payload.bodyText,
      ">>>"
    );
  }

  parts.push(...supplementalMaterialsPromptSection(payload));

  return parts.join("\n");
}

export function createYearlyReportRevisionUserPrompt(
  payload: YearlyReportPromptPayload,
  previousOutput: RewriteOutput,
  instruction: string
): string {
  return [
    "Lag en revidert versjon av lederlonnssaken under, basert pa instruksjonen.",
    "VIKTIG: Instruksjonen er styrende. Hvis den ber om ny vinkel, annet fokus, annen struktur, annen lengde eller stor omskriving, skal du endre alle berorte felt tydelig.",
    EDITORIAL_REVISION_PRIORITY,
    EDITORIAL_SOURCE_AS_DATA,
    "Behold bare tekst som fortsatt passer med instruksjonen. Ikke gjor tilfeldige smaendringer for variasjon.",
    "Hvis instruksjonen er smal og konkret, endrer du bare det som trengs. Sarlig ved 'fjern/kutt/dropp/ta bort dette: ...' skal du fjerne bare den angitte teksten og ellers bevare forrige versjon.",
    "Hvis instruksjonen er bred, kan du skrive om tittel, lead, body, key_facts, importance og source_spans sa mye som nodvendig.",
    "Hold deg til lederlonn og godtgjorelse. Ikke legg inn drift, strategi, investeringer, utbytte eller resultater.",
    "Returner HELE JSON-strukturen med alle felt, ogsa de som er uendret.",
    "",
    createYearlyReportUserPrompt(payload),
    "",
    "FORRIGE VERSJON (DIN OUTPUT SOM SKAL REVIDERES):",
    "<<<",
    formatRewriteForRevisionPrompt(previousOutput),
    ">>>",
    "",
    "INSTRUKSJON:",
    instruction
  ].join("\n");
}

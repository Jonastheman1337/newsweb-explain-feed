/**
 * Lightweight AI triage to assess whether a notice is newsworthy enough
 * to justify a full multi-step rewrite pipeline.
 *
 * Used for ambiguous categories like "ANNEN INFORMASJONSPLIKTIG REGULATORISK
 * INFORMASJON" where some notices are genuinely newsworthy (M&A, contracts)
 * and others are routine (bond extensions, obligasjonseiermøter).
 *
 * Design: fail-open — if the call errors or times out, default to rewriting.
 */

const TRIAGE_PROMPT = `Du er en redaksjonell vaktsjef for norsk finansnyheter.

Vurder om denne børsmeldingen er nyhetsverdig nok til å fortjene en redaksjonell omskriving, eller om den er en rutinemessig/administrativ melding.

NYHETSVERDIG (svar JA):
- Oppkjøp, fusjoner, fisjoner
- Nye kontrakter av betydelig verdi
- Emisjoner, rettet emisjon, kapitalinnhenting
- Innsideinformasjon om drift, strategi, resultater
- Store organisatoriske endringer (CEO-bytte, restrukturering)
- Kvartals-/årsresultater med vesentlig innhold
- Suspensjon eller handelsstopp
- Rettslige tvister, regulatoriske vedtak

IKKE NYHETSVERDIG (svar NEI):
- Utvidelse av obligasjonslån ("Utvidelse av [TICKER]")
- Obligasjonseiermøter uten vesentlig innhold
- Rene rentefastsettelser
- Rutinemessige kapitalendringer (aksjesplitt, ny aksjekapital registrert)
- Invitasjoner til presentasjoner uten substans
- Trafikktall, driftsstatistikk uten overraskelser
- Administrative endringer i verdipapirer

Svar med et JSON-objekt: {"newsworthy": true/false, "reason": "kort begrunnelse på norsk"}`;

export type TriageResult = {
  newsworthy: boolean;
  reason: string;
};

export type TriageCallFn = (
  title: string,
  bodyExcerpt: string,
  categories: string[]
) => Promise<TriageResult>;

export function buildTriageUserPrompt(
  title: string,
  bodyExcerpt: string,
  categories: string[]
): string {
  return [
    `Tittel: ${title}`,
    `Kategorier: ${categories.join(", ")}`,
    "",
    `Utdrag av meldingen (maks 500 tegn):`,
    bodyExcerpt.slice(0, 500)
  ].join("\n");
}

export function parseTriageResponse(raw: string): TriageResult {
  try {
    const trimmed = raw.trim();
    // Handle fenced JSON
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const jsonStr = fenced?.[1]?.trim() ?? trimmed;

    const firstBrace = jsonStr.indexOf("{");
    const lastBrace = jsonStr.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) {
      return { newsworthy: true, reason: "Could not parse triage response" };
    }

    const parsed = JSON.parse(jsonStr.slice(firstBrace, lastBrace + 1));
    if (typeof parsed.newsworthy !== "boolean") {
      return { newsworthy: true, reason: "Missing newsworthy field" };
    }
    return {
      newsworthy: parsed.newsworthy,
      reason: typeof parsed.reason === "string" ? parsed.reason : ""
    };
  } catch {
    // Fail-open: if we can't parse, assume newsworthy
    return { newsworthy: true, reason: "Triage parse error — defaulting to newsworthy" };
  }
}

export { TRIAGE_PROMPT };

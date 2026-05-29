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
- Invitasjoner til resultatpresentasjoner når selve rapporten/tallene ikke er publisert i kilden
- Publisering av Form 6-K, prospekt, rapport eller annet dokument uten konkrete nye tall, hendelser eller konsekvenser i tilgjengelig tekst
- Flaggemeldinger/store eierandeler der tilgjengelig tekst bare viser til et vedlegg eller skjema uten å oppgi hvem, hvor mye og hvorfor det er interessant
- Trafikktall, driftsstatistikk uten overraskelser
- Administrative endringer i verdipapirer

Hvis saken bare kan skrives ved å lese et vedlegg som ikke er gjengitt i teksten,
er den ikke nyhetsverdig nok for automatisk omskriving.

Svar med et JSON-objekt: {"newsworthy": true/false, "reason": "kort begrunnelse på norsk"}`;

export type TriageResult = {
  newsworthy: boolean;
  reason: string;
};

export type DeterministicTriageSkip = TriageResult & {
  kind: "document-only" | "routine-reminder";
};

export type TriageCallFn = (
  title: string,
  bodyExcerpt: string,
  categories: string[],
  hasAttachments?: boolean
) => Promise<TriageResult>;

const DOCUMENT_ONLY_PATTERNS = [
  /\b(interim|quarterly|annual|financial)\s+report\b/i,
  /\bq[1-4]\s+(?:fy)?\d{4}\s+(?:report|presentation)\b/i,
  /\b(?:årsrapport|kvartalsrapport|delårsrapport|halvårsrapport)\b/i,
  /\b(?:prospectus|prospekt|form\s+6-k|presentation)\b/i,
  /\b(?:has been|is|er)\s+(?:released|published|publisert|offentliggjort)\b/i,
  /\b(?:can be viewed|available|tilgjengelig|kan leses)\b/i,
  /\b(?:clicking the link|link at the end|se vedlegg|see attached)\b/i
];

const SUBSTANTIVE_FACT_PATTERNS = [
  /\b(?:revenue|revenues|inntekter|omsetning)\b/i,
  /\b(?:resultat|profit|loss|earnings|ebit|ebitda|operating income|driftsresultat)\b/i,
  /\b(?:guidance|guiding|utsikter|outlook|utbytte|dividend)\b/i,
  /\b(?:contract|kontrakt|agreement|avtale|order|ordre)\b/i,
  /\b(?:emisjon|rights issue|private placement|capital raise|kapitalinnhenting)\b/i,
  /\b(?:acquisition|oppkjøp|merger|fusjon|sale of|salg av)\b/i,
  /\b(?:resign|resignation|fratrer|går av|ceo|cfo|chair)\b/i,
  /\b(?:nok|usd|eur|dollar|kroner|euro|million|millioner|milliard|billion)\b/i
];

const ROUTINE_REMINDER_PATTERNS = [
  /\blast day of subscription period\b/i,
  /\bcommencement of (?:the )?subscription period\b/i,
  /\bsubscription period (?:commences|starts|ends|expires)\b/i,
  /\bsiste (?:dag|tegningsdag) (?:i|for)\s+tegningsperioden\b/i,
  /\btegningsperioden (?:starter|begynner|utløper|avsluttes)\b/i,
  /\btegningsfrist(?:en)?\b/i
];

const REMINDER_OUTCOME_PATTERNS = [
  /\b(?:result|results|utfall|resultat(?:et)?) of (?:the )?(?:subscription|offering)\b/i,
  /\b(?:fully subscribed|overtegnet|fulltegnet|allocated|allocation|tildel)\b/i,
  /\b(?:gross proceeds|net proceeds|proveny|henter|hentet)\b/i,
  /\b(?:completed|completion|gjennomført|fullført|approved|godkjent)\b/i,
  /\b(?:amend|amended|changed|endre[dt]?|nye vilkår|new terms)\b/i,
  /\b(?:resultat|driftsresultat|inntekter|omsetning|utbytte|contract|kontrakt)\b/i
];

function hasAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function getDeterministicTriageSkip(
  title: string,
  bodyText: string,
  _categories: string[],
  _hasAttachments?: boolean
): DeterministicTriageSkip | null {
  const text = `${title}\n${bodyText}`.trim();
  const hasDocumentOnlySignal = hasAnyPattern(text, DOCUMENT_ONLY_PATTERNS);
  const hasSubstantiveFacts = hasAnyPattern(bodyText, SUBSTANTIVE_FACT_PATTERNS);

  if (hasDocumentOnlySignal && !hasSubstantiveFacts) {
    return {
      newsworthy: false,
      kind: "document-only",
      reason:
        "Tilgjengelig tekst sier bare at et dokument/presentasjon er publisert, uten konkrete tall, hendelser eller konsekvenser."
    };
  }

  if (
    hasAnyPattern(text, ROUTINE_REMINDER_PATTERNS) &&
    !hasAnyPattern(text, REMINDER_OUTCOME_PATTERNS)
  ) {
    return {
      newsworthy: false,
      kind: "routine-reminder",
      reason:
        "Tilgjengelig tekst er en rutinemessig påminnelse om tegningsperiode/frister uten nytt utfall eller nye vilkår."
    };
  }

  return null;
}

export function buildTriageUserPrompt(
  title: string,
  bodyExcerpt: string,
  categories: string[],
  hasAttachments?: boolean
): string {
  return [
    `Tittel: ${title}`,
    `Kategorier: ${categories.join(", ")}`,
    ...(typeof hasAttachments === "boolean"
      ? [`Har vedlegg: ${hasAttachments ? "ja" : "nei"}`]
      : []),
    "",
    `Utdrag av meldingen (maks 1200 tegn):`,
    bodyExcerpt.slice(0, 1200)
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

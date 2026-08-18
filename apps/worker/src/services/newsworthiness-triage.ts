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
- Godkjenning/publisering av prospekt for en allerede annonsert emisjon, med mindre meldingen har nytt resultat, proveny eller utfall
- Flaggemeldinger/store eierandeler der tilgjengelig tekst bare viser til et vedlegg eller skjema uten å oppgi hvem, hvor mye og hvorfor det er interessant
- Trafikktall, driftsstatistikk uten overraskelser
- Administrative endringer i verdipapirer

Hvis saken bare kan skrives ved å lese et vedlegg som ikke er gjengitt i teksten,
er den ikke nyhetsverdig nok for automatisk omskriving.

Sett newsworthy til true/false og gi en kort begrunnelse på norsk i reason.`;

export type TriageResult = {
  newsworthy: boolean;
  reason: string;
};

// P3 registry: class ids ARE the persisted `kind` strings, so pre-registry
// rows, fixtures, and tests keep their values. Registry order is the frozen
// evaluation order (first match wins), mirroring the original fixed rule
// sequence. Append new ids at the END; never reorder.
export const triageClassIds = [
  "document-only",
  "routine-prospectus",
  "routine-reminder",
  "public-sector-results",
  "small-routine-bond"
] as const;

export type TriageClassId = (typeof triageClassIds)[number];

export type TriageReasonCode =
  | "TRIAGE_DOCUMENT_ONLY"
  | "TRIAGE_ROUTINE_PROSPECTUS"
  | "TRIAGE_ROUTINE_REMINDER"
  | "TRIAGE_PUBLIC_SECTOR_RESULTS"
  | "TRIAGE_SMALL_ROUTINE_BOND";

export type DeterministicTriageSkip = TriageResult & {
  kind: TriageClassId;
  classId: TriageClassId;
  reasonCode: TriageReasonCode;
};

// The production default. CI safety gates replay getDeterministicTriageSkip
// bare, so this constant — not env — is what release flips change; the
// TRIAGE_SKIP_CLASSES env is the emergency kill-switch only. Enabling a
// class = append its id here + build-safety-fixtures --update-expected in
// the same commit; that fixture diff is the release record.
export const defaultEnabledTriageClasses: readonly TriageClassId[] = [
  "document-only",
  "routine-prospectus",
  "routine-reminder",
  "public-sector-results",
  "small-routine-bond"
];

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
  // The lookahead excludes the MAR footer "Meldingen er offentliggjort av
  // <person>" — 675253 (a CEO departure) was skipped solely on that footer.
  /\b(?:has been|is|er)\s+(?:released|published|publisert|offentliggjort)\b(?!\s+(?:av|by)\b)/i,
  // Availability must be anchored to a document noun in the same sentence —
  // 678418 (field-trial results) was skipped solely on a bare "available".
  /\b(?:report|rapport|presentation|presentasjon|prospectus|prospekt|form\s+6-k|attachment|vedlegg|webcast|audiocast|webinar|recording|opptak)\b[^.!?]{0,80}\b(?:can be viewed|available|tilgjengelig|kan leses)\b/i,
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
  /\b(?:nok|usd|eur|dollar|kroner|euro|million|millioner|milliard|billion)\b/i,
  // Norwegian executive-change wording ("ønsker å fratre", "konsernsjef").
  /\b(?:fratre(?:r|den)?|konsernsjef)\b/i,
  // Percentage results and symbol-form currency amounts (field-trial and
  // trading-update notices carry substance as "29.8%" / "$18/box").
  /\d(?:[.,]\d+)?\s?(?:%|prosent(?:poeng)?|percent|per cent)/i,
  /[$€£]\s?\d/
];

const PROSPECTUS_PUBLICATION_PATTERNS = [
  /\b(?:publishes?|publishing|publication|published|approves?|approval|approved|available)\b.{0,80}\b(?:prospectus|prospekt)\b/i,
  /\b(?:prospectus|prospekt)\b.{0,80}\b(?:publishes?|publishing|publication|published|approves?|approval|approved|available)\b/i,
  /\b(?:godkjennelse|godkjent|publisert|offentliggjort|tilgjengelig)\b.{0,80}\bprospekt\b/i,
  /\bprospekt\b.{0,80}\b(?:godkjennelse|godkjent|publisert|offentliggjort|tilgjengelig)\b/i
];

const PROSPECTUS_OFFERING_CONTEXT_PATTERNS = [
  /\b(?:rights issue|subsequent offering|repair issue|subscription rights?|subscription period)\b/i,
  /\b(?:fortrinnsrettsemisjon|reparasjonsemisjon|emisjon|tegningsretter?|tegningsperioden)\b/i
];

const PROSPECTUS_ALREADY_ANNOUNCED_PATTERNS = [
  /\b(?:previously announced|earlier announced|as announced|reference is made to|further to|announced on|announced by)\b/i,
  /\b(?:tidligere annonsert|tidligere meldt|som tidligere meldt|det vises til|viser til)\b/i
];

const PROSPECTUS_MATERIAL_OUTCOME_PATTERNS = [
  /\b(?:result|results|utfall|fully subscribed|oversubscribed|overtegnet|fulltegnet|allocated|allocation|tildel)\b/i,
  /\b(?:gross proceeds|net proceeds|proveny|hentet|raises?|raised)\b/i,
  /\b(?:completed|completion|gjennomfort|gjennomfoert|fullfort|fullfoert)\b/i
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

const PUBLIC_SECTOR_RESULT_PATTERNS = [
  /\bkommune\b/i,
  /\bfylkeskommune\b/i,
  /\bmunicipal(?:ity)?\b/i
];

const RESULT_REPORT_PATTERNS = [
  /\b\d+\.\s*tertial\b/i,
  /\btertial\s+\d{4}\b/i,
  /\b(?:tertial|kvartal|quarter|interim|financial)\s+(?:report|rapport)\b/i,
  /\b(?:resultat|regnskap|årsrapport|arsrapport|annual report)\b/i,
  /\b(?:\u00e5rsrapport|arsrapport|\u00e5rsmelding|arsmelding|annual report)\b/i,
  /\u00e5rsrapport|\u00e5rsmelding/i
];

const PUBLIC_SECTOR_MARKET_EVENT_PATTERNS = [
  /\bobligasjonslån\b/i,
  /\bbond\b/i,
  /\bemisjon\b/i,
  /\bcapital raise\b/i,
  /\bdefault\b/i,
  /\b(?:downgrade|upgrade|rating)\b/i
];

const ROUTINE_BOND_PATTERNS = [
  /\b(?:vellykket\s+)?utstedelse av .*obligasjonslån\b/i,
  /\bvurderer utstedelse av .*obligasjonslån\b/i,
  /\b(?:successful )?issue of .*bond\b/i,
  /\bcontemplates? (?:the )?issuance of .*bond\b/i
];

// Vetoes for small-routine-bond: a tap under an existing bond, or distress
// language (waiver, coupon deferral, liquidity), is never a routine
// issuance — 679225 (Nordic Mining liquidity update) was skipped as one.
const ROUTINE_BOND_EXCLUSION_PATTERNS = [
  /\btap issue\b/i,
  /\btap[- ]?utstedelse\b/i,
  /\bexisting\b[^.!?]{0,60}\bbonds?\b/i,
  /\b(?:waiver|standstill|going concern|default(?:ed|s)?)\b/i,
  /\bdefer(?:ral|red|ring|s)?\b/i,
  /\bliquidity (?:shortfall|injection)\b/i,
  /\brestructur/i
];

const BILLION_NOK = 1_000_000_000;

function hasAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function parseNumberToken(raw: string): number | null {
  const normalized = raw.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function maxNokAmount(text: string): number | null {
  const matches: number[] = [];

  const billionPatterns = [
    /\bbnok\s*(\d+(?:[.,]\d+)?)\b/gi,
    /\bnok\s*(\d+(?:[.,]\d+)?)\s*(?:milliarder|mrd\.?|billion)\b/gi,
    /\b(\d+(?:[.,]\d+)?)\s*(?:milliarder|mrd\.?|billion)\s*(?:kroner|nok)\b/gi
  ];
  for (const pattern of billionPatterns) {
    for (const match of text.matchAll(pattern)) {
      const value = parseNumberToken(match[1] ?? "");
      if (value != null) matches.push(value * BILLION_NOK);
    }
  }

  const millionPatterns = [
    /\bmnok\s*(\d{1,3}(?:[ .]\d{3})+|\d+(?:[.,]\d+)?)\b/gi,
    /\bnok\s*(\d{1,3}(?:[ .]\d{3})+|\d+(?:[.,]\d+)?)\s*(?:millioner|mill\.?|million)\b/gi,
    /\b(\d{1,3}(?:[ .]\d{3})+|\d+(?:[.,]\d+)?)\s*(?:millioner|mill\.?|million)\s*(?:kroner|nok)\b/gi
  ];
  for (const pattern of millionPatterns) {
    for (const match of text.matchAll(pattern)) {
      const value = parseNumberToken(match[1] ?? "");
      if (value != null) matches.push(value * 1_000_000);
    }
  }

  const exactKronerPattern =
    /\b(\d{1,3}(?:[ .]\d{3})+|\d{7,})\s*(?:kroner|nok)\b/gi;
  for (const match of text.matchAll(exactKronerPattern)) {
    const value = parseNumberToken(match[1] ?? "");
    if (value != null) matches.push(value);
  }

  return matches.length ? Math.max(...matches) : null;
}

type TriageTextViews = {
  title: string;
  bodyText: string;
  text: string;
  sourceOnlyText: string;
  marketEventText: string;
};

type TriageClassDefinition = {
  id: TriageClassId;
  reasonCode: TriageReasonCode;
  reason: string;
  match: (views: TriageTextViews) => boolean;
};

// Registry order must mirror triageClassIds; each match body is the original
// rule logic verbatim.
const triageClassDefinitions: readonly TriageClassDefinition[] = [
  {
    id: "document-only",
    reasonCode: "TRIAGE_DOCUMENT_ONLY",
    reason:
      "Tilgjengelig tekst sier bare at et dokument/presentasjon er publisert, uten konkrete tall, hendelser eller konsekvenser.",
    match: (views) =>
      hasAnyPattern(views.text, DOCUMENT_ONLY_PATTERNS) &&
      !hasAnyPattern(views.bodyText, SUBSTANTIVE_FACT_PATTERNS)
  },
  {
    id: "routine-prospectus",
    reasonCode: "TRIAGE_ROUTINE_PROSPECTUS",
    reason:
      "Routine prospectus approval/publication for an already announced offering.",
    match: (views) =>
      hasAnyPattern(views.sourceOnlyText, PROSPECTUS_PUBLICATION_PATTERNS) &&
      hasAnyPattern(views.sourceOnlyText, PROSPECTUS_OFFERING_CONTEXT_PATTERNS) &&
      hasAnyPattern(views.sourceOnlyText, PROSPECTUS_ALREADY_ANNOUNCED_PATTERNS) &&
      !hasAnyPattern(views.sourceOnlyText, PROSPECTUS_MATERIAL_OUTCOME_PATTERNS)
  },
  {
    id: "routine-reminder",
    reasonCode: "TRIAGE_ROUTINE_REMINDER",
    reason:
      "Tilgjengelig tekst er en rutinemessig påminnelse om tegningsperiode/frister uten nytt utfall eller nye vilkår.",
    match: (views) =>
      hasAnyPattern(views.text, ROUTINE_REMINDER_PATTERNS) &&
      !hasAnyPattern(views.text, REMINDER_OUTCOME_PATTERNS)
  },
  {
    id: "public-sector-results",
    reasonCode: "TRIAGE_PUBLIC_SECTOR_RESULTS",
    reason:
      "Rutinemessig kommune-/offentlig resultatsak uten konkret kapitalmarkedshendelse eller substansielle tall.",
    match: (views) =>
      hasAnyPattern(views.text, PUBLIC_SECTOR_RESULT_PATTERNS) &&
      hasAnyPattern(views.text, RESULT_REPORT_PATTERNS) &&
      !hasAnyPattern(views.marketEventText, PUBLIC_SECTOR_MARKET_EVENT_PATTERNS)
  },
  {
    id: "small-routine-bond",
    reasonCode: "TRIAGE_SMALL_ROUTINE_BOND",
    reason:
      "Rutinemessig obligasjonsutstedelse under én milliard kroner uten sterkere nyhetspoeng.",
    match: (views) => {
      if (hasAnyPattern(views.text, ROUTINE_BOND_EXCLUSION_PATTERNS)) {
        return false;
      }
      const nokAmount = maxNokAmount(views.text);
      return (
        nokAmount != null &&
        nokAmount < BILLION_NOK &&
        hasAnyPattern(views.text, ROUTINE_BOND_PATTERNS)
      );
    }
  }
];

function buildTriageTextViews(
  title: string,
  bodyText: string,
  issuerName?: string,
  sourceBodyText?: string
): TriageTextViews {
  return {
    title,
    bodyText,
    text: [title, issuerName, bodyText].filter(Boolean).join("\n").trim(),
    sourceOnlyText: [title, issuerName, sourceBodyText ?? bodyText]
      .filter(Boolean)
      .join("\n")
      .trim(),
    marketEventText: [title, sourceBodyText ?? bodyText]
      .filter(Boolean)
      .join("\n")
      .trim()
  };
}

export type TriageShadowEvaluation = {
  enabledSkip: DeterministicTriageSkip | null;
  // Every registered class that matches, registry order, enabled or not.
  candidateClassIds: TriageClassId[];
  // Candidates NOT in the enabled set — the shadow signal for enablement.
  shadowSkipClassIds: TriageClassId[];
};

export function evaluateTriageClasses(
  title: string,
  bodyText: string,
  _categories: string[],
  _hasAttachments?: boolean,
  issuerName?: string,
  sourceBodyText?: string,
  options?: { enabledClasses?: readonly TriageClassId[] }
): TriageShadowEvaluation {
  const views = buildTriageTextViews(title, bodyText, issuerName, sourceBodyText);
  const enabled = new Set(options?.enabledClasses ?? defaultEnabledTriageClasses);
  const candidates = triageClassDefinitions.filter((definition) =>
    definition.match(views)
  );
  const firstEnabled = candidates.find((definition) => enabled.has(definition.id));
  return {
    enabledSkip: firstEnabled
      ? {
          newsworthy: false,
          kind: firstEnabled.id,
          classId: firstEnabled.id,
          reasonCode: firstEnabled.reasonCode,
          reason: firstEnabled.reason
        }
      : null,
    candidateClassIds: candidates.map((definition) => definition.id),
    shadowSkipClassIds: candidates
      .filter((definition) => !enabled.has(definition.id))
      .map((definition) => definition.id)
  };
}

export function getDeterministicTriageSkip(
  title: string,
  bodyText: string,
  categories: string[],
  hasAttachments?: boolean,
  issuerName?: string,
  sourceBodyText?: string,
  options?: { enabledClasses?: readonly TriageClassId[] }
): DeterministicTriageSkip | null {
  return evaluateTriageClasses(
    title,
    bodyText,
    categories,
    hasAttachments,
    issuerName,
    sourceBodyText,
    options
  ).enabledSkip;
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

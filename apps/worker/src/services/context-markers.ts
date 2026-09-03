import { ATTRIBUTION_MARKERS } from "./claim-precautions.js";
import { normalizeGuardrailText } from "./text-normalization.js";

/**
 * Context markers: does an article sentence that draws on an EARLIER notice
 * carry a time marker or an attribution marker, so a reader can tell it is
 * background rather than today's news?
 *
 * Pure text heuristics over `normalizeGuardrailText` output (lowercase,
 * diacritics folded, ae/o/a for æ/ø/å). All matching is on word boundaries.
 */

export type ContextMarkerKind =
  | "month" // "i juni", "i april 2026", "i mai i fjor"
  | "weekday" // "torsdag", "på tirsdag", "sist fredag"
  | "relative_time" // "i fjor", "i går", "nylig", "tidligere", "forrige uke", "for to uker siden"
  | "prior_verb" // "meldte", "ble varslet", "annonserte", "opplyste", "som meldt", "ble kjent"
  | "issuer_attribution" // "ifølge <issuer>", "opplyser <issuer>", "<issuer> opplyser"
  | "prior_notice_attribution" // "ifølge den tidligere meldingen", "i meldingen fra juni"
  | "company_attribution"; // generic ATTRIBUTION_MARKERS: "ifølge selskapet", "opplyser selskapet", ...

export type ContextMarker = {
  kind: ContextMarkerKind;
  /** The matched substring of the normalized sentence (lowercase, diacritics folded). */
  match: string;
};

export const CONTEXT_MARKER_MONTHS: readonly string[] = [
  "januar",
  "februar",
  "mars",
  "april",
  "mai",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "desember"
];

export const CONTEXT_MARKER_WEEKDAYS: readonly string[] = [
  "mandag",
  "tirsdag",
  "onsdag",
  "torsdag",
  "fredag",
  "lørdag",
  "søndag"
];

/**
 * Precedence when several kinds match. A marker nested strictly inside a
 * longer marker of another kind yields to the enclosing phrase first (so
 * "ifølge den tidligere meldingen" is prior_notice_attribution rather than
 * the bare relative_time "tidligere" it contains); precedence then decides
 * among the survivors.
 */
const KIND_PRECEDENCE: readonly ContextMarkerKind[] = [
  "prior_verb",
  "month",
  "weekday",
  "relative_time",
  "issuer_attribution",
  "prior_notice_attribution",
  "company_attribution"
];

/** Trailing legal-form tokens stripped from issuer names (compared after normalization). */
const LEGAL_SUFFIXES: ReadonlySet<string> = new Set([
  "asa",
  "as",
  "a/s",
  "aps",
  "ab",
  "ag",
  "bv",
  "b.v",
  "co",
  "corp",
  "corporation",
  "gmbh",
  "inc",
  "limited",
  "llc",
  "lp",
  "ltd",
  "ltda",
  "nv",
  "n.v",
  "oy",
  "oyj",
  "plc",
  "publ",
  "sa",
  "s.a",
  "se"
]);

/** Words too generic to stand alone as an issuer alias ("Norwegian", "Nordic", "Energy", ...). */
const ALIAS_STOP_WORDS: ReadonlySet<string> = new Set([
  "norwegian",
  "norske",
  "norsk",
  "nordic",
  "nordisk",
  "nordiske",
  "north",
  "northern",
  "scandinavian",
  "skandinavisk",
  "skandinaviske",
  "european",
  "international",
  "global",
  "group",
  "gruppen",
  "energy",
  "energi",
  "capital",
  "holding",
  "holdings",
  "technology",
  "technologies",
  "therapeutics",
  "shipping",
  "industries",
  "industri",
  "industrier",
  "bank",
  "banken",
  "offshore",
  "solutions",
  "systems",
  "software",
  "marine",
  "maritime",
  "property",
  "properties",
  "eiendom",
  "invest",
  "investment",
  "investments",
  "partners",
  "mining",
  "petroleum",
  "power",
  "renewables",
  "seafood",
  "services",
  "resources",
  "company",
  "selskap",
  "selskapet"
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return normalizeGuardrailText(value).replace(/\s+/g, " ").trim();
}

/** Strips wrapping punctuation from a name token for suffix/stop-word comparison. */
function cleanToken(token: string): string {
  return token.replace(/^[("'[]+/, "").replace(/[)"'\],.;:]+$/, "");
}

function hasAlphanumeric(token: string): boolean {
  return /[a-z0-9]/.test(token);
}

function isDistinctiveWord(token: string): boolean {
  const letters = token.replace(/[^a-z]/g, "");
  return letters.length >= 4 && !ALIAS_STOP_WORDS.has(token);
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

/**
 * Aliases a sentence may use for the issuer: the name without legal suffixes,
 * that name with trailing generic words progressively dropped ("Crayon Group
 * Holding" -> "Crayon Group" -> "Crayon"), the first distinctive word
 * (>= 4 letters, not a stop word), and the ticker sign. All normalized,
 * deduplicated, never empty strings.
 *
 * issuerAliases("Odfjell Drilling Ltd", "ODL") -> ["odfjell drilling", "odfjell", "odl"]
 */
export function issuerAliases(issuerName: string, issuerSign?: string | null): string[] {
  const tokens = normalizeText(issuerName).split(" ").filter((token) => token.length > 0);

  while (tokens.length > 0) {
    const last = cleanToken(tokens[tokens.length - 1] ?? "");
    if (LEGAL_SUFFIXES.has(last) || !hasAlphanumeric(last)) {
      tokens.pop();
      continue;
    }
    break;
  }

  const aliases: string[] = [];
  const fullName = tokens.join(" ");
  if (fullName) {
    aliases.push(fullName);
  }

  // Shorter forms used in prose: drop trailing stop words one at a time, but
  // never leave a form made only of stop words ("Nordic Capital" -> nothing).
  const shortened = tokens.slice();
  while (shortened.length > 1 && ALIAS_STOP_WORDS.has(cleanToken(shortened[shortened.length - 1] ?? ""))) {
    shortened.pop();
    if (shortened.some((token) => !ALIAS_STOP_WORDS.has(cleanToken(token)))) {
      aliases.push(shortened.join(" "));
    }
  }

  const distinctive = tokens.map(cleanToken).find(isDistinctiveWord);
  if (distinctive) {
    aliases.push(distinctive);
  }

  const sign = normalizeText(issuerSign);
  if (sign) {
    aliases.push(sign);
  }

  return unique(aliases);
}

const MONTH_ALTERNATION = CONTEXT_MARKER_MONTHS.map(normalizeText).join("|");
const WEEKDAY_ALTERNATION = CONTEXT_MARKER_WEEKDAYS.map(normalizeText).join("|");

/** Word-bounded global pattern; lookarounds (not \b) so aliases may start/end with punctuation. */
function wordPattern(body: string): RegExp {
  return new RegExp(String.raw`(?<![a-z0-9])(?:${body})(?![a-z0-9])`, "g");
}

const PRIOR_PARTICIPLES = "meldt|varslet|annonsert|opplyst|kunngjort|offentliggjort|omtalt";

const PRIOR_VERB_PATTERN = wordPattern(
  [
    String.raw`(?:ble|blitt|var) (?:${PRIOR_PARTICIPLES}|kjent)`,
    String.raw`har (?:tidligere |allerede )?(?:${PRIOR_PARTICIPLES}|uttalt)`,
    String.raw`som (?:tidligere )?(?:${PRIOR_PARTICIPLES})`,
    String.raw`tidligere (?:${PRIOR_PARTICIPLES})`,
    "meldte",
    "varslet",
    "annonserte",
    "opplyste",
    "uttalte",
    "kunngjorde",
    "offentliggjorde"
  ].join("|")
);

// Requires a preposition form so a bare calendar date ("5. juni") never matches.
const MONTH_PATTERN = wordPattern(
  String.raw`(?:i lopet av|i slutten av|i begynnelsen av|i starten av|i midten av|siden|fra|i) (?:${MONTH_ALTERNATION})(?: \d{4})?(?: i (?:fjor|ar))?`
);

const WEEKDAY_PATTERN = wordPattern(
  String.raw`(?:(?:pa|sist|siste|forrige|denne) )?(?:${WEEKDAY_ALTERNATION})(?:en|ens|s)?(?: (?:morgen|formiddag|ettermiddag|kveld|natt))?`
);

const RELATIVE_TIME_PATTERN = wordPattern(
  [
    String.raw`i fjor(?: (?:host|var|sommer|vinter))?`,
    "i gar",
    "i dag",
    "i morges",
    "i host",
    "i sommer",
    "i vinter",
    // "i vår" is also "in our": only count it at clause end or before a verb/conjunction.
    String.raw`i var(?=$|[^a-z0-9 ]| (?:ble|blitt|har|hadde|var|er|kom|fikk|gikk|da|og|at|som|men|etter|for)\b)`,
    "nylig",
    "tidligere",
    "opprinnelig(?:e)?",
    String.raw`(?:i )?forrige (?:uke|maned|ar|kvartal|halvar)`,
    String.raw`(?:i )?sist(?:e)? uke`,
    String.raw`for (?:[a-z0-9.,]+ ){0,2}(?:dag|dager|uke|uker|maned|maneder|ar|kvartal|kvartaler|tid) siden`
  ].join("|")
);

const PRIOR_NOTICE_PATTERN = wordPattern(
  String.raw`(?:ifolge|i) (?:en |den )?(?:(?:tidligere|forrige|opprinnelige) (?:bors)?melding(?:en|er|ene)?|(?:bors)?melding(?:en)? (?:fra|i|pa)(?: i)? (?:${MONTH_ALTERNATION}|${WEEKDAY_ALTERNATION}|fjor|host|var|sommer|vinter|forrige uke))`
);

// Built on first use, not at module load: claim-precautions imports
// reference-check, which may import this module, so the binding can be
// uninitialized while the cycle is still evaluating.
let companyAttributionPattern: RegExp | null = null;

function getCompanyAttributionPattern(): RegExp | null {
  if (companyAttributionPattern) {
    return companyAttributionPattern;
  }
  const markers = (Array.isArray(ATTRIBUTION_MARKERS) ? ATTRIBUTION_MARKERS : [])
    .map((marker) => escapeRegExp(normalizeText(marker)))
    .filter((marker) => marker.length > 0);
  if (markers.length === 0) {
    return null;
  }
  companyAttributionPattern = wordPattern(markers.join("|"));
  return companyAttributionPattern;
}

const VERBS_BEFORE_ISSUER =
  "ifolge|opplyser|opplyste|skriver|skrev|melder|meldte|uttaler|uttalte|sier|sa";
const VERBS_AFTER_ISSUER = "opplyser|skriver|melder|uttaler|sier";
const LEGAL_SUFFIX_ALTERNATION = Array.from(LEGAL_SUFFIXES).map(escapeRegExp).join("|");

function buildIssuerAttributionPattern(aliases: readonly string[]): RegExp | null {
  const normalized = unique((Array.isArray(aliases) ? aliases : []).map(normalizeText))
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  if (normalized.length === 0) {
    return null;
  }
  const alias = `(?:${normalized.join("|")})`;
  return wordPattern(
    [
      String.raw`(?:${VERBS_BEFORE_ISSUER}) ${alias}s?`,
      String.raw`${alias}(?: (?:${LEGAL_SUFFIX_ALTERNATION})\.?)? (?:${VERBS_AFTER_ISSUER})`
    ].join("|")
  );
}

type Candidate = ContextMarker & { start: number; end: number };

function collectCandidates(
  target: Candidate[],
  kind: ContextMarkerKind,
  pattern: RegExp,
  text: string
): void {
  for (const match of text.matchAll(pattern)) {
    const value = match[0];
    if (!value) {
      continue;
    }
    const start = match.index ?? 0;
    target.push({ kind, match: value, start, end: start + value.length });
  }
}

function isNestedInOtherKind(candidate: Candidate, all: readonly Candidate[]): boolean {
  return all.some(
    (other) =>
      other.kind !== candidate.kind &&
      other.start <= candidate.start &&
      other.end >= candidate.end &&
      other.end - other.start > candidate.end - candidate.start
  );
}

/**
 * Finds the strongest context marker in a sentence. `aliases` are the issuer
 * aliases (see `issuerAliases`); they are normalized here as well.
 * Returns null when the sentence carries no marker. Never throws.
 */
export function findContextMarker(
  sentence: string,
  aliases: readonly string[]
): ContextMarker | null {
  const text = normalizeText(sentence);
  if (!text) {
    return null;
  }

  const candidates: Candidate[] = [];
  collectCandidates(candidates, "prior_verb", PRIOR_VERB_PATTERN, text);
  collectCandidates(candidates, "month", MONTH_PATTERN, text);
  collectCandidates(candidates, "weekday", WEEKDAY_PATTERN, text);
  collectCandidates(candidates, "relative_time", RELATIVE_TIME_PATTERN, text);
  const issuerPattern = buildIssuerAttributionPattern(aliases);
  if (issuerPattern) {
    collectCandidates(candidates, "issuer_attribution", issuerPattern, text);
  }
  collectCandidates(candidates, "prior_notice_attribution", PRIOR_NOTICE_PATTERN, text);
  const companyPattern = getCompanyAttributionPattern();
  if (companyPattern) {
    collectCandidates(candidates, "company_attribution", companyPattern, text);
  }

  const best = candidates
    .filter((candidate) => !isNestedInOtherKind(candidate, candidates))
    .sort(
      (a, b) =>
        KIND_PRECEDENCE.indexOf(a.kind) - KIND_PRECEDENCE.indexOf(b.kind) || a.start - b.start
    )[0];

  return best ? { kind: best.kind, match: best.match } : null;
}

export function hasContextMarker(sentence: string, aliases: readonly string[]): boolean {
  return findContextMarker(sentence, aliases) !== null;
}

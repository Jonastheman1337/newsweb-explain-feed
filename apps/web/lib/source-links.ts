/**
 * Pure, DOM-free source linking for generated Norwegian article bodies.
 *
 * The input is the HTML produced by `plainTextToRichHtml` (or the rich editor):
 * `<p>` blocks, `<br>` line breaks and HTML-escaped text. Only text nodes are
 * inspected; tags are never matched against and existing text is never altered.
 * The helper inserts at most two `<a href="…">…</a>` pairs:
 *
 * - the primary link wraps the noun/verb of the FIRST attribution phrase
 *   ("ifølge en børsmelding", "opplyser selskapet", "ifølge <issuer>", …);
 * - the prior link wraps the verb of the FIRST sentence that refers to an
 *   earlier notice ("meldte", "ble varslet", "som meldt", …).
 *
 * Sentences that already contain an `<a>` are left untouched, which also makes
 * the transformation idempotent.
 */

export type SourceLinkTargets = {
  primary?: { url: string; issuerName?: string | null; issuerSign?: string | null } | null;
  related?: Array<{ url: string; publishedAt: string; relation?: string }>;
};

type Range = { start: number; end: number };

type PhraseKind = "noun" | "verb";

type Candidate = { start: number; kind: PhraseKind; anchor: Range };

type Phrase = { kind: PhraseKind; pre: string; anchor: string; post: string };

type Doc = {
  /** Concatenated text nodes; block-level tags contribute a "\n" separator. */
  text: string;
  /** text index -> html index, or -1 for synthetic separator characters. */
  map: number[];
  /** text indexes at which an `<a …>` or `</a>` tag sits. */
  anchorPositions: number[];
};

type Insertion = { at: number; markup: string };

// --- regex building blocks --------------------------------------------------

/** Word boundaries that understand Norwegian letters (JS `\b` is ASCII-only). */
const NOT_BEFORE = "(?<![\\p{L}\\p{N}_])";
const NOT_AFTER = "(?![\\p{L}\\p{N}_])";
/** Whitespace that never crosses a block/line boundary. */
const SP = "[^\\S\\n]+";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Literal word -> regex source that tolerates common diacritic spellings. */
function tolerant(word: string): string {
  return escapeRegExp(word)
    .replace(/ø/g, "[øöo]")
    .replace(/æ/g, "[æäa]")
    .replace(/å/g, "[åäa]");
}

const IFOLGE = tolerant("ifølge");
const NOUN = `(?:${tolerant("børs")})?melding(?:en)?`;
const VERBS = "(?:opplyser|skriver|melder|uttaler)";
const ARTICLE = `(?:(?:en|den)${SP})?`;
/** "i en (børs)melding" / "i (børs)meldingen". */
const NOUN_CLAUSE = `i${SP}(?:en${SP})?`;
/** Up to three plain words between the issuer reference and the noun clause. */
const FILLER = `(?:${SP}[^\\s.,;:!?]+){0,3}?`;
const GAAR_FREM = `(?:${tolerant("går")}|fr[ae]m${tolerant("går")})(?:${SP}det)?(?:${SP}fr[ae]m)?${SP}av`;

function primaryPhrases(issuerRef: string): Phrase[] {
  return [
    // ifølge (en|den)? (børs)melding(en)
    { kind: "noun", pre: `${IFOLGE}${SP}${ARTICLE}`, anchor: NOUN, post: "" },
    // i en (børs)melding / i (børs)meldingen — also covers "heter det i meldingen"
    { kind: "noun", pre: NOUN_CLAUSE, anchor: NOUN, post: "" },
    // går det frem av / fremgår det av (børs)meldingen
    { kind: "noun", pre: `${GAAR_FREM}${SP}${ARTICLE}`, anchor: NOUN, post: "" },
    // opplyser selskapet [torsdag] i en børsmelding -> the noun wins over the verb
    { kind: "noun", pre: `${VERBS}${SP}${issuerRef}${FILLER}${SP}${NOUN_CLAUSE}`, anchor: NOUN, post: "" },
    { kind: "noun", pre: `${issuerRef}${SP}${VERBS}${FILLER}${SP}${NOUN_CLAUSE}`, anchor: NOUN, post: "" },
    // opplyser selskapet / selskapet opplyser
    { kind: "verb", pre: "", anchor: VERBS, post: `${SP}${issuerRef}` },
    { kind: "verb", pre: `${issuerRef}${SP}`, anchor: VERBS, post: "" },
    // ifølge <issuer>
    { kind: "verb", pre: "", anchor: IFOLGE, post: `${SP}${issuerRef}` }
  ];
}

const KIND_RANK: Record<PhraseKind, number> = { noun: 0, verb: 1 };

// --- issuer aliases ---------------------------------------------------------

const LEGAL_SUFFIXES = new Set([
  "asa", "as", "a/s", "ab", "aps", "ltd", "limited", "plc", "se", "nv", "n.v.",
  "oyj", "inc", "ag", "gmbh", "sa", "co"
]);

const ALIAS_STOPWORDS = new Set([
  "en", "den", "det", "de", "et", "ei", "og", "i", "av", "at", "om", "på", "til",
  "for", "med", "er", "har", "som", "vil", "kan", "skal", "ble", "blir", "selskapet"
]);

function issuerAliases(primary: NonNullable<SourceLinkTargets["primary"]>): string[] {
  const aliases = new Set<string>();

  const name = (primary.issuerName ?? "").trim().replace(/\s+/g, " ");
  if (name) {
    aliases.add(name);
    const tokens = name.split(" ");
    while (
      tokens.length > 1 &&
      LEGAL_SUFFIXES.has(tokens[tokens.length - 1].toLowerCase().replace(/[.,]+$/, ""))
    ) {
      tokens.pop();
    }
    aliases.add(tokens.join(" ").replace(/[,.]+$/, "").trim());
  }

  const sign = (primary.issuerSign ?? "").trim();
  if (sign) aliases.add(sign);

  return [...aliases]
    .filter((alias) => alias.length >= 2 && !ALIAS_STOPWORDS.has(alias.toLowerCase()))
    .sort((a, b) => b.length - a.length);
}

function aliasSource(alias: string): string {
  return alias
    .trim()
    .split(/\s+/)
    .map(tolerant)
    .join(SP);
}

function issuerRefSource(issuerAliases: readonly string[]): string {
  const alternatives = ["selskapet"];
  for (const alias of issuerAliases) {
    const source = aliasSource(alias);
    if (source && !alternatives.includes(source)) alternatives.push(source);
  }
  return `(?:${alternatives.join("|")})`;
}

// --- primary attribution ----------------------------------------------------

function collectPrimaryCandidates(text: string, issuerAliases: readonly string[]): Candidate[] {
  const issuerRef = issuerRefSource(issuerAliases);
  const candidates: Candidate[] = [];

  for (const phrase of primaryPhrases(issuerRef)) {
    const re = new RegExp(
      `${NOT_BEFORE}(${phrase.pre})(${phrase.anchor})${phrase.post}${NOT_AFTER}`,
      "giu"
    );
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const anchorStart = match.index + match[1].length;
      candidates.push({
        start: match.index,
        kind: phrase.kind,
        anchor: { start: anchorStart, end: anchorStart + match[2].length }
      });
    }
  }

  return candidates.sort(
    (a, b) =>
      a.start - b.start ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      a.anchor.start - b.anchor.start
  );
}

/**
 * Plain-text position of the word to link for the first attribution phrase,
 * or null when the text has none. `issuerAliases` are extra names for the
 * issuer ("Equinor", "EQNR"); "selskapet" is always recognised.
 */
export function findPrimaryAttributionAnchor(
  text: string,
  issuerAliases: readonly string[]
): { start: number; end: number } | null {
  const first = collectPrimaryCandidates(text, issuerAliases)[0];
  return first ? { ...first.anchor } : null;
}

// --- sentences --------------------------------------------------------------

const ABBREVIATIONS = new Set([
  "mill", "mrd", "ca", "kr", "nr", "eks", "jf", "dvs", "evt", "pst", "kl", "tlf",
  "inkl", "ekskl", "hhv", "osv", "mv", "pkt", "vs", "st", "co", "corp", "inc",
  "ltd", "mr", "mrs", "dr", "prof", "adm", "dir", "avd", "iht", "ifm", "pga",
  "mht", "ang", "ref", "fom", "tom", "etc", "vol", "tsd"
]);

function isLowercaseLetter(char: string): boolean {
  return char.toLowerCase() === char && char.toUpperCase() !== char;
}

function isSentenceEnd(text: string, at: number, end: number): boolean {
  if (text[at] !== ".") return true;

  const before = /[\p{L}\p{N}]+$/u.exec(text.slice(Math.max(0, at - 32), at))?.[0] ?? "";
  if (before.length === 1 || ABBREVIATIONS.has(before.toLowerCase())) return false;

  // "5. juni", "ca. 50 mill. kroner": a lowercase continuation is not a new sentence.
  const next = /\S/u.exec(text.slice(end))?.[0];
  if (next && isLowercaseLetter(next)) return false;

  return true;
}

/**
 * Sentence ranges in document order. `end` excludes trailing whitespace; a
 * block/line separator ("\n") always ends a sentence.
 */
function splitSentences(text: string): Range[] {
  const sentences: Range[] = [];
  const boundary = /[.!?]+[»"”’')\]]*(?=\s|$)|\n/gu;
  let start = 0;
  let match: RegExpExecArray | null;

  while ((match = boundary.exec(text)) !== null) {
    const isNewline = match[0] === "\n";
    if (!isNewline && !isSentenceEnd(text, match.index, match.index + match[0].length)) {
      continue;
    }

    const end = isNewline ? match.index : match.index + match[0].length;
    if (text.slice(start, end).trim()) sentences.push({ start, end });

    let next = match.index + match[0].length;
    while (next < text.length && /\s/.test(text[next])) next++;
    start = next;
    boundary.lastIndex = next;
  }

  if (text.slice(start).trim()) sentences.push({ start, end: text.length });
  return sentences;
}

/** Index of the sentence a text position belongs to (-1 before the first). */
function sentenceIndexAt(sentences: readonly Range[], position: number): number {
  let index = -1;
  for (let i = 0; i < sentences.length && sentences[i].start <= position; i++) index = i;
  return index;
}

// --- prior notice reference -------------------------------------------------

const PRIOR_STANDALONE = "(?:meldte|varslet|annonserte|opplyste|uttalte|kunngjorde)";
const PRIOR_PREFIXED = "(?:meldt|annonsert|varslet|kunngjort|opplyst)";
const PRIOR_PREFIX = `(?:ble|som|tidligere)${SP}`;

function priorAnchorsIn(text: string, sentence: Range): Range[] {
  const re = new RegExp(
    `${NOT_BEFORE}(?:${PRIOR_PREFIX})?(${PRIOR_STANDALONE})${NOT_AFTER}` +
      `|${NOT_BEFORE}${PRIOR_PREFIX}(${PRIOR_PREFIXED})${NOT_AFTER}`,
    "giu"
  );
  const slice = text.slice(sentence.start, sentence.end);
  const anchors: Range[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(slice)) !== null) {
    const word = match[1] ?? match[2];
    const end = sentence.start + match.index + match[0].length;
    anchors.push({ start: end - word.length, end });
  }
  return anchors;
}

/**
 * Plain-text position of the verb to link in the first sentence that refers
 * to an earlier notice, together with that sentence's bounds; null when none.
 */
export function findPriorAttributionAnchor(
  text: string
): { start: number; end: number; sentenceStart: number; sentenceEnd: number } | null {
  for (const sentence of splitSentences(text)) {
    const [anchor] = priorAnchorsIn(text, sentence);
    if (anchor) {
      return { ...anchor, sentenceStart: sentence.start, sentenceEnd: sentence.end };
    }
  }
  return null;
}

// --- related notice selection -----------------------------------------------

const MONTHS = [
  "januar", "februar", "mars", "april", "mai", "juni", "juli", "august",
  "september", "oktober", "november", "desember"
];
/** Sunday first, matching JS/Intl weekday numbering. */
const WEEKDAYS = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6
};

const MONTH_RE = new RegExp(`${NOT_BEFORE}(${MONTHS.map(tolerant).join("|")})${NOT_AFTER}`, "giu");
const WEEKDAY_RE = new RegExp(
  `${NOT_BEFORE}(${WEEKDAYS.map(tolerant).join("|")})(?:en|ens|s)?${NOT_AFTER}`,
  "giu"
);

let osloFormatter: Intl.DateTimeFormat | null = null;

function osloParts(date: Date): { month: number; weekday: number } {
  osloFormatter ??= new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Oslo",
    weekday: "short",
    month: "numeric"
  });
  let month = -1;
  let weekday = -1;
  for (const part of osloFormatter.formatToParts(date)) {
    if (part.type === "month") month = Number(part.value) - 1;
    if (part.type === "weekday") weekday = WEEKDAY_INDEX[part.value] ?? -1;
  }
  return { month, weekday };
}

function mentionedIndexes(text: string, re: RegExp, names: readonly string[]): Set<number> {
  const found = new Set<number>();
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const index = names.findIndex((name) => fold(name) === fold(match![1]));
    if (index >= 0) found.add(index);
  }
  return found;
}

function fold(value: string): string {
  return value.toLowerCase().replace(/ö/g, "ø").replace(/ä/g, "å");
}

type Related = NonNullable<SourceLinkTargets["related"]>[number];

function pickRelated(related: readonly Related[], sentenceText: string): Related {
  const months = mentionedIndexes(sentenceText, MONTH_RE, MONTHS);
  const weekdays = mentionedIndexes(sentenceText, WEEKDAY_RE, WEEKDAYS);

  let best = related[0];
  let bestScore = -1;
  let bestTime = Infinity;

  for (const notice of related) {
    const time = new Date(notice.publishedAt).getTime();
    let score = 0;
    if (Number.isFinite(time)) {
      const parts = osloParts(new Date(time));
      if (weekdays.has(parts.weekday)) score += 2;
      if (months.has(parts.month)) score += 1;
    }
    const orderTime = Number.isFinite(time) ? time : Infinity;
    if (score > bestScore || (score === bestScore && orderTime < bestTime)) {
      best = notice;
      bestScore = score;
      bestTime = orderTime;
    }
  }

  return best;
}

// --- html plumbing ----------------------------------------------------------

const INLINE_TAGS = new Set([
  "a", "abbr", "b", "code", "del", "em", "i", "ins", "mark", "s", "small",
  "span", "strong", "sub", "sup", "u"
]);

function tokenize(html: string): Doc {
  const doc: Doc = { text: "", map: [], anchorPositions: [] };
  const tagRe = /<[^>]*>/g;
  let last = 0;

  const pushText = (from: number, to: number) => {
    for (let i = from; i < to; i++) doc.map.push(i);
    doc.text += html.slice(from, to);
  };

  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html)) !== null) {
    pushText(last, match.index);
    const name = /^<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(match[0])?.[1]?.toLowerCase() ?? "";
    if (name === "a") doc.anchorPositions.push(doc.text.length);
    if (!INLINE_TAGS.has(name)) {
      doc.text += "\n";
      doc.map.push(-1);
    }
    last = match.index + match[0].length;
  }
  pushText(last, html.length);

  return doc;
}

/** HTML range for a text range, or null when it is not one contiguous text run. */
function htmlRange(doc: Doc, range: Range): Range | null {
  if (range.end <= range.start) return null;
  const start = doc.map[range.start];
  const last = doc.map[range.end - 1];
  if (start == null || last == null || start < 0 || last < 0) return null;
  if (last - start !== range.end - 1 - range.start) return null;
  return { start, end: last + 1 };
}

function sentenceHasAnchor(doc: Doc, sentences: readonly Range[], index: number): boolean {
  return doc.anchorPositions.some((position) => sentenceIndexAt(sentences, position) === index);
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeHref(url: string | null | undefined): string | null {
  const trimmed = (url ?? "").trim();
  return /^(?:https?:\/\/|\/)/i.test(trimmed) ? trimmed : null;
}

function wrap(range: Range, href: string): Insertion[] {
  return [
    { at: range.start, markup: `<a href="${escapeAttribute(href)}">` },
    { at: range.end, markup: "</a>" }
  ];
}

function applyInsertions(html: string, insertions: Insertion[]): string {
  let result = html;
  for (const insertion of [...insertions].sort((a, b) => b.at - a.at)) {
    result = result.slice(0, insertion.at) + insertion.markup + result.slice(insertion.at);
  }
  return result;
}

// --- public entry point -----------------------------------------------------

/**
 * Wrap the first attribution phrase in a link to `targets.primary.url` and the
 * first prior-notice reference in a link to the best-matching related notice.
 * Text is never changed; only `<a href="…">` / `</a>` are inserted. Returns
 * the input unchanged when nothing matches, and is idempotent.
 */
export function linkSourceAttributions(html: string, targets: SourceLinkTargets): string {
  const primaryUrl = safeHref(targets.primary?.url);
  const related = (targets.related ?? []).filter((notice) => safeHref(notice.url));
  if (!html || (!primaryUrl && !related.length)) return html;

  const doc = tokenize(html);
  const sentences = splitSentences(doc.text);
  const insertions: Insertion[] = [];
  let primarySentence = -1;

  if (primaryUrl && targets.primary) {
    const aliases = issuerAliases(targets.primary);
    for (const candidate of collectPrimaryCandidates(doc.text, aliases)) {
      const range = htmlRange(doc, candidate.anchor);
      if (!range) continue;
      const index = sentenceIndexAt(sentences, candidate.anchor.start);
      if (!sentenceHasAnchor(doc, sentences, index)) {
        insertions.push(...wrap(range, primaryUrl));
        primarySentence = index;
      }
      break;
    }
  }

  if (related.length) {
    for (let index = 0; index < sentences.length; index++) {
      const sentence = sentences[index];
      const anchors = priorAnchorsIn(doc.text, sentence);
      if (!anchors.length) continue;
      if (index === primarySentence) continue;
      if (sentenceHasAnchor(doc, sentences, index)) break;

      for (const anchor of anchors) {
        const range = htmlRange(doc, anchor);
        if (!range) continue;
        const target = pickRelated(related, doc.text.slice(sentence.start, sentence.end));
        insertions.push(...wrap(range, safeHref(target.url) ?? target.url));
        break;
      }
      break;
    }
  }

  return insertions.length ? applyInsertions(html, insertions) : html;
}

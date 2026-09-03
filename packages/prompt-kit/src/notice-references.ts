/**
 * Pure extraction of explicit references to an earlier Newsweb stock-exchange
 * notice from a notice body ("Reference is made to the stock exchange
 * announcement published on 26 May 2026 regarding …", "Det vises til
 * børsmelding 23. juni 2026 vedrørende …"). The output is meant for a resolver
 * that looks the earlier notice up by issuer + date + topic.
 *
 * Everything here is deterministic, case-insensitive and linear in the body
 * length: the body is scanned once per pattern family and the per-sentence
 * work is bounded by WINDOW_MAX_CHARS.
 */

export type NoticeReference = {
  /** The matched sentence fragment, whitespace-collapsed, trimmed, <= 300 chars. */
  raw: string;
  /** ISO calendar date (YYYY-MM-DD) of the cited notice, or null. */
  date: string | null;
  /** Set when the text says today / earlier today / yesterday. */
  relativeDay: "today" | "yesterday" | null;
  /** Text after regarding/concerning/on/vedrørende/om/angående, <= 160 chars. */
  topic: string | null;
  /** Only present when a Newsweb URL or message id is literally cited. */
  messageId?: number;
};

export type ExtractNoticeReferencesOptions = {
  /** Publication timestamp of the citing notice (any Date.parse-able string). */
  publishedAt: string;
  /** Maximum number of references to return (default 3). */
  max?: number;
  /**
   * Keep formula references that carry a topic but no date, e.g.
   * "Reference is made to the stock exchange notice published by X related to
   * the contemplated private placement". Off by default; a resolver that opts
   * in must search a recent window and demand a clear topic match.
   */
  includeUndated?: boolean;
};

const UNDATED_FORMULA_PATTERN = /reference is made to|(?:det )?vises til/i;

/**
 * Regex alternation (no anchors) over Norwegian and English month names, full
 * and abbreviated. Superset of the pattern in
 * apps/worker/src/services/reference-check.ts.
 */
export const MONTH_NAME_PATTERN =
  "jan(?:uary|uar)?|feb(?:ruary|ruar)?|mar(?:ch|s)?|apr(?:il)?|mai|may|jun(?:e|i)?|jul(?:y|i)?|aug(?:ust)?|sep(?:tember|t)?|okt(?:ober)?|oct(?:ober)?|nov(?:ember)?|des(?:ember)?|dec(?:ember)?";

const MONTH_INDEX_BY_NAME = new Map<string, number>([
  ["jan", 0],
  ["januar", 0],
  ["january", 0],
  ["feb", 1],
  ["februar", 1],
  ["february", 1],
  ["mar", 2],
  ["mars", 2],
  ["march", 2],
  ["apr", 3],
  ["april", 3],
  ["mai", 4],
  ["may", 4],
  ["jun", 5],
  ["juni", 5],
  ["june", 5],
  ["jul", 6],
  ["juli", 6],
  ["july", 6],
  ["aug", 7],
  ["august", 7],
  ["sep", 8],
  ["sept", 8],
  ["september", 8],
  ["okt", 9],
  ["oktober", 9],
  ["oct", 9],
  ["october", 9],
  ["nov", 10],
  ["november", 10],
  ["des", 11],
  ["desember", 11],
  ["dec", 11],
  ["december", 11]
]);

/** Month index (0-11) for a Norwegian/English month name or abbreviation. */
export function monthIndexFromName(name: string): number | null {
  if (typeof name !== "string") {
    return null;
  }
  const key = name.trim().toLowerCase().replace(/\.$/, "");
  const index = MONTH_INDEX_BY_NAME.get(key);
  return index === undefined ? null : index;
}

const DEFAULT_MAX = 3;
const RAW_MAX_CHARS = 300;
const TOPIC_MAX_CHARS = 160;
const WINDOW_MAX_CHARS = 700;
const CUE_LOOKBEHIND_CHARS = 70;
const DOCUMENT_NOUN_MAX_DISTANCE = 60;
/** "As announced …" style triggers must be followed (almost) directly by the date. */
const TIGHT_TRIGGER_MAX_DISTANCE = 12;
/** Weak topic triggers (on/om/of/where) must follow the date directly. */
const WEAK_TOPIC_TRIGGER_MAX_DISTANCE = 3;
const YEARLESS_SIBLING_MAX_CHAIN = 3;
const MIN_YEAR = 1900;
const MAX_YEAR = 2199;

const NOTICE_NOUN =
  "(?:announcements?|notices?|notifications?|press[\\s-]+releases?|releases?|reports?|messages?|disclosures?|updates?|summons|børsmelding(?:en|er|ene)?|melding(?:en|er|ene)?|pressemelding(?:en|er|ene)?|kunngjøring(?:en|er)?)";
const NOTICE_MODIFIER =
  "(?:(?:company['’]s|selskapets|stock[\\s-]+exchange|separate|previous|earlier|prior|tidligere|nevnte|ovennevnte)\\s+)*";
const ARTICLE =
  "(?:(?:the|its|our|their|this|that|a|an|den|denne|disse|vår|vårt|våre)\\s+)?";
/** Article without demonstratives: "in this announcement" is the current notice, not a citation. */
const PRIOR_ARTICLE = "(?:(?:the|its|our|their|a|an|den|vår|vårt|våre)\\s+)?";
/** Nouns that make "in the …" / "further to the …" a citation (no reports/updates/messages). */
const TRIGGER_NOTICE_NOUN =
  "(?:announcements?|notices?|notifications?|press[\\s-]+releases?|releases?|børsmelding(?:en|er|ene)?|melding(?:en|er|ene)?|pressemelding(?:en|er|ene)?|kunngjøring(?:en|er)?)";

/** Phrases that introduce a citation of an earlier notice. */
const TRIGGER_REGEX = new RegExp(
  "\\b(?:" +
    [
      "references?\\s+(?:is|are|was|were)\\s+(?:also\\s+|further\\s+|hereby\\s+)?made\\s+to",
      `further\\s+to\\s+${PRIOR_ARTICLE}${NOTICE_MODIFIER}${TRIGGER_NOTICE_NOUN}`,
      "as\\s+(?:previously\\s+|earlier\\s+|already\\s+|first\\s+)?(?:announced|disclosed|communicated|reported|informed|published|stated|described|notified|mentioned|set\\s+out|referred\\s+to)",
      "previously\\s+(?:announced|disclosed|communicated|reported|published|stated|notified)",
      `(?:in|per|pursuant\\s+to|following|see|cf\\.?|ref\\.?)\\s+${PRIOR_ARTICLE}${NOTICE_MODIFIER}${TRIGGER_NOTICE_NOUN}`,
      "(?:det|vi|selskapet|styret)\\s+(?:vises|viser|henviser)\\s+(?:også\\s+|videre\\s+|videre\\s+også\\s+)?til",
      "henvises\\s+til",
      "som\\s+(?:tidligere\\s+)?(?:meldt|annonsert|opplyst|kommunisert|offentliggjort|informert|omtalt|varslet|beskrevet|nevnt|publisert)",
      "tidligere\\s+(?:meldt|annonsert|opplyst|kommunisert|offentliggjort|publisert|varslet)",
      `(?:i|jf\\.?|jfr\\.?|se|ifølge|iht\\.?)\\s+${PRIOR_ARTICLE}${NOTICE_MODIFIER}${TRIGGER_NOTICE_NOUN}`
    ].join("|") +
    ")\\b",
  "gi"
);

/**
 * "As announced …", "previously announced …", "som meldt …": the date (or
 * today/yesterday) has to follow the trigger directly, otherwise the sentence
 * is describing content rather than citing a notice.
 */
const TIGHT_TRIGGER_REGEX = /^(?:as|som|previously|tidligere)\b/i;

/**
 * Explicit calendar dates. Group layout:
 *  1-3  day month-name year   (26 May 2026, 26th May 2026, 23. juni 2026, 2nd of June 2026)
 *  4-6  month-name day year   (May 26, 2026)
 *  7-9  dd.mm.yyyy / dd/mm/yyyy
 * 10-12 yyyy-mm-dd
 */
const DATE_REGEX = new RegExp(
  [
    `(?<![\\d.])(\\d{1,2})(?:st|nd|rd|th)?\\.?(?:\\s+of)?\\s+(${MONTH_NAME_PATTERN})\\.?,?\\s+(\\d{4})(?!\\d)`,
    `\\b(${MONTH_NAME_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})(?!\\d)`,
    "(?<![\\d.])(\\d{1,2})[./](\\d{1,2})[./](\\d{4})(?!\\d)",
    "(?<![\\d-])(\\d{4})-(\\d{2})-(\\d{2})(?![\\d-])"
  ].join("|"),
  "gi"
);

/** "16 July and 31 July 2026" / "12. februar og 26. mars 2026": a year-less day-month directly before a dated sibling. */
const YEARLESS_SIBLING_REGEX = new RegExp(
  `(?<![\\d.])(\\d{1,2})(?:st|nd|rd|th)?\\.?\\s+(${MONTH_NAME_PATTERN})\\.?\\s*(?:,|and|og|&|samt)\\s*$`,
  "i"
);
const YEARLESS_SIBLING_HEAD_REGEX = new RegExp(
  `^\\d{1,2}(?:st|nd|rd|th)?\\.?\\s+(?:${MONTH_NAME_PATTERN})\\.?`,
  "i"
);

const RELATIVE_DAY_REGEX =
  /\b(?:earlier\s+today|today|this\s+morning|tidligere\s+i\s+dag|i\s+dag|idag|dagens|yesterday|i\s+g(?:å|aa)r|ig(?:å|aa)r|g(?:å|aa)rsdagens)\b/gi;

const MESSAGE_ID_REGEX =
  /newsweb\.oslobors\.no\/message\/(\d{3,9})|\b(?:message|meldings?)[\s-]*(?:id|no|nr|number|nummer)\.?\s*[:#]?\s*(\d{4,9})\b/gi;

/** Text immediately before a date that marks it as a publication date. */
const POSITIVE_CUE_REGEX = new RegExp(
  `(?:\\b${NOTICE_NOUN}\\s*(?:(?:that|which|som)\\s+(?:was|ble)\\s+)?(?:published|issued|dated|made|released|distributed|announced|sent|of|on|from|av|datert|publisert|fra|den|sendt|offentliggjort)?(?:\\s+(?:by|av|from|fra)\\s+[^.,;]{1,80}?)?\\s*(?:on\\s+|the\\s+|den\\s+)?$` +
    `|\\b(?:published|issued|dated|announced|released|disclosed|communicated|reported|informed|distributed|meldt|publisert|offentliggjort|datert|annonsert|sendt|kommunisert|opplyst|informert|omtalt|varslet)\\s+(?:on\\s+|the\\s+|den\\s+)?$)`,
  "i"
);

/** Text immediately before a date that marks it as something other than a publication date. */
const NEGATIVE_CUE_REGEX =
  /\b(?:held|hold|holds|expire|expires|expiring|expiry|until|deadline|before|by|latest|no\s+later\s+than|from|between|ending|ends|starting|starts|commencing|commence|commences|effective|effective\s+date\s+of|with\s+effect\s+from|as\s+of|as\s+at|as\s+per|dated\s+as\s+of|per|pr|avholdes|holdes|avholdt|utløper|innen|senest|fra|mellom|f\.o\.m|t\.o\.m|gjeldende\s+fra|med\s+virkning\s+fra|til\s+og\s+med|fram\s+til|frem\s+til)\.?\s+(?:on\s+|the\s+|den\s+)?$/i;

/** Documents whose own date is not a notice date ("the merger plan dated 20 July 2026"). */
const DOCUMENT_NOUN_REGEX =
  /\b(?:prospectus|prospekt(?:et)?|agreements?|avtalen?|contracts?|kontrakt(?:en)?|plans?|planen|loans?|lån(?:et)?|facility|facilities|indenture|term\s+sheet|offer\s+document|tilbudsdokument(?:et)?|invoice|letter|brev)\b/gi;
const NOTICE_NOUN_REGEX = new RegExp(`\\b${NOTICE_NOUN}`, "gi");

/** "26 May 2026 and 28 May 2026" – text between two sibling dates. */
const SIBLING_JOIN_REGEX =
  /^[\s,]*(?:(?:and|og|as\s+well\s+as|samt|&|\/)\s*)?(?:on\s+|the\s+|den\s+)?$/i;

/** "today, 2 June 2026" – text between a relative day and its explicit date. */
const RELATIVE_DATE_JOIN_REGEX = /^[\s,(]*(?:(?:on|the|den|i\.e\.|dvs\.?)\s*)?$/i;

const STRONG_TOPIC_TRIGGER =
  "regarding|concerning|about|whereby|in\\s+respect\\s+of|in\\s+relation\\s+to|relating\\s+to|related\\s+to|with\\s+respect\\s+to|with\\s+regard\\s+to|vedrørende|vedr|angående|ang|knyttet\\s+til|i\\s+forbindelse\\s+med";
const WEAK_TOPIC_TRIGGER = "on|om|of|hvor|where|wherein|in\\s+which";
const TOPIC_TRIGGER_REGEX = new RegExp(
  `\\b(?:(${STRONG_TOPIC_TRIGGER})|(${WEAK_TOPIC_TRIGGER}))\\b\\.?`,
  "gi"
);
const BACKWARD_TOPIC_TRIGGER_REGEX = new RegExp(
  `\\b(?:${STRONG_TOPIC_TRIGGER})\\b\\.?`,
  "gi"
);
/** "dagens børsmelding om …" / "today's announcement on …": a weak trigger right after a notice noun is fine. */
const NOTICE_NOUN_BEFORE_TRIGGER_REGEX = new RegExp(`\\b${NOTICE_NOUN}\\s*$`, "i");

/** "… regarding A, and to B in the press release issued 19 May 2026" */
const CONJOINED_TOPIC_SPLIT_REGEX =
  /,?\s+(?:and|og)\s+(?:also\s+|further\s+|videre\s+)?(?:to|til)\s+/gi;

/** Publication scaffolding left dangling at the end of a topic cut at the next date. */
const TRAILING_PUBLICATION_CUE_REGEX = new RegExp(
  "(?:\\s+(?:as|som)\\s+(?:further\\s+|also\\s+|nærmere\\s+)?(?:described|announced|disclosed|set\\s+out|referred\\s+to|stated|beskrevet|omtalt|meldt))?" +
    `(?:(?:^|[\\s,]+(?:in|i|per|jf\\.?|cf\\.?|to|til|and|og)\\s+)${ARTICLE}${NOTICE_MODIFIER}${NOTICE_NOUN})?` +
    "(?:(?:^|\\s+)(?:(?:that|which|som)\\s+(?:was|ble)\\s+)?(?:published|issued|dated|made|released|announced|distributed|sent|publisert|datert|sendt|offentliggjort|annonsert|meldt))?" +
    "(?:\\s+by\\s+(?:the\\s+company|selskapet))?" +
    "(?:(?:^|\\s+)(?:on|of|from|av|fra|den|the|i|in|at|dated))?\\s*$",
  "i"
);

const NOISE_TOPIC_REGEX =
  /^(?:(?:the|a|an|its|our|their|this|that|den|denne|company['’]s|selskapets|separate|stock|exchange|previous|earlier|tidligere|announcements?|notices?|notifications?|press|releases?|reports?|messages?|børsmelding(?:en|er)?|melding(?:en|er)?|pressemelding(?:en|er)?|published|issued|dated|made|publisert|datert|on|of|from|av|den|i|in|by|company|selskapet)\s*)+$/i;

const TRAILING_PARENTHETICAL_REGEX = /\s*\([^()]{0,80}\)$/;
const LEADING_ENUMERATOR_REGEX = /^\(?(?:i{1,3}|iv|v|vi{1,3}|[a-h]|\d{1,2})\)\s*/i;
const EDGE_PUNCTUATION_LEADING_REGEX = /^[\s:;,.\-–—]+/;
const EDGE_PUNCTUATION_TRAILING_REGEX = /[\s:;,.\-–—]+$/;
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["“", "”"],
  ["‘", "’"],
  ["'", "'"],
  ["«", "»"]
];

/** Sentence terminators: ./!/? followed by an uppercase-ish sentence start, end of text, or a blank line. */
const SENTENCE_END_REGEX = /[.!?]+(?=\s+["“”'‘’(\[]*[A-ZÆØÅ]|\s*$)|\n[ \t]*\n/g;
const ABBREVIATION_BEFORE_PERIOD_REGEX =
  /(?:^|[\s(])(?:ltd|inc|co|corp|mr|mrs|ms|dr|no|nr|ca|jf|jfr|kl|cf|approx|etc|vs|st|jr|sr|e\.g|i\.e|p|pp|ref)$/i;

type Span = { index: number; end: number };
type DateAnchor = Span & { kind: "date"; iso: string };
type RelativeAnchor = Span & { kind: "relative"; day: "today" | "yesterday" };
type Anchor = DateAnchor | RelativeAnchor;
type MessageMatch = Span & { messageId: number };
type Trigger = Span & { kind: "phrase" | "message" };
type Window = {
  /** Start of the citing fragment (trigger start, or sentence start for URL-only citations). */
  start: number;
  end: number;
  /** End of the trigger phrase itself. */
  triggerEnd: number;
  /** Message ids are searched from the sentence start so a URL before the trigger is still attached. */
  messageSearchStart: number;
  /** "As announced …" style: the first date must follow the trigger directly. */
  tight: boolean;
};
type Candidate = {
  anchorStart: number;
  anchorEnd: number;
  date: string | null;
  relativeDay: "today" | "yesterday" | null;
  topic: string | null;
  pendingTopic: string | null;
  joinedWithNext: boolean;
  messageId?: number;
};

/**
 * Extract explicit references to earlier notices from a notice body.
 * Never throws; returns [] for empty or unusable input.
 */
export function extractNoticeReferences(
  bodyText: string,
  options: ExtractNoticeReferencesOptions
): NoticeReference[] {
  try {
    return extract(bodyText, options);
  } catch {
    return [];
  }
}

function extract(
  bodyText: string,
  options: ExtractNoticeReferencesOptions | undefined
): NoticeReference[] {
  if (typeof bodyText !== "string") {
    return [];
  }
  const text = bodyText.replace(/\r\n?/g, "\n");
  if (text.trim().length === 0) {
    return [];
  }
  const max = normalizeMax(options?.max);
  if (max === 0) {
    return [];
  }
  const publishedDate = osloCalendarDate(options?.publishedAt);

  const phraseTriggers = collectPhraseTriggers(text);
  const messages = collectMessageIds(text);
  if (phraseTriggers.length === 0 && messages.length === 0) {
    return [];
  }

  const dates = collectDates(text);
  const anchors = mergeAnchors(dates, collectRelativeDays(text));
  const terminators = collectSentenceEnds(text, dates);
  const windows = buildWindows(text, phraseTriggers, messages, terminators);

  const includeUndated = options?.includeUndated === true;
  const references: NoticeReference[] = [];
  for (const window of windows) {
    references.push(
      ...processWindow(text, window, anchors, messages, publishedDate, includeUndated)
    );
  }
  return finalize(references, publishedDate, max, includeUndated);
}

function normalizeMax(value: unknown): number {
  if (value === undefined || value === null) {
    return DEFAULT_MAX;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_MAX;
  }
  return Math.max(0, Math.floor(numeric));
}

// ---------------------------------------------------------------------------
// Scanning passes (each linear in the body length)
// ---------------------------------------------------------------------------

function collectPhraseTriggers(text: string): Trigger[] {
  const triggers: Trigger[] = [];
  for (const match of text.matchAll(TRIGGER_REGEX)) {
    const index = match.index ?? 0;
    triggers.push({ index, end: index + match[0].length, kind: "phrase" });
  }
  return triggers;
}

function collectMessageIds(text: string): MessageMatch[] {
  const messages: MessageMatch[] = [];
  for (const match of text.matchAll(MESSAGE_ID_REGEX)) {
    const digits = match[1] ?? match[2];
    if (!digits) {
      continue;
    }
    const messageId = Number(digits);
    if (!Number.isSafeInteger(messageId) || messageId <= 0) {
      continue;
    }
    const index = match.index ?? 0;
    messages.push({ index, end: index + match[0].length, messageId });
  }
  return messages;
}

function collectDates(text: string): DateAnchor[] {
  const dates: DateAnchor[] = [];
  for (const match of text.matchAll(DATE_REGEX)) {
    const iso = parseDateMatch(match);
    if (iso === null) {
      continue;
    }
    const index = match.index ?? 0;
    dates.push({ kind: "date", index, end: index + match[0].length, iso });
    if (match[1] !== undefined) {
      dates.push(...collectYearlessSiblings(text, index, Number(match[3])));
    }
  }
  dates.sort((a, b) => a.index - b.index);
  return dates;
}

/** "16 July and 31 July 2026" cites two notices; give the year-less one the sibling's year. */
function collectYearlessSiblings(text: string, before: number, year: number): DateAnchor[] {
  const siblings: DateAnchor[] = [];
  let cursor = before;
  for (let round = 0; round < YEARLESS_SIBLING_MAX_CHAIN; round += 1) {
    const segment = text.slice(Math.max(0, cursor - 40), cursor);
    const match = YEARLESS_SIBLING_REGEX.exec(segment);
    if (match === null) {
      break;
    }
    const iso = buildIsoDate(year, monthIndexFromName(match[2]), Number(match[1]));
    if (iso === null) {
      break;
    }
    const index = cursor - segment.length + (match.index ?? 0);
    const head = YEARLESS_SIBLING_HEAD_REGEX.exec(match[0]);
    const end = index + (head === null ? match[0].length : head[0].length);
    siblings.push({ kind: "date", index, end, iso });
    cursor = index;
  }
  return siblings;
}

function collectRelativeDays(text: string): RelativeAnchor[] {
  const anchors: RelativeAnchor[] = [];
  for (const match of text.matchAll(RELATIVE_DAY_REGEX)) {
    const index = match.index ?? 0;
    const word = match[0].toLowerCase();
    const day: "today" | "yesterday" =
      /yester|g(?:å|aa)r/.test(word) ? "yesterday" : "today";
    anchors.push({ kind: "relative", index, end: index + match[0].length, day });
  }
  return anchors;
}

function mergeAnchors(dates: DateAnchor[], relatives: RelativeAnchor[]): Anchor[] {
  const anchors: Anchor[] = [...dates, ...relatives];
  anchors.sort((a, b) => a.index - b.index);
  return anchors;
}

function collectSentenceEnds(text: string, dates: DateAnchor[]): Span[] {
  const terminators: Span[] = [];
  let dateCursor = 0;
  for (const match of text.matchAll(SENTENCE_END_REGEX)) {
    const index = match.index ?? 0;
    const end = index + match[0].length;
    if (match[0].startsWith("\n")) {
      terminators.push({ index, end: index });
      continue;
    }
    while (dateCursor < dates.length && dates[dateCursor].end <= index) {
      dateCursor += 1;
    }
    const insideDate =
      dateCursor < dates.length &&
      dates[dateCursor].index <= index &&
      dates[dateCursor].end > index;
    if (insideDate) {
      continue;
    }
    if (match[0] === ".") {
      const before = text.slice(Math.max(0, index - 12), index);
      if (ABBREVIATION_BEFORE_PERIOD_REGEX.test(before)) {
        continue;
      }
    }
    terminators.push({ index, end });
  }
  return terminators;
}

function parseDateMatch(match: RegExpMatchArray): string | null {
  if (match[1] !== undefined) {
    return buildIsoDate(Number(match[3]), monthIndexFromName(match[2]), Number(match[1]));
  }
  if (match[4] !== undefined) {
    return buildIsoDate(Number(match[6]), monthIndexFromName(match[4]), Number(match[5]));
  }
  if (match[7] !== undefined) {
    return buildIsoDate(Number(match[9]), Number(match[8]) - 1, Number(match[7]));
  }
  if (match[10] !== undefined) {
    return buildIsoDate(Number(match[10]), Number(match[11]) - 1, Number(match[12]));
  }
  return null;
}

function buildIsoDate(
  year: number,
  monthIndex: number | null,
  day: number
): string | null {
  if (
    monthIndex === null ||
    !Number.isInteger(year) ||
    !Number.isInteger(monthIndex) ||
    !Number.isInteger(day)
  ) {
    return null;
  }
  if (year < MIN_YEAR || year > MAX_YEAR || monthIndex < 0 || monthIndex > 11) {
    return null;
  }
  if (day < 1 || day > 31) {
    return null;
  }
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return toIsoDate(year, monthIndex, day);
}

function toIsoDate(year: number, monthIndex: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Sentence windows
// ---------------------------------------------------------------------------

function buildWindows(
  text: string,
  phraseTriggers: Trigger[],
  messages: MessageMatch[],
  terminators: Span[]
): Window[] {
  const triggers: Trigger[] = [
    ...phraseTriggers,
    ...messages.map<Trigger>((message) => ({
      index: message.index,
      end: message.end,
      kind: "message"
    }))
  ];
  triggers.sort((a, b) => a.index - b.index);

  const windows: Window[] = [];
  let coveredUntil = -1;
  for (const trigger of triggers) {
    if (trigger.index < coveredUntil) {
      continue;
    }
    const sentenceStart = findSentenceStart(terminators, trigger.index);
    const sentenceEnd = findSentenceEnd(terminators, text, trigger.end);
    if (trigger.kind === "message") {
      if (hasTriggerBetween(phraseTriggers, sentenceStart, sentenceEnd)) {
        // The phrase window for this sentence will pick the message id up.
        continue;
      }
      const end = Math.min(sentenceEnd, sentenceStart + WINDOW_MAX_CHARS);
      windows.push({
        start: sentenceStart,
        end,
        triggerEnd: trigger.end,
        messageSearchStart: sentenceStart,
        tight: false
      });
      coveredUntil = end;
      continue;
    }
    const end = Math.min(sentenceEnd, trigger.index + WINDOW_MAX_CHARS);
    windows.push({
      start: trigger.index,
      end,
      triggerEnd: trigger.end,
      messageSearchStart: sentenceStart,
      tight: TIGHT_TRIGGER_REGEX.test(text.slice(trigger.index, trigger.end))
    });
    coveredUntil = end;
  }
  return windows;
}

/** End offset (exclusive) of the sentence that contains `from`. */
function findSentenceEnd(terminators: Span[], text: string, from: number): number {
  let low = 0;
  let high = terminators.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (terminators[mid].index < from) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low < terminators.length ? terminators[low].end : text.length;
}

/** Start offset of the sentence that contains `position`. */
function findSentenceStart(terminators: Span[], position: number): number {
  let low = 0;
  let high = terminators.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (terminators[mid].end <= position) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low > 0 ? terminators[low - 1].end : 0;
}

function hasTriggerBetween(triggers: Trigger[], start: number, end: number): boolean {
  let low = 0;
  let high = triggers.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (triggers[mid].index < start) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low < triggers.length && triggers[low].index < end;
}

// ---------------------------------------------------------------------------
// Per-window extraction
// ---------------------------------------------------------------------------

function processWindow(
  text: string,
  window: Window,
  anchors: Anchor[],
  messages: MessageMatch[],
  publishedDate: string | null,
  includeUndated = false
): NoticeReference[] {
  const windowAnchors = anchors.filter(
    (anchor) => anchor.index >= window.start && anchor.end <= window.end
  );
  const candidates = acceptAnchors(text, window, windowAnchors, publishedDate);

  const windowMessages = messages.filter(
    (message) => message.index >= window.messageSearchStart && message.end <= window.end
  );
  attachMessageIds(candidates, windowMessages);
  if (candidates.length === 0) {
    // Undated citation formula ("Reference is made to the notice published by
    // X related to …"): no anchor to accept, so the trigger itself becomes
    // the anchor and the topic finder runs from there. finalize() keeps it
    // only when a topic was found.
    const triggerText = text.slice(window.start, window.triggerEnd);
    if (!includeUndated || !UNDATED_FORMULA_PATTERN.test(triggerText)) {
      return [];
    }
    candidates.push({
      anchorStart: window.triggerEnd,
      anchorEnd: window.triggerEnd,
      date: null,
      relativeDay: null,
      topic: null,
      pendingTopic: null,
      joinedWithNext: false
    });
  }
  candidates.sort((a, b) => a.anchorStart - b.anchorStart);
  assignTopics(text, window, candidates);

  const raw = truncate(collapseWhitespace(text.slice(window.start, window.end)), RAW_MAX_CHARS);
  return candidates.map((candidate) => {
    const reference: NoticeReference = {
      raw,
      date: candidate.date,
      relativeDay: candidate.relativeDay,
      topic: candidate.topic
    };
    if (candidate.messageId !== undefined) {
      reference.messageId = candidate.messageId;
    }
    return reference;
  });
}

function acceptAnchors(
  text: string,
  window: Window,
  windowAnchors: Anchor[],
  publishedDate: string | null
): Candidate[] {
  const accepted: Candidate[] = [];
  let i = 0;
  while (i < windowAnchors.length) {
    const anchor = windowAnchors[i];
    const previous = accepted.length > 0 ? accepted[accepted.length - 1] : null;
    const before = text.slice(
      Math.max(window.start, anchor.index - CUE_LOOKBEHIND_CHARS),
      anchor.index
    );

    let ok = false;
    let joinedToPrevious = false;
    if (isDocumentDate(before)) {
      ok = false;
    } else if (POSITIVE_CUE_REGEX.test(before)) {
      ok = true;
    } else if (previous === null) {
      const tooFar =
        window.tight && anchor.index - window.triggerEnd > TIGHT_TRIGGER_MAX_DISTANCE;
      ok = !tooFar && !NEGATIVE_CUE_REGEX.test(before);
    } else if (SIBLING_JOIN_REGEX.test(text.slice(previous.anchorEnd, anchor.index))) {
      ok = true;
      joinedToPrevious = true;
    }
    if (!ok) {
      i += 1;
      continue;
    }

    let date: string | null = null;
    let relativeDay: "today" | "yesterday" | null = null;
    let anchorEnd = anchor.end;
    if (anchor.kind === "date") {
      date = anchor.iso;
    } else {
      relativeDay = anchor.day;
      date = relativeDate(publishedDate, anchor.day);
      const next = windowAnchors[i + 1];
      if (
        next !== undefined &&
        next.kind === "date" &&
        RELATIVE_DATE_JOIN_REGEX.test(text.slice(anchor.end, next.index))
      ) {
        date = next.iso;
        anchorEnd = next.end;
        i += 1;
      }
    }

    if (joinedToPrevious && previous !== null) {
      previous.joinedWithNext = true;
    }
    accepted.push({
      anchorStart: anchor.index,
      anchorEnd,
      date,
      relativeDay,
      topic: null,
      pendingTopic: null,
      joinedWithNext: false
    });
    i += 1;
  }
  return accepted;
}

/**
 * A date preceded by a document noun ("the merger plan dated …", "the
 * prospectus … approved on …") with no notice noun in between is the
 * document's date, not a notice date.
 */
function isDocumentDate(before: string): boolean {
  let documentIndex = -1;
  for (const match of before.matchAll(DOCUMENT_NOUN_REGEX)) {
    documentIndex = match.index ?? -1;
  }
  if (documentIndex === -1 || before.length - documentIndex > DOCUMENT_NOUN_MAX_DISTANCE) {
    return false;
  }
  let noticeIndex = -1;
  for (const match of before.matchAll(NOTICE_NOUN_REGEX)) {
    noticeIndex = match.index ?? -1;
  }
  return documentIndex > noticeIndex;
}

function relativeDate(
  publishedDate: string | null,
  day: "today" | "yesterday"
): string | null {
  if (publishedDate === null) {
    return null;
  }
  return day === "today" ? publishedDate : shiftIsoDate(publishedDate, -1);
}

function attachMessageIds(candidates: Candidate[], messages: MessageMatch[]): void {
  for (const message of messages) {
    let best: Candidate | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      if (candidate.messageId !== undefined) {
        continue;
      }
      const distance =
        message.index >= candidate.anchorEnd
          ? message.index - candidate.anchorEnd
          : candidate.anchorStart - message.end;
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    if (best !== null) {
      best.messageId = message.messageId;
      continue;
    }
    candidates.push({
      anchorStart: message.index,
      anchorEnd: message.end,
      date: null,
      relativeDay: null,
      topic: null,
      pendingTopic: null,
      joinedWithNext: false,
      messageId: message.messageId
    });
  }
}

function assignTopics(text: string, window: Window, candidates: Candidate[]): void {
  for (let k = 0; k < candidates.length; k += 1) {
    const current = candidates[k];
    const next = k + 1 < candidates.length ? candidates[k + 1] : null;
    const regionEnd = next !== null ? next.anchorStart : window.end;
    const forward = findForwardTopic(
      text.slice(current.anchorEnd, Math.max(current.anchorEnd, regionEnd)),
      next !== null
    );
    if (forward.topic !== null) {
      current.topic = forward.topic;
      current.pendingTopic = forward.remainder;
      continue;
    }
    const previous = k > 0 ? candidates[k - 1] : null;
    if (previous !== null && previous.pendingTopic !== null) {
      current.topic = previous.pendingTopic;
      continue;
    }
    if (k === 0) {
      current.topic = findBackwardTopic(text.slice(window.start, current.anchorStart));
    }
  }
  for (let k = candidates.length - 2; k >= 0; k -= 1) {
    if (candidates[k].joinedWithNext && candidates[k].topic === null) {
      candidates[k].topic = candidates[k + 1].topic;
    }
  }
}

function findForwardTopic(
  segment: string,
  cutByNextAnchor: boolean
): { topic: string | null; remainder: string | null } {
  let chosen: RegExpMatchArray | null = null;
  for (const match of segment.matchAll(TOPIC_TRIGGER_REGEX)) {
    const index = match.index ?? 0;
    const strong = match[1] !== undefined;
    const weakButAdjacent =
      index <= WEAK_TOPIC_TRIGGER_MAX_DISTANCE ||
      NOTICE_NOUN_BEFORE_TRIGGER_REGEX.test(segment.slice(0, index));
    if (strong || weakButAdjacent) {
      chosen = match;
      break;
    }
  }
  if (chosen === null) {
    return { topic: null, remainder: null };
  }
  let body = segment.slice((chosen.index ?? 0) + chosen[0].length);
  let remainder: string | null = null;
  if (cutByNextAnchor) {
    let last: RegExpMatchArray | null = null;
    for (const split of body.matchAll(CONJOINED_TOPIC_SPLIT_REGEX)) {
      last = split;
    }
    if (last !== null) {
      const splitIndex = last.index ?? 0;
      remainder = cleanTopic(body.slice(splitIndex + last[0].length));
      body = body.slice(0, splitIndex);
    }
  }
  return { topic: cleanTopic(body), remainder };
}

function findBackwardTopic(segment: string): string | null {
  let chosen: RegExpMatchArray | null = null;
  for (const match of segment.matchAll(BACKWARD_TOPIC_TRIGGER_REGEX)) {
    chosen = match;
    break;
  }
  if (chosen === null) {
    return null;
  }
  return cleanTopic(segment.slice((chosen.index ?? 0) + chosen[0].length));
}

// ---------------------------------------------------------------------------
// Topic cleaning
// ---------------------------------------------------------------------------

function cleanTopic(value: string): string | null {
  let topic = collapseWhitespace(value);
  for (let round = 0; round < 3; round += 1) {
    const before = topic;
    topic = trimEdgePunctuation(topic);
    topic = topic.replace(TRAILING_PUBLICATION_CUE_REGEX, "");
    topic = trimEdgePunctuation(topic);
    topic = topic.replace(TRAILING_PARENTHETICAL_REGEX, "");
    topic = topic.replace(LEADING_ENUMERATOR_REGEX, "");
    topic = trimEdgePunctuation(topic);
    if (topic === before) {
      break;
    }
  }
  if (topic.length > TOPIC_MAX_CHARS) {
    topic = trimEdgePunctuation(capAtWordBoundary(topic, TOPIC_MAX_CHARS));
  }
  if (topic.length < 2 || NOISE_TOPIC_REGEX.test(topic)) {
    return null;
  }
  return topic;
}

function trimEdgePunctuation(value: string): string {
  let out = value
    .replace(EDGE_PUNCTUATION_LEADING_REGEX, "")
    .replace(EDGE_PUNCTUATION_TRAILING_REGEX, "");
  for (let round = 0; round < 4 && out.length > 0; round += 1) {
    const next = trimUnbalancedQuotes(out);
    if (next === out) {
      break;
    }
    out = next
      .replace(EDGE_PUNCTUATION_LEADING_REGEX, "")
      .replace(EDGE_PUNCTUATION_TRAILING_REGEX, "");
  }
  return out;
}

function trimUnbalancedQuotes(value: string): string {
  for (const [open, close] of QUOTE_PAIRS) {
    const opens = countChar(value, open);
    const closes = open === close ? opens : countChar(value, close);
    const startsWithOpen = value.startsWith(open);
    const endsWithClose = value.endsWith(close);
    if (startsWithOpen && endsWithClose && value.length >= 2) {
      const wrapped = open === close ? opens === 2 : opens === 1 && closes === 1;
      if (wrapped) {
        return value.slice(open.length, value.length - close.length);
      }
    }
    if (endsWithClose) {
      const unbalanced = open === close ? opens % 2 === 1 : closes > opens;
      if (unbalanced) {
        return value.slice(0, value.length - close.length);
      }
    }
    if (startsWithOpen) {
      const unbalanced = open === close ? opens % 2 === 1 : opens > closes;
      if (unbalanced) {
        return value.slice(open.length);
      }
    }
  }
  return value;
}

function countChar(value: string, char: string): number {
  let count = 0;
  for (const current of value) {
    if (current === char) {
      count += 1;
    }
  }
  return count;
}

function capAtWordBoundary(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  const cut = value.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return lastSpace >= max - 40 ? cut.slice(0, lastSpace) : cut;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max).trimEnd();
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Dates relative to publication (Europe/Oslo)
// ---------------------------------------------------------------------------

function osloCalendarDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return null;
  }
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Oslo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date(ms));
    const pick = (type: string): number | null => {
      const part = parts.find((entry) => entry.type === type);
      if (!part) {
        return null;
      }
      const numeric = Number(part.value);
      return Number.isInteger(numeric) ? numeric : null;
    };
    const year = pick("year");
    const month = pick("month");
    const day = pick("day");
    if (year === null || month === null || day === null) {
      return null;
    }
    return toIsoDate(year, month - 1, day);
  } catch {
    return null;
  }
}

function shiftIsoDate(iso: string, days: number): string | null {
  const [year, month, day] = iso.split("-").map(Number);
  if (![year, month, day].every((part) => Number.isInteger(part))) {
    return null;
  }
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return toIsoDate(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

// ---------------------------------------------------------------------------
// Final filtering
// ---------------------------------------------------------------------------

function finalize(
  references: NoticeReference[],
  publishedDate: string | null,
  max: number,
  includeUndated = false
): NoticeReference[] {
  const seen = new Map<string, NoticeReference>();
  const results: NoticeReference[] = [];
  for (const reference of references) {
    if (
      reference.date === null &&
      reference.relativeDay === null &&
      reference.messageId === undefined
    ) {
      const keepUndated =
        includeUndated &&
        reference.topic !== null &&
        UNDATED_FORMULA_PATTERN.test(reference.raw);
      if (!keepUndated) {
        continue;
      }
    }
    if (
      reference.date !== null &&
      publishedDate !== null &&
      reference.date > publishedDate
    ) {
      continue;
    }
    const dateKey =
      reference.date ??
      (reference.relativeDay !== null
        ? `rel:${reference.relativeDay}`
        : reference.messageId !== undefined
          ? `msg:${reference.messageId}`
          : "undated");
    const key = `${dateKey}|${(reference.topic ?? "").toLowerCase()}`;
    const existing = seen.get(key);
    if (existing !== undefined) {
      if (existing.messageId === undefined && reference.messageId !== undefined) {
        existing.messageId = reference.messageId;
      }
      continue;
    }
    seen.set(key, reference);
    results.push(reference);
  }
  return results.slice(0, max);
}

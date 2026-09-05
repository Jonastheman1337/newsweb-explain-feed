import {
  assessNumbersInText, defaultEnabledDerivationRules, parseNumberToken,
  type AssessNumbersOptions, type NumberAssessment
} from "@newsweb/prompt-kit";
import { normalizeNoticeNumericRanges } from "./notice-numeric-ranges.js";

export type NoticeNumberAssessment = NumberAssessment;
type OutflowKind = "dividend" | "interest" | "tax" | "debt_repayment";
type Unit = { currency: string; scale: number };
type Scope = "group" | "parent";
type PaidRow = Unit & { kind: OutflowKind; value: number; cell: string; header: string; row: string; scope: Scope; period: string; latestPeriod: string;
  recipient: "shareholders" | "non_controlling" | "unspecified" };
type NoticeIdentity = { issuerName: string; publishedAt: string };

const currencies: Array<[string, RegExp]> = [
  ["EUR", /^(?:EUR|euros?)$/i], ["NOK", /^(?:NOK|norske kroner)$/i],
  ["SEK", /^(?:SEK|svenske kroner)$/i], ["DKK", /^(?:DKK|danske kroner)$/i],
  ["USD", /^(?:USD|amerikanske dollar)$/i], ["GBP", /^(?:GBP|britiske pund)$/i]
];
const currencyWords = "EUR|euros?|NOK|norske kroner|SEK|svenske kroner|DKK|danske kroner|USD|amerikanske dollar|GBP|britiske pund";
const scaleWords = "millioner|millions?|tusen|thousands?|milliarder|billions?";
const amount = "(?:\\d{1,3}(?:[ \\u00a0]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)";
const money = `(?<amount>${amount})(?:\\s+(?<scale>${scaleWords}))?\\s+(?<currency>${currencyWords})\\b`;
const paid = "(?:utbetalte|utbetalt|betalte|betalt)";
const kindWords = "utbytte|renter|skatt|avdrag";
const visiblePatterns = [
  `${paid}\\s+(?:(?:til sammen|totalt|samlet|om lag|rundt)\\s+)?${money}\\s+(?:i|som)\\s+(?<kind>${kindWords})\\b`,
  `${paid}\\s+(?<kind>${kindWords})\\s+(?:(?:på|for)\\s+)?${money}`,
  `(?:tilbakebetalte|tilbakebetalt|nedbetalte|nedbetalt)\\s+${money}\\s+(?:i\\s+)?(?<kind>lån|gjeld)\\b`
];
const sourceKinds: Array<[OutflowKind, RegExp]> = [
  ["dividend", /^(?:dividends? paid(?: to (?:shareholders|equity holders|owners|non-controlling interests))?|(?:utbetalt|betalt) utbytte)$/i],
  ["interest", /^(?:interest paid|(?:betalte?|utbetalte?) renter)$/i],
  ["tax", /^(?:(?:income )?tax(?:es)? paid|(?:betalt|betalte) skatt(?:er)?)$/i],
  ["debt_repayment", /^(?:repayments? of (?:borrowings|loans|lease liabilities)|(?:tilbakebetaling|nedbetaling|avdrag) (?:av|på) (?:lån|gjeld))$/i]
];
const nonHistorical = /\b(?:ikke|ingen|aldri|kan|kunne|vil|ville|skal|bør|venter|ventet|forventer|forventet|foreslår|foreslått|mulig|dersom|hvis|anslag|prognose|forecast|projected|budget|illustrative|hypothetical|scenario|pro forma|expected|proposed|unpaid)\b/i;
const boundary = /^\s*(?:\[|(?:note\s+)?\d{1,2}(?:\.\d{1,2})*\.?\s+[A-ZÆØÅ]|(?:consolidated|parent|group|separate|konsern|morselskap)|(?:statement of|cash flows? from|transactions with|kontantstrøm))/i;

function scaleValue(word = ""): number {
  return /^(?:million|millioner)/i.test(word) ? 1_000_000 :
    /^(?:thousand|tusen)/i.test(word) ? 1_000 : /^(?:billion|milliard)/i.test(word) ? 1_000_000_000 : 1;
}
function currencyId(word: string): string | undefined {
  return currencies.find(([, pattern]) => pattern.test(word.trim()))?.[0];
}
function scalar(text: string): number | null {
  // A single comma/point plus three digits is locale-ambiguous. This rule
  // deliberately performs no guessing or rounding and never decodes glyphs.
  if (!new RegExp(`^${amount}$`).test(text)) return null;
  const value = Number(text.replace(/[ \u00a0]/g, "").replace(",", "."));
  return Number.isFinite(value) ? value : null;
}
function headerUnit(line: string): Unit | null {
  const cells = line.split(/\t+| {2,}/).map(cell => cell.trim());
  if (cells.length < 2 || !cells.slice(1).some(cell => /^(?:19|20)\d{2}(?:\s*[/–-]\s*(?:\d{2}|(?:19|20)\d{2}))?$/.test(cell))) return null;
  const unit = new RegExp(`^(?<currency>${currencyWords})(?:\\s+(?<scale>${scaleWords}))?$`, "i").exec(cells[0]);
  if (!unit?.groups || nonHistorical.test(line)) return null;
  const currency = currencyId(unit.groups.currency);
  return currency ? { currency, scale: scaleValue(unit.groups.scale) } : null;
}
function periodKey(text: string): string | null {
  const match = /^((?:19|20)\d{2})(?:\s*[/–-]\s*((?:19|20)?\d{2}))?$/.exec(text.trim());
  if (!match) return null;
  const end = match[2] ? match[2].length === 2 ? match[1].slice(0, 2) + match[2] : match[2] : null;
  return end ? `${match[1]}/${end}` : match[1];
}
function paidRows(sourceText: string): PaidRow[] {
  const rows: PaidRow[] = [];
  let header: { unit: Unit; text: string; index: number; periods: Array<string | null>; scope: Scope } | null = null;
  let hypothetical = false;
  let scope: Scope | null = null;
  for (const [index, line] of sourceText.split(/\r?\n/).entries()) {
    const structuralLine = line.trim().replace(/[ \t]+/g, " ");
    if (/^\s*\[/.test(line)) { hypothetical = false; scope = null; }
    if (boundary.test(line)) header = null;
    // Every entity/statement heading ends the previous ownership section,
    // including unknown entities. Only its own explicit group/parent wording
    // can establish a new scope; a later unit header cannot revive the old one.
    const statementBoundary = /\b(?:financial statements?|accounts)\b/i.test(structuralLine) ||
      /^(?:subsidiar(?:y|ies)|datterselskap|konsern(?:regnskap|rekneskap)|morselskapets regnskap)\b/i.test(structuralLine);
    if (statementBoundary) {
      header = null; scope = null;
      const group = /\bconsolidated\b|konsern(?:regnskap|rekneskap)/i.test(structuralLine);
      const parent = /\b(?:parent(?: company)?|separate)\b|morselskap/i.test(structuralLine);
      const otherEntity = /\bsubsidiar(?:y|ies)\b|datterselskap/i.test(structuralLine);
      if (!otherEntity && group !== parent) scope = group ? "group" : "parent";
    } else if (/^(?:notes to (?:the )?)?consolidated statement\b/i.test(structuralLine)) {
      scope = "group";
    } else if (/^(?:the )?parent company\b/i.test(structuralLine) && scope !== "group") {
      scope = "parent";
    }
    if (nonHistorical.test(line)) { hypothetical = true; header = null; }
    const unit = headerUnit(line);
    if (unit) {
      header = hypothetical || !scope ? null : { unit, text: line, index, scope,
        periods: line.split(/\t+| {2,}/).map(periodKey) };
      continue;
    }
    // A changed unit, period or section starts another table. Never scan
    // backward past it to revive a convenient older header.
    if (/^\s*(?:EUR|NOK|SEK|DKK|USD|GBP|[$€£]|(?:19|20)\d{2}(?:\s*[/–-]\s*\d{2,4})?\s*(?:\t| {2,}))/i.test(line)) header = null;
    if (!header || index - header.index > 18 || hypothetical) continue;
    const cells = line.split(/\t+| {2,}/).map(cell => cell.trim());
    const kind = sourceKinds.find(([, pattern]) => pattern.test(cells[0]))?.[0];
    if (!kind || cells.length < 2 || cells.length !== header.periods.length) continue;
    const latestPeriod = header.periods.filter((period): period is string => period !== null).sort().at(-1)!;
    for (const [column, cell] of cells.entries()) {
      const period = header.periods[column];
      if (!period) continue;
      if (!/^[-−]/.test(cell)) continue;
      const value = scalar(cell.slice(1));
      if (value !== null && value > 0) rows.push({ ...header.unit, kind, value, cell, header: header.text, row: line,
        scope: header.scope, period, latestPeriod, recipient: /non-controlling interests/i.test(cells[0]) ? "non_controlling" :
          /\bto\b/i.test(cells[0]) ? "shareholders" : "unspecified" });
    }
  }
  return rows;
}
function visibleKind(word: string): OutflowKind {
  return word.toLowerCase() === "utbytte" ? "dividend" : word.toLowerCase() === "renter" ? "interest" :
    word.toLowerCase() === "skatt" ? "tax" : "debt_repayment";
}
function clauseAt(text: string, index: number): { text: string; start: number } {
  // Decimal punctuation remains in the clause. A neighbouring sentence or
  // JSON string cannot donate its payment verb to a different occurrence.
  const separators = [...text.matchAll(/[!?;\n"{}]|\.(?!\d)|,\s+(?:og|men)\b/g)].map(match => match.index!);
  const start = separators.filter(position => position < index).at(-1) ?? -1;
  const end = separators.find(position => position >= index) ?? text.length;
  return { text: text.slice(start + 1, end), start: start + 1 };
}

function matchesPaymentOwner(prefix: string, row: PaidRow, identity: NoticeIdentity): boolean {
  const normalized = prefix.trim();
  const stem = identity.issuerName.replace(/\s+(?:ASA|AS|PLC|LTD|LIMITED|AB|A\/S)$/i, "").trim();
  const aliases = [...new Set([identity.issuerName, stem, stem.split(/\s+/)[0]].filter(alias => alias.length >= 4))];
  const subjects = ["Selskapet", ...(row.scope === "group" ? ["Konsernet"] : ["Morselskapet"]), ...aliases];
  const escaped = subjects.map(subject => subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  if (new RegExp(`^(?:${escaped})(?:\\s+(?:har|hadde|allerede|også))*$`, "i").test(normalized)) return true;
  // Passive payment in an explicitly issuer-attributed report sentence.
  return new RegExp(`^(?:${escaped})\\s+(?:oppgir|opplyser|rapporterer)\\s+[^.!?;:]{0,100}\\s+at\\s+det\\s+(?:ble|er)$`, "i").test(normalized) &&
    !/\b(?:eierne|aksjonærene|datterselskapet|morselskapet|konsernet)\b/i.test(normalized.slice(normalized.indexOf(" ") + 1));
}
function matchesPaymentPeriod(clause: string, row: PaidRow, identity: NoticeIdentity): boolean {
  const sourceYear = Number(row.period.split("/").at(-1));
  const published = new Date(identity.publishedAt);
  if (!Number.isFinite(published.getTime())) return false;
  const publicationYear = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Oslo", year: "numeric" }).format(published));
  if (sourceYear > publicationYear) return false;
  const mentioned = [...clause.matchAll(/\b(?:i|for|året|regnskapsåret)\s+((?:19|20)\d{2}(?:\s*[/–-]\s*(?:(?:19|20)?\d{2}))?)(?!\d)/gi)]
    .map(match => periodKey(match[1])).filter((period): period is string => period !== null);
  return mentioned.length ? mentioned.every(period => period === row.period) : row.period === row.latestPeriod;
}

function matchesDividendRecipient(tail: string, row: PaidRow): boolean {
  // A generic owner noun followed by another company name is not the same
  // recipient. Do not erase a non-controlling-interest limitation either.
  const match = /^(?:\s+til\s+(?<recipient>aksjonærene|eierne|aksjeeierne|minoritetsaksjonærene|minoritetseierne))?(?:\s+(?:i|for)\s+(?:19|20)\d{2}(?:\s*[/–-]\s*(?:(?:19|20)?\d{2}))?)?\s*$/i.exec(tail);
  if (!match) return false;
  const recipient = match.groups?.recipient?.toLowerCase();
  const minority = recipient === "minoritetsaksjonærene" || recipient === "minoritetseierne";
  return row.recipient === "non_controlling" ? minority : !minority && (row.recipient === "shareholders" || !recipient);
}

/** Notice-only signed outflow presentation. Mask just the witnessed positive
 * amount; all other occurrences, signs, units, dates and ownership checks run
 * normally. Nothing is added to the general source-number index. */
export function isolatePaidOutflowMagnitudes(
  text: string, sourceText: string, identity: NoticeIdentity, options?: AssessNumbersOptions
): {
  text: string; assessments: NoticeNumberAssessment[];
} {
  const rows = paidRows(sourceText);
  if (!rows.length) return { text, assessments: [] };
  const enabled = (options?.enabledDerivationRules ?? defaultEnabledDerivationRules).includes("paid_outflow_magnitude");
  const accepted = new Map<number, { length: number; assessment: NoticeNumberAssessment }>();
  for (const pattern of visiblePatterns) for (const match of text.matchAll(new RegExp(`\\b${pattern}`, "giu"))) {
    const groups = match.groups!;
    const start = match.index! + match[0].indexOf(groups.amount);
    const clause = clauseAt(text, start);
    if (accepted.has(start) || nonHistorical.test(clause.text)) continue;
    const value = scalar(groups.amount);
    const currency = currencyId(groups.currency);
    if (value === null || value <= 0 || !currency) continue;
    const scale = scaleValue(groups.scale);
    const prefix = text.slice(clause.start, match.index);
    const row = rows.find(candidate => candidate.kind === visibleKind(groups.kind) && candidate.currency === currency &&
      matchesPaymentOwner(prefix, candidate, identity) && matchesPaymentPeriod(clause.text, candidate, identity) &&
      (candidate.kind !== "dividend" || matchesDividendRecipient(text.slice(match.index! + match[0].length, clause.start + clause.text.length), candidate)) &&
      Math.abs(candidate.value * candidate.scale - value * scale) <= Number.EPSILON * Math.max(candidate.value * candidate.scale, value * scale) * 4);
    const parsed = parseNumberToken(groups.amount);
    if (!row || !parsed) continue;
    if (!enabled) {
      // Check this occurrence through the ordinary chain before naming a
      // disabled candidate. Keep its complete textual context but mask other
      // digits so a different occurrence cannot donate its acceptance.
      const occurrenceText = text.slice(0, start).replace(/\d/g, " ") + groups.amount +
        text.slice(start + groups.amount.length).replace(/\d/g, " ");
      const ordinary = assessNumbersInText(normalizeNoticeNumericRanges(occurrenceText),
        normalizeNoticeNumericRanges(sourceText), options)
        .find(assessment => assessment.display === parsed.display);
      if (ordinary?.disposition !== "unexpected") continue;
      accepted.set(start, { length: groups.amount.length, assessment: {
        display: parsed.display, disposition: "unexpected", ruleId: null, count: 1,
        candidateRuleId: ordinary.candidateRuleId ?? "paid_outflow_magnitude"
      } });
      continue;
    }
    accepted.set(start, { length: groups.amount.length, assessment: {
      display: parsed.display, disposition: "derived", ruleId: "paid_outflow_magnitude", count: 1,
      provenance: { outflowKind: row.kind, sourceHeader: row.header, sourceRow: row.row, sourceSignedCell: row.cell,
        currency, sourceScale: row.scale, visibleScale: scale, sourceScope: row.scope, sourcePeriod: row.period, sourceRecipient: row.recipient,
        visibleStart: start, visibleEnd: start + groups.amount.length }
    } });
  }
  let masked = text;
  for (const [start, { length }] of accepted) masked = masked.slice(0, start) + " ".repeat(length) + masked.slice(start + length);
  return { text: masked, assessments: [...accepted.values()].map(item => item.assessment) };
}

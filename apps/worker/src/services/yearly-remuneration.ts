export type YearlyRawPage = { pageNumber: number; text: string };
export type YearlyRemunerationSelection = {
  status: "available" | "no_disclosure_found" | "unavailable";
  letterText: null;
  remunerationText: string | null;
  pageCount: number;
  selectedPages: Array<{ pageNumber: number; reasons: string[] }>;
  diagnostics: {
    version: "yearly-raw-remuneration-v1";
    inspectedPages: number;
    unreadablePages: number[];
    completeReadableScan: boolean;
    disclosurePages: number[];
    unusableDisclosurePages: number[];
    explicitNonpaymentPages: number[];
    contextTruncated: boolean;
    reasons: string[];
  };
};

const MAX_CONTEXT_CHARS = 24_000;
const MAX_DISCLOSURE_PAGES = 4;
const MAX_CONTEXT_DISTANCE = 12;
const payLanguage = /remuneration|compensation|salar(?:y|ies)|godtgj[øo]relse|lederl[øo]nn|l[øo]nn|executive pay/i;
const role = /\bCEO\b|chief executive|executive (?:management|directors?)|senior (?:management|executives?)|key management|board (?:members?|of directors)|daglig leder|administrerende direkt[øo]r|ledende ansatte|konsern(?:sjef|ledelse)|styret/i;
const payLabel = /(?:base |fixed |variable |total |other |cash |share.based )?(?:salar(?:y|ies)|remuneration|compensation|benefits?|employee benefit expense|bonus|pension|grunnl[øo]nn|fastl[øo]nn|variabel l[øo]nn|godtgj[øo]relse|pensjon|l[øo]nn)/i;
const currency = /\b(?:NOK|SEK|DKK|USD|EUR|GBP|CHF|CAD|AUD|euros?|dollars?|kroner|kr|pounds?)\b|[$€£]/i;
const yearOrPeriod = /\b(?:19|20)\d{2}(?:\s*[/–-]\s*(?:\d{2}|(?:19|20)\d{2}))?\b/;
const sectionHeading = /^\s*\d{1,2}(?:\.\d{1,2})*\.?\s+[A-ZÆØÅ]/;
const nonMonetary = /\b(?:number of|man.years|full.time|employees? employed|shares? (?:granted|awarded|held)|options? (?:granted|awarded|held)|days?|meetings?|headcount|antall|[åa]rsverk|prosent|percent|per cent)\b|%/i;
const nonpayment = /(?:no remuneration (?:is|was|has been) paid|(?:board|directors?|CEO|executive management).{0,100}(?:received no (?:remuneration|compensation)|(?:did|does) not receive (?:any )?(?:remuneration|compensation))|(?:ingen|ikke).{0,40}(?:utbetalt|betalt).{0,40}godtgj[øo]relse)/i;
const normalize = (value: string) => value.normalize("NFKC").replace(/\u00ad/g, "").replace(/\s+/g, " ").trim();

function analysisLines(page: YearlyRawPage): string[] {
  // Navigation furniture is not a table role header. Raw output stays untouched.
  return page.text.split(/\r?\n/).filter(line => !/\bCONTENTS\b.*(?:\||FINANCIAL INFORMATION)|\bINNHOLD\b.*\|/i.test(line));
}
function scope(page: YearlyRawPage): "group" | "parent" | "mixed" | null {
  const group = /(?:notes to (?:the )?consolidated financial statements|consolidated (?:statement|accounts)|konsernregnskap|noter til konsern)/i.test(page.text);
  const parent = /(?:parent company financial statements|separate financial statements|morselskapets (?:regnskap|noter)|selskapsregnskap)/i.test(page.text);
  return group && parent ? "mixed" : group ? "group" : parent ? "parent" : null;
}
function isToc(lines: string[]): boolean {
  return lines.slice(0, 5).some(line => /^\s*(?:table of contents|contents|innhold(?:sfortegnelse)?)\s*$/i.test(line)) ||
    lines.filter(line => /\.{3,}\s*\d+\s*$/.test(line)).length >= 3;
}
function readable(page: YearlyRawPage): boolean {
  const text = normalize(analysisLines(page).join("\n"));
  return text.length >= 40 && (text.match(/\p{L}/gu)?.length ?? 0) >= 20 && !/[\uE000-\uF8FF\uFFFD]/.test(text);
}
function hasPayRows(page: YearlyRawPage, hasCurrency: boolean): boolean {
  const lines = analysisLines(page);
  if (isToc(lines) || !payLanguage.test(lines.join("\n"))) return false;
  let nearestRole = -100;
  let countTable = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (sectionHeading.test(line)) { nearestRole = -100; countTable = false; }
    if (role.test(line)) nearestRole = i;
    if (/number of (?:shares|options|employees)|antall (?:aksjer|opsjoner|ansatte)/i.test(line)) countTable = true;
    if (currency.test(line)) countTable = false;
    const label = payLabel.exec(line);
    if (!label || i - nearestRole > 12 || countTable || nonMonetary.test(line) || /\b(?:policy|will|may|shall|should|maximum|limit)\b/i.test(line)) continue;
    const rest = line.slice(label.index + label[0].length);
    const numbers = rest.match(/[−+-]?\d+(?:[.,]\d+)*(?: \d{3})*/g) ?? [];
    // This is only a monetary-row witness, not a numeric conversion. Both
    // decimal conventions remain literal; a year alone is not a pay amount.
    if (hasCurrency && numbers.some(value => !/^(?:19|20)\d{2}$/.test(value)) &&
      !/[\uE000-\uF8FF\uFFFD]/.test(line)) return true;
  }
  return false;
}

/** Missing raw evidence is retryable, never evidence of no pay. */
export function requireYearlyRemunerationSource<T extends YearlyRemunerationSelection>(selection: T | null): T {
  if (!selection || selection.status === "unavailable" ||
    (selection.status === "available" && !selection.remunerationText?.trim())) {
    throw new Error(`YEARLY_REPORT_SOURCE_UNAVAILABLE: ${selection?.diagnostics.reasons.join(", ") || "no_readable_annual_pdf"}`);
  }
  return selection;
}

/** Select raw annual pages only. No salary parsing, unit conversion or inferred owner. */
export function selectYearlyRemunerationPages(pages: readonly YearlyRawPage[], pageCount = pages.length): YearlyRemunerationSelection {
  const ordered = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const uniquePages = new Set(ordered.map(page => page.pageNumber));
  const validPageNumbers = ordered.every(page => Number.isInteger(page.pageNumber) && page.pageNumber >= 1 && page.pageNumber <= pageCount);
  const unreadablePages = ordered.filter(page => !readable(page)).map(page => page.pageNumber);
  const completeReadableScan = pageCount > 0 && ordered.length === pageCount && uniquePages.size === pageCount && validPageNumbers && unreadablePages.length === 0;
  const selected = new Map<number, { page: YearlyRawPage; reasons: Set<string> }>();
  const disclosurePages: number[] = [];
  const unusableDisclosurePages: number[] = [];
  const explicitNonpaymentPages: number[] = [];
  const add = (page: YearlyRawPage, reason: string) => {
    const entry = selected.get(page.pageNumber) ?? { page, reasons: new Set<string>() };
    entry.reasons.add(reason); selected.set(page.pageNumber, entry);
  };
  if (uniquePages.size === ordered.length && validPageNumbers) for (const page of ordered) {
    const lines = analysisLines(page);
    if (!readable(page) || isToc(lines)) continue;
    const pageScope = scope(page);
    // Context is retained verbatim, never converted into a typed unit/scope claim.
    // Do not borrow accounting basis across an explicit parent/group boundary.
    const preceding: YearlyRawPage[] = [];
    for (const earlier of ordered.filter(item => item.pageNumber < page.pageNumber).reverse()) {
      if (page.pageNumber - earlier.pageNumber > MAX_CONTEXT_DISTANCE) break;
      const earlierScope = scope(earlier);
      if (pageScope && earlierScope && pageScope !== earlierScope) break;
      if (!pageScope && earlierScope) break;
      if (readable(earlier)) preceding.push(earlier);
    }
    const unitPage = currency.test(page.text) ? page : preceding.find(item => currency.test(item.text));
    const hasExplicitNonpayment = role.test(lines.join(" ")) && nonpayment.test(normalize(lines.join(" ")));
    const payRows = hasPayRows(page, true);
    // A disclosed pay table without a usable monetary basis is unavailable,
    // not evidence that the readable report contains no disclosure.
    if (payRows && !unitPage) unusableDisclosurePages.push(page.pageNumber);
    if (!(payRows && unitPage) && !hasExplicitNonpayment) continue;
    disclosurePages.push(page.pageNumber);
    if (hasExplicitNonpayment) explicitNonpaymentPages.push(page.pageNumber);
    if (disclosurePages.length > MAX_DISCLOSURE_PAGES) continue;
    add(page, hasExplicitNonpayment ? "scoped_nonpayment" : "remuneration_rows");
    if (unitPage) add(unitPage, "monetary_basis_context");
    const basis = preceding.find(item => /basis of (?:preparation|consolidation)|reporting period|regnskapsprinsipper|rapporteringsperiode/i.test(item.text));
    if (basis) add(basis, "accounting_period_scope_context");
    const cover = ordered.find(item => item.pageNumber <= 3 && readable(item) && yearOrPeriod.test(item.text) && /annual report|[åa]rsrapport|fiscal year|financial year/i.test(item.text) && !isToc(analysisLines(item)));
    if (cover) add(cover, "report_period_context");
  }
  const selectedEntries = [...selected.values()].sort((a, b) => a.page.pageNumber - b.page.pageNumber);
  const raw = selectedEntries.map(({ page }) => `[PDF page ${page.pageNumber}]\n${page.text}`).join("\n\n");
  // Never truncate a table or drop its basis silently just to fit the budget.
  const overBudget = raw.length > MAX_CONTEXT_CHARS;
  const contextTruncated = disclosurePages.length > MAX_DISCLOSURE_PAGES;
  const available = disclosurePages.length > 0 && !overBudget && !unusableDisclosurePages.length;
  return {
    status: available ? "available" : completeReadableScan && !disclosurePages.length && !unusableDisclosurePages.length ? "no_disclosure_found" : "unavailable",
    letterText: null, remunerationText: available ? raw : null, pageCount,
    selectedPages: selectedEntries.map(({ page, reasons }) => ({ pageNumber: page.pageNumber, reasons: [...reasons] })),
    diagnostics: { version: "yearly-raw-remuneration-v1", inspectedPages: ordered.length, unreadablePages, completeReadableScan,
      disclosurePages, unusableDisclosurePages, explicitNonpaymentPages, contextTruncated,
      reasons: [
        ...(!ordered.length ? ["no_extracted_pages"] : []),
        ...(!validPageNumbers || uniquePages.size !== ordered.length ? ["invalid_or_duplicate_pages"] : []),
        ...(!completeReadableScan ? ["incomplete_or_unreadable_scan"] : []),
        ...(!disclosurePages.length ? ["no_qualifying_remuneration_disclosure"] : []),
        ...(unusableDisclosurePages.length ? ["pay_rows_without_monetary_basis"] : []),
        ...(contextTruncated ? ["additional_disclosure_pages_not_selected"] : []),
        ...(overBudget ? ["whole_page_context_exceeds_budget"] : [])
      ] }
  };
}

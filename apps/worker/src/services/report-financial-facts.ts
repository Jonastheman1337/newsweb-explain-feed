import type { ReportMetricCandidate, ReportMetricKind } from "./pdf-extract.js";

export type ReportFinancialPeriod = {
  id: string;
  label: string;
  kind: "quarter" | "half_year" | "year" | "unspecified";
  year: number;
  quarter?: number;
  half?: number;
};

export type ReportFinancialFact = {
  metric: ReportMetricKind;
  label: string;
  rawValue: string;
  numericValue: number | null;
  currency: string | null;
  scale: "units" | "thousands" | "millions" | "billions" | null;
  period: ReportFinancialPeriod | null;
  comparisonPeriodId: string | null;
  tableScope: "consolidated" | "parent_company" | null;
  pageNumber: number;
  rowNumber: number;
  rowText: string;
  headerText: string[];
  attachmentId?: number;
  attachmentName?: string | null;
  usable: boolean;
  unresolved: string[];
};

// Ordinary spaces separate cells. A PDF often loses column geometry: interpreting
// "100 200" as 100200 silently changes the financial fact. Only explicit table
// cell boundaries or nonbreaking grouping spaces may join thousands groups.
export function extractReportNumberValues(text: string): string[] {
  const cells = text.split(/\t| {2,}/);
  const numbers: string[] = [];
  for (const cell of cells) {
    const trimmed = cell.trim();
    if (cells.length > 1 && /^(?:\(\s*)?[-+−–]?\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?\s*\)?$/.test(trimmed)) {
      numbers.push(trimmed);
      continue;
    }
    const matches = cell.match(/(?:\(\s*)?[-+−–]?\d+(?:[\u00a0\u202f]\d{3})*(?:[.,]\d+)*(?:\s*\))?/g) ?? [];
    numbers.push(...matches.map((value) => value.trim()));
  }
  return numbers;
}

function parseNumber(raw: string): { value: number | null; issue?: string } {
  let value = raw.replace(/[\u00a0\u202f ]/g, "").replace(/[−–]/g, "-");
  if (/^\(.*\)$/.test(value)) value = `-${value.slice(1, -1)}`;
  const unsigned = value.replace(/^[-+]/, "");
  if (!/^\d+(?:[.,]\d+)*$/.test(unsigned)) return { value: null, issue: "invalid_number" };
  if (unsigned.includes(",") && unsigned.includes(".")) {
    const decimal = unsigned.lastIndexOf(",") > unsigned.lastIndexOf(".") ? "," : ".";
    const grouping = decimal === "," ? "." : ",";
    const [integer, fraction, extra] = unsigned.split(decimal);
    if (extra !== undefined || !fraction || !/^\d+$/.test(fraction) || !/^\d{1,3}(?:[.,]\d{3})+$/.test(integer)) {
      return { value: null, issue: "ambiguous_number_separators" };
    }
    value = value.split(grouping).join("").replace(decimal, ".");
  } else if (/[.,]/.test(unsigned)) {
    const pieces = unsigned.split(/[.,]/);
    if (pieces.length > 2) {
      if (pieces.slice(1).every((part) => part.length === 3) && pieces[0].length <= 3) value = value.replace(/[.,]/g, "");
      else return { value: null, issue: "ambiguous_number_separators" };
    } else if (pieces[1].length === 3) {
      // 1,234 may mean 1234 or 1.234. Preserve the source token, not a guess.
      return { value: null, issue: "ambiguous_number_separators" };
    } else value = value.replace(",", ".");
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? { value: parsed } : { value: null, issue: "invalid_number" };
}

function periodFromMatch(label: string): ReportFinancialPeriod | null {
  const range = label.match(/^(\d{1,2})\.(\d{1,2})\.(?:(\d{4}))?\s*[-–—]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (range) {
    const [, startDay, startMonth, startYear, endDay, endMonth, endYear] = range;
    const year = Number(endYear);
    const fromYear = Number(startYear ?? endYear);
    const start = `${Number(startMonth)}-${Number(startDay)}`;
    const end = `${Number(endMonth)}-${Number(endDay)}`;
    const validDate = (y: number, m: number, d: number) => {
      const date = new Date(Date.UTC(y, m - 1, d));
      return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
    };
    if (!validDate(fromYear, Number(startMonth), Number(startDay)) || !validDate(year, Number(endMonth), Number(endDay))) return null;
    if (fromYear === year) {
      if (start === "1-1" && end === "12-31") return { id: `${year}-FY`, label, kind: "year", year };
      if ((start === "1-1" && end === "6-30") || (start === "7-1" && end === "12-31")) {
        const half = start === "1-1" ? 1 : 2;
        return { id: `${year}-H${half}`, label, kind: "half_year", year, half };
      }
      const quarter = ["1-1/3-31", "4-1/6-30", "7-1/9-30", "10-1/12-31"].indexOf(`${start}/${end}`) + 1;
      if (quarter) return { id: `${year}-Q${quarter}`, label, kind: "quarter", year, quarter };
    }
    return { id: `${fromYear}-${start}/${year}-${end}`, label, kind: "unspecified", year };
  }
  const date = label.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (date) {
    // A date alone says when a column ends, not when it starts. Retain its
    // position so explicitly named neighbouring quarters can still be used.
    const year = Number(date[3]);
    return { id: `${year}-date-${Number(date[2])}-${Number(date[1])}`, label, kind: "unspecified", year };
  }
  const yearMatch = label.match(/\b(20\d{2}|19\d{2})\b/);
  if (!yearMatch) return null;
  const year = Number(yearMatch[1]);
  const quarter = label.match(/(?:Q\s*([1-4])|([1-4])\s*Q|([1-4])\.?\s*(?:quarter|kvartal))/i);
  if (quarter) {
    const n = Number(quarter[1] ?? quarter[2] ?? quarter[3]);
    return { id: `${year}-Q${n}`, label, kind: "quarter", year, quarter: n };
  }
  const half = label.match(/(?:H\s*([12])|([12])\s*H|([12])\.?\s*(?:half(?:\s+year)?|halv[åa]r))/i);
  if (half) {
    const n = Number(half[1] ?? half[2] ?? half[3]);
    return { id: `${year}-H${n}`, label, kind: "half_year", year, half: n };
  }
  if (/\b(?:FY|full[ -]?year|year|hel[åa]r)\b/i.test(label)) return { id: `${year}-FY`, label, kind: "year", year };
  return { id: `${year}-unspecified`, label, kind: "unspecified", year };
}

function periodsInLine(line: string): ReportFinancialPeriod[] {
  const explicit = /\b(?:\d{1,2}\.\d{1,2}\.(?:(?:20|19)\d{2})?\s*[-–—]\s*\d{1,2}\.\d{1,2}\.(?:20|19)\d{2}|(?:Q\s*[1-4]|[1-4]\s*Q|[1-4]\.?\s*(?:quarter|kvartal)|H\s*[12]|[12]\s*H|[12]\.?\s*(?:half(?:\s+year)?|halv[åa]r)|FY|full[ -]?year|year|hel[åa]r)\s*[-/]?\s*(?:20|19)\d{2}|\d{1,2}\.\d{1,2}\.(?:20|19)\d{2})\b/gi;
  const labels = [...line.matchAll(explicit)].map((match) => match[0]);
  const unitWords = /(?:NOK|SEK|DKK|EUR|USD|GBP|CHF|millions?|thousands?|billions?|mnok|msek|meur|amounts? in|notes?|noter?|unaudited|audited)/gi;
  if (labels.length) {
    const remainder = line.replace(explicit, "").replace(unitWords, "");
    if (/[A-Za-zÆØÅæøå\d]/.test(remainder)) return [];
    const periods = labels.map(periodFromMatch);
    return periods.every((period): period is ReportFinancialPeriod => period !== null) ? periods : [];
  }
  // A year on its own establishes the year, not whether this is an annual or
  // interim comparison. Keep the type unresolved unless the column says so.
  const withoutUnit = line.replace(unitWords, "");
  if (!/^[\s|,()\d]+$/.test(withoutUnit)) return [];
  return [...withoutUnit.matchAll(/\b(?:20|19)\d{2}\b/g)].flatMap((match) => periodFromMatch(match[0]) ?? []);
}

function findHeader(lines: string[], rowIndex: number): { periods: ReportFinancialPeriod[]; text: string[] } {
  for (let i = rowIndex - 1; i >= 0; i--) {
    const periods = periodsInLine(lines[i]);
    if (!periods.length) continue;
    if (periods.every((period) => period.kind === "unspecified") && i > 0) {
      const labels = lines[i - 1].trim().split(/\t+|\s{2,}|\s+(?=(?:Q[1-4]|H[12]|FY|Year)\b)/i).filter(Boolean);
      if (labels.length === periods.length) {
        const combined = labels.map((label, index) => periodFromMatch(`${label} ${periods[index].year}`));
        if (combined.every((period) => period && period.kind !== "unspecified")) return { periods: combined as ReportFinancialPeriod[], text: [lines[i - 1], lines[i]] };
      }
    }
    return { periods, text: [lines[i]] };
  }
  return { periods: [], text: [] };
}

function findUnits(lines: string[], rowIndex: number): { currency: string | null; scale: ReportFinancialFact["scale"]; text: string[] } {
  for (let i = rowIndex; i >= 0; i--) {
    const line = lines[i];
    // Restrict unit detection to compact table headings/cells. Narrative currency
    // mentions and a prior unrelated table must not establish this row's units.
    if (line.length > 180) continue;
    const currencies = [...line.matchAll(/\b(?:[MT]?(?:NOK|SEK|DKK|EUR|USD|GBP|CHF))(?:m|bn)?\b/gi)].map((match) => match[0].toUpperCase().replace(/^[MT](?=[A-Z]{3}$)/, "").replace(/(?:BN|M)$/, ""));
    if (/\b(?:norske kroner|norwegian kroner)\b/i.test(line)) currencies.push("NOK");
    const unique = [...new Set(currencies)];
    if (unique.length > 1) return { currency: null, scale: null, text: [line] };
    if (!unique.length) continue;
    let scale: ReportFinancialFact["scale"] = null;
    if (/\b(?:billion|billions|milliard(?:er)?)\b|\b(?:NOK|SEK|DKK|EUR|USD|GBP|CHF)bn\b/i.test(line)) scale = "billions";
    else if (/\b(?:million(?:s|er)?|mill\.?|mnok|msek|mdkk|meur|musd|mgbp|mchf)\b|\b(?:NOK|SEK|DKK|EUR|USD|GBP|CHF)m\b/i.test(line)) scale = "millions";
    else if (/\b(?:thousand(?:s)?|tusen|tnok|tsek|tdkk|teur|tusd|tgbp|tchf)\b|(?:NOK|SEK|DKK|EUR|USD|GBP|CHF)\s*[(\s'’]*(?:0{3}|1[\s,.]?0{3})\b/i.test(line)) scale = "thousands";
    else if (/^\s*(?:\(?\s*(?:amounts?\s+in\s+|in\s+)?(?:NOK|SEK|DKK|EUR|USD|GBP|CHF)\s*\)?)(?:\s+(?:Q[1-4]|H[12]|FY|20\d{2}).*)?\s*$/i.test(line)) scale = "units";
    return { currency: unique[0], scale, text: [line] };
  }
  return { currency: null, scale: null, text: [] };
}

function findScope(lines: string[], rowIndex: number): { scope: ReportFinancialFact["tableScope"]; text: string[] } {
  for (let i = rowIndex; i >= 0; i--) {
    if (/\b(?:parent company|morselskap(?:et)?|morbanken)\b/i.test(lines[i])) return { scope: "parent_company", text: [lines[i]] };
    if (/\b(?:consolidated|group income|konsern(?:et|regnskap)?)\b/i.test(lines[i])) return { scope: "consolidated", text: [lines[i]] };
  }
  return { scope: null, text: [] };
}

function statementKind(line: string): "income" | "cash_flow" | "balance" | null {
  if (/\b(?:income statement|statement of (?:comprehensive income|profit or loss)|resultatregnskap)\b/i.test(line)) return "income";
  if (/\b(?:cash flow statement|statement of cash flows?)\b/i.test(line)) return "cash_flow";
  if (/\b(?:balance sheet|statement of financial position|balanse)\b/i.test(line)) return "balance";
  return null;
}

function isUnitCaption(line: string): boolean {
  return /^\s*\(?\s*(?:(?:all\s+)?amounts?\s+in\s+|alle\s+(?:tall|beløp)(?:\s+i)?\s+|in\s+)?[MT]?(?:NOK|SEK|DKK|EUR|USD|GBP|CHF)(?:m|bn)?(?:\s+(?:million(?:s|er)?|mill\.?|thousands?|tusen|billions?|milliarder?|1[\s,.]?000|000|units?))?\s*\)?\s*$/i.test(line);
}

function tableStartBeforeRow(lines: string[], rowIndex: number): number {
  let start = Math.max(0, rowIndex - 25);
  for (let i = rowIndex - 1; i >= 0; i--) {
    if (statementKind(lines[i])) { start = i; break; }
  }
  // Some statements put an explicit consolidated/parent financial heading and
  // units immediately above the statement title. Keep that compact preamble,
  // but never borrow an earlier table's trailing numeric rows or unit caption.
  let preambleStart = start;
  let scopedPreamble = false;
  for (let i = start - 1; i >= Math.max(0, start - 4); i--) {
    const scoped = /^\s*(?:consolidated|group|parent company)\s+(?:financial statements|accounts)\b/i.test(lines[i]);
    if (!scoped && !isUnitCaption(lines[i])) break;
    scopedPreamble ||= scoped;
    preambleStart = i;
  }
  return scopedPreamble ? preambleStart : start;
}

function isolatedTrailingUnits(lines: string[], rowIndex: number): ReturnType<typeof findUnits> | null {
  // Some PDFs emit a page's title/caption after all its table rows. Recover only
  // a single isolated statement: one period header, one scope, one unit caption,
  // and no data after the caption. Multiple tables remain unresolved.
  if (lines.filter(line => periodsInLine(line).length > 0).length !== 1) return null;
  const statements = new Set(lines.flatMap(line => statementKind(line) ?? []));
  if (statements.size !== 1) return null;
  const scopes = new Set(lines.flatMap(line => findScope([line], 0).scope ?? []));
  if (scopes.size !== 1) return null;
  const captions = lines.flatMap((line, index) => isUnitCaption(line) ? [index] : []);
  if (captions.length !== 1 || captions[0] <= rowIndex) return null;
  const index = captions[0];
  if (index === 0 || !statementKind(lines[index - 1])) return null;
  const tail = lines.slice(index + 1).map(line => line.trim()).filter(Boolean);
  if (tail.length > 4 || tail.some(line => !statementKind(line) && !/^\d+$/.test(line) &&
      !(line.length <= 100 && /\b(?:halvårsrapport|annual report|quarterly report)\b/i.test(line)))) return null;
  const units = findUnits([lines[index]], 0);
  return units.currency && units.scale ? { ...units, text: [lines[index - 1], ...units.text] } : null;
}

export function extractReportFinancialFacts(
  pages: Array<{ pageNumber: number; text: string }>,
  rows: ReportMetricCandidate[]
): ReportFinancialFact[] {
  const facts: ReportFinancialFact[] = [];
  for (const row of rows) {
    const page = pages.find((item) => item.pageNumber === row.pageNumber);
    if (!page) continue;
    const lines = page.text.split(/\r?\n/);
    const rowIndex = row.rowNumber ? row.rowNumber - 1 : lines.findIndex((line) => line.trim() === row.rowText.trim());
    if (rowIndex < 0) continue;
    const tableStart = tableStartBeforeRow(lines, rowIndex);
    const tableLines = lines.slice(tableStart, rowIndex + 1);
    const tableRowIndex = tableLines.length - 1;
    const header = findHeader(tableLines, tableRowIndex);
    let units = findUnits(tableLines, tableRowIndex);
    if (!units.currency && !units.scale) units = isolatedTrailingUnits(lines, rowIndex) ?? units;
    const scope = findScope(tableLines, tableRowIndex);
    const tableScope = scope.scope;
    const exactRow = lines[rowIndex];
    const labelOffset = exactRow.indexOf(row.label);
    const afterLabel = labelOffset >= 0 ? exactRow.slice(labelOffset + row.label.length) : exactRow;
    const values = extractReportNumberValues(afterLabel);
    // Notes, missing cells, percentages and narrative prose invalidate positional
    // alignment. Never shift periods to make the number count fit.
    const residue = afterLabel.replace(/(?:\(\s*)?[-+−–]?\d+(?:[\s\u00a0\u202f.,]\d+)*(?:\s*\))?/g, "").trim();
    const numericTableRow = !/[A-Za-zÆØÅæøå%]/.test(residue) && !/(?:^|\s)[–—-](?:\s|$)/.test(residue) && !/\b(?:was|were|is|are|grew|fell|increased|decreased|amounted|var|ble|økte|falt|utgjorde)\b/i.test(row.label);
    const aligned = numericTableRow && header.periods.length > 0 && values.length === header.periods.length && new Set(header.periods.map((period) => period.id)).size === header.periods.length;
    for (const [index, rawValue] of values.entries()) {
      const parsed = parseNumber(rawValue);
      const period = aligned ? header.periods[index] : null;
      const unresolved: string[] = [];
      if (parsed.issue) unresolved.push(parsed.issue);
      if (!aligned) unresolved.push("column_alignment_unresolved");
      if (!period || period.kind === "unspecified") unresolved.push("period_unresolved");
      if (!units.currency) unresolved.push("currency_unresolved");
      if (!units.scale) unresolved.push("scale_unresolved");
      if (!tableScope) unresolved.push("table_scope_unresolved");
      const comparisons = period && period.kind !== "unspecified" ? header.periods.filter((other) => other.kind === period.kind && other.year === period.year - 1 && other.quarter === period.quarter && other.half === period.half) : [];
      facts.push({
        metric: row.metric,
        label: row.label,
        rawValue,
        numericValue: parsed.value,
        currency: units.currency,
        scale: units.scale,
        period,
        comparisonPeriodId: comparisons.length === 1 ? comparisons[0].id : null,
        tableScope,
        pageNumber: row.pageNumber,
        rowNumber: rowIndex + 1,
        rowText: exactRow,
        headerText: [...new Set([...scope.text, ...units.text, ...header.text])],
        usable: unresolved.length === 0,
        unresolved
      });
    }
  }
  return facts;
}

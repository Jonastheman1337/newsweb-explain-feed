/** Source selection preserves original text; it never interprets numeric columns. */
export function isPdfContentsPage(text: string): boolean {
  return /(?:^|\n)\s*(?:table of contents|contents|innholdsfortegnelse|innhold)\s*(?:\n|$)/i.test(text);
}
export function isIncomeStatementPage(text: string): boolean {
  if (isPdfContentsPage(text)) return false;
  const lines = text.split(/\r?\n/).slice(0, 12);
  const headings = lines.map((_, index) => lines.slice(index, index + 5).join(" ").replace(/\s+/g, " ").trim());
  return headings.some(heading => /^(?:(?:unaudited|condensed|consolidated|interim|group)\s+)*(?:statements? of profit (?:or|and) loss|income statements?|resultatregnskap)(?=\s*(?:$|\(|in\b|note\b|20\d{2}|june\b))/i.test(heading))
    && /(?:revenue|operating (?:profit|income)|result from operating|driftsinntekter|driftsresultat|omsetning)/i.test(text)
    && /\d[\d,.]*\s+\(?\d/.test(text);
}
export function isStatementContinuation(text: string): boolean {
  return /^\s*(?:attributable to|earnings per share|basic earnings|resultat per aksje)/i.test(text);
}
export function pdfInstructionTerms(instruction = ""): string[] {
  const terms = [...new Set(instruction.toLowerCase().match(/[\p{L}]{4,}/gu) ?? [])];
  const stop = new Set(["this", "that", "with", "from", "please", "report", "interesting", "already", "known", "focus", "attached", "statement", "unaudited", "condensed", "consolidated", "interim"]);
  // Keep the full bounded instruction, including a section named at the end.
  return terms.filter(term => !stop.has(term)).slice(-80);
}
/** Zero-based indexes in priority order, including source continuations. */
export function selectPdfSourcePages(pages: string[], instruction = ""): number[] {
  const selected = new Set<number>();
  const add = (index: number) => { if (index >= 0 && index < pages.length && pages[index].trim()) selected.add(index); };
  const statements = pages.flatMap((text, index) => isIncomeStatementPage(text) ? [index] : []);
  const incomeRequested = /profit\s*(?:\/|or|and)\s*loss|income statement|resultatregnskap/i.test(instruction);
  for (const match of instruction.matchAll(/\b(?:page|side|p\.)\s*(\d{1,4})\b/gi)) {
    const index = Number(match[1]) - 1; add(index); add(index + 1);
  }
  const addStatements = () => { for (const index of statements) { add(index); if (isStatementContinuation(pages[index + 1] ?? "")) add(index + 1); } };
  if (incomeRequested || !instruction.trim()) addStatements();
  const terms = pdfInstructionTerms(instruction);
  const scores = pages.map((text, index) => ({ index, score: isPdfContentsPage(text) ? 0 : terms.reduce((n, term) => n + Number(text.toLowerCase().includes(term)), 0) }));
  for (const row of scores.filter(row => row.score >= 2).sort((a,b) => b.score-a.score).slice(0, 3)) { add(row.index); add(row.index + 1); }
  addStatements();
  for (let index=0; index<pages.length; index++) add(index);
  return [...selected];
}
export function packPdfSourcePages(pages: string[], indexes: number[], budget: number): string {
  const parts: string[] = [];
  let remaining = budget;
  for (const index of indexes) {
    const text = pages[index]?.trim(); if (!text) continue;
    const prefix = `[PDF page ${index + 1}]\n`;
    const marker = "\n[... PDF-utdrag avkortet ...]";
    const separator = parts.length ? 2 : 0;
    if (remaining <= prefix.length + marker.length + separator) break;
    const available = remaining - prefix.length - separator;
    const body = text.length <= available ? text : text.slice(0, available - marker.length) + marker;
    parts.push(prefix + body); remaining -= prefix.length + body.length + separator;
    if (body !== text) break;
  }
  return parts.join("\n\n");
}

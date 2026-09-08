/** Blank-line separated paragraphs, trimmed, without empties. */
export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export type PdfPageSection = { page: number | null; paragraphs: string[] };

/**
 * Split the worker's PDF context on its `[PDF page N]` marker lines. Text
 * before the first marker (key metrics, section labels) becomes a section
 * without a page number. Sections with no text are dropped.
 */
export function splitPdfPages(text: string): PdfPageSection[] {
  const sections: PdfPageSection[] = [];
  let page: number | null = null;
  let lines: string[] = [];
  const flush = () => {
    // The worker separates its context sections with a bare "---" line.
    const paragraphs = splitParagraphs(lines.join("\n")).filter((paragraph) => !/^-{3,}$/.test(paragraph));
    if (paragraphs.length) sections.push({ page, paragraphs });
    lines = [];
  };
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const marker = /^\s*\[PDF page (\d+)\]\s*$/.exec(line);
    if (marker) {
      flush();
      page = Number(marker[1]);
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

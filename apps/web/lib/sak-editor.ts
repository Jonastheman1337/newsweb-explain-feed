import { sakMaterialSourceId, type SakArticle, type SakEditedArticle, type SakMaterial } from "@newsweb/shared";
import { sanitizeRichHtml } from "./rich-text";

/** Restore source markers from the edited DOM, preserving paragraph types. */
export function sakEditedArticleFromHtml(title: string, html: string, materials: Pick<SakMaterial, "id" | "url">[]): SakEditedArticle {
  const doc = new DOMParser().parseFromString(sanitizeRichHtml(html), "text/html");
  const sources = new Map<string, string>();
  for (const item of materials) {
    try { if (item.url) sources.set(new URL(item.url).href, sakMaterialSourceId(item.id)); } catch { /* failed URL material */ }
  }
  for (const br of Array.from(doc.querySelectorAll("br"))) br.replaceWith(doc.createTextNode("\n"));
  for (const anchor of Array.from(doc.querySelectorAll("a[href]"))) {
    const label = anchor.textContent ?? "";
    let source: string | undefined;
    try { source = sources.get(new URL(anchor.getAttribute("href")!).href); } catch { /* rendered as ordinary text */ }
    if (!source) throw new Error(`Lenken «${label}» er ikke blant kildene. Legg lenken til som kilde før du reviderer.`);
    if (label.length > 80 || /[[\]|]/.test(label)) throw new Error(`Kort ned lenketeksten «${label.slice(0,40)}» før du reviderer (maks 80 tegn).`);
    anchor.replaceWith(doc.createTextNode(`[[${label}|${source}]]`));
  }
  const parts = Array.from(doc.body.children).flatMap((element) => {
    if (element.matches("ul,ol")) return Array.from(element.querySelectorAll("li")).map((item) => ({ kind: "paragraph" as const, text: item.textContent?.trim() ?? "" }));
    const text = (element.textContent ?? "").trim();
    return [{ kind: element.tagName === "H3" ? "subheading" as const : /^\s*[–—-]\s/.test(text) ? "quote" as const : "paragraph" as const, text }];
  }).filter((item) => item.text);
  return { title: title.trim(), lead: parts[0]?.text ?? "", blocks: parts.slice(1) };
}

export type SakTextChange = { kind: "same" | "added" | "removed"; text: string };
export function sakArticleChanges(before: Pick<SakArticle, "title" | "lead" | "blocks">, after: Pick<SakArticle, "title" | "lead" | "blocks">): SakTextChange[] {
  const lines = (article: typeof before) => [article.title, article.lead, ...article.blocks.map((block) => block.text)];
  const a = lines(before), b = lines(after);
  const counts = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) counts[i]![j] = a[i] === b[j] ? 1 + counts[i + 1]![j + 1]! : Math.max(counts[i + 1]![j]!, counts[i]![j + 1]!);
  const changes: SakTextChange[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { changes.push({ kind: "same", text: a[i++]! }); j++; }
    else if (i < a.length && (j === b.length || counts[i + 1]![j]! >= counts[i]![j + 1]!)) changes.push({ kind: "removed", text: a[i++]! });
    else changes.push({ kind: "added", text: b[j++]! });
  }
  return changes;
}

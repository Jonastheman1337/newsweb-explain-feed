import {
  AI_DISCLOSURE_LINK_HREF,
  AI_DISCLOSURE_LINK_TEXT,
  AI_DISCLOSURE_TEXT
} from "./ai-disclosure";

const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

export function plainTextToRichHtml(text: string): string {
  const blocks = text.split(/\n{2,}/).filter((block) => block.length > 0);
  if (!blocks.length) return "";

  return blocks
    .map(
      (block) =>
        `<p>${escapeHtml(block).replace(/\r?\n/g, "<br>")}</p>`
    )
    .join("");
}

export function normalizePastedTitle(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function normalizeLinkHref(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    if (!ALLOWED_LINK_PROTOCOLS.has(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function appendCleanChildren(source: Node, target: Node, doc: Document) {
  for (const child of Array.from(source.childNodes)) {
    const clean = cleanNode(child, doc);
    if (clean) {
      target.appendChild(clean);
    }
  }
}

function appendCleanFlowChildren(source: Node, target: Node, doc: Document) {
  let paragraph: HTMLParagraphElement | null = null;

  function flushParagraph() {
    if (paragraph && nodeHasContent(paragraph)) {
      target.appendChild(paragraph);
    }
    paragraph = null;
  }

  function appendFlowNode(clean: Node) {
    if (clean.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      for (const child of Array.from(clean.childNodes)) {
        appendFlowNode(child);
      }
      return;
    }

    if (isBlockElement(clean)) {
      flushParagraph();
      target.appendChild(clean);
      return;
    }

    if (!paragraph) {
      paragraph = doc.createElement("p");
    }
    paragraph.appendChild(clean);
  }

  for (const child of Array.from(source.childNodes)) {
    const clean = cleanNode(child, doc);
    if (clean) {
      appendFlowNode(clean);
    }
  }

  flushParagraph();
}

function appendCleanListChild(clean: Node, list: HTMLElement, doc: Document) {
  if (
    clean.nodeType === Node.ELEMENT_NODE &&
    (clean as Element).tagName.toLowerCase() === "li"
  ) {
    list.appendChild(clean);
    return;
  }

  if (clean.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    for (const child of Array.from(clean.childNodes)) {
      appendCleanListChild(child, list, doc);
    }
    return;
  }

  const item = doc.createElement("li");
  item.appendChild(clean);
  if (nodeHasContent(item)) {
    list.appendChild(item);
  }
}

function hasBoldStyle(element: Element): boolean {
  const fontWeight = (element as HTMLElement).style.fontWeight.trim().toLowerCase();
  if (fontWeight === "bold" || fontWeight === "bolder") return true;

  const numericWeight = Number(fontWeight);
  return Number.isFinite(numericWeight) && numericWeight >= 600;
}

function hasItalicStyle(element: Element): boolean {
  const fontStyle = (element as HTMLElement).style.fontStyle.trim().toLowerCase();
  return fontStyle === "italic" || fontStyle === "oblique";
}

function cleanStyledInline(element: Element, doc: Document): Node | null {
  const fragment = doc.createDocumentFragment();
  appendCleanChildren(element, fragment, doc);
  if (!fragment.childNodes.length) return null;

  let clean: Node = fragment;
  if (hasItalicStyle(element)) {
    const em = doc.createElement("em");
    em.appendChild(clean);
    clean = em;
  }

  if (hasBoldStyle(element)) {
    const strong = doc.createElement("strong");
    strong.appendChild(clean);
    clean = strong;
  }

  return nodeHasContent(clean) ? clean : null;
}

function cleanNode(node: Node, doc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return doc.createTextNode(node.textContent ?? "");
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const element = node as Element;
  const tag = element.tagName.toLowerCase();

  if (tag === "script" || tag === "style" || tag === "iframe") {
    return null;
  }

  if (tag === "br") {
    return doc.createElement("br");
  }

  if (tag === "strong" || tag === "b") {
    const strong = doc.createElement("strong");
    appendCleanChildren(element, strong, doc);
    return nodeHasContent(strong) ? strong : null;
  }

  if (tag === "em" || tag === "i") {
    const em = doc.createElement("em");
    appendCleanChildren(element, em, doc);
    return nodeHasContent(em) ? em : null;
  }

  if (tag === "a") {
    const href = normalizeLinkHref(element.getAttribute("href") ?? "");
    const fragment = doc.createDocumentFragment();
    appendCleanChildren(element, fragment, doc);
    if (!href) return fragment;

    const anchor = doc.createElement("a");
    anchor.setAttribute("href", href);
    anchor.appendChild(fragment);
    return nodeHasContent(anchor) ? anchor : null;
  }

  if (tag === "span") {
    return cleanStyledInline(element, doc);
  }

  if (tag === "ul" || tag === "ol") {
    const list = doc.createElement(tag);
    for (const child of Array.from(element.childNodes)) {
      const clean = cleanNode(child, doc);
      if (clean) {
        appendCleanListChild(clean, list, doc);
      }
    }
    return list.children.length ? list : null;
  }

  if (tag === "li") {
    const item = doc.createElement("li");
    appendCleanChildren(element, item, doc);
    return nodeHasContent(item) ? item : null;
  }

  if (tag === "p" || tag === "div") {
    const fragment = doc.createDocumentFragment();
    appendCleanFlowChildren(element, fragment, doc);
    return fragment.childNodes.length ? fragment : null;
  }

  // Subheadings (sak articles). Every heading level collapses to <h3>; the
  // notice flow never produces headings, so it is unaffected.
  if (tag === "h2" || tag === "h3" || tag === "h4") {
    const heading = doc.createElement("h3");
    appendCleanChildren(element, heading, doc);
    return nodeHasContent(heading) ? heading : null;
  }

  const fragment = doc.createDocumentFragment();
  appendCleanChildren(element, fragment, doc);
  return fragment.childNodes.length ? fragment : null;
}

function nodeHasContent(node: Node): boolean {
  if ((node.textContent ?? "").trim()) return true;

  if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    return Array.from(node.childNodes).some((child) => {
      if (child.nodeType !== Node.ELEMENT_NODE) return false;
      return (child as Element).tagName.toLowerCase() === "br" || nodeHasContent(child);
    });
  }

  return false;
}

function isBlockElement(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const tag = (node as Element).tagName.toLowerCase();
  return tag === "p" || tag === "ul" || tag === "ol" || tag === "h3";
}

function normalizeRoot(container: HTMLElement, doc: Document): string {
  const normalized = doc.createElement("div");
  let paragraph: HTMLParagraphElement | null = null;

  function flushParagraph() {
    if (paragraph && nodeHasContent(paragraph)) {
      normalized.appendChild(paragraph);
    }
    paragraph = null;
  }

  for (const node of Array.from(container.childNodes)) {
    if (!nodeHasContent(node)) continue;

    if (isBlockElement(node)) {
      flushParagraph();
      normalized.appendChild(node);
      continue;
    }

    if (!paragraph) {
      paragraph = doc.createElement("p");
    }
    paragraph.appendChild(node);
  }

  flushParagraph();
  return normalized.innerHTML;
}

export function sanitizeRichHtml(html: string): string {
  if (typeof document === "undefined") {
    return plainTextToRichHtml(stripTags(html));
  }

  const template = document.createElement("template");
  template.innerHTML = html;
  const cleaned = document.createElement("div");
  appendCleanChildren(template.content, cleaned, document);
  return normalizeRoot(cleaned, document);
}

function unwrapElement(element: Element) {
  const parent = element.parentNode;
  if (!parent) return;

  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }
  parent.removeChild(element);
}

/**
 * Keep useful structure and links when text is pasted into the editor, but do
 * not import emphasis inherited from the source page. Editors can still add
 * bold and italic deliberately with the local formatting toolbar afterwards.
 */
export function sanitizePastedRichHtml(html: string): string {
  const safeHtml = sanitizeRichHtml(html);
  if (typeof document === "undefined") {
    return safeHtml;
  }

  const template = document.createElement("template");
  template.innerHTML = safeHtml;
  for (const element of Array.from(template.content.querySelectorAll("strong, em"))) {
    unwrapElement(element);
  }

  return sanitizeRichHtml(template.innerHTML);
}

export type RichHtmlToPlainTextOptions = {
  // Render <a href> as "text (href)" so links survive a plain-text paste.
  linkUrls?: boolean;
};

function inlineText(node: Node, options: RichHtmlToPlainTextOptions): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (tag === "br") {
    return "\n";
  }

  const text = Array.from(element.childNodes)
    .map((child) => inlineText(child, options))
    .join("");

  if (tag === "a" && options.linkUrls) {
    const href = element.getAttribute("href");
    if (href && text.trim()) {
      return `${text} (${href})`;
    }
  }

  return text;
}

function blockText(
  node: Node,
  options: RichHtmlToPlainTextOptions,
  orderedIndex?: number
): string {
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return inlineText(node, options).trim();
  }

  const element = node as Element;
  const tag = element.tagName.toLowerCase();

  if (tag === "ul" || tag === "ol") {
    return Array.from(element.children)
      .filter((child) => child.tagName.toLowerCase() === "li")
      .map((child, index) =>
        blockText(child, options, tag === "ol" ? index + 1 : undefined)
      )
      .filter(Boolean)
      .join("\n");
  }

  if (tag === "li") {
    const prefix = orderedIndex == null ? "- " : `${orderedIndex}. `;
    return `${prefix}${inlineText(element, options).trim()}`;
  }

  return inlineText(element, options).trim();
}

export function richHtmlToPlainText(
  html: string,
  options: RichHtmlToPlainTextOptions = {}
): string {
  if (typeof document === "undefined") {
    return stripTags(html).trim();
  }

  const template = document.createElement("template");
  template.innerHTML = sanitizeRichHtml(html);
  return Array.from(template.content.childNodes)
    .map((node) => blockText(node, options))
    .filter(Boolean)
    .join("\n\n");
}

export function createAiDisclosureHtml(): string {
  return `<p><em>${escapeHtml(AI_DISCLOSURE_TEXT)}<a href="${AI_DISCLOSURE_LINK_HREF}">${escapeHtml(
    AI_DISCLOSURE_LINK_TEXT
  )}</a>.</em></p>`;
}

export function createNoticeClipboardHtml(title: string, bodyHtml: string): string {
  return `<article><h2>${escapeHtml(title)}</h2>${sanitizeRichHtml(
    bodyHtml
  )}${createAiDisclosureHtml()}</article>`;
}

/**
 * Clipboard payload for a /sak article: title + body with <h3> subheads and
 * <a href> links kept, and a plain-text twin that writes links as
 * "tekst (url)". No AI disclosure; the desk adds its own footer.
 */
export function createSakClipboard(
  title: string,
  bodyHtml: string
): { html: string; text: string } {
  const sanitized = sanitizeRichHtml(bodyHtml);
  const body = richHtmlToPlainText(sanitized, { linkUrls: true });
  return {
    html: `<article><h2>${escapeHtml(title)}</h2>${sanitized}</article>`,
    text: [title.trim(), body].filter(Boolean).join("\n\n")
  };
}

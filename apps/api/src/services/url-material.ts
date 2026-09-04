import dns from "node:dns";
import { isIP } from "node:net";
import { htmlToText } from "html-to-text";
import {
  extractPdfMaterialText,
  sanitizeMaterialTitle,
  truncateMaterialText
} from "./notice-materials.js";
import { SAK_MAX_MATERIAL_TEXT_CHARS } from "./sak-materials.js";

/**
 * Server-side URL → text for /sak materials. Reads public web pages and PDFs
 * only; anything that resolves to a private or link-local address is refused
 * before a byte is fetched (the API runs next to Redis, Postgres and the
 * cloud metadata endpoint). Paywalls and blocks come back as a plain
 * failure the user answers by pasting the text instead.
 */

export const URL_MATERIAL_TIMEOUT_MS = 15_000;
export const URL_MATERIAL_MAX_BYTES = 5 * 1024 * 1024;
export const URL_MATERIAL_MAX_REDIRECTS = 5;
export const URL_MATERIAL_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 autoweb24-sak/1.0";

export const PAYWALL_MESSAGE =
  "Klarte ikke å hente lesbar tekst fra lenken (betalingsmur eller blokkering). Lim inn teksten som tekstmateriale i stedet.";
export const TIMEOUT_MESSAGE = "Tidsavbrudd (15 s) ved henting av lenken. Lim inn teksten i stedet.";
export const TOO_LARGE_MESSAGE = "Lenken peker til en fil som er større enn 5 MB.";
export const BLOCKED_HOST_MESSAGE = "Lenken peker til en intern eller privat adresse og kan ikke hentes.";
export const INVALID_URL_MESSAGE = "Ugyldig lenke. Bruk en full http- eller https-adresse.";
export const UNSUPPORTED_TYPE_MESSAGE = "Lenken peker ikke til en nettside eller en PDF.";
export const EXTRACT_FAILED_MESSAGE =
  "Klarte ikke å lese teksten i dokumentet. Lim inn teksten som tekstmateriale i stedet.";

export type UrlMaterialErrorCode =
  | "invalid_url"
  | "blocked_host"
  | "timeout"
  | "too_large"
  | "http_error"
  | "unsupported_type"
  | "thin_or_paywalled"
  | "extract_failed";

export type UrlMaterialSuccess = {
  ok: true;
  title: string;
  text: string;
  finalUrl: string;
  contentType: "html" | "pdf";
  pageCount?: number;
};

export type UrlMaterialFailure = {
  ok: false;
  errorCode: UrlMaterialErrorCode;
  errorText: string;
};

export type UrlMaterialResult = UrlMaterialSuccess | UrlMaterialFailure;

export type UrlLookup = (
  hostname: string
) => Promise<Array<{ address: string; family: number }>>;

export type FetchUrlMaterialDeps = {
  fetchImpl?: typeof fetch;
  lookup?: UrlLookup;
  extractPdf?: (
    buffer: Buffer,
    options?: { maxChars?: number }
  ) => Promise<{ text: string; pageCount: number }>;
  timeoutMs?: number;
  maxBytes?: number;
  maxChars?: number;
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const PAYWALL_PATTERN =
  /abonner|abonnement|kun for abonnenter|logg inn for å lese|subscribe to (?:continue|read)|subscription required|for subscribers only/i;

const THIN_TEXT_CHARS = 400;
const PAYWALL_SUSPECT_CHARS = 2000;

const defaultLookup: UrlLookup = (hostname) =>
  dns.promises.lookup(hostname, { all: true, verbatim: true });

function failure(errorCode: UrlMaterialErrorCode, errorText: string): UrlMaterialFailure {
  return { ok: false, errorCode, errorText };
}

// ---------------------------------------------------------------------------
// Address policy
// ---------------------------------------------------------------------------

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }
  return octets;
}

function isBlockedIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // 127/8
  if (a === 169 && b === 254) return true; // 169.254/16 (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 (CGNAT)
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function expandIpv6(address: string): number[] | null {
  // Returns the eight 16-bit groups, or null when the literal is malformed.
  let value = address.toLowerCase();
  const zoneIndex = value.indexOf("%");
  if (zoneIndex >= 0) value = value.slice(0, zoneIndex);

  // Embedded dotted IPv4 tail (::ffff:10.0.0.1) → two hex groups.
  const dottedMatch = value.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dottedMatch) {
    const octets = parseIpv4(dottedMatch[2]);
    if (!octets) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    value = `${dottedMatch[1]}${high}:${low}`;
  }

  const halves = value.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const groups = [...head, ...tail];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  if (halves.length === 1 && groups.length !== 8) return null;
  if (halves.length === 2 && groups.length > 7) return null;
  const missing = 8 - groups.length;
  const expanded = [
    ...head.map((group) => parseInt(group, 16)),
    ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => 0),
    ...tail.map((group) => parseInt(group, 16))
  ];
  return expanded.length === 8 ? expanded : null;
}

/**
 * True for loopback, unspecified, link-local, unique-local, CGNAT, private
 * IPv4 ranges and their IPv4-mapped IPv6 forms. Unparseable literals count
 * as blocked: the fetch must never be the thing that finds out.
 */
export function isBlockedAddress(address: string): boolean {
  const trimmed = address.trim().replace(/^\[|\]$/g, "");
  const family = isIP(trimmed);
  if (family === 4) {
    const octets = parseIpv4(trimmed);
    return !octets || isBlockedIpv4(octets);
  }
  if (family !== 6) return true;

  const groups = expandIpv6(trimmed);
  if (!groups) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const allZero = groups.every((group) => group === 0);
  if (allZero) return true; // ::
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) {
    return true; // ::1
  }
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) addresses.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
    const octets = [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff];
    return isBlockedIpv4(octets);
  }
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

export function parsePublicHttpUrl(rawUrl: string): { ok: true; url: URL } | UrlMaterialFailure {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return failure("invalid_url", INVALID_URL_MESSAGE);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return failure("invalid_url", INVALID_URL_MESSAGE);
  }
  if (url.username || url.password) {
    return failure("invalid_url", INVALID_URL_MESSAGE);
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname) {
    return failure("invalid_url", INVALID_URL_MESSAGE);
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return failure("blocked_host", BLOCKED_HOST_MESSAGE);
  }
  return { ok: true, url };
}

export async function assertPublicHttpUrl(
  url: URL,
  lookup: UrlLookup = defaultLookup
): Promise<{ ok: true } | UrlMaterialFailure> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) {
    return isBlockedAddress(hostname)
      ? failure("blocked_host", BLOCKED_HOST_MESSAGE)
      : { ok: true };
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname);
  } catch {
    return failure("http_error", "Fant ikke nettstedet i lenken.");
  }
  if (addresses.length === 0) {
    return failure("http_error", "Fant ikke nettstedet i lenken.");
  }
  if (addresses.some((entry) => isBlockedAddress(entry.address))) {
    return failure("blocked_host", BLOCKED_HOST_MESSAGE);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// HTML → text
// ---------------------------------------------------------------------------

const SKIPPED_SELECTORS = [
  "script",
  "style",
  "noscript",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "iframe",
  "img",
  "svg",
  "video",
  "audio",
  "button",
  "template"
];

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  laquo: "«",
  raquo: "»",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  aring: "å",
  Aring: "Å",
  oslash: "ø",
  Oslash: "Ø",
  aelig: "æ",
  AElig: "Æ",
  eacute: "é"
};

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_match, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-zA-Z]+);/g, (match, name: string) => HTML_ENTITIES[name] ?? match);
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t ]+\n/g, "\n")
    .replace(/\n[ \t ]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlToArticleText(html: string): string {
  const baseSelector = /<article[\s>]/i.test(html)
    ? "article"
    : /<main[\s>]/i.test(html)
      ? "main"
      : "body";
  const text = htmlToText(html, {
    wordwrap: false,
    baseElements: {
      selectors: [baseSelector],
      returnDomByDefault: true
    },
    selectors: [
      { selector: "a", options: { ignoreHref: true } },
      ...["h1", "h2", "h3", "h4", "h5", "h6"].map((selector) => ({
        selector,
        options: { uppercase: false }
      })),
      ...SKIPPED_SELECTORS.map((selector) => ({ selector, format: "skip" }))
    ]
  });
  return normalizeExtractedText(text);
}

export function extractHtmlTitle(html: string): string | null {
  const head = html.slice(0, 200_000);
  const ogMatch =
    head.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i
    ) ??
    head.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["'][^>]*>/i
    );
  const candidate = ogMatch?.[1] ?? head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (!candidate) return null;
  const decoded = decodeHtmlEntities(candidate).replace(/\s+/g, " ").trim();
  return decoded || null;
}

export function detectThinOrPaywalled(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < THIN_TEXT_CHARS) return true;
  if (trimmed.length < PAYWALL_SUSPECT_CHARS && PAYWALL_PATTERN.test(trimmed)) return true;
  return false;
}

function charsetFromContentType(contentType: string | null): string | null {
  const match = contentType?.match(/charset=["']?([\w-]+)/i);
  return match?.[1] ?? null;
}

function charsetFromHtml(buffer: Buffer): string | null {
  const head = buffer.subarray(0, 4096).toString("latin1");
  const match =
    head.match(/<meta[^>]+charset=["']?([\w-]+)/i) ??
    head.match(/<meta[^>]+content=["'][^"']*charset=([\w-]+)/i);
  return match?.[1] ?? null;
}

function decodeBody(buffer: Buffer, contentType: string | null): string {
  const label = charsetFromContentType(contentType) ?? charsetFromHtml(buffer) ?? "utf-8";
  try {
    return new TextDecoder(label).decode(buffer);
  } catch {
    return buffer.toString("utf8");
  }
}

function looksLikePdf(url: URL, contentType: string | null, buffer: Buffer): boolean {
  if (contentType?.toLowerCase().includes("application/pdf")) return true;
  if (/\.pdf$/i.test(url.pathname)) return true;
  return buffer.subarray(0, 5).toString("latin1") === "%PDF-";
}

function looksLikeHtml(contentType: string | null, buffer: Buffer): boolean {
  const lowered = contentType?.toLowerCase() ?? "";
  if (lowered.includes("text/html") || lowered.includes("application/xhtml")) return true;
  if (lowered.includes("text/plain")) return true;
  if (lowered && !lowered.startsWith("text/") && !lowered.includes("xml")) return false;
  const head = buffer.subarray(0, 512).toString("latin1");
  return /<(?:!doctype|html|head|body|article|main|div|p)[\s>]/i.test(head);
}

function pdfTitleFromUrl(url: URL): string {
  const last = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
  return sanitizeMaterialTitle(last.replace(/\.pdf$/i, ""), url.hostname);
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

async function readBodyWithLimit(
  response: Response,
  maxBytes: number
): Promise<Buffer | "too_large"> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return "too_large";
  }
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length > maxBytes ? "too_large" : buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return "too_large";
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function fetchUrlMaterial(
  rawUrl: string,
  deps: FetchUrlMaterialDeps = {}
): Promise<UrlMaterialResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const lookup = deps.lookup ?? defaultLookup;
  const extractPdf = deps.extractPdf ?? extractPdfMaterialText;
  const timeoutMs = deps.timeoutMs ?? URL_MATERIAL_TIMEOUT_MS;
  const maxBytes = deps.maxBytes ?? URL_MATERIAL_MAX_BYTES;
  const maxChars = deps.maxChars ?? SAK_MAX_MATERIAL_TEXT_CHARS;

  const parsed = parsePublicHttpUrl(rawUrl);
  if (!parsed.ok) return parsed;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let current = parsed.url;
    let response: Response | null = null;

    for (let hop = 0; hop <= URL_MATERIAL_MAX_REDIRECTS; hop += 1) {
      const policy = await assertPublicHttpUrl(current, lookup);
      if (!policy.ok) return policy;

      response = await fetchImpl(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": URL_MATERIAL_USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5",
          "Accept-Language": "nb-NO,nb;q=0.9,no;q=0.8,en;q=0.5"
        }
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          return failure("http_error", `Lenken svarte med HTTP ${response.status} uten mål.`);
        }
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          return failure("invalid_url", INVALID_URL_MESSAGE);
        }
        const nextParsed = parsePublicHttpUrl(next.toString());
        if (!nextParsed.ok) return nextParsed;
        current = nextParsed.url;
        response = null;
        continue;
      }
      break;
    }

    if (!response) {
      return failure("http_error", "For mange omdirigeringer.");
    }

    if (response.status === 401 || response.status === 403 || response.status === 429) {
      return failure("thin_or_paywalled", `${PAYWALL_MESSAGE} (HTTP ${response.status})`);
    }
    if (!response.ok) {
      return failure("http_error", `Lenken svarte med HTTP ${response.status}.`);
    }

    const body = await readBodyWithLimit(response, maxBytes);
    if (body === "too_large") {
      return failure("too_large", TOO_LARGE_MESSAGE);
    }

    const contentType = response.headers.get("content-type");
    const finalUrl = current.toString();

    if (looksLikePdf(current, contentType, body)) {
      let extracted: { text: string; pageCount: number };
      try {
        extracted = await extractPdf(body, { maxChars });
      } catch {
        return failure("extract_failed", EXTRACT_FAILED_MESSAGE);
      }
      const text = extracted.text.trim();
      if (!text) {
        return failure("extract_failed", EXTRACT_FAILED_MESSAGE);
      }
      return {
        ok: true,
        title: pdfTitleFromUrl(current),
        text,
        finalUrl,
        contentType: "pdf",
        pageCount: extracted.pageCount
      };
    }

    if (!looksLikeHtml(contentType, body)) {
      return failure("unsupported_type", UNSUPPORTED_TYPE_MESSAGE);
    }

    const html = decodeBody(body, contentType);
    const isPlainText = contentType?.toLowerCase().includes("text/plain") ?? false;
    const text = truncateMaterialText(
      isPlainText ? normalizeExtractedText(html) : htmlToArticleText(html),
      maxChars
    );
    if (detectThinOrPaywalled(text)) {
      return failure("thin_or_paywalled", PAYWALL_MESSAGE);
    }
    const title = sanitizeMaterialTitle(
      (isPlainText ? null : extractHtmlTitle(html)) ?? current.hostname,
      current.hostname
    );
    return { ok: true, title, text, finalUrl, contentType: "html" };
  } catch (error) {
    if (isAbortError(error)) {
      return failure("timeout", TIMEOUT_MESSAGE);
    }
    const detail = error instanceof Error ? error.message : String(error);
    return failure("http_error", `Klarte ikke å hente lenken (${detail}).`);
  } finally {
    clearTimeout(timer);
  }
}

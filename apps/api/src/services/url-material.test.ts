import { describe, expect, it, vi } from "vitest";
import {
  BLOCKED_HOST_MESSAGE,
  PAYWALL_MESSAGE,
  TIMEOUT_MESSAGE,
  decodeHtmlEntities,
  detectThinOrPaywalled,
  extractHtmlTitle,
  fetchUrlMaterial,
  htmlToArticleText,
  isBlockedAddress,
  parsePublicHttpUrl,
  type UrlLookup
} from "./url-material.js";

const PUBLIC_LOOKUP: UrlLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const PRIVATE_LOOKUP: UrlLookup = async () => [{ address: "10.0.0.7", family: 4 }];

function htmlPage(body: string, title = "Testside"): string {
  return `<!doctype html><html><head><title>${title}</title><meta property="og:title" content="OG-tittel &amp; mer"></head><body><nav>Meny Meny</nav><script>var x = 1;</script><article>${body}</article><footer>Bunntekst</footer></body></html>`;
}

function longParagraphs(count = 12): string {
  return Array.from(
    { length: count },
    (_, index) =>
      `<p>Avsnitt ${index + 1}: Norges Bank holdt renten uendret på rentemøtet, og komiteen mente det fortsatt kunne bli nødvendig å heve renten senere i år.</p>`
  ).join("");
}

function response(
  body: BodyInit | null,
  init: { status?: number; headers?: Record<string, string> } = {}
): Response {
  return new Response(body, { status: init.status ?? 200, headers: init.headers ?? {} });
}

describe("isBlockedAddress", () => {
  it("rejects private, loopback, link-local and CGNAT IPv4 ranges", () => {
    for (const address of [
      "169.254.169.254",
      "10.0.0.1",
      "127.0.0.1",
      "0.0.0.0",
      "172.16.5.5",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "100.127.255.255",
      "255.255.255.255"
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("allows public IPv4 and IPv6 addresses", () => {
    for (const address of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "100.128.0.1", "2606:4700::1111"]) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it("rejects IPv6 loopback, unique-local, link-local and mapped private IPv4", () => {
    for (const address of [
      "::1",
      "::",
      "::ffff:10.0.0.1",
      "::ffff:169.254.169.254",
      "::ffff:a9fe:a9fe",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "FE80::abcd%eth0",
      "ff02::1"
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
    expect(isBlockedAddress("::ffff:8.8.8.8")).toBe(false);
  });

  it("treats unparseable literals as blocked", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
  });
});

describe("parsePublicHttpUrl", () => {
  it("accepts http and https only", () => {
    expect(parsePublicHttpUrl("https://e24.no/artikkel").ok).toBe(true);
    expect(parsePublicHttpUrl("ftp://e24.no/fil")).toMatchObject({ ok: false, errorCode: "invalid_url" });
    expect(parsePublicHttpUrl("ikke en lenke")).toMatchObject({ ok: false, errorCode: "invalid_url" });
  });

  it("rejects userinfo and localhost", () => {
    expect(parsePublicHttpUrl("https://user:pw@e24.no/")).toMatchObject({ ok: false, errorCode: "invalid_url" });
    expect(parsePublicHttpUrl("http://localhost:4000/")).toMatchObject({ ok: false, errorCode: "blocked_host" });
    expect(parsePublicHttpUrl("http://api.localhost/")).toMatchObject({ ok: false, errorCode: "blocked_host" });
  });
});

describe("fetchUrlMaterial", () => {
  it("blocks hosts that resolve to private addresses before fetching", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchUrlMaterial("https://intern.example.com/side", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: PRIVATE_LOOKUP
    });
    expect(result).toEqual({ ok: false, errorCode: "blocked_host", errorText: BLOCKED_HOST_MESSAGE });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks IP literals directly", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchUrlMaterial("http://169.254.169.254/latest/meta-data", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: PUBLIC_LOOKUP
    });
    expect(result).toMatchObject({ ok: false, errorCode: "blocked_host" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("re-validates every redirect hop and stops at a private target", async () => {
    const fetchImpl = vi.fn(async () =>
      response(null, { status: 302, headers: { location: "http://10.0.0.1/hemmelig" } })
    );
    const result = await fetchUrlMaterial("https://e24.no/redir", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: PUBLIC_LOOKUP
    });
    expect(result).toMatchObject({ ok: false, errorCode: "blocked_host" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("follows public redirects and reports the final url", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith("/redir")
        ? response(null, { status: 301, headers: { location: "/endelig" } })
        : response(htmlPage(longParagraphs()), { headers: { "content-type": "text/html; charset=utf-8" } })
    );
    const result = await fetchUrlMaterial("https://e24.no/redir", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: PUBLIC_LOOKUP
    });
    expect(result).toMatchObject({ ok: true, finalUrl: "https://e24.no/endelig", contentType: "html" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("honours the abort signal as a timeout", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        })
    );
    const result = await fetchUrlMaterial("https://e24.no/treg", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: PUBLIC_LOOKUP,
      timeoutMs: 20
    });
    expect(result).toEqual({ ok: false, errorCode: "timeout", errorText: TIMEOUT_MESSAGE });
  });

  it("rejects a declared content-length above the cap", async () => {
    const fetchImpl = vi.fn(async () =>
      response("x", { headers: { "content-length": String(6 * 1024 * 1024), "content-type": "text/html" } })
    );
    const result = await fetchUrlMaterial("https://e24.no/stor", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: PUBLIC_LOOKUP
    });
    expect(result).toMatchObject({ ok: false, errorCode: "too_large" });
  });

  it("aborts a streaming body that grows past the cap", async () => {
    const fetchImpl = vi.fn(async () =>
      response("y".repeat(5000), { headers: { "content-type": "text/html" } })
    );
    const result = await fetchUrlMaterial("https://e24.no/strom", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: PUBLIC_LOOKUP,
      maxBytes: 100
    });
    expect(result).toMatchObject({ ok: false, errorCode: "too_large" });
  });

  it("extracts PDFs through the injected extractor", async () => {
    const fetchImpl = vi.fn(async () =>
      response(Buffer.from("%PDF-1.7 binary"), { headers: { "content-type": "application/pdf" } })
    );
    const extractPdf = vi.fn(async () => ({ text: "Rapporttekst fra PDF", pageCount: 3 }));
    const result = await fetchUrlMaterial("https://danskebank.com/Nordic%20Outlook.pdf", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: PUBLIC_LOOKUP,
      extractPdf
    });
    expect(result).toEqual({
      ok: true,
      title: "Nordic Outlook",
      text: "Rapporttekst fra PDF",
      finalUrl: "https://danskebank.com/Nordic%20Outlook.pdf",
      contentType: "pdf",
      pageCount: 3
    });
    expect(extractPdf).toHaveBeenCalledWith(expect.any(Buffer), { maxChars: 60_000 });
  });

  it("maps 403 to the paywall failure with the status", async () => {
    const fetchImpl = vi.fn(async () => response("nei", { status: 403 }));
    const result = await fetchUrlMaterial("https://e24.no/betalt", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: PUBLIC_LOOKUP
    });
    expect(result).toEqual({
      ok: false,
      errorCode: "thin_or_paywalled",
      errorText: `${PAYWALL_MESSAGE} (HTTP 403)`
    });
  });

  it("reports thin pages as paywalled", async () => {
    const fetchImpl = vi.fn(async () =>
      response(htmlPage("<p>Denne saken er kun for abonnenter. Logg inn for å lese.</p>"), {
        headers: { "content-type": "text/html" }
      })
    );
    const result = await fetchUrlMaterial("https://e24.no/abonnent", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: PUBLIC_LOOKUP
    });
    expect(result).toEqual({ ok: false, errorCode: "thin_or_paywalled", errorText: PAYWALL_MESSAGE });
  });

  it("returns article text and the og:title for readable pages", async () => {
    const fetchImpl = vi.fn(async () =>
      response(htmlPage(longParagraphs()), { headers: { "content-type": "text/html; charset=utf-8" } })
    );
    const result = await fetchUrlMaterial("https://e24.no/norsk-oekonomi/i/abc/renten", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: PUBLIC_LOOKUP
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.title).toBe("OG-tittel & mer");
    expect(result.text).toContain("Avsnitt 1:");
    expect(result.text).not.toContain("Meny Meny");
    expect(result.text).not.toContain("var x");
    expect(result.text).not.toContain("Bunntekst");
  });

  it("rejects non-document content types", async () => {
    const fetchImpl = vi.fn(async () =>
      response(Buffer.from([0x89, 0x50, 0x4e, 0x47]), { headers: { "content-type": "image/png" } })
    );
    const result = await fetchUrlMaterial("https://e24.no/bilde.png", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: PUBLIC_LOOKUP
    });
    expect(result).toMatchObject({ ok: false, errorCode: "unsupported_type" });
  });
});

describe("htmlToArticleText", () => {
  it("prefers <article>, drops chrome and keeps link text without hrefs", () => {
    const text = htmlToArticleText(
      '<html><body><header>Topp</header><main><p>Utenfor</p></main><article><h2>Tittel</h2><p>Les <a href="https://x.no">mer her</a>.</p><aside>Side</aside></article></body></html>'
    );
    expect(text).toContain("Tittel");
    expect(text).toContain("Les mer her.");
    expect(text).not.toContain("https://x.no");
    expect(text).not.toContain("Topp");
    expect(text).not.toContain("Side");
    expect(text).not.toContain("Utenfor");
  });

  it("falls back to <main> and then <body>", () => {
    expect(htmlToArticleText("<body><nav>N</nav><main><p>Hoved</p></main></body>")).toBe("Hoved");
    expect(htmlToArticleText("<body><p>En</p><p>To</p></body>")).toBe("En\n\nTo");
  });
});

describe("title and paywall helpers", () => {
  it("extracts og:title before <title> and decodes entities", () => {
    expect(extractHtmlTitle(htmlPage("<p>x</p>"))).toBe("OG-tittel & mer");
    expect(extractHtmlTitle("<head><title>Bare &laquo;tittel&raquo;</title></head>")).toBe("Bare «tittel»");
    expect(extractHtmlTitle("<p>ingen</p>")).toBeNull();
    expect(decodeHtmlEntities("&#x41;&#66;&aring;")).toBe("ABå");
  });

  it("detects thin and paywalled text", () => {
    expect(detectThinOrPaywalled("kort")).toBe(true);
    expect(detectThinOrPaywalled(`${"a".repeat(600)} Kun for abonnenter`)).toBe(true);
    expect(detectThinOrPaywalled("b".repeat(2500))).toBe(false);
    expect(detectThinOrPaywalled(`${"c".repeat(2500)} abonnement`)).toBe(false);
  });
});

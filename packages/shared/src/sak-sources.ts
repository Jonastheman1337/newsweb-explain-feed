/** Identify the publication, not an interviewee quoted in its reporting. */
const PUBLICATIONS = [
  { name: "Bloomberg", domains: ["bloomberg.com"], aliases: ["Bloomberg"] },
  { name: "Reuters", domains: ["reuters.com"], aliases: ["Reuters"] },
  { name: "Financial Times", domains: ["ft.com"], aliases: ["Financial Times", "FT"] },
  { name: "Wall Street Journal", domains: ["wsj.com"], aliases: ["Wall Street Journal", "WSJ"] },
  { name: "New York Times", domains: ["nytimes.com"], aliases: ["New York Times", "NY Times"] },
  { name: "Business Insider", domains: ["businessinsider.com"], aliases: ["Business Insider"] },
  { name: "CNBC", domains: ["cnbc.com"], aliases: ["CNBC"] },
  { name: "Forbes", domains: ["forbes.com"], aliases: ["Forbes"] },
  { name: "NTB", domains: ["ntb.no"], aliases: ["NTB"] },
  { name: "Dagens Næringsliv", domains: ["dn.no"], aliases: ["Dagens Næringsliv"] },
  { name: "Finansavisen", domains: ["finansavisen.no"], aliases: ["Finansavisen"] },
  { name: "E24", domains: ["e24.no"], aliases: ["E24"] }
];

export function sakSourcePublisher(source: {
  title?: string; url?: string | null; text?: string; publisher?: string | null;
}): string | null {
  if (source.publisher?.trim()) return source.publisher.trim().slice(0, 120);
  let hostname = "";
  try { hostname = new URL(source.url ?? "").hostname.toLowerCase(); } catch { /* pasted source */ }
  // NTB distribution hosts issuer press releases, not NTB reporting.
  if (hostname === "kommunikasjon.ntb.no" || hostname === "via.ritzau.dk") return null;
  const title = source.title?.trim().toLowerCase() ?? "";
  const opening = (source.text ?? "").trim().slice(0, 180);
  for (const publication of PUBLICATIONS) {
    if (publication.domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`) || title === domain || title === `www.${domain}`)) return publication.name;
    if (publication.aliases.some((alias) => title === alias.toLowerCase())) return publication.name;
    // Datelines/bylines are evidence of the publisher; mentions in the
    // article body aren't. An editor can supply any other publication.
    if (new RegExp(`^(?:\\([^)]*\\b${publication.name}\\)|${publication.name}\\s*(?:[-–—:]|\\n))`, "i").test(opening)) return publication.name;
  }
  return null;
}

export function sakPublisherAliases(publisher: string): string[] {
  return PUBLICATIONS.find((item) => item.name === publisher)?.aliases ?? [publisher];
}

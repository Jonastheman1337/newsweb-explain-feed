import { describe, expect, it } from "vitest";
import { sakSourcePublisher } from "./sak-sources.js";
import { sakGenerateRequestSchema } from "./sak.js";

describe("Sak publication identity", () => {
  it("recognizes pasted Bloomberg reporting without a URL", () => {
    expect(sakSourcePublisher({ title: "Tekstmateriale", text: "(Bloomberg) -- A Bitcoin-linked blockchain has halted transactions." })).toBe("Bloomberg");
  });
  it("does not confuse an issuer press-release distributor with the publication", () => {
    expect(sakSourcePublisher({ url: "https://kommunikasjon.ntb.no/pressemelding/123", title: "Avinor åpner rute" })).toBeNull();
  });
  it("does not infer the publisher from a body mention or a lookalike domain", () => {
    expect(sakSourcePublisher({ url: "https://bloomberg.com.example.org/x", text: "The bank says Bloomberg reported the news yesterday." })).toBeNull();
  });
  it("retains an explicitly supplied publication for unfamiliar sources", () => {
    expect(sakSourcePublisher({ publisher: "Lokalavisen", text: "En ny sak" })).toBe("Lokalavisen");
  });
});
it("requires an explicit base version for edited copy", () => {
  const editedArticle = { title: "En ny sak", lead: "En redigert ingress", blocks: [{ kind: "paragraph", text: "En redigert brødtekst." }] };
  expect(sakGenerateRequestSchema.safeParse({ editedArticle }).success).toBe(false);
  expect(sakGenerateRequestSchema.safeParse({ baseVersionId: "v1", editedArticle }).success).toBe(true);
});

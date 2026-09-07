import { describe, expect, it } from "vitest";
import type { SakArticle } from "@newsweb/shared";
import type { SakPromptPayload } from "@newsweb/prompt-kit";
import { missingSakPublisherIssues, parseSakReferenceReview, sakReviewPassages, parseSakBrief } from "./sak-review.js";

const text = "(Bloomberg) -- Liquid Network issues L-BTC against actual Bitcoin, which it locks up. With roughly 95% of reserves drained and the network paused, the incident exposes a critical weakness, Flynn said.";
const payload: SakPromptPayload = { sakId: "s1", todayIso: "2026-09-07T10:00:00Z", targetChars: 1500, materials: [{ sourceId: "material_m1", kind: "text", title: "Tekstmateriale", text, textChars: text.length, status: "ready" }] };
const article: SakArticle = {
  title: "Liquid Network stanser transaksjoner", lead: "Nettverket utsteder L-BTC mot bitcoin som det låser opp.",
  blocks: [{ kind: "quote", text: "– Hendelsen avdekker en kritisk svakhet, sier Flynn." }],
  sources: [{ materialId: "material_m1", usedFor: "Opplysninger om nettverket" }], source_spans: ["material_m1: which it locks up"], excluded_hype: [], desk_notes: ["Ingen merknader"], change_note: "Første utkast"
};
function referenceResponse(overrides: (item: Record<string, unknown>) => Record<string, unknown> = (item) => item) {
  return JSON.stringify({ sentences: sakReviewPassages(article).map((passage) => overrides({ index: passage.index, grounded: true, explanation: "Supported", evidence: [{ materialId: "material_m1", quote: text }] })) });
}
describe("publication attribution", () => {
  it("blocks Bloomberg reporting credited only to an interviewee or the source ledger", () => {
    expect(missingSakPublisherIssues(article, payload)[0]?.code).toBe("SAK_PUBLISHER_NOT_ATTRIBUTED");
  });
  it.each(["skriver Bloomberg", "Bloomberg skriver", "ifølge nyhetsbyrået Bloomberg", "sier Flynn til Bloomberg"])("accepts natural prose attribution: %s", (credit) => {
    expect(missingSakPublisherIssues({ ...article, lead: `Nettverket stanses, ${credit}.` }, payload)).toEqual([]);
  });
  it("uses checked evidence to catch a source falsely marked unused", () => {
    const hidden = { ...article, sources: [{ materialId: "material_m1", usedFor: "ikke brukt: bakgrunn" }] };
    expect(missingSakPublisherIssues(hidden, payload, ["material_m1"])).toHaveLength(1);
  });
});
describe("complete, source-bound semantic review", () => {
  it("carries a reversed meaning to the exact passage even when all numbers match", () => {
    const raw = referenceResponse((item) => item.index === 1 ? { ...item, grounded: false, explanation: "locks up betyr låser, ikke låser opp." } : item);
    expect(parseSakReferenceReview(raw, article, payload).issues).toEqual([expect.objectContaining({ severity: "blocking", location: "lead", message: "locks up betyr låser, ikke låser opp." })]);
  });
  it("rejects fabricated evidence even if the checker claims support", () => {
    const raw = referenceResponse((item) => ({ ...item, evidence: [{ materialId: "material_m1", quote: "The network unlocks all its bitcoins." }] }));
    expect(parseSakReferenceReview(raw, article, payload).issues).toHaveLength(sakReviewPassages(article).length);
  });
  it("does not accept evidence from another material or from an unread material", () => {
    const raw = referenceResponse((item) => ({ ...item, evidence: [{ materialId: "material_other", quote: text }] }));
    expect(parseSakReferenceReview(raw, article, payload).issues.length).toBeGreaterThan(0);
    const failed = { ...payload, materials: payload.materials.map((source) => ({ ...source, status: "failed" as const })) };
    expect(parseSakReferenceReview(referenceResponse(), article, failed).issues.length).toBeGreaterThan(0);
  });
  it("requires coverage of every passage, with no duplicate indices", () => {
    expect(() => parseSakReferenceReview('{"sentences":[]}', article, payload)).toThrow();
    const raw = referenceResponse((item) => ({ ...item, index: 0 }));
    expect(() => parseSakReferenceReview(raw, article, payload)).toThrow(/hele artikkelen/);
  });
  it("accepts translated quotes grounded semantically in their original English passage", () => {
    expect(parseSakReferenceReview(referenceResponse(), article, payload).issues).toEqual([]);
  });
  it("requires the news brief's evidence to exist in the cited source", () => {
    const brief = { angle: "Reserver tappet", news: [{ fact: "Utsteder L-BTC", materialId: "material_m1", evidence: "Invented claim absent from the source" }], essentialContext: [], omit: [], uncertainties: [] };
    expect(() => parseSakBrief(JSON.stringify(brief), payload)).toThrow(/ikke finnes/);
  });
});

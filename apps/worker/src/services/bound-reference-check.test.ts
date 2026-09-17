import { describe, it, expect } from "vitest";
import type { PromptPayload } from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";
import { bindReferenceResult, freezeReferenceSources } from "./bound-reference-check.js";
import { assessReferenceCheckGate, collectDraftSentences } from "./reference-check.js";
const payload: PromptPayload = { messageId: 100, title: "Completion", issuerName: "TORM", issuerSign: "TORM", publishedAt: "2026-09-17T07:00:00Z", bodyText: "The sale completed. No proceeds to TORM.", sourceBodyChars: 44, categories: [], markets: [], hasAttachments: false,
  relatedNotices: [{ messageId: 90, title: "Pricing", issuerName: "TORM", issuerSign: "TORM", publishedAt: "2026-09-16T07:00:00Z", text: "TORM announces pricing.\n\nGross proceeds to the seller are U.S. $290,250,000.", textChars: 80, relation: "history", resolvedBy: "db", score: 1 }] };
const draft: RewriteOutput = { title: "Torm fullfører salget", lead: "Torm meldte i går et bruttoproveny til selger på 290,25 millioner amerikanske dollar.", body: [], company_sentence: "", key_facts: ["Salget er fullført"], negative_or_surprising: [], excluded_hype: [], source_limitations: [], confidence: "high", importance: "medium", source_spans: ["primary: The sale completed."] };
function response() { const sources=freezeReferenceSources(payload); return { sentences: collectDraftSentences(draft).map((sentence,index) => ({ index, grounded:true, interpretation:"Correct meaning, currency, scale and date.", uses:[{fact:sentence, refs: index===0 ? [sources[0].blocks[1].ref] : [sources[1].blocks[2].ref], linkText: index===1 ? "meldte i går" : ""}] })) }; }
describe("bound original evidence", () => {
  it("accepts equivalent amounts and identity from document context without a generated quote", () => {
    const report=bindReferenceResult(payload,draft,freezeReferenceSources(payload),response());
    expect(assessReferenceCheckGate(report).blocking).toBe(false);
    expect(report.sourceLinks[0]).toMatchObject({text:"meldte i går",messageId:90,sourceId:"prior_90"});
    expect(report.items[1].sourceEvidence).toBe("Gross proceeds to the seller are U.S. $290,250,000.");
  });
  it.each(["invented", "prior_90:obsolete:b2"])("rejects unknown/stale reference %s", ref => {
    const raw=response();raw.sentences[1].uses[0].refs=[ref];
    expect(()=>bindReferenceResult(payload,draft,freezeReferenceSources(payload),raw)).toThrow("BOUND_UNKNOWN_OR_STALE_REF");
  });
  it("invalidates old references when source text changes", () => {
    const changed={...payload,relatedNotices:payload.relatedNotices!.map(p=>({...p,text:p.text.replace("290,250,000","190,250,000")}))};
    expect(()=>bindReferenceResult(changed,draft,freezeReferenceSources(changed),response())).toThrow("BOUND_UNKNOWN_OR_STALE_REF");
  });
  it("does not accept a fact or anchor absent from the article", () => {
    const raw=response();raw.sentences[1].uses[0].fact="A different sentence";
    expect(()=>bindReferenceResult(payload,draft,freezeReferenceSources(payload),raw)).toThrow("BOUND_FACT_NOT_IN_SENTENCE");
    const anchor=response();anchor.sentences[1].uses[0].linkText="not in article";
    expect(()=>bindReferenceResult(payload,draft,freezeReferenceSources(payload),anchor)).toThrow("BOUND_LINK_NOT_IN_FACT");
  });
  it("requires complete unique sentence coverage", () => {
    const raw=response();raw.sentences[1].index=0;
    expect(()=>bindReferenceResult(payload,draft,freezeReferenceSources(payload),raw)).toThrow("BOUND_INVALID_SENTENCE_PARTITION");
  });
  it("blocks a semantically unsupported claim even when its references exist", () => {
    const raw=response();raw.sentences[1].grounded=false;raw.sentences[1].interpretation="Wrong currency or amount.";
    const report=bindReferenceResult(payload,draft,freezeReferenceSources(payload),raw);
    expect(assessReferenceCheckGate(report).blocking).toBe(true);
    expect(report.sourceLinks).toEqual([]);
  });
  it("requires evidence for supported claims", () => {
    const raw=response();raw.sentences[1].uses=[];
    expect(()=>bindReferenceResult(payload,draft,freezeReferenceSources(payload),raw)).toThrow("BOUND_MISSING_EVIDENCE");
  });
  it("never guesses a link when a claim needs multiple source documents", () => {
    const sources=freezeReferenceSources(payload);const raw=response();raw.sentences[1].uses[0].refs.push(sources[0].blocks[1].ref);
    expect(bindReferenceResult(payload,draft,sources,raw).sourceLinks).toEqual([]);
  });
  it("rejects future evidence", () => {
    const changed={...payload,relatedNotices:payload.relatedNotices!.map(p=>({...p,publishedAt:payload.publishedAt}))};
    expect(()=>bindReferenceResult(changed,draft,freezeReferenceSources(changed),response())).toThrow("BOUND_UNKNOWN_OR_STALE_REF");
  });
  it("rejects a mutated snapshot even if an old reference ID is retained", () => {
    const sources=freezeReferenceSources(payload); sources[1].blocks[2].text="Modified evidence";
    expect(()=>bindReferenceResult(payload,draft,sources,response())).toThrow("BOUND_SNAPSHOT_CHANGED");
  });
  it("requires an exact existing anchor for a supported historical body claim", () => {
    const raw=response();raw.sentences[1].uses[0].linkText="";
    expect(()=>bindReferenceResult(payload,draft,freezeReferenceSources(payload),raw)).toThrow("BOUND_MISSING_PRIOR_LINK");
  });

});

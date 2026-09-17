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
    expect(report.sourceLinks[0]).toMatchObject({text:"meldte i går",messageId:90,sourceId:"prior_90",fact:draft.lead});
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
    expect(bindReferenceResult(payload,draft,freezeReferenceSources(payload),anchor).sourceLinks[0]).toMatchObject({text:"meldte",messageId:90});
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
  it("keeps the historical link when a comparison needs current and one prior source", () => {
    const sources=freezeReferenceSources(payload);const raw=response();raw.sentences[1].uses[0].refs.push(sources[0].blocks[1].ref);
    expect(bindReferenceResult(payload,draft,sources,raw).sourceLinks[0]).toMatchObject({text:"meldte i går",sourceId:"prior_90",messageId:90,refs:[sources[1].blocks[2].ref]});
  });
  it("rejects future evidence", () => {
    const changed={...payload,relatedNotices:payload.relatedNotices!.map(p=>({...p,publishedAt:payload.publishedAt}))};
    expect(()=>bindReferenceResult(changed,draft,freezeReferenceSources(changed),response())).toThrow("BOUND_UNKNOWN_OR_STALE_REF");
  });
  it("rejects a mutated snapshot even if an old reference ID is retained", () => {
    const sources=freezeReferenceSources(payload); sources[1].blocks[2].text="Modified evidence";
    expect(()=>bindReferenceResult(payload,draft,sources,response())).toThrow("BOUND_SNAPSHOT_CHANGED");
  });
  it("repairs a missing historical anchor without invalidating factual coverage", () => {
    const raw=response();raw.sentences[1].uses[0].linkText="";
    const report=bindReferenceResult(payload,draft,freezeReferenceSources(payload),raw);
    expect(report.sourceLinks[0]).toMatchObject({text:"meldte",messageId:90});
    expect(assessReferenceCheckGate(report).blocking).toBe(false);
  });

});

it("links the earlier same-day notice in a verified mixed-source comparison", () => {
  const d={...draft,lead:"Andelen er opp fra 20,95 prosent i en tidligere melding samme dag."};
  const sources=freezeReferenceSources(payload);
  const raw={sentences:collectDraftSentences(d).map((fact,index)=>({index,grounded:true,interpretation:"Verified comparison",uses:[{fact,refs:index ? [sources[0].blocks[1].ref,sources[1].blocks[2].ref]:[sources[0].blocks[1].ref],linkText:""}]}))};
  const report=bindReferenceResult(payload,d,sources,raw);
  expect(report.sourceLinks).toHaveLength(1);
  expect(report.sourceLinks[0]).toMatchObject({text:"en tidligere melding samme dag",sourceId:"prior_90",messageId:90});
  expect(report.evidenceBindings[1].refs).toHaveLength(2);
});
it("requires explicit disambiguation when two prior sources support one fact", () => {
  const p={...payload,relatedNotices:[...payload.relatedNotices!,{...payload.relatedNotices![0],messageId:80}]};
  const sources=freezeReferenceSources(p);const raw=response();
  raw.sentences[1].uses[0].refs.push(sources[2].blocks[2].ref);
  expect(bindReferenceResult(p,draft,sources,raw).sourceLinks).toEqual([]);
  const selected=structuredClone(raw) as any;
  selected.sentences[1].uses[0].linkSourceId="prior_80";
  expect(bindReferenceResult(p,draft,sources,selected).sourceLinks[0]).toMatchObject({text:"meldte i går",messageId:80,refs:[sources[2].blocks[2].ref]});
  selected.sentences[1].uses[0].linkSourceId="prior_999";
  expect(bindReferenceResult(p,draft,sources,selected).sourceLinks).toEqual([]);
});
it("uses the verified fact as fallback only for an unambiguous source", () => {
  const d={...draft,lead:"Tilbudet var på 47 kroner per aksje."}; const sources=freezeReferenceSources(payload);
  const raw={sentences:collectDraftSentences(d).map((fact,index)=>({index,grounded:true,interpretation:"Verified",uses:[{fact,refs:[sources[index?1:0].blocks[1].ref],linkText:""}]}))};
  expect(bindReferenceResult(payload,d,sources,raw).sourceLinks[0]).toMatchObject({text:d.lead,messageId:90});
});

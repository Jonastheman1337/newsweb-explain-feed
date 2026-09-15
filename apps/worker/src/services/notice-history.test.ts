import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { PromptPayload } from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";
import { selectHistory, retrieveHistory, needsEventHistory, validateHistoryAssessment, applyHistoryDecision, trustedHistoryDecision, type HistoryAssessment } from "./notice-history.js";
import { applyImportanceHighBar } from "./importance.js";
import { replayValidationPayloadFromRow } from "./generation-run-replay.js";
import type { RelatedNoticeCandidate } from "./related-notices.js";

const fixtures=JSON.parse(readFileSync(new URL('../fixtures/notice-history.json',import.meta.url),'utf8')).cases;
const payment=fixtures.find((c: {id:string})=>c.id==='unchanged-distribution');
function payload():PromptPayload { return {...payment.current,relatedNotices:selectHistory(payment.current,payment.prior.map((p:RelatedNoticeCandidate)=>({...p,publishedAt:new Date(p.publishedAt)})))}; }
function repeat():HistoryAssessment { return {decision:'routine_repeat',newsworthy:false,importance:'uviktig',confidence:'high',reason:'Uendret utbetaling.',
  repeatedFacts:[{current:{sourceId:'current',blockId:'b1'},prior:{sourceId:'prior_900000',blockId:'b0'}}],newFacts:[],uncertainties:[]}; }

describe('history-aware triage',()=>{
  it('finds the 99% statement inside the real CFO-departure notice',()=>{
    const c=fixtures[0];const selected=selectHistory(c.current,c.prior.map((p:RelatedNoticeCandidate)=>({...p,publishedAt:new Date(p.publishedAt)})));
    expect(selected.find(p=>p.messageId===682288)?.text).toContain('99%');
    expect(selected).toHaveLength(3);
  });
  it('excludes future, self, other issuer and stale evidence',()=>{
    const p=payload(); const base={...payment.prior[0],publishedAt:new Date(payment.prior[0].publishedAt)};
    expect(selectHistory(p,[{...base,publishedAt:new Date(p.publishedAt)},{...base,messageId:p.messageId},{...base,issuerSign:'OTHER'}, {...base,publishedAt:new Date('2025-01-01')}])).toEqual([]);
    expect(selectHistory({...p,issuerSign:'-'},[base])).toEqual([]);
  });
  it('does not retrieve history for a standalone executive departure',()=>{
    expect(needsEventHistory({title:'CFO leaves',bodyText:'The CFO will leave the company next year.'})).toBe(false);
  });
  it('makes a stalled store uncertain within a shared deadline',async()=>{
    const result=await retrieveHistory(payload(),()=>new Promise(()=>{}),15);
    expect(result.outcome).toBe('timeout');expect(result.selected).toEqual([]);
  });
  it('does not report a store failure as no-match',async()=>{
    expect((await retrieveHistory(payload(),async()=>{throw Error('unavailable')})).outcome).toBe('unavailable');
  });
  it('permits skipping an unchanged payment with complete evidence',()=>{
    expect(validateHistoryAssessment(payload(),repeat()).rejectionCodes).toEqual([]);
    expect(validateHistoryAssessment(payload(),repeat()).assessment.newsworthy).toBe(false);
  });
  it('allows an expected mechanical new fact in a routine payment',()=>{
    const a=repeat();a.newFacts=[{evidence:{sourceId:'current',blockId:'b0'},material:false}];
    expect(validateHistoryAssessment(payload(),a).assessment.newsworthy).toBe(false);
  });
  it('allows a read-complete attachment to support a skip, but not partial extraction',()=>{
    const p={...payload(),hasAttachments:true,pdfSupplementText:'The payment follows the unchanged previously announced terms.'};
    expect(validateHistoryAssessment(p,repeat()).assessment.newsworthy).toBe(true);
    expect(validateHistoryAssessment({...p,pdfSupplementComplete:true},repeat()).assessment.newsworthy).toBe(false);
  });
  it('rejects fabricated evidence and a material-new-fact/skip contradiction',()=>{
    const a=repeat();a.repeatedFacts[0].prior.blockId='invented_block';
    expect(validateHistoryAssessment(payload(),a).rejectionCodes).toContain('ungrounded_evidence');
    const b=repeat();b.newFacts=[{evidence:{sourceId:'current',blockId:'b0'},material:true}];
    expect(validateHistoryAssessment(payload(),b).assessment.newsworthy).toBe(true);
  });
  it('never lets low-confidence or future history downgrade importance',()=>{
    const a={...repeat(),confidence:'low' as const};
    expect(validateHistoryAssessment(payload(),a).assessment.decision).toBe('uncertain');
    const p=payload();p.relatedNotices![0].publishedAt='2027-01-01';
    expect(validateHistoryAssessment(p,repeat()).rejectionCodes).toContain('ineligible_history');
  });
  it('overrides background severe-event keywords and binds decisions to the exact source',()=>{
    const p=payload();p.bodyText+=' This is part of a restructuring.';
    const a={...repeat(),decision:'expected_update' as const,newsworthy:true,importance:'medium' as const};
    applyHistoryDecision(p,a);
    const draft={importance:'viktig'} as RewriteOutput;
    expect(applyImportanceHighBar(draft,p).rewrite.importance).toBe('medium');
    p.bodyText+=' New terms have changed.';
    expect(trustedHistoryDecision(p)).toBeUndefined();
    expect(applyImportanceHighBar(draft,p).rewrite.importance).toBe('viktig');
  });
  it('preserves validated history through replay and rejects stale source bindings',()=>{
    const p=payload();applyHistoryDecision(p,repeat());
    const replay=replayValidationPayloadFromRow({sourcePayload:p});
    expect(replay?.payload.historyDecision).toEqual(p.historyDecision);
    expect(replayValidationPayloadFromRow({sourcePayload:{...p,bodyText:'changed'}})).toBeNull();
  });
});

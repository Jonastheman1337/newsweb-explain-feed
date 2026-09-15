import { describe, expect, it, vi } from "vitest";
import { createNewswebRelatedNoticeClient, resolveRelatedNotices, emptyRelatedNoticeStore, type RelatedNoticeSource } from "./related-notices.js";

const source:RelatedNoticeSource={messageId:900001,issuerSign:'TEST',issuerName:'Example ASA',publishedAt:new Date('2026-09-15T12:00:00Z'),
  bodyText:'Reference is made to the announcement on 1 September 2026 regarding the capital distribution.',rawMessageJson:{}};

describe('bounded referenced-notice retrieval',()=>{
  it('returns an explicit timeout for a stalled DB without waiting on it',async()=>{
    const result=await resolveRelatedNotices(source,{enabledRelations:['reference'],timeoutMs:15,
      store:{...emptyRelatedNoticeStore,findByIssuerAndDate:()=>new Promise(()=>{})}});
    expect(result.related).toEqual([]);expect(result.telemetry.unresolved[0].reason).toBe('timeout');
  });
  it('coalesces simultaneous list fetches and caches only successful responses',async()=>{
    const fetcher=vi.fn().mockRejectedValueOnce(Error('temporary error')).mockImplementation(async()=>new Response(JSON.stringify({data:{messages:[],overflow:false}}),{status:200}));
    const client=createNewswebRelatedNoticeClient(fetcher);
    await expect(client.listByDate('2026-09-01')).rejects.toThrow();
    await Promise.all([client.listByDate('2026-09-01'),client.listByDate('2026-09-01')]);
    await client.listByDate('2026-09-01');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
  });
  it('fetches at most two candidate bodies concurrently and keeps ambiguous results unresolved',async()=>{
    let active=0,maxActive=0;
    const list=Array.from({length:6},(_,i)=>({messageId:800000+i,title:'Capital distribution announced',issuerName:'Example ASA',issuerSign:'TEST',publishedTime:`2026-09-01T0${i}:00:00Z`}));
    const result=await resolveRelatedNotices(source,{enabledRelations:['reference'],store:emptyRelatedNoticeStore,newsweb:{listByDate:async()=>list,
      fetchMessage:async(id)=>{active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,5));active--;
        return{messageId:id,title:'Capital distribution announced',issuerName:'Example ASA',issuerSign:'TEST',publishedAt:new Date(list.find(x=>x.messageId===id)!.publishedTime),bodyText:'Capital distribution of NOK 5 per share.'};}}});
    expect(maxActive).toBe(2);expect(result.related).toEqual([]);expect(result.telemetry.unresolved[0].reason).toBe('ambiguous');
  });
});

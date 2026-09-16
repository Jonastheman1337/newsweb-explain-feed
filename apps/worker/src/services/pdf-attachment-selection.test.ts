import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
const docs = vi.hoisted(() => new Map<number, string[]>());
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ OPS: {}, getDocument: ({data}: {data: Uint8Array}) => {
 const pages=docs.get(Number(Buffer.from(data).toString())) ?? [];
 return {promise: Promise.resolve({numPages: pages.length, getPage: async (n:number) => ({getOperatorList:async()=>({fnArray:[]}),getTextContent: async () => ({items: pages[n-1].split("\n").map((str,i)=>({str,transform:[10,0,0,10,0,10000-i*14],width:str.length*5}))})}),destroy:async()=>{}})};
}}));
import { extractReportContent, downloadReportPdfAttachment, reportNeedsOpenAIPdfFallback } from "./pdf-extract.js";
const fixture=JSON.parse(readFileSync(new URL("../fixtures/cmb-pdf-statements.json",import.meta.url),"utf8")) as Array<{id:number;pageCount:number;pages:Record<string,string>}>;
const instruction="This is the interesting part. The ship sales is already known. Unaudited condensed consolidated interim statement of profit or loss";
afterEach(()=>vi.unstubAllGlobals());
function setup(failFirst=false) {
 for (const d of fixture) { const pages=Array.from({length:d.pageCount},()=>"Company background"); for(const [n,text] of Object.entries(d.pages)) pages[Number(n)-1]=text; docs.set(d.id,pages); }
 vi.stubGlobal("fetch",vi.fn(async (url:string)=> { const id=Number(new URL(url).searchParams.get("attachmentId")); return new Response(String(id),{status: failFirst && id===333345 ? 503 : 200}); }));
}
describe("content-based attachment selection",()=>{
 it.each([false,true])("finds both actual statements with opaque names and reversed order=%s",async reverse=>{
  setup();const attachments=fixture.map(d=>({id:d.id,name:`${d.id}.pdf`}));if(reverse)attachments.reverse();
  const raw={attachments};const r=await extractReportContent(raw,682396,instruction);
  expect(r?.attachments).toHaveLength(2);expect(r?.text).toContain("733,214");expect(r?.text).toContain("2.53");
  expect(r?.selectedPages).toEqual(expect.arrayContaining([expect.objectContaining({attachmentId:333345,pageNumber:27}),expect.objectContaining({attachmentId:333346,pageNumber:4}),expect.objectContaining({attachmentId:333346,pageNumber:5})]));
  expect(r && reportNeedsOpenAIPdfFallback(r)).toBe(false);
  await downloadReportPdfAttachment(raw,682396,r!.attachmentId);expect(fetch).toHaveBeenCalledTimes(2);
 });
 it("uses the other PDF after one download fails",async()=>{setup(true);const r=await extractReportContent({attachments:fixture.map(d=>({id:d.id,name:"unknown.pdf"}))},682396,instruction);expect(r?.attachmentId).toBe(333346);expect(r?.diagnostics.failedAttachments).toHaveLength(1);});
 it("keeps the continuation without an instruction",async()=>{setup();const r=await extractReportContent({attachments:[{id:333346,name:"opaque.pdf"}]},682396);expect(r?.selectedPages.some(p=>p.pageNumber===5)).toBe(true);});
});

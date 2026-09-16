import {beforeEach,describe,expect,it,vi} from "vitest";
const mock=vi.hoisted(()=>({pages:[""],call:vi.fn()}));
vi.mock("@newsweb/shared/openai-responses",()=>({createOpenAIClient:()=>({}),callOpenAIForJson:mock.call}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs",()=>({getDocument:()=>({promise:Promise.resolve({numPages:mock.pages.length,getPage:async(n:number)=>({getTextContent:async()=>({items:mock.pages[n-1].split("\n").map((str,i)=>({str,transform:[1,0,0,1,0,100-i]}))})}),destroy:async()=>{}})})}));
import {extractPdfMaterialText} from "./notice-materials.js";
beforeEach(()=>{mock.call.mockReset();vi.stubEnv("OPENAI_API_KEY","test");});
describe("PDF uploads",()=>{
 it("keeps late financial pages without a model call",async()=>{
  mock.pages=["Background. ".repeat(2000),"Consolidated income statement\n(in thousands of USD)\nRevenue 100 90\nProfit 20 10"];
  const result=await extractPdfMaterialText(Buffer.from("%PDF-1.4"));
  expect(result.text.startsWith("[PDF page 2]")).toBe(true);expect(result.pages).toHaveLength(2);expect(mock.call).not.toHaveBeenCalled();
 });
 it("reads image-only PDFs through visual fallback",async()=>{
  mock.pages=[""];mock.call.mockResolvedValue({content:JSON.stringify({complete:true,pages:[{page:1,text:"Revenue 100 90\nProfit 20 10"}]})});
  const result=await extractPdfMaterialText(Buffer.from("%PDF-1.4"));expect(result.extractionMethod).toBe("visual");expect(result.text).toContain("Profit 20 10");
 });
 it("does not mark an incomplete scan readable",async()=>{
  mock.pages=[""];mock.call.mockResolvedValue({content:JSON.stringify({complete:false,pages:[]})});
  await expect(extractPdfMaterialText(Buffer.from("%PDF-1.4"))).rejects.toThrow("fullstendig");
 });
 it("rejects non-PDF bytes regardless of filename",async()=>{await expect(extractPdfMaterialText(Buffer.from("not a pdf"))).rejects.toThrow("gyldig PDF");});
});

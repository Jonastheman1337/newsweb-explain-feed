import Fastify from "fastify";
import multipart from "@fastify/multipart";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
const mocks=vi.hoisted(()=>({create:vi.fn(),extract:vi.fn()}));
vi.mock("@newsweb/shared/db",()=>({prisma:{sourceNotice:{findUnique:async()=>({messageId:42})},noticeMaterial:{create:mocks.create}},logPrisma:{}}));
vi.mock("../services/notice-materials.js",async(original)=>({...await original<typeof import("../services/notice-materials.js")>(),extractPdfMaterialText:mocks.extract}));
import {noticeRoutes} from "./notice.js";
import {MAX_MATERIAL_FILE_BYTES} from "../services/notice-materials.js";
let app:ReturnType<typeof Fastify>;
beforeEach(async()=>{
 vi.resetAllMocks();mocks.extract.mockResolvedValue({text:"[PDF page 27]\nRevenue 100 90",pages:["Revenue 100 90"],pageCount:1,extractionMethod:"text"});
 mocks.create.mockImplementation(async({data})=>({...data,id:"material-test",url:null,createdAt:new Date()}));
 app=Fastify();app.decorate("authenticate",async()=>undefined);await app.register(multipart,{limits:{fileSize:MAX_MATERIAL_FILE_BYTES,files:1}});await app.register(noticeRoutes);
});
afterEach(async()=>app.close());
async function upload(bytes:Buffer,name:string){
 const boundary="test-boundary";
 return app.inject({method:"POST",url:"/notice/42/materials/pdf",headers:{"content-type":`multipart/form-data; boundary=${boundary}`},payload:Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),bytes,Buffer.from(`\r\n--${boundary}--\r\n`)])});
}
it("accepts an opaque name and a 35 MiB PDF, storing full pages privately",async()=>{
 const bytes=Buffer.alloc(35*1024*1024,32);bytes.write("%PDF-1.4");const r=await upload(bytes,"unknown-file");
 expect(r.statusCode).toBe(201);expect(r.json().status).toBe("ready");expect(r.json().metadata.pdfPages).toBeUndefined();
 expect(mocks.create.mock.calls[0][0].data.metadataJson.pdfPages).toEqual(["Revenue 100 90"]);
});
it("rejects fake PDF content despite a PDF filename",async()=>{const r=await upload(Buffer.from("bad bytes"),"report.pdf");expect(r.statusCode).toBe(415);expect(mocks.create).not.toHaveBeenCalled();});
it("never marks empty extraction ready",async()=>{mocks.extract.mockResolvedValue({text:"",pages:[""],pageCount:1});const r=await upload(Buffer.from("%PDF-1.4"),"scan.pdf");expect(r.statusCode).toBe(201);expect(r.json().status).toBe("failed");expect(r.json().enabled).toBe(false);});

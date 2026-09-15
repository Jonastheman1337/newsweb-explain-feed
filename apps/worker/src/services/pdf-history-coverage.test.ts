import { describe, expect, it } from "vitest";
import { extractPagesFromPdf } from "./pdf-extract.js";

function pdf(draw=false):Buffer {
  const stream=`BT /F1 12 Tf 20 100 Td (An unchanged distribution was paid under the previously announced terms.) Tj ET${draw?' 20 20 40 40 re f':''}`;
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let text='%PDF-1.4\n';const offsets=[0];
  for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(text);text+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(text);
}
describe('attachment evidence completeness',()=>{
  it('certifies all-page text extraction when no visual content is omitted',async()=>{
    const result=await extractPagesFromPdf(pdf(),true);
    expect(result.textComplete).toBe(true);expect(result.pages[0]).toContain('unchanged distribution');
  });
  it('requires further review when a drawing is not represented by extracted text',async()=>{
    expect((await extractPagesFromPdf(pdf(true),true)).textComplete).toBe(false);
  });
});

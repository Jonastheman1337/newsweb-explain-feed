import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ documents: new Map<number, string[]>(), failIds: new Set<number>(), geometry: new Map<number, Array<{ str: string; transform: number[]; width: number }>>() }));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: ({ data }: { data: Uint8Array }) => ({
    promise: Promise.resolve({
      numPages: fixture.documents.get(Number(Buffer.from(data).toString()))?.length ?? 0,
      getPage: async (pageNumber: number) => ({
        getTextContent: async () => ({
          items: fixture.geometry.get(Number(Buffer.from(data).toString())) ?? (fixture.documents.get(Number(Buffer.from(data).toString()))?.[pageNumber - 1] ?? "").split("\n").map((str, index) => ({ str, transform: [10, 0, 0, 10, 0, 1000 - index * 14], width: str.length * 5 }))
        })
      }),
      destroy: vi.fn()
    })
  })
}));

import { downloadReportPdfAttachment, extractGeneralPdfContent, extractPagesFromPdf, extractReportContent, extractYearlyReportSections, reportNeedsOpenAIPdfFallback } from "./pdf-extract.js";

const padding = "The business description on this source page contains additional background. ".repeat(10);
const report = (revenue = "33,9 30,1") => ["Consolidated income statement", "NOK million", "Q2 2026 Q2 2025", `Revenue ${revenue}`, "Operating profit 10,2 9,3", "Profit before tax 9,8 8,1", padding].join("\n");

beforeEach(() => {
  fixture.documents.clear();
  fixture.failIds.clear();
  fixture.geometry.clear();
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const id = Number(new URL(input).searchParams.get("attachmentId"));
    return fixture.failIds.has(id) ? new Response("Unavailable", { status: 503 }) : new Response(String(id));
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe("bounded report attachment selection", () => {
  it("selects an opaque report and complementary presentation by content, with provenance", async () => {
    fixture.documents.set(1, [`Q2 branding presentation\n${padding}`]);
    fixture.documents.set(2, [report()]);
    fixture.documents.set(3, ["Q2 financial results\nNOK million\nQ2 2026 Q2 2025\nRevenue 33,9 30,1\nOperating profit 10,2 9,3\nOutlook: management increased its target.\n" + padding]);
    const result = await extractReportContent({ attachments: [
      { id: 1, fileName: "Q2-slides.pdf", fileSize: 1000000 },
      { id: 2, fileName: "98375.pdf", fileSize: 1000 },
      { id: 3, fileName: "presentation.pdf", fileSize: 5000 }
    ] }, 681267);
    expect(result?.attachmentId).toBe(2);
    expect(result?.attachments?.map((attachment) => attachment.attachmentId)).toEqual([2, 3]);
    expect(result?.diagnostics.inspectedAttachmentIds).toEqual([1, 2, 3]);
    expect(result?.text).toContain("management increased its target");
    expect(result?.referenceText).toContain("[PDF attachment 2: 98375.pdf]");
    expect(result?.referenceText).toContain("[PDF attachment 3: presentation.pdf]");
    expect(result?.financialFacts?.some((fact) => fact.attachmentId === 2 && fact.usable && fact.rowNumber === 4)).toBe(true);
    expect(result?.selectedPages.every((page) => page.attachmentId === 2 || page.attachmentId === 3)).toBe(true);
    expect(result?.text).not.toContain("branding presentation");
  });

  it("limits inspection and marks unseen attachments instead of claiming complete evidence", async () => {
    const attachments = Array.from({ length: 6 }, (_, index) => ({ id: index + 1, fileName: `source-${index + 1}.pdf` }));
    attachments.forEach((attachment) => fixture.documents.set(attachment.id, [report()]));
    const result = await extractReportContent({ attachments }, 10);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(result?.diagnostics.uninspectedAttachmentIds).toEqual([5, 6]);
    expect(result?.attachments).toHaveLength(1); // Exact duplicate text contributes no additional facts.
    expect(result?.diagnostics.completeness).toBe("partial");
    expect(result?.diagnostics.completenessReasons).toContain("attachment_inspection_budget");
  });

  it("continues after one broken attachment and records that incomplete evidence", async () => {
    fixture.failIds.add(1);
    fixture.documents.set(2, [report()]);
    const result = await extractReportContent({ attachments: [{ id: 1, fileName: "Q2-report.pdf" }, { id: 2, fileName: "readable.pdf" }] }, 10);
    expect(result?.attachmentId).toBe(2);
    expect(result?.diagnostics.failedAttachments?.[0].attachmentId).toBe(1);
    expect(result?.diagnostics.completenessReasons).toContain("attachment_extraction_failed");
  });

  it("records omitted relevant PDFs and keeps the global text budgets bounded", async () => {
    const attachments = [1, 2, 3].map((id) => ({ id, fileName: `${id}.pdf` }));
    attachments.forEach(({ id }) => fixture.documents.set(id, [report(`${id}0,5 ${id}0,1`) + padding.repeat(100)]));
    const result = await extractReportContent({ attachments }, 10);
    expect(result?.attachments).toHaveLength(2);
    expect(result?.text.length).toBeLessThanOrEqual(24000);
    expect(result?.referenceText.length).toBeLessThanOrEqual(72000);
    expect(result?.diagnostics.completenessReasons).toEqual(expect.arrayContaining(["additional_relevant_attachments_omitted", "selected_context_truncated", "selected_reference_pages_truncated"]));
  });

  it("retains a request for a page beyond the inspection cap and requests fallback", async () => {
    fixture.documents.set(1, [report(), ...Array.from({ length: 170 }, () => padding)]);
    const result = await extractReportContent({ attachments: [{ id: 1, fileName: "Q2-report.pdf" }] }, 10, "Include page 170");
    expect(result?.pageCount).toBe(171);
    expect(result?.attachments?.[0].extractedPageCount).toBe(160);
    expect(result?.diagnostics.requestedPageNumbers).toEqual([170]);
    expect(result?.diagnostics.completenessReasons).toEqual(expect.arrayContaining(["report_page_inspection_budget", "requested_page_not_found"]));
    expect(reportNeedsOpenAIPdfFallback(result!)).toBe(true);
  });

  it("rejects a named quarterly branding file without report content", async () => {
    fixture.documents.set(1, [`Q2 investor branding presentation\n${padding}`]);
    const raw = { attachments: [{ id: 1, fileName: "Q2-report.pdf" }] };
    expect(await extractReportContent(raw, 10)).toBeNull();
    expect(await downloadReportPdfAttachment(raw, 10)).toBeNull();
  });

  it("allows visual fallback for a scanned named report and reuses a selected primary ID", async () => {
    fixture.documents.set(1, [""]);
    fixture.documents.set(2, [report()]);
    expect((await downloadReportPdfAttachment({ attachments: [{ id: 1, fileName: "Q2-report.pdf" }] }, 10))?.attachmentId).toBe(1);
    vi.mocked(fetch).mockClear();
    expect((await downloadReportPdfAttachment({ attachments: [{ id: 1, fileName: "Q2-report.pdf" }, { id: 2, fileName: "opaque.pdf" }] }, 10, 2))?.attachmentId).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("non-report extraction compatibility", () => {
  it("preserves horizontal cell gaps and original grouped number strings", async () => {
    fixture.documents.set(1, [""]);
    const cell = (str: string, x: number, y: number, width: number) => ({ str, transform: [10, 0, 0, 10, x, y], width });
    fixture.geometry.set(1, [cell("Revenue", 10, 100, 40), cell("1 234", 180, 100, 30), cell("1 100", 300, 100, 30), cell("Operating profit", 10, 80, 80), cell("(10)", 180, 80, 20)]);
    expect((await extractPagesFromPdf(Buffer.from("1"))).pages).toEqual(["Revenue\t1 234\t1 100\nOperating profit\t(10)"]);
  });

  it("continues extracting general announcement PDFs", async () => {
    fixture.documents.set(1, ["Shareholder meeting agenda\n" + padding]);
    const raw = { attachments: [{ id: 1, fileName: "agenda.pdf" }] };
    expect(await extractReportContent(raw, 10)).toBeNull();
    expect(await extractGeneralPdfContent(raw, 10)).toMatchObject({ attachmentId: 1, pageCount: 1, text: expect.stringContaining("Shareholder meeting agenda") });
  });

  it("preserves targeted yearly remuneration extraction", async () => {
    fixture.documents.set(1, ["Cover", "Table of contents", "Introduction", "Godtgjørelse til ledende ansatte\nGrunnlønn 1 250 000 kroner\n" + padding]);
    expect(await extractYearlyReportSections({ attachments: [{ id: 1, fileName: "Årsrapport 2025.pdf" }] }, 10)).toMatchObject({ attachmentId: 1, letterText: null, remunerationText: expect.stringContaining("1 250 000 kroner") });
  });
});

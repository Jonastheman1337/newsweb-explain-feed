import {
  sakDraftResponseSchema,
  sakDraftSchema,
  sakListItemSchema,
  sakMaterialSchema,
  sakVersionSchema
} from "@newsweb/shared";
import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  sakDraftPayload,
  sakListItemPayload,
  sakMaterialPayload,
  sakVersionAsRewriteStatus,
  sakVersionPayload
} from "./sak-payloads.js";

const createdAt = new Date("2026-09-04T08:00:00Z");

const draftRow = {
  id: "ckdraft1",
  titleOverride: null,
  targetChars: 2500,
  createdAt,
  lastActivityAt: createdAt,
  expiresAt: new Date("2026-09-05T08:00:00Z")
};

const article = {
  sources: [{ materialId: "material_ckm1", usedFor: "tall og sitater" }],
  source_spans: ['material_ckm1: "We see strong demand"'],
  excluded_hype: [],
  title: "Air Canada åpner rute til Oslo",
  lead: "Canadas største flyselskap starter direkterute mellom Oslo og Toronto neste sommer.",
  blocks: [{ kind: "paragraph", text: "Ruten flys fire ganger i uken, [[ifølge selskapet|material_ckm1]]." }],
  desk_notes: ["Ingen merknader"],
  change_note: "Første utkast"
};

describe("sak payload mappers", () => {
  it("maps a draft row to the shared draft schema", () => {
    expect(sakDraftSchema.parse(sakDraftPayload(draftRow))).toMatchObject({
      id: "ckdraft1",
      targetChars: 2500,
      expiresAt: "2026-09-05T08:00:00.000Z"
    });
  });

  it("maps material rows and falls back on unknown kinds", () => {
    const payload = sakMaterialPayload({
      id: "ckm1",
      sakId: "ckdraft1",
      kind: "url",
      title: "NTB",
      url: "https://kommunikasjon.ntb.no/x",
      fileName: null,
      fileSize: null,
      extractedText: "tekst",
      textChars: 5,
      status: "ready",
      errorText: null,
      enabled: true,
      metadataJson: { contentType: "html" } as Prisma.JsonValue,
      createdAt
    });
    expect(sakMaterialSchema.parse(payload)).toMatchObject({
      kind: "url",
      extractedTextChars: 5,
      status: "ready",
      metadata: { contentType: "html" }
    });
  });

  it("maps versions with a parsed article and tolerates broken json", () => {
    const base = {
      id: "ckv1",
      sakId: "ckdraft1",
      version: 1,
      status: "ready",
      articleJson: article as unknown as Prisma.JsonValue,
      userInstruction: "Kort lead",
      changeNote: "Første utkast",
      promptVersion: "sak-v1.0.0",
      model: "gpt-5.6-terra",
      errorText: null,
      validationJson: null,
      generationRunId: "run1",
      requestedAt: createdAt,
      generatedAt: new Date("2026-09-04T08:03:00Z")
    };
    const ready = sakVersionSchema.parse(sakVersionPayload(base));
    expect(ready.article?.title).toBe("Air Canada åpner rute til Oslo");

    const broken = sakVersionSchema.parse(
      sakVersionPayload({ ...base, status: "needs_review", articleJson: { title: 1 } as unknown as Prisma.JsonValue })
    );
    expect(broken.article).toBeNull();
    expect(broken.status).toBe("needs_review");
  });

  it("builds list items from the latest readable article", () => {
    const item = sakListItemPayload({
      ...draftRow,
      versionCount: 2,
      materialCount: 3,
      latestArticleJson: article as unknown as Prisma.JsonValue
    });
    expect(sakListItemSchema.parse(item)).toMatchObject({
      title: "Air Canada åpner rute til Oslo",
      versionCount: 2,
      materialCount: 3
    });
    expect(
      sakListItemPayload({ ...draftRow, titleOverride: "Egen tittel", versionCount: 0, materialCount: 0, latestArticleJson: null }).title
    ).toBe("Egen tittel");
  });

  it("assembles a full draft response the shared schema accepts", () => {
    const response = sakDraftResponseSchema.parse({
      draft: sakDraftPayload(draftRow),
      materials: [],
      versions: [],
      activeGeneration: { generationRunId: "run1", jobId: "17", version: 1 }
    });
    expect(response.activeGeneration?.version).toBe(1);
  });

  it("maps sak version statuses onto the notice status shape", () => {
    expect(
      sakVersionAsRewriteStatus({ status: "ready", generatedAt: null, requestedAt: createdAt, version: 2 })
    ).toEqual({ status: "published", generatedAt: createdAt, version: 2 });
    expect(
      sakVersionAsRewriteStatus({ status: "needs_review", generatedAt: createdAt, requestedAt: createdAt, version: 1 })?.status
    ).toBe("published");
    expect(
      sakVersionAsRewriteStatus({ status: "pending", generatedAt: null, requestedAt: createdAt, version: 1 })?.status
    ).toBe("pending");
    expect(sakVersionAsRewriteStatus(null)).toBeNull();
  });
});

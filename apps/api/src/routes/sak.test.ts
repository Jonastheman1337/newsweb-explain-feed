import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  draft: { findFirst: vi.fn(), update: vi.fn() },
  material: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  version: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  run: { create: vi.fn(), update: vi.fn() },
  reserve: vi.fn(), release: vi.fn(), queue: vi.fn()
}));
vi.mock("@newsweb/shared/db", () => ({ prisma: { sakDraft: mocks.draft, sakMaterial: mocks.material, sakVersion: mocks.version }, logPrisma: { generationRun: mocks.run } }));
vi.mock("../services/sak-reservation.js", () => ({ reserveSakGeneration: mocks.reserve, releaseSakGenerationSlot: mocks.release }));
import { sakRoutes } from "./sak.js";
const owner = "editor-123456";
const article = { title: "Opprinnelig tittel", lead: "Dette er den opprinnelige ingressen.", blocks: [{ kind: "paragraph", text: "Opprinnelig tekst fra kilden." }], sources: [{ materialId: "material_m1", usedFor: "Hovednyheten" }], source_spans: ["material_m1: original source"], excluded_hype: [], desk_notes: ["Ingen merknader"], change_note: "Første utkast" };
const material = { id: "m1", sakId: "s1", kind: "text", title: "Bloomberg", url: "https://bloomberg.com/story", extractedText: "(Bloomberg) -- Original source reporting.", textChars: 40, status: "ready", errorText: null, enabled: true, metadataJson: { priority: 100 }, fileName: null, fileSize: null, createdAt: new Date() };
let app: ReturnType<typeof Fastify>;
beforeEach(async () => {
  vi.resetAllMocks();
  mocks.draft.findFirst.mockResolvedValue({ id: "s1", ownerId: owner, expiresAt: new Date(Date.now() + 86400000), titleOverride: null, targetChars: 1500 });
  mocks.material.findMany.mockResolvedValue([material]);
  mocks.material.findFirst.mockResolvedValue(material);
  mocks.material.update.mockImplementation(async ({ data }) => ({ ...material, ...data }));
  mocks.run.create.mockResolvedValue({ id: "r1" });
  mocks.run.update.mockResolvedValue({});
  mocks.version.updateMany.mockResolvedValue({ count: 1 });
  mocks.reserve.mockResolvedValue({ targetVersion: 4, previousArticleJson: { ...article, title: "Nyeste genererte tittel" } });
  mocks.queue.mockResolvedValue({ id: "j1" });
  app = Fastify();
  app.decorate("authenticate", async () => undefined);
  app.decorate("config", { SAK_TTL_HOURS: 24 });
  app.decorate("sakQueue", { add: mocks.queue });
  await app.register(sakRoutes);
});
afterEach(async () => app.close());

describe("Sak generation request", () => {
  it("revises the selected older version with the user's visible edits and its own source ledger", async () => {
    mocks.version.findFirst.mockResolvedValue({ id: "v1", articleJson: article });
    const editedArticle = { title: "Min rettede tittel", lead: "Dette er min manuelt rettede ingress.", blocks: [{ kind: "paragraph", text: "Behold min rettelse." }] };
    const response = await app.inject({ method: "POST", url: "/sak/s1/generate", headers: { "x-sak-owner": owner }, payload: { baseVersionId: "v1", editedArticle, revisionAction: "lead", instruction: "Kortere ingress" } });
    expect(response.statusCode, response.body).toBe(200);
    expect(mocks.version.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "v1", sakId: "s1" }) }));
    expect(mocks.queue.mock.calls[0]?.[1]).toMatchObject({ baseVersionId: "v1", revisionAction: "lead", previousArticleJson: { ...editedArticle, sources: article.sources }, materials: [{ sourceId: "material_m1", publisher: "Bloomberg" }] });
  });
  it("rejects a base version outside this draft before reserving a generation", async () => {
    mocks.version.findFirst.mockResolvedValue(null);
    const response = await app.inject({ method: "POST", url: "/sak/s1/generate", headers: { "x-sak-owner": owner }, payload: { baseVersionId: "foreign-version" } });
    expect(response.statusCode).toBe(400);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });
  it("still scopes the request to its owner", async () => {
    mocks.draft.findFirst.mockResolvedValue(null);
    const response = await app.inject({ method: "POST", url: "/sak/s1/generate", headers: { "x-sak-owner": "another-editor" }, payload: {} });
    expect(response.statusCode).toBe(404);
    expect(mocks.draft.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ownerId: "another-editor" }) }));
    expect(mocks.reserve).not.toHaveBeenCalled();
  });
});
describe("pasted replacement sources", () => {
  it("updates the existing material and preserves its URL, identity and priority", async () => {
    const response = await app.inject({ method: "POST", url: "/sak/s1/materials/text", headers: { "x-sak-owner": owner }, payload: { replaceMaterialId: "m1", text: "(Bloomberg) -- Corrected original source text.", publisher: "Bloomberg" } });
    expect(response.statusCode, response.body).toBe(201);
    expect(mocks.material.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "m1" }, data: expect.objectContaining({ url: material.url, metadataJson: expect.objectContaining({ priority: 100, publisher: "Bloomberg" }) }) }));
    expect(response.json()).toMatchObject({ id: "m1", url: material.url, extractedText: expect.stringContaining("Corrected") });
    expect(mocks.material.create).not.toHaveBeenCalled();
  });
  it("rejects replacing a material belonging to another draft", async () => {
    mocks.material.findFirst.mockResolvedValue(null);
    const response = await app.inject({ method: "POST", url: "/sak/s1/materials/text", headers: { "x-sak-owner": owner }, payload: { replaceMaterialId: "other", text: "Valid replacement text" } });
    expect(response.statusCode).toBe(404);
    expect(mocks.material.update).not.toHaveBeenCalled();
  });
});

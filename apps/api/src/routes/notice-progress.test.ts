import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ control: vi.fn(), run: vi.fn() }));
vi.mock("@newsweb/shared/db", () => ({
  prisma: { noticeGenerationControl: { findFirst: db.control } },
  logPrisma: { generationRun: { findUnique: db.run } }
}));
import { noticeRoutes } from "./notice.js";
let handler: (request: any, reply: any) => Promise<any>;
const now = new Date("2026-09-15T14:00:00Z");
beforeEach(async () => {
  vi.clearAllMocks();
  const app = {
    get: (path: string, _options: unknown, route: typeof handler) => { if (path === "/notice/:messageId/status") handler = route; },
    post: vi.fn(), delete: vi.fn(), patch: vi.fn(), authenticate: vi.fn()
  };
  await noticeRoutes(app as never, {});
  db.control.mockResolvedValue({ generationRunId: "own-run", messageId: 123, clientRequestId: null, status: "running", targetVersion: 2, resultRewriteId: null, errorText: null, createdAt: now, updatedAt: now });
  db.run.mockResolvedValue({ id: "own-run", phase: "correcting_notice", phaseUpdatedAt: now });
});
function reply() { const r = { header: vi.fn(), code: vi.fn(), send: vi.fn() }; r.code.mockReturnValue(r); return r; }
it("returns real progress for the exact request, with no caching", async () => {
  const res = reply();
  const payload = await handler({ params: { messageId: "123" }, query: { generationRunId: "own-run" } }, res);
  expect(db.control).toHaveBeenCalledWith({ where: { generationRunId: "own-run", messageId: 123 } });
  expect(db.run).toHaveBeenCalledWith({ where: { id: "own-run" }, select: { id: true, phase: true, phaseUpdatedAt: true } });
  expect(payload.request).toMatchObject({ generationRunId: "own-run", phase: "correcting_notice", phaseUpdatedAt: now.toISOString() });
  expect(res.header).toHaveBeenCalledWith("Cache-Control", "private, no-store");
});
it("does not look up or expose progress for a missing request", async () => {
  db.control.mockResolvedValue(null); const res = reply();
  await handler({ params: { messageId: 123 }, query: { generationRunId: "other-run" } }, res);
  expect(res.code).toHaveBeenCalledWith(404); expect(db.run).not.toHaveBeenCalled();
});
it("stops returning writing progress once the request has finished", async () => {
  db.control.mockResolvedValue({ ...(await db.control()), status: "published", resultRewriteId: "result-2" });
  const payload = await handler({ params: { messageId: 123 }, query: { generationRunId: "own-run" } }, reply());
  expect(payload).toMatchObject({ ready: true, request: { phase: null, state: "published" } });
  expect(db.run).not.toHaveBeenCalled();
});
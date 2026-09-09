import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  source: { findUnique: vi.fn() },
  controls: { findUnique: vi.fn(), findFirst: vi.fn() },
  run: { create: vi.fn(), update: vi.fn() },
  createRequest: vi.fn(), reserve: vi.fn(), queue: vi.fn()
}));
vi.mock("@newsweb/shared/db", () => ({
  prisma: { sourceNotice: mocks.source, noticeGenerationControl: mocks.controls },
  logPrisma: { generationRun: mocks.run }
}));
vi.mock("@newsweb/shared/generation-control", async (original) => ({
  ...await original<typeof import("@newsweb/shared/generation-control")>(),
  createGenerationRequest: mocks.createRequest
}));
vi.mock("../services/rewrite-reservation.js", () => ({
  reserveRewriteGeneration: mocks.reserve,
  releaseRewriteGenerationSlot: vi.fn(),
  ActiveGenerationConflictError: class extends Error {}
}));
vi.mock("../services/editorial-telemetry.js", async (original) => ({
  ...await original<typeof import("../services/editorial-telemetry.js")>(),
  tryCreateUserActionEvent: vi.fn()
}));
import { noticeRoutes } from "./notice.js";

const clientRequestId = "00000000-0000-4000-8000-000000000001";
const control = {
  generationRunId: "run-new", clientRequestId, status: "queued",
  targetVersion: null, resultRewriteId: null, errorText: null,
  createdAt: new Date(), updatedAt: new Date()
};
let app: ReturnType<typeof Fastify>;
beforeEach(async () => {
  vi.resetAllMocks();
  mocks.source.findUnique.mockResolvedValue({ messageId: 42, rewrites: [] });
  mocks.createRequest.mockResolvedValue(control);
  mocks.run.create.mockResolvedValue({ id: "run-new" });
  mocks.run.update.mockResolvedValue({});
  mocks.reserve.mockResolvedValue({ targetVersion: 2, previousRewriteJson: null });
  mocks.queue.mockResolvedValue({ id: "job-new" });
  app = Fastify();
  app.decorate("authenticate", async () => undefined);
  app.decorate("config", { FAST_DRAFT_ENABLED: false });
  app.decorate("redis", { get: vi.fn().mockResolvedValue("ready"), publish: vi.fn().mockResolvedValue(1) });
  app.decorate("rewriteQueue", { add: mocks.queue });
  await app.register(noticeRoutes);
});
afterEach(async () => app.close());

describe("notice regeneration reasoning", () => {
  for (const queued of [false, true]) {
    it.each(["failed", "published", "skipped", "pending", "needs_retry", null])(
      `selects reasoning from the latest rewrite (%s), queued=${queued}`,
      async (status) => {
        mocks.source.findUnique.mockResolvedValue({ messageId: 42, rewrites: status ? [{ status }] : [] });
        const payload = { selectedMaterialIds: [], ...(queued ? { clientRequestId } : {}) };
        const response = await app.inject({ method: "POST", url: "/notice/42/generate", payload });
        expect(response.statusCode, response.body).toBe(queued ? 202 : 200);
        expect(mocks.source.findUnique).toHaveBeenCalledWith(expect.objectContaining({
          select: expect.objectContaining({ rewrites: { orderBy: { version: "desc" }, take: 1, select: { status: true } } })
        }));
        const input = queued ? mocks.createRequest.mock.calls[0][1].snapshot : mocks.queue.mock.calls[0][1];
        expect(input.reasoningEffortOverride ?? null).toBe(status === "failed" ? "xhigh" : null);
        if (queued) expect(input.requestInput).toEqual(payload);
        else expect(mocks.run.update.mock.calls[0][0].data.inputJson.reasoningEffortOverride).toBe(status === "failed" ? "xhigh" : null);
      }
    );
    it(`preserves explicitly requested higher reasoning, queued=${queued}`, async () => {
      const response = await app.inject({ method: "POST", url: "/notice/42/generate", payload: {
        selectedMaterialIds: [], reasoningEffortOverride: "xhigh", ...(queued ? { clientRequestId } : {})
      } });
      expect(response.statusCode, response.body).toBe(queued ? 202 : 200);
      const input = queued ? mocks.createRequest.mock.calls[0][1].snapshot : mocks.queue.mock.calls[0][1];
      expect(input.reasoningEffortOverride).toBe("xhigh");
    });
  }

  it.each(["failed", "skipped", "cancelled"])("retries a %s request using its saved inputs", async (status) => {
    const snapshot = {
      instruction: "Keep this instruction", previousRewriteJson: { title: "My edited title" },
      supplementalMaterials: [{ id: "material-1", text: "Saved source" }], reasoningEffortOverride: null
    };
    mocks.controls.findFirst.mockResolvedValue({ generationRunId: "run-prior", status, snapshotJson: snapshot });
    const response = await app.inject({ method: "POST", url: "/notice/42/generate", payload: { clientRequestId, retryOf: "run-prior" } });
    expect(response.statusCode, response.body).toBe(202);
    expect(mocks.createRequest.mock.calls[0][1].snapshot).toEqual({
      ...snapshot, reasoningEffortOverride: status === "failed" ? "xhigh" : null,
      retryOf: "run-prior", requestInput: { clientRequestId, retryOf: "run-prior" }
    });
  });

  it("returns an existing request unchanged after the notice state changes", async () => {
    const payload = { clientRequestId, selectedMaterialIds: [] };
    mocks.source.findUnique.mockResolvedValue({ messageId: 42, rewrites: [{ status: "failed" }] });
    mocks.controls.findUnique.mockResolvedValue({ ...control, snapshotJson: { requestInput: payload, reasoningEffortOverride: null } });
    const response = await app.inject({ method: "POST", url: "/notice/42/generate", payload });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().generationRunId).toBe("run-new");
    expect(mocks.createRequest).not.toHaveBeenCalled();
  });
});

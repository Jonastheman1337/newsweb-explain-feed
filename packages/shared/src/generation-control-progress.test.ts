import { expect, it } from "vitest";
import type { NoticeGenerationControl } from "@prisma/client";
import { generationControlPayload } from "./generation-control.js";
const now = new Date("2026-09-15T14:00:00Z");
const row: NoticeGenerationControl = { generationRunId: "own-run", messageId: 123, clientRequestId: null, position: 1n, status: "running", targetVersion: 2, snapshotJson: {}, resultRewriteId: null, errorText: null, heartbeatAt: now, createdAt: now, updatedAt: now, finishedAt: null };
it.each(["loading_context", "writing_notice", "correcting_notice", "checking_references", "rechecking_references", "publishing"])("returns the request's own %s phase", phase => {
  expect(generationControlPayload(row, { id: row.generationRunId, phase, phaseUpdatedAt: now })).toMatchObject({ phase, phaseUpdatedAt: now.toISOString() });
});
it("cannot borrow the phase of another generation on the same notice", () => {
  expect(generationControlPayload(row, { id: "other-run", phase: "writing_notice", phaseUpdatedAt: now })).toMatchObject({ phase: null, phaseUpdatedAt: null });
});
it.each(["cancelled", "cancelling", "failed", "published", "skipped"])("does not expose old writing progress for a %s request", status => {
  expect(generationControlPayload({ ...row, status }, { id: row.generationRunId, phase: "writing_notice", phaseUpdatedAt: now }).phase).toBeNull();
});
it("queued requests always show their own queue state", () => {
  expect(generationControlPayload({ ...row, status: "queued" }, { id: row.generationRunId, phase: "writing_notice", phaseUpdatedAt: now }).phase).toBe("queued");
});
it.each(["made_up", "published", "skipped", "failed"])("does not present %s as an active operation", phase => {
  expect(generationControlPayload(row, { id: row.generationRunId, phase, phaseUpdatedAt: now }).phase).toBeNull();
});

import { createHash, randomUUID } from "node:crypto";
import {
  Prisma,
  type PrismaClient,
  type NoticeGenerationControl,
} from "@prisma/client";
import { normalizeRewriteJson } from "./rewrite.js";
import { rewriteOutputSchema } from "./rewrite.js";
import {
  noticeGenerationRequestSchema,
  type NoticeEditorSnapshot,
} from "./notice-editor.js";

export const generationJobId = (runId: string) => `notice-request-${runId}`;
export const CONTROL_TERMINAL = ["published", "skipped", "failed", "cancelled"];
export function generationControlPayload(row: NoticeGenerationControl) {
  return noticeGenerationRequestSchema.parse({
    generationRunId: row.generationRunId,
    clientRequestId: row.clientRequestId,
    state: row.status,
    version: row.targetVersion,
    rewriteId: row.resultRewriteId,
    error: row.errorText,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
export class InvalidEditorBaseError extends Error {}
export class DuplicateGenerationRequestError extends Error {}
export async function resolveNoticeEditorBase(
  db: PrismaClient,
  messageId: number,
  base: NoticeEditorSnapshot,
) {
  let rewriteJson: unknown;
  if (base.rewriteId.startsWith("fast:")) {
    const row = await db.fastDraft.findFirst({
      where: { id: base.rewriteId.slice(5), messageId, status: "ready" },
    });
    if (!row || base.contentHash !== row.id)
      throw new InvalidEditorBaseError("Førsteutkastet er ikke tilgjengelig.");
    rewriteJson = row.rewriteJson;
  } else {
    const row = await db.publishedRewrite.findFirst({
      where: { id: base.rewriteId, messageId },
    });
    if (!row || row.contentHash !== base.contentHash)
      throw new InvalidEditorBaseError(
        "Den valgte versjonen er ikke tilgjengelig.",
      );
    rewriteJson = row.rewriteJson;
  }
  const original = rewriteOutputSchema.parse(normalizeRewriteJson(rewriteJson));
  const paragraphs = base.body
    .split(/\n\s*\n/)
    .map((text) => text.trim())
    .filter(Boolean);
  return {
    ...original,
    title: base.title,
    lead: paragraphs[0] ?? "",
    body: paragraphs.slice(1),
  };
}
export function jsonSnapshot(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
export function snapshotHash(value: unknown): string {
  function canonical(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, canonical(v)]),
      );
    return v;
  }
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)) ?? "null")
    .digest("hex");
}
export async function createGenerationRequest(
  db: PrismaClient,
  args: { messageId: number; clientRequestId: string; snapshot: unknown },
) {
  const snapshot = jsonSnapshot(args.snapshot);
  const row = await db.$transaction(async (tx) => {
    await lockNotice(tx, args.messageId);
    return tx.noticeGenerationControl.upsert({
      where: {
        messageId_clientRequestId: {
          messageId: args.messageId,
          clientRequestId: args.clientRequestId,
        },
      },
      create: {
        generationRunId: randomUUID(),
        messageId: args.messageId,
        clientRequestId: args.clientRequestId,
        snapshotJson: snapshot,
      },
      update: {},
    });
  });
  const stored = row.snapshotJson as Record<string, unknown>;
  const incoming = snapshot as Record<string, unknown>;
  if (
    snapshotHash(stored.requestInput ?? stored) !==
    snapshotHash(incoming.requestInput ?? incoming)
  )
    throw new DuplicateGenerationRequestError(
      "Forespørselen er allerede sendt med annet innhold.",
    );
  return row;
}
/** Use the same lock order in admission, cancellation and publication. */
export async function lockNotice(
  tx: Prisma.TransactionClient,
  messageId: number,
) {
  const rows = await tx.$queryRaw<
    Array<{ activeGenerationRunId: string | null; nextRewriteVersion: number }>
  >(Prisma.sql`
    SELECT active_generation_run_id AS "activeGenerationRunId", next_rewrite_version AS "nextRewriteVersion"
    FROM feed_items WHERE message_id=${messageId} FOR UPDATE`);
  if (!rows[0]) throw new Error(`feed_items missing for ${messageId}`);
  return rows[0];
}
/** Called by the worker immediately before execution, not by the HTTP request. */
export async function admitGenerationRequest(db: PrismaClient, runId: string) {
  const found = await db.noticeGenerationControl.findUnique({
    where: { generationRunId: runId },
  });
  if (!found) return { kind: "missing" as const };
  return db.$transaction(async (tx) => {
    const feed = await lockNotice(tx, found.messageId);
    const row = await tx.noticeGenerationControl.findUniqueOrThrow({
      where: { generationRunId: runId },
    });
    if (CONTROL_TERMINAL.includes(row.status) || row.status === "cancelling")
      return { kind: "terminal" as const, row };
    if (feed.activeGenerationRunId && feed.activeGenerationRunId !== runId)
      return { kind: "busy" as const };
    if (row.status === "queued") {
      const earlier = await tx.noticeGenerationControl.findFirst({
        where: {
          messageId: row.messageId,
          status: { in: ["queued", "running", "cancelling"] },
          position: { lt: row.position },
        },
      });
      if (earlier) return { kind: "busy" as const };
    }
    const version = row.targetVersion ?? feed.nextRewriteVersion;
    await tx.feedItem.update({
      where: { messageId: row.messageId },
      data: {
        activeGenerationRunId: runId,
        ...(row.targetVersion == null
          ? { nextRewriteVersion: { increment: 1 } }
          : {}),
      },
    });
    const active = await tx.noticeGenerationControl.update({
      where: { generationRunId: runId },
      data: {
        status: "running",
        targetVersion: version,
        heartbeatAt: new Date(),
      },
    });
    return { kind: "admitted" as const, row: active };
  });
}
export async function cancelGenerationRequest(
  db: PrismaClient,
  messageId: number,
  runId: string,
) {
  return db.$transaction(async (tx) => {
    await lockNotice(tx, messageId);
    const row = await tx.noticeGenerationControl.findFirst({
      where: { generationRunId: runId, messageId },
    });
    if (!row) return null;
    if (CONTROL_TERMINAL.includes(row.status) || row.status === "cancelling")
      return row;
    const queued = row.status === "queued";
    if (queued)
      await tx.feedItem.updateMany({
        where: { messageId, activeGenerationRunId: runId },
        data: { activeGenerationRunId: null },
      });
    return tx.noticeGenerationControl.update({
      where: { generationRunId: runId },
      data: {
        status: queued ? "cancelled" : "cancelling",
        ...(queued ? { finishedAt: new Date() } : {}),
      },
    });
  });
}
/** Acknowledge only after the running task has stopped, never release a successor. */
export async function acknowledgeGenerationCancellation(
  db: PrismaClient,
  runId: string,
) {
  const found = await db.noticeGenerationControl.findUnique({
    where: { generationRunId: runId },
  });
  if (!found) return;
  await db.$transaction(async (tx) => {
    await lockNotice(tx, found.messageId);
    const row = await tx.noticeGenerationControl.findUniqueOrThrow({
      where: { generationRunId: runId },
    });
    if (!["cancelling", "cancelled"].includes(row.status)) return;
    await tx.noticeGenerationControl.update({
      where: { generationRunId: runId },
      data: { status: "cancelled", finishedAt: new Date() },
    });
    await tx.rewrite.updateMany({
      where: {
        messageId: row.messageId,
        generationRunId: runId,
        status: { not: "published" },
      },
      data: { status: "failed" },
    });
    await tx.feedItem.updateMany({
      where: { messageId: row.messageId, activeGenerationRunId: runId },
      data: { activeGenerationRunId: null },
    });
  });
}

import { z } from "zod";

/** The text the editor actually submitted, independent of the latest publication. */
export const noticeEditorSnapshotSchema = z.object({
  rewriteId: z.string().min(1).max(100),
  contentHash: z.string().min(1).max(128),
  title: z.string().max(2000),
  body: z.string().max(50_000),
});
export type NoticeEditorSnapshot = z.infer<typeof noticeEditorSnapshotSchema>;

export const noticeGenerationStateSchema = z.enum([
  "queued",
  "running",
  "cancelling",
  "cancelled",
  "published",
  "skipped",
  "failed",
]);
export type NoticeGenerationState = z.infer<typeof noticeGenerationStateSchema>;
export const noticeGenerationRequestSchema = z.object({
  generationRunId: z.string(),
  clientRequestId: z.string().nullable(),
  state: noticeGenerationStateSchema,
  version: z.number().int().nullable(),
  rewriteId: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type NoticeGenerationRequest = z.infer<
  typeof noticeGenerationRequestSchema
>;
export const NOTICE_EDITOR_CAPABILITIES = {
  snapshotRevision: true,
  queuedGeneration: true,
  cancellation: true,
  urlMaterials: true,
} as const;

export function isNoticeGenerationTerminal(
  state: NoticeGenerationState,
): boolean {
  return ["cancelled", "published", "skipped", "failed"].includes(state);
}

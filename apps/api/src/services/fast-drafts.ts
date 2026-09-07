import { fastDraftSchema, type FeedItem } from "@newsweb/shared";
import { prisma } from "@newsweb/shared/db";
export async function loadFastDrafts(messageIds: number[]) {
    const rows = await prisma.fastDraft.findMany({ where: { messageId: { in: messageIds } }, select: { id: true, messageId: true, status: true, startedAt: true, finishedAt: true, deadlineAt: true, rewriteJson: true } });
    const mapped = new Map<number, NonNullable<FeedItem["fastDraft"]>>();
    for (const row of rows) {
        const parsed = fastDraftSchema.safeParse({ id: row.id, status: row.status === "pending" && row.deadlineAt.getTime() < Date.now() ? "failed" : row.status, startedAt: row.startedAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null, ...(row.status === "ready" ? { rewrite: row.rewriteJson } : {}) });
        if (parsed.success)
            mapped.set(row.messageId, parsed.data);
    }
    return mapped;
}

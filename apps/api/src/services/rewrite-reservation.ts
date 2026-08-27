import { logPrisma, prisma } from "@newsweb/shared/db";
import type { Prisma } from "@prisma/client";
import { isGenerationRunActive } from "./generation-status.js";

export class ActiveGenerationConflictError extends Error {
  constructor(readonly generationRunId: string) {
    super("A generation is already active for this notice.");
    this.name = "ActiveGenerationConflictError";
  }
}

type Reservation = {
  targetVersion: number;
  previousRewriteJson: Prisma.JsonValue | null;
};

async function claimAndReserve(
  messageId: number,
  generationRunId: string
): Promise<Reservation | { conflictRunId: string }> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.feedItem.updateMany({
      where: {
        messageId,
        activeGenerationRunId: null
      },
      data: {
        activeGenerationRunId: generationRunId
      }
    });

    if (claimed.count === 0) {
      const current = await tx.feedItem.findUnique({
        where: { messageId },
        select: { activeGenerationRunId: true }
      });
      if (!current) {
        throw new Error(`feed_items missing for ${messageId}`);
      }
      if (current.activeGenerationRunId === generationRunId) {
        throw new Error(`Generation ${generationRunId} already reserved a version.`);
      }
      return {
        conflictRunId: current.activeGenerationRunId ?? "unknown"
      };
    }

    const item = await tx.feedItem.update({
      where: { messageId },
      data: {
        nextRewriteVersion: { increment: 1 }
      },
      select: {
        nextRewriteVersion: true,
        activePublishedRewrite: {
          select: { rewriteJson: true }
        }
      }
    });

    return {
      targetVersion: item.nextRewriteVersion - 1,
      previousRewriteJson: item.activePublishedRewrite?.rewriteJson ?? null
    };
  });
}

async function activeRunIsStillLive(generationRunId: string): Promise<boolean> {
  if (generationRunId === "unknown") return false;
  const run = await logPrisma.generationRun.findUnique({
    where: { id: generationRunId },
    select: {
      id: true,
      status: true,
      phase: true,
      phaseUpdatedAt: true,
      requestedAt: true
    }
  });
  return isGenerationRunActive(run);
}

export async function releaseRewriteGenerationSlot(
  messageId: number,
  generationRunId: string
): Promise<void> {
  await prisma.feedItem.updateMany({
    where: {
      messageId,
      activeGenerationRunId: generationRunId
    },
    data: {
      activeGenerationRunId: null
    }
  });
}

export async function reserveRewriteGeneration(
  messageId: number,
  generationRunId: string
): Promise<Reservation> {
  let reservation = await claimAndReserve(messageId, generationRunId);
  if (!("conflictRunId" in reservation)) {
    return reservation;
  }

  if (await activeRunIsStillLive(reservation.conflictRunId)) {
    throw new ActiveGenerationConflictError(reservation.conflictRunId);
  }

  await releaseRewriteGenerationSlot(messageId, reservation.conflictRunId);
  reservation = await claimAndReserve(messageId, generationRunId);
  if ("conflictRunId" in reservation) {
    throw new ActiveGenerationConflictError(reservation.conflictRunId);
  }
  return reservation;
}

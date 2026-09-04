import { prisma } from "@newsweb/shared/db";
import type { Prisma } from "@prisma/client";
import {
  ActiveGenerationConflictError,
  activeRunIsStillLive
} from "./rewrite-reservation.js";

/**
 * Generation slot for a /sak draft: mirrors rewrite-reservation.ts over
 * sakDraft.activeGenerationRunId + nextVersion. One live generation per
 * draft; a dead run (stale or terminal in the log DB) is evicted so the
 * user is never locked out by a crashed worker.
 */

export type SakReservation = {
  targetVersion: number;
  previousArticleJson: Prisma.JsonValue | null;
};

type SakReservationTx = {
  sakDraft: {
    updateMany(args: {
      where: { id: string; activeGenerationRunId: string | null };
      data: { activeGenerationRunId: string | null };
    }): Promise<{ count: number }>;
    findUnique(args: {
      where: { id: string };
      select: { activeGenerationRunId: true };
    }): Promise<{ activeGenerationRunId: string | null } | null>;
    update(args: {
      where: { id: string };
      data: { nextVersion: { increment: number } };
      select: { nextVersion: true };
    }): Promise<{ nextVersion: number }>;
  };
  sakVersion: {
    findFirst(args: {
      where: { sakId: string; status: { in: string[] } };
      orderBy: { version: "desc" };
      select: { articleJson: true };
    }): Promise<{ articleJson: Prisma.JsonValue | null } | null>;
  };
};

export type SakReservationClient = {
  $transaction<T>(fn: (tx: SakReservationTx) => Promise<T>): Promise<T>;
  sakDraft: {
    updateMany(args: {
      where: { id: string; activeGenerationRunId: string };
      data: { activeGenerationRunId: null };
    }): Promise<{ count: number }>;
  };
};

export type SakReservationDeps = {
  client?: SakReservationClient;
  isRunStillLive?: (generationRunId: string) => Promise<boolean>;
};

export class SakDraftMissingError extends Error {
  constructor(readonly sakId: string) {
    super(`sak_drafts missing for ${sakId}`);
    this.name = "SakDraftMissingError";
  }
}

const PREVIOUS_VERSION_STATUSES = ["ready", "needs_review"];

async function claimAndReserve(
  client: SakReservationClient,
  sakId: string,
  generationRunId: string
): Promise<SakReservation | { conflictRunId: string }> {
  return client.$transaction(async (tx) => {
    const claimed = await tx.sakDraft.updateMany({
      where: { id: sakId, activeGenerationRunId: null },
      data: { activeGenerationRunId: generationRunId }
    });

    if (claimed.count === 0) {
      const current = await tx.sakDraft.findUnique({
        where: { id: sakId },
        select: { activeGenerationRunId: true }
      });
      if (!current) {
        throw new SakDraftMissingError(sakId);
      }
      if (current.activeGenerationRunId === generationRunId) {
        throw new Error(`Generation ${generationRunId} already reserved a version.`);
      }
      return { conflictRunId: current.activeGenerationRunId ?? "unknown" };
    }

    const draft = await tx.sakDraft.update({
      where: { id: sakId },
      data: { nextVersion: { increment: 1 } },
      select: { nextVersion: true }
    });
    const previous = await tx.sakVersion.findFirst({
      where: { sakId, status: { in: PREVIOUS_VERSION_STATUSES } },
      orderBy: { version: "desc" },
      select: { articleJson: true }
    });

    return {
      targetVersion: draft.nextVersion - 1,
      previousArticleJson: previous?.articleJson ?? null
    };
  });
}

export async function releaseSakGenerationSlot(
  sakId: string,
  generationRunId: string,
  deps: SakReservationDeps = {}
): Promise<void> {
  const client = deps.client ?? (prisma as unknown as SakReservationClient);
  await client.sakDraft.updateMany({
    where: { id: sakId, activeGenerationRunId: generationRunId },
    data: { activeGenerationRunId: null }
  });
}

export async function reserveSakGeneration(
  sakId: string,
  generationRunId: string,
  deps: SakReservationDeps = {}
): Promise<SakReservation> {
  const client = deps.client ?? (prisma as unknown as SakReservationClient);
  const isRunStillLive = deps.isRunStillLive ?? activeRunIsStillLive;

  let reservation = await claimAndReserve(client, sakId, generationRunId);
  if (!("conflictRunId" in reservation)) {
    return reservation;
  }

  if (await isRunStillLive(reservation.conflictRunId)) {
    throw new ActiveGenerationConflictError(reservation.conflictRunId);
  }

  await releaseSakGenerationSlot(sakId, reservation.conflictRunId, { client });
  reservation = await claimAndReserve(client, sakId, generationRunId);
  if ("conflictRunId" in reservation) {
    throw new ActiveGenerationConflictError(reservation.conflictRunId);
  }
  return reservation;
}

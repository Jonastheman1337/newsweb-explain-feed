import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { ActiveGenerationConflictError } from "./rewrite-reservation.js";
import {
  SakDraftMissingError,
  releaseSakGenerationSlot,
  reserveSakGeneration,
  type SakReservationClient
} from "./sak-reservation.js";

type DraftState = { id: string; activeGenerationRunId: string | null; nextVersion: number };
type VersionState = { version: number; status: string; articleJson: Prisma.JsonValue | null };

function fakeClient(draft: DraftState | null, versions: VersionState[] = []) {
  const state = draft ? { ...draft } : null;
  const tx = {
    sakDraft: {
      async updateMany(args: {
        where: { id: string; activeGenerationRunId: string | null };
        data: { activeGenerationRunId: string | null };
      }) {
        if (!state || state.id !== args.where.id) return { count: 0 };
        if (state.activeGenerationRunId !== args.where.activeGenerationRunId) return { count: 0 };
        state.activeGenerationRunId = args.data.activeGenerationRunId;
        return { count: 1 };
      },
      async findUnique(args: { where: { id: string } }) {
        return state && state.id === args.where.id
          ? { activeGenerationRunId: state.activeGenerationRunId }
          : null;
      },
      async update(args: { where: { id: string }; data: { nextVersion: { increment: number } } }) {
        if (!state || state.id !== args.where.id) throw new Error("missing");
        state.nextVersion += args.data.nextVersion.increment;
        return { nextVersion: state.nextVersion };
      }
    },
    sakVersion: {
      async findFirst(args: { where: { status: { in: string[] } } }) {
        const candidates = versions
          .filter((version) => args.where.status.in.includes(version.status))
          .sort((a, b) => b.version - a.version);
        return candidates[0] ? { articleJson: candidates[0].articleJson } : null;
      }
    }
  };
  const client: SakReservationClient = {
    async $transaction(fn) {
      return fn(tx);
    },
    sakDraft: {
      async updateMany(args) {
        if (!state || state.id !== args.where.id) return { count: 0 };
        if (state.activeGenerationRunId !== args.where.activeGenerationRunId) return { count: 0 };
        state.activeGenerationRunId = null;
        return { count: 1 };
      }
    }
  };
  return { client, state: () => state };
}

describe("reserveSakGeneration", () => {
  it("claims the slot, bumps nextVersion and returns the latest readable article", async () => {
    const article = { title: "Forrige" } as unknown as Prisma.JsonValue;
    const { client, state } = fakeClient({ id: "sak1", activeGenerationRunId: null, nextVersion: 3 }, [
      { version: 1, status: "ready", articleJson: { title: "Eldre" } as unknown as Prisma.JsonValue },
      { version: 2, status: "needs_review", articleJson: article },
      { version: 3, status: "failed", articleJson: null }
    ]);

    const reservation = await reserveSakGeneration("sak1", "run-a", { client });
    expect(reservation).toEqual({ targetVersion: 3, previousArticleJson: article });
    expect(state()).toMatchObject({ activeGenerationRunId: "run-a", nextVersion: 4 });
  });

  it("refuses while another run is live", async () => {
    const { client } = fakeClient({ id: "sak1", activeGenerationRunId: "run-live", nextVersion: 2 });
    await expect(
      reserveSakGeneration("sak1", "run-b", { client, isRunStillLive: async () => true })
    ).rejects.toBeInstanceOf(ActiveGenerationConflictError);
  });

  it("evicts a dead run and takes over", async () => {
    const { client, state } = fakeClient({ id: "sak1", activeGenerationRunId: "run-dead", nextVersion: 2 });
    const reservation = await reserveSakGeneration("sak1", "run-c", {
      client,
      isRunStillLive: async () => false
    });
    expect(reservation).toEqual({ targetVersion: 2, previousArticleJson: null });
    expect(state()?.activeGenerationRunId).toBe("run-c");
  });

  it("fails loudly for a missing draft", async () => {
    const { client } = fakeClient(null);
    await expect(reserveSakGeneration("nope", "run-d", { client })).rejects.toBeInstanceOf(
      SakDraftMissingError
    );
  });
});

describe("releaseSakGenerationSlot", () => {
  it("only releases the slot it owns", async () => {
    const { client, state } = fakeClient({ id: "sak1", activeGenerationRunId: "run-x", nextVersion: 2 });
    await releaseSakGenerationSlot("sak1", "run-other", { client });
    expect(state()?.activeGenerationRunId).toBe("run-x");
    await releaseSakGenerationSlot("sak1", "run-x", { client });
    expect(state()?.activeGenerationRunId).toBeNull();
  });
});

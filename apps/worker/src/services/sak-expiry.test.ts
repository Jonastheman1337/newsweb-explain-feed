import { describe, expect, it } from "vitest";
import { SAK_EXPIRY_SWEEP_MS, expireSakDrafts, type SakExpiryClient } from "./sak-expiry.js";

describe("expireSakDrafts", () => {
  it("deletes drafts whose expiry is in the past and returns the count", async () => {
    const calls: Array<{ where: { expiresAt: { lt: Date } } }> = [];
    const client: SakExpiryClient = {
      sakDraft: {
        async deleteMany(args) {
          calls.push(args);
          return { count: 3 };
        }
      }
    };
    const now = new Date("2026-09-04T12:00:00Z");
    await expect(expireSakDrafts(client, now)).resolves.toBe(3);
    expect(calls).toEqual([{ where: { expiresAt: { lt: now } } }]);
  });

  it("sweeps hourly", () => {
    expect(SAK_EXPIRY_SWEEP_MS).toBe(60 * 60 * 1000);
  });
});

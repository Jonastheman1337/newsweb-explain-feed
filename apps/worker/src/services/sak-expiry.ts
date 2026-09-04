/**
 * /sak drafts live SAK_TTL_HOURS from creation (the API stamps expiresAt).
 * This sweep deletes what has expired; materials and versions go with the
 * draft through the FK cascade. The API already filters expired rows out of
 * every read, so the sweep is housekeeping, not access control.
 */

export const SAK_EXPIRY_SWEEP_MS = 60 * 60 * 1000;

export type SakExpiryClient = {
  sakDraft: {
    deleteMany(args: { where: { expiresAt: { lt: Date } } }): Promise<{ count: number }>;
  };
};

export async function expireSakDrafts(
  client: SakExpiryClient,
  now: Date = new Date()
): Promise<number> {
  const result = await client.sakDraft.deleteMany({
    where: { expiresAt: { lt: now } }
  });
  return result.count;
}

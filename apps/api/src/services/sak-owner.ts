import type { IncomingHttpHeaders } from "node:http";
import { z } from "zod";

/**
 * /sak drafts are scoped per browser: the web app sends its locally minted
 * editor id in this header, and every read or write is filtered on it. One
 * shared login, many browsers, no accounts.
 */
export const SAK_OWNER_HEADER = "x-sak-owner";

export const sakOwnerIdSchema = z
  .string()
  .min(8)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);

export function parseSakOwnerHeader(
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>
): string | null {
  const raw = headers[SAK_OWNER_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const parsed = sakOwnerIdSchema.safeParse(value.trim());
  return parsed.success ? parsed.data : null;
}

export function isDraftOwnedAndLive(
  draft: { ownerId: string; expiresAt: Date } | null | undefined,
  ownerId: string,
  now: Date = new Date()
): boolean {
  if (!draft) return false;
  if (draft.ownerId !== ownerId) return false;
  return draft.expiresAt.getTime() > now.getTime();
}

export function sakExpiresAt(now: Date, ttlHours: number): Date {
  return new Date(now.getTime() + Math.max(0, ttlHours) * 60 * 60 * 1000);
}

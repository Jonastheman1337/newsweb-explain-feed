import type { SakVersion } from "@newsweb/shared";

export function formatOsloClock(isoString: string): string {
  return new Intl.DateTimeFormat("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo"
  }).format(new Date(isoString));
}

export function sakShortId(id: string): string {
  return id.slice(-6);
}

export function sakVersionsLabel(count: number): string {
  return `${count} ${count === 1 ? "versjon" : "versjoner"}`;
}

export function sortSakVersions(versions: SakVersion[]): SakVersion[] {
  return [...versions].sort((a, b) => a.version - b.version);
}

export function sakVersionHasArticle(
  version: SakVersion
): version is SakVersion & { article: NonNullable<SakVersion["article"]> } {
  return (
    version.article != null &&
    (version.status === "ready" || version.status === "needs_review")
  );
}

function messageOf(entry: unknown): string | null {
  if (typeof entry === "string") return entry.trim() || null;
  if (entry && typeof entry === "object") {
    const record = entry as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message.trim();
    }
    if (typeof record.code === "string" && record.code.trim()) {
      return record.code.trim();
    }
  }
  return null;
}

function isBlockingIssue(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const record = entry as Record<string, unknown>;
  return record.blocking === true || record.severity === "blocking";
}

/**
 * Blocking validator messages from `SakVersion.validation`. The shape is
 * owned by the worker (`{issues, blockingErrors, warnings}`), so read it
 * defensively and fall back to an empty list.
 */
export function extractSakBlockingMessages(validation: unknown): string[] {
  if (!validation || typeof validation !== "object") return [];
  const record = validation as Record<string, unknown>;

  const fromBlocking = Array.isArray(record.blockingErrors)
    ? record.blockingErrors.map(messageOf)
    : [];
  const fromIssues = Array.isArray(record.issues)
    ? record.issues.filter(isBlockingIssue).map(messageOf)
    : [];

  const messages = (fromBlocking.length ? fromBlocking : fromIssues).filter(
    (message): message is string => message != null
  );
  return Array.from(new Set(messages));
}

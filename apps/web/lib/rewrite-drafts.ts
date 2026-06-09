"use client";

export type RewriteDraft = {
  title: string;
  body: string;
  bodyHtml?: string;
  updatedAt: string;
};

export type RewriteDraftChangeDetail = {
  messageId: number;
  version: number;
  hasDraft: boolean;
};

export const REWRITE_DRAFT_CHANGE_EVENT = "newsweb:rewrite-draft-change";

function getDraftStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getRewriteDraftKey(messageId: number, version?: number | null): string | null {
  if (version == null) return null;
  return `newsweb:rewrite-draft:${messageId}:${version}`;
}

export function isSameAsOriginal(args: {
  title: string;
  body: string;
  bodyHtml?: string | null;
  originalTitle: string;
  originalBody: string;
  originalBodyHtml?: string | null;
}): boolean {
  const sameText =
    args.title === args.originalTitle && args.body === args.originalBody;
  if (!sameText) return false;

  if (args.bodyHtml != null || args.originalBodyHtml != null) {
    return (args.bodyHtml ?? null) === (args.originalBodyHtml ?? null);
  }

  return true;
}

function parseDraft(value: string | null): RewriteDraft | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<RewriteDraft>;
    if (typeof parsed.title !== "string" || typeof parsed.body !== "string") {
      return null;
    }

    return {
      title: parsed.title,
      body: parsed.body,
      bodyHtml:
        typeof parsed.bodyHtml === "string" ? parsed.bodyHtml : undefined,
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date().toISOString()
    };
  } catch {
    return null;
  }
}

function emitDraftChange(messageId: number, version: number, hasDraft: boolean) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<RewriteDraftChangeDetail>(REWRITE_DRAFT_CHANGE_EVENT, {
      detail: { messageId, version, hasDraft }
    })
  );
}

export function getRewriteDraft(args: {
  messageId: number;
  version?: number | null;
  originalTitle?: string;
  originalBody?: string;
  originalBodyHtml?: string;
}): RewriteDraft | null {
  const storage = getDraftStorage();
  if (!storage) return null;

  const key = getRewriteDraftKey(args.messageId, args.version);
  if (!key) return null;

  const draft = parseDraft(storage.getItem(key));
  if (!draft) return null;

  if (
    args.originalTitle != null &&
    args.originalBody != null &&
    isSameAsOriginal({
      title: draft.title,
      body: draft.body,
      bodyHtml: draft.bodyHtml,
      originalTitle: args.originalTitle,
      originalBody: args.originalBody,
      originalBodyHtml: args.originalBodyHtml
    })
  ) {
    if (draft.bodyHtml != null && args.originalBodyHtml == null) {
      return draft;
    }

    storage.removeItem(key);
    emitDraftChange(args.messageId, args.version as number, false);
    return null;
  }

  return draft;
}

export function hasRewriteDraft(args: {
  messageId: number;
  version?: number | null;
  originalTitle?: string;
  originalBody?: string;
}): boolean {
  return getRewriteDraft(args) != null;
}

export function saveRewriteDraft(args: {
  messageId: number;
  version?: number | null;
  title: string;
  body: string;
  bodyHtml?: string;
  originalTitle: string;
  originalBody: string;
  originalBodyHtml?: string;
}): RewriteDraft | null {
  const storage = getDraftStorage();
  if (!storage) return null;

  const key = getRewriteDraftKey(args.messageId, args.version);
  if (!key || args.version == null) return null;

  if (
    isSameAsOriginal({
      title: args.title,
      body: args.body,
      bodyHtml: args.bodyHtml,
      originalTitle: args.originalTitle,
      originalBody: args.originalBody,
      originalBodyHtml: args.originalBodyHtml
    })
  ) {
    storage.removeItem(key);
    emitDraftChange(args.messageId, args.version, false);
    return null;
  }

  const draft = {
    title: args.title,
    body: args.body,
    bodyHtml: args.bodyHtml,
    updatedAt: new Date().toISOString()
  };
  try {
    storage.setItem(key, JSON.stringify(draft));
  } catch {
    return null;
  }
  emitDraftChange(args.messageId, args.version, true);
  return draft;
}

export function deleteRewriteDraft(args: {
  messageId: number;
  version?: number | null;
}) {
  const storage = getDraftStorage();
  if (!storage) return;

  const key = getRewriteDraftKey(args.messageId, args.version);
  if (!key || args.version == null) return;

  storage.removeItem(key);
  emitDraftChange(args.messageId, args.version, false);
}

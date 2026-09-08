"use client";

import { useEffect, useState } from "react";

// Per-browser presentation preferences for /next. Like drafts, nothing is
// synced across devices; the first render always uses defaults so the server
// and client markup agree.
export const NEXT_PREFS_KEY = "newsweb:next-prefs";
export const NEXT_PREFS_CHANGE_EVENT = "newsweb:next-prefs-change";
export const SOURCE_FONT_STEPS = [13, 14, 15, 16] as const;
export const SOURCE_RATIO_MIN = 0.3;
export const SOURCE_RATIO_MAX = 0.7;
export const SOURCE_RATIO_STEP = 0.02;
export const NOTICE_CHARS_DEFAULT = 1000;
export const NOTICE_CHARS_MIN = 300;
export const NOTICE_CHARS_MAX = 4000;
export const NOTICE_CHARS_PRESETS = [600, 800, 1000, 1300, 1800, 2500] as const;

export type SourceFontPx = (typeof SOURCE_FONT_STEPS)[number];
export type NextPrefs = { sourceRatio?: number; sourceFontPx?: SourceFontPx; noticeChars?: number };

export function clampNoticeChars(value: number): number {
  const chars = Number.isFinite(value) ? Math.round(value) : NOTICE_CHARS_DEFAULT;
  return Math.min(NOTICE_CHARS_MAX, Math.max(NOTICE_CHARS_MIN, chars));
}

// Fallback only when storage throws (private mode, blocked site data): the
// preference still applies to every open card for the rest of the session.
let memoryPrefs: NextPrefs = {};

export function clampSourceRatio(value: number): number {
  const ratio = Number.isFinite(value) ? value : SOURCE_RATIO_MIN;
  const clamped = Math.min(SOURCE_RATIO_MAX, Math.max(SOURCE_RATIO_MIN, ratio));
  return Math.round(clamped * 1000) / 1000;
}

function isFontStep(value: unknown): value is SourceFontPx {
  return SOURCE_FONT_STEPS.includes(value as SourceFontPx);
}

function sanitize(value: unknown): NextPrefs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const prefs: NextPrefs = {};
  if (typeof raw.sourceRatio === "number" && Number.isFinite(raw.sourceRatio))
    prefs.sourceRatio = clampSourceRatio(raw.sourceRatio);
  if (isFontStep(raw.sourceFontPx)) prefs.sourceFontPx = raw.sourceFontPx;
  if (typeof raw.noticeChars === "number" && Number.isFinite(raw.noticeChars))
    prefs.noticeChars = clampNoticeChars(raw.noticeChars);
  return prefs;
}

export function readNextPrefs(): NextPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(NEXT_PREFS_KEY);
    return raw ? sanitize(JSON.parse(raw)) : {};
  } catch {
    return memoryPrefs;
  }
}

/** Merge a patch into the stored preferences; `undefined` removes a field. */
export function writeNextPrefs(patch: Partial<NextPrefs>): void {
  if (typeof window === "undefined") return;
  const next = { ...readNextPrefs(), ...patch } as Record<string, unknown>;
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  memoryPrefs = sanitize(next);
  try {
    window.localStorage.setItem(NEXT_PREFS_KEY, JSON.stringify(memoryPrefs));
  } catch {
    /* Kept in memory only. */
  }
  window.dispatchEvent(new Event(NEXT_PREFS_CHANGE_EVENT));
}

export function useNextPrefs(): NextPrefs {
  const [prefs, setPrefs] = useState<NextPrefs>({});
  useEffect(() => {
    const refresh = () => setPrefs(readNextPrefs());
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === NEXT_PREFS_KEY) refresh();
    };
    refresh();
    window.addEventListener(NEXT_PREFS_CHANGE_EVENT, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(NEXT_PREFS_CHANGE_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return prefs;
}

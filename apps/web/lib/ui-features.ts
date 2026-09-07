// Server-only rollout decisions. A missing flag always preserves the legacy UI.
export function readUiFeatures(env: Record<string, string | undefined>) {
  return {
    uiV2: env.UI_V2_ENABLED === "true",
    // Reserved for the separate fast-draft milestone; no generation consumer yet.
    fastDraft: env.FAST_DRAFT_ENABLED === "true"
  };
}

export function loginDestination(next?: string): string {
  return next === "/next" ? "/next" : "/feed";
}

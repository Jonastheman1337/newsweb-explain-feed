// Server-only rollout decisions. A missing flag always preserves the legacy UI.
export function readUiFeatures(env: Record<string, string | undefined>) {
  return {
    uiV2: env.UI_V2_ENABLED === "true",
    // The worker and API use this independent opt-in as well.
    fastDraft: env.FAST_DRAFT_ENABLED === "true"
  };
}

export function loginDestination(next?: string): string {
  return next === "/legacy" ? "/legacy" : "/";
}

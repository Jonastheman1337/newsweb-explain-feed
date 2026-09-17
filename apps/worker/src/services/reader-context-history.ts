import type { PromptPayload, RelatedNoticePayload } from "@newsweb/prompt-kit";
import { trustedHistoryDecision, historyInputHash } from "./notice-history.js";
/** Preserve the exact evidence underlying an already validated triage decision. */
export function mergeReaderContext(payload: PromptPayload, selected: RelatedNoticePayload[]): void {
  const decision = trustedHistoryDecision(payload);
  if (!decision) { payload.relatedNotices = selected; return; }
  const retained = new Map((payload.relatedNotices ?? []).map(source => [source.messageId, source]));
  for (const source of selected) if (!retained.has(source.messageId)) retained.set(source.messageId, source);
  payload.relatedNotices = [...retained.values()];
  payload.historyDecision = { ...decision, inputHash: historyInputHash(payload) };
}

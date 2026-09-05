import { buildNoticeEvidence, isResultsNotice, type NoticePayload } from "./notice-evidence.js";
import type { DeterministicTriageSkip } from "./newsworthiness-triage.js";

/** A missing report attachment cannot establish that the report contains no news.
 * Let the shared pipeline assess the current facts and retain source failures. */
export function deferUnavailableReportSkip(payload: NoticePayload, skip: DeterministicTriageSkip | null): boolean {
  return skip?.classId === "document-only" && payload.hasAttachments &&
    isResultsNotice(payload, "regular") && !buildNoticeEvidence(payload).attachmentTextAvailable;
}

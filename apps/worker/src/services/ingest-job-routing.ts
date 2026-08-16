export const ingestJobNames = {
  cleanup: "cleanup-job-runs",
  numericShadowMonitor: "numeric-shadow-monitor",
  poll: "poll-list",
  notice: "ingest-notice"
} as const;

export type IngestJobKind = keyof typeof ingestJobNames | "unsupported";

export function classifyIngestJobName(name: string): IngestJobKind {
  for (const [kind, jobName] of Object.entries(ingestJobNames)) {
    if (name === jobName) return kind as keyof typeof ingestJobNames;
  }
  return "unsupported";
}

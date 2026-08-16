import { z } from "zod";

export const NUMERIC_SHADOW_MONITOR_APP_SETTING_KEY =
  "numericShadowMonitorV1";
export const NUMERIC_SHADOW_MONITOR_SCHEMA_VERSION = 1 as const;
export const NUMERIC_SHADOW_MONITOR_CRON_PATTERN = "30 18 * * 1-5";
export const NUMERIC_SHADOW_MONITOR_TIME_ZONE = "Europe/Oslo";
export const NUMERIC_SHADOW_MONITOR_WINDOW_DAYS = 7;

const numericShadowExampleSchema = z.object({
  messageId: z.number().int().positive(),
  version: z.number().int().nullable(),
  requestedAt: z.string().datetime(),
  status: z.string(),
  candidateDisplays: z.array(z.string()),
  otherUnexpectedDisplays: z.array(z.string()),
  numericWouldClear: z.boolean()
});

const numericShadowRuleSummarySchema = z.object({
  ruleId: z.string(),
  enabled: z.boolean(),
  candidateOccurrences: z.number().int().nonnegative(),
  candidateAssessmentRecords: z.number().int().nonnegative(),
  candidateRuns: z.number().int().nonnegative(),
  candidateNotices: z.number().int().nonnegative(),
  candidateDays: z.number().int().nonnegative(),
  numericWouldClearRuns: z.number().int().nonnegative(),
  derivedOccurrences: z.number().int().nonnegative(),
  newCandidateAssessmentRecords: z.number().int().nonnegative(),
  newestCandidateAt: z.string().datetime().nullable(),
  candidateDisplays: z.array(z.string()),
  examples: z.array(numericShadowExampleSchema)
});

export const numericShadowMonitorSnapshotSchema = z.object({
  schemaVersion: z.literal(NUMERIC_SHADOW_MONITOR_SCHEMA_VERSION),
  generatedAt: z.string().datetime(),
  schedule: z.object({
    pattern: z.string(),
    timezone: z.string()
  }),
  window: z.object({
    days: z.number().int().positive(),
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    throughDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  }),
  enabledRuleIds: z.array(z.string()),
  query: z.object({
    rowLimit: z.number().int().positive(),
    queryTruncated: z.boolean(),
    rowsRead: z.number().int().nonnegative(),
    rowsInWindow: z.number().int().nonnegative(),
    telemetryRows: z.number().int().nonnegative(),
    dedupedRuns: z.number().int().nonnegative(),
    retriesDiscarded: z.number().int().nonnegative()
  }),
  totals: z.object({
    notices: z.number().int().nonnegative(),
    assessedOccurrences: z.number().int().nonnegative(),
    matchedOccurrences: z.number().int().nonnegative(),
    derivedOccurrences: z.number().int().nonnegative(),
    unexpectedOccurrences: z.number().int().nonnegative(),
    shadowCandidateOccurrences: z.number().int().nonnegative(),
    unclassifiedUnexpectedOccurrences: z.number().int().nonnegative()
  }),
  rules: z.array(numericShadowRuleSummarySchema),
  attention: z.object({
    required: z.boolean(),
    reasons: z.array(z.string()),
    newCandidateAssessmentRecords: z.number().int().nonnegative()
  }),
  seenCandidateKeys: z.array(z.string())
});

export type NumericShadowMonitorSnapshot = z.infer<
  typeof numericShadowMonitorSnapshotSchema
>;
export type NumericShadowRuleSummary = NumericShadowMonitorSnapshot["rules"][number];
export type NumericShadowExample = NumericShadowRuleSummary["examples"][number];

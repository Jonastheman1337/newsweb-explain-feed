import {
  NUMERIC_SHADOW_MONITOR_CRON_PATTERN,
  NUMERIC_SHADOW_MONITOR_SCHEMA_VERSION,
  NUMERIC_SHADOW_MONITOR_TIME_ZONE,
  NUMERIC_SHADOW_MONITOR_WINDOW_DAYS,
  type NumericShadowMonitorSnapshot,
  type NumericShadowRuleSummary
} from "@newsweb/shared";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SEEN_CANDIDATE_KEYS = 5_000;
const MAX_RULE_DISPLAYS = 50;
const MAX_RULE_EXAMPLES = 10;

const osloDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: NUMERIC_SHADOW_MONITOR_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export type NumericShadowGenerationRow = {
  id: string;
  messageId: number;
  version: number | null;
  status: string;
  requestedAt: Date;
  validationJson: unknown;
};

type ParsedAssessment = {
  display: string;
  disposition: "matched" | "derived" | "unexpected";
  ruleId: string | null;
  count: number;
  candidateRuleId: string | null;
};

type MutableRuleSummary = Omit<
  NumericShadowRuleSummary,
  | "candidateRuns"
  | "candidateNotices"
  | "candidateDays"
  | "candidateDisplays"
  | "examples"
> & {
  candidateRunKeys: Set<string>;
  candidateNoticeIds: Set<number>;
  candidateDateKeys: Set<string>;
  candidateDisplayValues: Set<string>;
  examples: NumericShadowRuleSummary["examples"];
};

function recordValue(value: unknown): Record<string, unknown> | null {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return null;
    }
  }
  return parsed != null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

function parseAssessments(value: unknown): ParsedAssessment[] | null {
  const validation = recordValue(value);
  if (!validation || !Array.isArray(validation.numberAssessments)) return null;

  const assessments: ParsedAssessment[] = [];
  for (const value of validation.numberAssessments) {
    const assessment = recordValue(value);
    if (!assessment) continue;
    const disposition = assessment.disposition;
    const count = assessment.count;
    if (
      typeof assessment.display !== "string" ||
      !["matched", "derived", "unexpected"].includes(String(disposition)) ||
      typeof count !== "number" ||
      !Number.isInteger(count) ||
      count <= 0
    ) {
      continue;
    }
    assessments.push({
      display: assessment.display,
      disposition: disposition as ParsedAssessment["disposition"],
      ruleId: typeof assessment.ruleId === "string" ? assessment.ruleId : null,
      count,
      candidateRuleId:
        typeof assessment.candidateRuleId === "string"
          ? assessment.candidateRuleId
          : null
    });
  }
  return assessments;
}

export function osloDateKey(value: Date): string {
  const parts = Object.fromEntries(
    osloDateFormatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function rollingOsloDateKeys(
  now: Date,
  days = NUMERIC_SHADOW_MONITOR_WINDOW_DAYS
): string[] {
  const current = osloDateKey(now).split("-").map(Number);
  const anchor = Date.UTC(current[0], current[1] - 1, current[2], 12);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(anchor - (days - index - 1) * DAY_MS);
    return [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, "0"),
      String(date.getUTCDate()).padStart(2, "0")
    ].join("-");
  });
}

export function numericShadowQuerySince(
  now: Date,
  days = NUMERIC_SHADOW_MONITOR_WINDOW_DAYS
): Date {
  // One extra UTC day safely covers the Oslo midnight boundary across DST.
  return new Date(now.getTime() - (days + 1) * DAY_MS);
}

export function previousSeenCandidateKeys(value: unknown): string[] {
  const parsed = recordValue(value);
  if (!parsed || !Array.isArray(parsed.seenCandidateKeys)) return [];
  return parsed.seenCandidateKeys
    .filter((key): key is string => typeof key === "string")
    .slice(0, MAX_SEEN_CANDIDATE_KEYS);
}

function emptyRuleSummary(ruleId: string, enabled: boolean): MutableRuleSummary {
  return {
    ruleId,
    enabled,
    candidateOccurrences: 0,
    candidateAssessmentRecords: 0,
    candidateRunKeys: new Set(),
    candidateNoticeIds: new Set(),
    candidateDateKeys: new Set(),
    numericWouldClearRuns: 0,
    derivedOccurrences: 0,
    newCandidateAssessmentRecords: 0,
    newestCandidateAt: null,
    candidateDisplayValues: new Set(),
    examples: []
  };
}

function candidateKey(
  ruleId: string,
  row: NumericShadowGenerationRow,
  assessment: ParsedAssessment
): string {
  return [
    ruleId,
    row.messageId,
    row.version ?? "null",
    assessment.display,
    assessment.count
  ].join("|");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export function buildNumericShadowMonitorSnapshot(args: {
  rows: NumericShadowGenerationRow[];
  now: Date;
  monitoredRuleIds: readonly string[];
  enabledRuleIds: readonly string[];
  previousSeenCandidateKeys?: readonly string[];
  rowLimit: number;
  queryTruncated: boolean;
  windowDays?: number;
}): NumericShadowMonitorSnapshot {
  const windowDays = args.windowDays ?? NUMERIC_SHADOW_MONITOR_WINDOW_DAYS;
  const windowDateKeys = rollingOsloDateKeys(args.now, windowDays);
  const allowedDateKeys = new Set(windowDateKeys);
  const enabledRuleIds = [...new Set(args.enabledRuleIds)];
  const enabledRules = new Set(enabledRuleIds);
  const previousKeys = new Set(args.previousSeenCandidateKeys ?? []);

  const rowsInWindow = args.rows.filter((row) =>
    allowedDateKeys.has(osloDateKey(row.requestedAt))
  );
  const telemetryRows = rowsInWindow
    .map((row) => ({ row, assessments: parseAssessments(row.validationJson) }))
    .filter(
      (
        item
      ): item is { row: NumericShadowGenerationRow; assessments: ParsedAssessment[] } =>
        item.assessments != null
    )
    .sort((left, right) => {
      const timeDifference =
        right.row.requestedAt.getTime() - left.row.requestedAt.getTime();
      return timeDifference || right.row.id.localeCompare(left.row.id);
    });

  const latestByNoticeVersion = new Map<
    string,
    { row: NumericShadowGenerationRow; assessments: ParsedAssessment[] }
  >();
  for (const item of telemetryRows) {
    const key = `${item.row.messageId}:${item.row.version ?? "null"}`;
    if (!latestByNoticeVersion.has(key)) latestByNoticeVersion.set(key, item);
  }
  const latestRuns = [...latestByNoticeVersion.values()];

  const mutableRules = new Map<string, MutableRuleSummary>();
  const ensureRule = (ruleId: string): MutableRuleSummary => {
    let summary = mutableRules.get(ruleId);
    if (!summary) {
      summary = emptyRuleSummary(ruleId, enabledRules.has(ruleId));
      mutableRules.set(ruleId, summary);
    }
    return summary;
  };
  for (const ruleId of args.monitoredRuleIds) ensureRule(ruleId);
  for (const ruleId of enabledRuleIds) ensureRule(ruleId);

  const noticeIds = new Set<number>();
  const currentCandidateKeys = new Set<string>();
  let assessedOccurrences = 0;
  let matchedOccurrences = 0;
  let derivedOccurrences = 0;
  let unexpectedOccurrences = 0;
  let shadowCandidateOccurrences = 0;
  let unclassifiedUnexpectedOccurrences = 0;

  for (const { row, assessments } of latestRuns) {
    noticeIds.add(row.messageId);
    const runKey = `${row.messageId}:${row.version ?? "null"}`;
    const runDateKey = osloDateKey(row.requestedAt);
    const unexpected = assessments.filter(
      (assessment) => assessment.disposition === "unexpected"
    );
    const candidatesByRule = new Map<string, ParsedAssessment[]>();

    for (const assessment of assessments) {
      assessedOccurrences += assessment.count;
      if (assessment.disposition === "matched") {
        matchedOccurrences += assessment.count;
      } else if (assessment.disposition === "derived") {
        derivedOccurrences += assessment.count;
        if (assessment.ruleId) {
          ensureRule(assessment.ruleId).derivedOccurrences += assessment.count;
        }
      } else {
        unexpectedOccurrences += assessment.count;
        if (!assessment.candidateRuleId) {
          unclassifiedUnexpectedOccurrences += assessment.count;
          continue;
        }
        shadowCandidateOccurrences += assessment.count;
        const candidates = candidatesByRule.get(assessment.candidateRuleId) ?? [];
        candidates.push(assessment);
        candidatesByRule.set(assessment.candidateRuleId, candidates);
      }
    }

    for (const [ruleId, candidates] of candidatesByRule) {
      const summary = ensureRule(ruleId);
      const otherUnexpected = unexpected.filter(
        (assessment) => assessment.candidateRuleId !== ruleId
      );
      const numericWouldClear = otherUnexpected.length === 0;
      summary.candidateRunKeys.add(runKey);
      summary.candidateNoticeIds.add(row.messageId);
      summary.candidateDateKeys.add(runDateKey);
      if (numericWouldClear) summary.numericWouldClearRuns += 1;
      if (
        !summary.newestCandidateAt ||
        row.requestedAt.toISOString() > summary.newestCandidateAt
      ) {
        summary.newestCandidateAt = row.requestedAt.toISOString();
      }

      for (const candidate of candidates) {
        summary.candidateOccurrences += candidate.count;
        summary.candidateAssessmentRecords += 1;
        summary.candidateDisplayValues.add(candidate.display);
        const key = candidateKey(ruleId, row, candidate);
        currentCandidateKeys.add(key);
        if (!previousKeys.has(key)) summary.newCandidateAssessmentRecords += 1;
      }

      if (summary.examples.length < MAX_RULE_EXAMPLES) {
        summary.examples.push({
          messageId: row.messageId,
          version: row.version,
          requestedAt: row.requestedAt.toISOString(),
          status: row.status,
          candidateDisplays: uniqueStrings(candidates.map((item) => item.display)),
          otherUnexpectedDisplays: uniqueStrings(
            otherUnexpected.map((item) => item.display)
          ),
          numericWouldClear
        });
      }
    }
  }

  const monitoredOrder = new Map(
    args.monitoredRuleIds.map((ruleId, index) => [ruleId, index])
  );
  const rules = [...mutableRules.values()]
    .sort((left, right) => {
      const leftOrder = monitoredOrder.get(left.ruleId) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = monitoredOrder.get(right.ruleId) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.ruleId.localeCompare(right.ruleId);
    })
    .map<NumericShadowRuleSummary>((summary) => ({
      ruleId: summary.ruleId,
      enabled: summary.enabled,
      candidateOccurrences: summary.candidateOccurrences,
      candidateAssessmentRecords: summary.candidateAssessmentRecords,
      candidateRuns: summary.candidateRunKeys.size,
      candidateNotices: summary.candidateNoticeIds.size,
      candidateDays: summary.candidateDateKeys.size,
      numericWouldClearRuns: summary.numericWouldClearRuns,
      derivedOccurrences: summary.derivedOccurrences,
      newCandidateAssessmentRecords: summary.newCandidateAssessmentRecords,
      newestCandidateAt: summary.newestCandidateAt,
      candidateDisplays: [...summary.candidateDisplayValues]
        .sort()
        .slice(0, MAX_RULE_DISPLAYS),
      examples: summary.examples
    }));

  const attentionReasons: string[] = [];
  if (shadowCandidateOccurrences > 0) {
    attentionReasons.push(
      `${shadowCandidateOccurrences} current shadow candidate occurrence(s) require human review.`
    );
  }
  if (args.queryTruncated) {
    attentionReasons.push(
      `The generation query reached its ${args.rowLimit}-row limit; the window may be incomplete.`
    );
  }
  if (rowsInWindow.length > 0 && telemetryRows.length === 0) {
    attentionReasons.push(
      "Generation traffic exists, but no numeric assessment telemetry was found."
    );
  }
  const monitoredRules = new Set(args.monitoredRuleIds);
  const unknownCandidateRules = rules
    .filter(
      (summary) =>
        summary.candidateOccurrences > 0 && !monitoredRules.has(summary.ruleId)
    )
    .map((summary) => summary.ruleId);
  if (unknownCandidateRules.length > 0) {
    attentionReasons.push(
      `Unknown shadow candidate rule(s): ${unknownCandidateRules.join(", ")}.`
    );
  }
  const unconfiguredDerivedRules = rules
    .filter(
      (summary) => summary.derivedOccurrences > 0 && !enabledRules.has(summary.ruleId)
    )
    .map((summary) => summary.ruleId);
  if (unconfiguredDerivedRules.length > 0) {
    attentionReasons.push(
      `Derived numbers appeared for rule(s) not reported as enabled: ${unconfiguredDerivedRules.join(", ")}.`
    );
  }

  const newCandidateAssessmentRecords = rules.reduce(
    (total, summary) => total + summary.newCandidateAssessmentRecords,
    0
  );
  const seenCandidateKeys = [
    ...currentCandidateKeys,
    ...(args.previousSeenCandidateKeys ?? [])
  ]
    .filter((key, index, values) => values.indexOf(key) === index)
    .slice(0, MAX_SEEN_CANDIDATE_KEYS);

  return {
    schemaVersion: NUMERIC_SHADOW_MONITOR_SCHEMA_VERSION,
    generatedAt: args.now.toISOString(),
    schedule: {
      pattern: NUMERIC_SHADOW_MONITOR_CRON_PATTERN,
      timezone: NUMERIC_SHADOW_MONITOR_TIME_ZONE
    },
    window: {
      days: windowDays,
      fromDate: windowDateKeys[0],
      throughDate: windowDateKeys.at(-1) ?? windowDateKeys[0]
    },
    enabledRuleIds,
    query: {
      rowLimit: args.rowLimit,
      queryTruncated: args.queryTruncated,
      rowsRead: args.rows.length,
      rowsInWindow: rowsInWindow.length,
      telemetryRows: telemetryRows.length,
      dedupedRuns: latestRuns.length,
      retriesDiscarded: telemetryRows.length - latestRuns.length
    },
    totals: {
      notices: noticeIds.size,
      assessedOccurrences,
      matchedOccurrences,
      derivedOccurrences,
      unexpectedOccurrences,
      shadowCandidateOccurrences,
      unclassifiedUnexpectedOccurrences
    },
    rules,
    attention: {
      required: attentionReasons.length > 0,
      reasons: attentionReasons,
      newCandidateAssessmentRecords
    },
    seenCandidateKeys
  };
}

import { describe, expect, it } from "vitest";
import { numericShadowMonitorSnapshotSchema } from "@newsweb/shared";
import {
  buildNumericShadowMonitorSnapshot,
  rollingOsloDateKeys,
  type NumericShadowGenerationRow
} from "./numeric-shadow-monitor.js";

const monitoredRuleIds = ["source_cell_subrun", "verbal_minus_match"];

function row(args: {
  id: string;
  messageId?: number;
  version?: number | null;
  requestedAt?: string;
  status?: string;
  assessments?: unknown[];
  validationJson?: unknown;
}): NumericShadowGenerationRow {
  return {
    id: args.id,
    messageId: args.messageId ?? 680000,
    version: args.version === undefined ? 1 : args.version,
    requestedAt: new Date(args.requestedAt ?? "2026-08-14T10:00:00.000Z"),
    status: args.status ?? "failed",
    validationJson:
      args.validationJson ?? { numberAssessments: args.assessments ?? [] }
  };
}

function candidate(
  display: string,
  candidateRuleId: string,
  count = 1
): Record<string, unknown> {
  return {
    display,
    disposition: "unexpected",
    ruleId: null,
    candidateRuleId,
    count
  };
}

function snapshot(
  rows: NumericShadowGenerationRow[],
  overrides: Partial<
    Parameters<typeof buildNumericShadowMonitorSnapshot>[0]
  > = {}
) {
  return buildNumericShadowMonitorSnapshot({
    rows,
    now: new Date("2026-08-16T12:00:00.000Z"),
    monitoredRuleIds,
    enabledRuleIds: [],
    rowLimit: 5_000,
    queryTruncated: false,
    ...overrides
  });
}

describe("numeric shadow monitor", () => {
  it("keeps only the latest telemetry-bearing retry per notice and version", () => {
    const result = snapshot([
      row({
        id: "old",
        requestedAt: "2026-08-14T09:00:00.000Z",
        assessments: [candidate("297 689", "source_cell_subrun")]
      }),
      row({
        id: "new",
        requestedAt: "2026-08-14T10:00:00.000Z",
        assessments: []
      }),
      row({
        id: "other-version",
        version: 2,
        requestedAt: "2026-08-14T09:30:00.000Z",
        assessments: [candidate("161", "verbal_minus_match")]
      })
    ]);

    expect(result.query).toMatchObject({
      telemetryRows: 3,
      dedupedRuns: 2,
      retriesDiscarded: 1
    });
    expect(
      result.rules.find((rule) => rule.ruleId === "source_cell_subrun")
        ?.candidateOccurrences
    ).toBe(0);
    expect(
      result.rules.find((rule) => rule.ruleId === "verbal_minus_match")
        ?.candidateOccurrences
    ).toBe(1);
  });

  it("separates numeric-blocker clearance from mixed unexpected numbers", () => {
    const result = snapshot([
      row({
        id: "mixed",
        messageId: 680001,
        assessments: [
          candidate("297 689", "source_cell_subrun", 2),
          {
            display: "42",
            disposition: "unexpected",
            ruleId: null,
            count: 1
          }
        ]
      }),
      row({
        id: "candidate-only",
        messageId: 680002,
        assessments: [candidate("161", "verbal_minus_match")]
      })
    ]);

    const source = result.rules.find(
      (rule) => rule.ruleId === "source_cell_subrun"
    );
    const verbal = result.rules.find(
      (rule) => rule.ruleId === "verbal_minus_match"
    );
    expect(source).toMatchObject({
      candidateOccurrences: 2,
      candidateAssessmentRecords: 1,
      candidateRuns: 1,
      candidateNotices: 1,
      numericWouldClearRuns: 0
    });
    expect(source?.examples[0]).toMatchObject({
      numericWouldClear: false,
      otherUnexpectedDisplays: ["42"]
    });
    expect(verbal).toMatchObject({
      candidateOccurrences: 1,
      numericWouldClearRuns: 1
    });
    expect(result.totals).toMatchObject({
      assessedOccurrences: 4,
      unexpectedOccurrences: 4,
      shadowCandidateOccurrences: 3,
      unclassifiedUnexpectedOccurrences: 1
    });
    expect(result.attention.required).toBe(true);
  });

  it("uses exact Oslo calendar days across the DST transition", () => {
    const now = new Date("2026-03-30T12:00:00.000Z");
    expect(rollingOsloDateKeys(now, 7)).toEqual([
      "2026-03-24",
      "2026-03-25",
      "2026-03-26",
      "2026-03-27",
      "2026-03-28",
      "2026-03-29",
      "2026-03-30"
    ]);

    const result = snapshot(
      [
        row({
          id: "included",
          messageId: 680003,
          requestedAt: "2026-03-23T23:30:00.000Z",
          assessments: [candidate("1", "source_cell_subrun")]
        }),
        row({
          id: "excluded",
          messageId: 680004,
          requestedAt: "2026-03-23T22:30:00.000Z",
          assessments: [candidate("2", "source_cell_subrun")]
        })
      ],
      { now }
    );

    expect(result.query.rowsInWindow).toBe(1);
    expect(result.rules[0].candidateOccurrences).toBe(1);
  });

  it("persists candidate fingerprints so repeat runs distinguish new evidence", () => {
    const rows = [
      row({
        id: "candidate",
        assessments: [candidate("297 689", "source_cell_subrun")]
      })
    ];
    const first = snapshot(rows);
    const second = snapshot(rows, {
      previousSeenCandidateKeys: first.seenCandidateKeys
    });

    expect(first.attention.newCandidateAssessmentRecords).toBe(1);
    expect(second.attention.newCandidateAssessmentRecords).toBe(0);
    expect(second.attention.required).toBe(true);
  });

  it("tracks enabled derivations without treating them as shadow candidates", () => {
    const result = snapshot(
      [
        row({
          id: "derived",
          status: "success",
          assessments: [
            {
              display: "297 689",
              disposition: "derived",
              ruleId: "source_cell_subrun",
              count: 2
            }
          ]
        })
      ],
      { enabledRuleIds: ["source_cell_subrun"] }
    );

    expect(result.totals).toMatchObject({
      derivedOccurrences: 2,
      shadowCandidateOccurrences: 0
    });
    expect(result.rules[0]).toMatchObject({
      enabled: true,
      derivedOccurrences: 2,
      candidateOccurrences: 0
    });
    expect(result.attention.required).toBe(false);
    expect(numericShadowMonitorSnapshotSchema.safeParse(result).success).toBe(true);
  });

  it("flags traffic with missing numeric telemetry", () => {
    const result = snapshot([
      row({ id: "legacy", validationJson: { errors: [] } })
    ]);

    expect(result.query).toMatchObject({ rowsInWindow: 1, telemetryRows: 0 });
    expect(result.attention.required).toBe(true);
    expect(result.attention.reasons[0]).toContain("no numeric assessment telemetry");
  });
});

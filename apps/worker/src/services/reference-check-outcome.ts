import {
  defaultReferenceCheckEnforcement,
  resolveReferenceCheckOutcome,
  type ReferenceCheckEnforcementConfig,
  type ReferenceCheckerErrorEntry,
  type ReferenceCheckGateResult,
  type ReferenceCheckOutcome,
  type ReferenceCoverageReport
} from "./reference-check.js";

export type ReferenceRepairHistoryEntry = {
  checkNumber: number;
  correctionAttempt: number;
  coveragePercent: number;
  unsupportedSentenceCount: number;
  highRiskUnsupportedSentenceCount: number;
  blocking: boolean;
  blockingReason: string | null;
  unsupportedSentences: Array<{
    index: number;
    sentence: string;
    interpretation: string;
  }>;
};

export type ReferenceRepairResult = {
  checkerError: string | null;
  checkerErrors: ReferenceCheckerErrorEntry[];
  correctionAttempts: number;
  initialCoverage: ReferenceCoverageReport | null;
  finalCoverage: ReferenceCoverageReport | null;
  repairHistory: ReferenceRepairHistoryEntry[];
};

// Flow-level state for the up-to-three reference repair stages per
// generation run. absorbReferenceRepairResult reproduces the hand-written
// absorb blocks byte-identically; the persisted-JSON builders below own the
// validationJson.referenceCheck literal all flows share.
export type ReferenceRepairAccumulator = {
  // Legacy overwrite semantics: always the LAST stage's error (or null).
  // The admin "checker error:" summary and checker_error_count telemetry
  // series depend on this staying unchanged through the shadow window.
  checkerError: string | null;
  // Accumulated classified failures, re-staged to run-global check numbers.
  checkerErrors: ReferenceCheckerErrorEntry[];
  correctionApplied: boolean;
  correctionAttempts: number;
  repairHistory: ReferenceRepairHistoryEntry[];
  // initialCoverage is only ever taken from the FIRST stage, even when that
  // stage errored before producing coverage — later stages never touch it.
  initialCoverage: ReferenceCoverageReport | null;
  finalCoverage: ReferenceCoverageReport | null;
  absorbedStages: number;
};

export function createReferenceRepairAccumulator(): ReferenceRepairAccumulator {
  return {
    checkerError: null,
    checkerErrors: [],
    correctionApplied: false,
    correctionAttempts: 0,
    repairHistory: [],
    initialCoverage: null,
    finalCoverage: null,
    absorbedStages: 0
  };
}

export function absorbReferenceRepairResult(
  state: ReferenceRepairAccumulator,
  result: ReferenceRepairResult
): void {
  const stageOffset = state.repairHistory.length;
  state.checkerError = result.checkerError;
  state.checkerErrors.push(
    ...result.checkerErrors.map((entry) => ({
      ...entry,
      stage: entry.stage + stageOffset
    }))
  );
  state.correctionApplied =
    state.correctionApplied || result.correctionAttempts > 0;
  state.correctionAttempts += result.correctionAttempts;
  state.repairHistory = [...state.repairHistory, ...result.repairHistory];
  if (state.absorbedStages === 0) {
    state.initialCoverage = result.initialCoverage;
  }
  state.finalCoverage =
    result.finalCoverage ?? result.initialCoverage ?? state.finalCoverage;
  state.absorbedStages += 1;
}

export function resolveAccumulatedReferenceCheckOutcome(
  state: ReferenceRepairAccumulator
): ReferenceCheckOutcome {
  return resolveReferenceCheckOutcome({
    checkerErrors: state.checkerErrors,
    initialCoverage: state.initialCoverage,
    finalCoverage: state.finalCoverage,
    correctionAttempts: state.correctionAttempts,
    completedCheckCount: state.repairHistory.length
  });
}

// Failure paths can fire before any reference-check stage ran (the initial
// draft call throwing); persisting an outcome there would count generation
// failures as checker unavailability in the shadow telemetry.
export function maybeAccumulatedReferenceCheckOutcome(
  state: ReferenceRepairAccumulator
): ReferenceCheckOutcome | undefined {
  return state.absorbedStages > 0
    ? resolveAccumulatedReferenceCheckOutcome(state)
    : undefined;
}

// The persisted shadow record. Additive-only: it is appended as the LAST key
// of the existing referenceCheck literals so every legacy key keeps its
// position; the enforcement snapshot records which config was active when
// the run persisted, so the shadow window is self-describing.
export function referenceCheckOutcomeJson(
  outcome: ReferenceCheckOutcome,
  enforcement: ReferenceCheckEnforcementConfig = defaultReferenceCheckEnforcement
): Record<string, unknown> {
  return {
    state: outcome.state,
    evaluatedCoverage: outcome.evaluatedCoverage,
    degraded: outcome.degraded,
    evidenceStale: outcome.evidenceStale,
    checkerErrors: outcome.checkerErrors,
    shadow: {
      wouldBlock: outcome.wouldBlock,
      wouldRetry: outcome.wouldRetry,
      enforcement: {
        blockOnResidualUnsupported: enforcement.blockOnResidualUnsupported,
        retryOnUnavailable: enforcement.retryOnUnavailable
      }
    }
  };
}

export function referenceCoverageJson(
  coverage: ReferenceCoverageReport | null
): Record<string, unknown> | null {
  if (!coverage) return null;
  return {
    totalSentences: coverage.totalSentences,
    visibleArticleSentenceCount: coverage.visibleArticleSentenceCount,
    groundedSentences: coverage.groundedSentences,
    coveragePercent: coverage.coveragePercent,
    sentenceReviews: coverage.items.map((item) => ({
      index: item.index,
      sentence: item.sentence,
      grounded: item.grounded,
      interpretation: item.interpretation,
      sourceEvidence: item.sourceEvidence
    })),
    unsupportedSentences: coverage.unsupportedSentences.map((item) => ({
      index: item.index,
      sentence: item.sentence,
      interpretation: item.interpretation,
      sourceEvidence: item.sourceEvidence
    }))
  };
}

export type ReferenceCheckFlowAudit = {
  attributionCorrectionApplied: boolean;
  attributionRiskCount: number;
  importanceAdjusted: boolean;
  importanceAdjustReason: string | null;
};

// The full validationJson.referenceCheck literal. Key order is frozen:
// admin-signals and pull-signals consumers read this shape, and the byte-
// identity guard in reference-check-outcome.test.ts pins it.
export function referenceCheckValidationJson(
  state: ReferenceRepairAccumulator,
  gate: ReferenceCheckGateResult,
  flow: ReferenceCheckFlowAudit,
  outcome?: ReferenceCheckOutcome
): Record<string, unknown> {
  const { initialCoverage, finalCoverage } = state;
  return {
    enabled: true,
    checkerError: state.checkerError,
    correctionApplied: state.correctionApplied,
    correctionAttempts: state.correctionAttempts,
    repairHistory: state.repairHistory,
    attributionCorrectionApplied: flow.attributionCorrectionApplied,
    attributionRiskCount: flow.attributionRiskCount,
    initialCoveragePercent: initialCoverage?.coveragePercent ?? null,
    finalCoveragePercent:
      finalCoverage?.coveragePercent ??
      initialCoverage?.coveragePercent ??
      null,
    importanceAdjusted: flow.importanceAdjusted,
    importanceAdjustReason: flow.importanceAdjustReason,
    blocking: gate.blocking,
    blockingReason: gate.reason,
    highRiskUnsupportedSentenceCount: gate.highRiskUnsupportedSentences.length,
    initialCoverage: referenceCoverageJson(initialCoverage),
    finalCoverage: referenceCoverageJson(finalCoverage ?? initialCoverage),
    totalSentences:
      finalCoverage?.totalSentences ?? initialCoverage?.totalSentences ?? 0,
    unsupportedSentenceCount:
      finalCoverage?.unsupportedSentences.length ??
      initialCoverage?.unsupportedSentences.length ??
      0,
    sentenceReviews: (finalCoverage?.items ?? initialCoverage?.items ?? []).map(
      (item) => ({
        index: item.index,
        sentence: item.sentence,
        grounded: item.grounded,
        interpretation: item.interpretation,
        sourceEvidence: item.sourceEvidence
      })
    ),
    unsupportedSentences: (
      finalCoverage?.unsupportedSentences ??
      initialCoverage?.unsupportedSentences ??
      []
    ).map((item) => ({
      index: item.index,
      sentence: item.sentence,
      interpretation: item.interpretation,
      sourceEvidence: item.sourceEvidence
    })),
    ...(outcome ? { outcome: referenceCheckOutcomeJson(outcome) } : {})
  };
}

// The reduced literal the regular flow persists on its failure paths. Its
// key order and missing-fallback semantics differ from the full literal on
// purpose — frozen as-is.
export function referenceCheckFailureJson(
  state: ReferenceRepairAccumulator,
  flow: ReferenceCheckFlowAudit,
  outcome?: ReferenceCheckOutcome
): Record<string, unknown> {
  const { initialCoverage, finalCoverage } = state;
  return {
    enabled: true,
    checkerError: state.checkerError,
    correctionApplied: state.correctionApplied,
    correctionAttempts: state.correctionAttempts,
    repairHistory: state.repairHistory,
    attributionCorrectionApplied: flow.attributionCorrectionApplied,
    attributionRiskCount: flow.attributionRiskCount,
    importanceAdjusted: flow.importanceAdjusted,
    importanceAdjustReason: flow.importanceAdjustReason,
    initialCoveragePercent: initialCoverage?.coveragePercent ?? null,
    finalCoveragePercent: finalCoverage?.coveragePercent ?? null,
    initialCoverage: referenceCoverageJson(initialCoverage),
    finalCoverage: referenceCoverageJson(finalCoverage),
    ...(outcome ? { outcome: referenceCheckOutcomeJson(outcome) } : {})
  };
}

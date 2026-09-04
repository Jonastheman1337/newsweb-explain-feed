import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PromptPayload } from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";
import { evaluateTriageClasses } from "./newsworthiness-triage.js";
import {
  classifyLegacyCheckerErrorMessage,
  referenceCheckSourceValues,
  resolveReferenceCheckOutcome,
  type ReferenceCheckerErrorEntry,
  type ReferenceCheckOutcomeState,
  type ReferenceCheckSource,
  type ReferenceCoverageItem,
  type ReferenceCoverageReport,
  type ReferencePriorContext
} from "./reference-check.js";
import {
  detectMarkerLeaks,
  validateRewriteOutput,
  visibleArticleText
} from "./rewrite-validation.js";

export const safetyGateClasses = [
  "numeric_false_block",
  "numeric_unresolved",
  "checker_error_published",
  "marker_leak",
  "loaded_language",
  "routine_not_news",
  "false_skip"
] as const;

export type SafetyGateClass = (typeof safetyGateClasses)[number];

// What the CI gate replays per class. Integrity-only classes freeze data and
// stored dispositions until a deterministic detector ships for them; P4
// flipped checker_error_published and marker_leak to replayable behaviors.
export const safetyClassBehavior = {
  numeric_false_block: "validation",
  numeric_unresolved: "validation",
  checker_error_published: "checker_outcome",
  marker_leak: "marker",
  loaded_language: "integrity_only",
  routine_not_news: "triage",
  false_skip: "triage"
} as const satisfies Record<
  SafetyGateClass,
  "validation" | "triage" | "integrity_only" | "checker_outcome" | "marker"
>;

export type SafetyValidationExpectation = {
  issueCodes: string[];
  hasUnexpectedNumbers: boolean;
  blocking: boolean;
};

export type SafetyTriageExpectation = {
  deterministicSkipKind: string | null;
  // Registered classes that match but are not in the enabled default —
  // the shadow signal, registry order.
  shadowSkipClassIds: string[];
};

export type SafetyCheckerOutcomeExpectation = {
  state: ReferenceCheckOutcomeState;
  evaluatedCoverage: "final" | "initial" | "none";
  wouldBlock: boolean;
  wouldRetry: boolean;
  checkerErrorKinds: string[];
};

export type SafetyMarkerExpectation = {
  categories: string[];
  patternIds: string[];
  wouldBlock: boolean;
};

export type SafetyCaseExpected = {
  validation?: SafetyValidationExpectation;
  triage?: SafetyTriageExpectation;
  checkerOutcome?: SafetyCheckerOutcomeExpectation;
  marker?: SafetyMarkerExpectation;
};

export type SafetyCase = {
  messageId: number;
  generationRunId: string | null;
  promptVersion: string | null;
  sourcePayload: PromptPayload;
  storedOutput: RewriteOutput | null;
  storedValidation: unknown;
  labels: { class: SafetyGateClass; note?: string; reportRef?: string };
  // Filled by seeder replay of the current validators, never written by hand.
  expected: SafetyCaseExpected;
  provenance: {
    window: { from: string; to: string };
    status: string | null;
    feedback?: string[];
  };
};

export type SafetyFixtureFile = {
  schemaVersion: 1;
  class: SafetyGateClass;
  createdAt: string;
  source: { db: string; query: string; gitHead: string };
  cases: SafetyCase[];
};

export type SafetyFixtureManifest = {
  schemaVersion: 1;
  corpusId: string;
  createdAt: string;
  files: Array<{
    path: string;
    class: SafetyGateClass;
    caseCount: number;
    contentSha256: string;
  }>;
  uniformExpectations: Partial<Record<SafetyGateClass, string>>;
  excludedNumericMessageIds: number[];
  sourceQueries: Record<string, string>;
};

export function safetyFixturesDir(): string {
  return fileURLToPath(
    new URL("../fixtures/editorial-eval/safety/", import.meta.url)
  );
}

export async function loadSafetyFixtureManifest(): Promise<SafetyFixtureManifest | null> {
  try {
    const raw = await fs.readFile(
      path.join(safetyFixturesDir(), "manifest.json"),
      "utf8"
    );
    return JSON.parse(raw) as SafetyFixtureManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function loadSafetyFixtureFile(
  relativePath: string
): Promise<SafetyFixtureFile> {
  const raw = await fs.readFile(
    path.join(safetyFixturesDir(), relativePath),
    "utf8"
  );
  return JSON.parse(raw) as SafetyFixtureFile;
}

export function replayValidationExpectation(
  item: Pick<SafetyCase, "sourcePayload" | "storedOutput">
): SafetyValidationExpectation | null {
  if (!item.storedOutput) return null;
  const result = validateRewriteOutput(item.storedOutput, item.sourcePayload);
  const issueCodes = [...new Set(result.issues.map((issue) => issue.code))].sort();
  return {
    issueCodes,
    hasUnexpectedNumbers: issueCodes.includes("UNEXPECTED_NUMBERS"),
    blocking: result.blockingErrors.length > 0
  };
}

export function replayTriageExpectation(
  item: Pick<SafetyCase, "sourcePayload">
): SafetyTriageExpectation {
  const payload = item.sourcePayload;
  // Mirrors the worker's deterministic pre-triage call exactly, bare (no
  // options), so CI replays the code-default enabled set like production.
  const evaluation = evaluateTriageClasses(
    payload.title,
    [payload.bodyText, payload.pdfSupplementText ?? ""]
      .filter(Boolean)
      .join("\n\n"),
    payload.categories,
    payload.hasAttachments,
    payload.issuerName,
    payload.bodyText
  );
  return {
    deterministicSkipKind: evaluation.enabledSkip?.kind ?? null,
    shadowSkipClassIds: [...evaluation.shadowSkipClassIds]
  };
}

// Rebuilds a ReferenceCoverageReport from the persisted
// validationJson.referenceCheck coverage blob (referenceCoverageJson shape:
// sentenceReviews carry the grounded flags; unsupported set is derived from
// them, matching buildCoverageReport semantics).
function coverageReportFromStored(
  raw: unknown
): ReferenceCoverageReport | null {
  // Strict: a blob missing the referenceCoverageJson fields returns null and
  // fails the never-flips coverage invariant LOUDLY, instead of silently
  // reconstructing a vacuous report that would turn the gate into a no-op.
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const blob = raw as Record<string, unknown>;
  if (
    typeof blob.totalSentences !== "number" ||
    typeof blob.visibleArticleSentenceCount !== "number" ||
    typeof blob.groundedSentences !== "number" ||
    typeof blob.coveragePercent !== "number" ||
    !Array.isArray(blob.sentenceReviews)
  ) {
    return null;
  }
  const items = blob.sentenceReviews
    .filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === "object" && !Array.isArray(item)
    )
    .map((item): ReferenceCoverageItem => ({
      index: Number(item.index ?? 0),
      sentence: String(item.sentence ?? ""),
      grounded: Boolean(item.grounded),
      interpretation: String(item.interpretation ?? ""),
      sourceEvidence: String(item.sourceEvidence ?? ""),
      ...(isReferenceCheckSource(item.source) ? { source: item.source } : {})
    }));
  const priorContext = priorContextFromStored(blob.priorContext);
  return {
    totalSentences: blob.totalSentences,
    visibleArticleSentenceCount: blob.visibleArticleSentenceCount,
    // Frozen safety rows predate title checking: their visible count is
    // lead + body only. Preserve the historical <=3 short-article gate when
    // replaying them instead of treating the stored count as title-inclusive.
    visibleArticleSentenceCountIncludesTitle: false,
    groundedSentences: blob.groundedSentences,
    coveragePercent: blob.coveragePercent,
    items,
    unsupportedSentences: items.filter((item) => !item.grounded),
    ...(typeof blob.headSentenceCount === "number"
      ? { headSentenceCount: blob.headSentenceCount }
      : {}),
    ...(priorContext ? { priorContext } : {})
  };
}

function isReferenceCheckSource(value: unknown): value is ReferenceCheckSource {
  return (
    typeof value === "string" &&
    (referenceCheckSourceValues as readonly string[]).includes(value)
  );
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function priorContextFromStored(raw: unknown): ReferencePriorContext | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const blob = raw as Record<string, unknown>;
  return {
    sourceIds: stringList(blob.sourceIds),
    issuerAliases: stringList(blob.issuerAliases),
    timeMarkers: stringList(blob.timeMarkers)
  };
}

export function replayCheckerOutcomeExpectation(
  item: Pick<SafetyCase, "storedValidation">
): SafetyCheckerOutcomeExpectation | null {
  const stored = item.storedValidation as Record<string, unknown> | null;
  const nestedValidation =
    stored && typeof stored.validation === "object"
      ? (stored.validation as Record<string, unknown>)
      : null;
  const referenceCheck =
    stored && typeof stored === "object"
      ? ((stored.referenceCheck ?? nestedValidation?.referenceCheck) as
          | Record<string, unknown>
          | undefined)
      : undefined;
  if (!referenceCheck || typeof referenceCheck !== "object") return null;
  // Prefer the structured entries the P4 worker persists (exact kinds and
  // multi-stage history); fall back to classifying the legacy last-error
  // string for pre-P4 rows.
  const storedOutcome =
    referenceCheck.outcome && typeof referenceCheck.outcome === "object"
      ? (referenceCheck.outcome as Record<string, unknown>)
      : null;
  const storedEntries = Array.isArray(storedOutcome?.checkerErrors)
    ? (storedOutcome!.checkerErrors as unknown[]).filter(
        (entry): entry is Record<string, unknown> =>
          !!entry && typeof entry === "object" && !Array.isArray(entry)
      )
    : [];
  const message =
    typeof referenceCheck.checkerError === "string"
      ? referenceCheck.checkerError
      : null;
  const checkerErrors: ReferenceCheckerErrorEntry[] =
    storedEntries.length > 0
      ? storedEntries.map((entry, index) => ({
          stage: typeof entry.stage === "number" ? entry.stage : index + 1,
          kind: String(
            entry.kind ?? "unknown"
          ) as ReferenceCheckerErrorEntry["kind"],
          message: String(entry.message ?? ""),
          ...(typeof entry.afterCorrection === "boolean"
            ? { afterCorrection: entry.afterCorrection }
            : {})
        }))
      : message
        ? [
            {
              stage: 1,
              kind: classifyLegacyCheckerErrorMessage(message).kind,
              message
            }
          ]
        : [];
  const outcome = resolveReferenceCheckOutcome({
    checkerErrors,
    initialCoverage: coverageReportFromStored(referenceCheck.initialCoverage),
    finalCoverage: coverageReportFromStored(referenceCheck.finalCoverage),
    correctionAttempts: Number(referenceCheck.correctionAttempts ?? 0)
  });
  return {
    state: outcome.state,
    evaluatedCoverage: outcome.evaluatedCoverage,
    wouldBlock: outcome.wouldBlock,
    wouldRetry: outcome.wouldRetry,
    checkerErrorKinds: [
      ...new Set(checkerErrors.map((entry) => entry.kind))
    ].sort()
  };
}

export function replayMarkerExpectation(
  item: Pick<SafetyCase, "storedOutput">
): SafetyMarkerExpectation | null {
  if (!item.storedOutput) return null;
  const matches = detectMarkerLeaks(visibleArticleText(item.storedOutput));
  return {
    categories: [...new Set(matches.map((match) => match.category))].sort(),
    patternIds: [...new Set(matches.map((match) => match.id))].sort(),
    wouldBlock: matches.length > 0
  };
}

export function replayExpected(item: SafetyCase): SafetyCaseExpected {
  const behavior = safetyClassBehavior[item.labels.class];
  if (behavior === "validation") {
    const validation = replayValidationExpectation(item);
    return validation ? { validation } : {};
  }
  if (behavior === "triage") {
    return { triage: replayTriageExpectation(item) };
  }
  if (behavior === "checker_outcome") {
    const checkerOutcome = replayCheckerOutcomeExpectation(item);
    return checkerOutcome ? { checkerOutcome } : {};
  }
  if (behavior === "marker") {
    const marker = replayMarkerExpectation(item);
    return marker ? { marker } : {};
  }
  return {};
}

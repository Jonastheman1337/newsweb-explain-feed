import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PromptPayload } from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";
import { getDeterministicTriageSkip } from "./newsworthiness-triage.js";
import { validateRewriteOutput } from "./rewrite-validation.js";

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
// stored dispositions until P4 ships deterministic detectors for them.
export const safetyClassBehavior = {
  numeric_false_block: "validation",
  numeric_unresolved: "validation",
  checker_error_published: "integrity_only",
  marker_leak: "integrity_only",
  loaded_language: "integrity_only",
  routine_not_news: "triage",
  false_skip: "triage"
} as const satisfies Record<
  SafetyGateClass,
  "validation" | "triage" | "integrity_only"
>;

export type SafetyValidationExpectation = {
  issueCodes: string[];
  hasUnexpectedNumbers: boolean;
  blocking: boolean;
};

export type SafetyTriageExpectation = {
  deterministicSkipKind: string | null;
};

export type SafetyCaseExpected = {
  validation?: SafetyValidationExpectation;
  triage?: SafetyTriageExpectation;
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
  // Mirrors the worker's deterministic pre-triage call exactly.
  const skip = getDeterministicTriageSkip(
    payload.title,
    [payload.bodyText, payload.pdfSupplementText ?? ""]
      .filter(Boolean)
      .join("\n\n"),
    payload.categories,
    payload.hasAttachments,
    payload.issuerName,
    payload.bodyText
  );
  return { deterministicSkipKind: skip?.kind ?? null };
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
  return {};
}

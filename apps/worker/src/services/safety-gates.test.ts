import { describe, expect, it } from "vitest";
import { sha256CanonicalJson } from "./editorial-eval-artifact.js";
import {
  loadSafetyFixtureFile,
  loadSafetyFixtureManifest,
  replayCheckerOutcomeExpectation,
  replayMarkerExpectation,
  replayTriageExpectation,
  replayValidationExpectation,
  safetyClassBehavior,
  type SafetyFixtureFile,
  type SafetyFixtureManifest
} from "./safety-fixtures.js";

const manifest: SafetyFixtureManifest | null = await loadSafetyFixtureManifest();
const fixtureFiles: Array<{
  entry: SafetyFixtureManifest["files"][number];
  file: SafetyFixtureFile;
}> = manifest
  ? await Promise.all(
      manifest.files.map(async (entry) => ({
        entry,
        file: await loadSafetyFixtureFile(entry.path)
      }))
    )
  : [];

describe.runIf(!manifest)("editorial safety gates (not seeded)", () => {
  it("waits for build-safety-fixtures to seed the corpus", () => {
    expect(manifest).toBeNull();
  });
});

describe.runIf(manifest !== null)("editorial safety gates", () => {
  it("matches manifest hashes, classes and counts", () => {
    expect(fixtureFiles.length).toBe(manifest!.files.length);
    for (const { entry, file } of fixtureFiles) {
      expect(file.schemaVersion).toBe(1);
      expect(file.class).toBe(entry.class);
      expect(file.cases.length).toBe(entry.caseCount);
      expect(sha256CanonicalJson(file)).toBe(entry.contentSha256);
    }
  });

  it("labels every case with its file class and keeps message IDs unique per class", () => {
    for (const { file } of fixtureFiles) {
      const seen = new Set<number>();
      for (const item of file.cases) {
        expect(item.labels.class).toBe(file.class);
        expect(seen.has(item.messageId)).toBe(false);
        seen.add(item.messageId);
      }
    }
  });

  for (const { file } of fixtureFiles) {
    const behavior = safetyClassBehavior[file.class];
    describe(file.class, () => {
      for (const item of file.cases) {
        if (behavior === "validation") {
          it(`case ${item.messageId} keeps its expected validation disposition`, () => {
            expect(item.expected.validation).toBeDefined();
            expect(replayValidationExpectation(item)).toEqual(
              item.expected.validation
            );
          });
        } else if (behavior === "triage") {
          it(`case ${item.messageId} keeps its expected deterministic triage`, () => {
            expect(item.expected.triage).toBeDefined();
            expect(replayTriageExpectation(item)).toEqual(item.expected.triage);
          });
        } else if (behavior === "checker_outcome") {
          it(`case ${item.messageId} keeps its expected checker outcome`, () => {
            expect(item.sourcePayload.messageId).toBe(item.messageId);
            expect(item.storedValidation).toBeTruthy();
            expect(item.expected.checkerOutcome).toBeDefined();
            expect(replayCheckerOutcomeExpectation(item)).toEqual(
              item.expected.checkerOutcome
            );
          });
        } else if (behavior === "marker") {
          it(`case ${item.messageId} keeps its expected marker detection`, () => {
            expect(item.sourcePayload.messageId).toBe(item.messageId);
            expect(item.storedValidation).toBeTruthy();
            expect(item.storedOutput).toBeTruthy();
            expect(item.expected.marker).toBeDefined();
            expect(replayMarkerExpectation(item)).toEqual(item.expected.marker);
          });
        } else {
          it(`case ${item.messageId} retains stored evidence`, () => {
            expect(item.sourcePayload.messageId).toBe(item.messageId);
            expect(item.storedValidation).toBeTruthy();
          });
        }
      }

      if (file.class === "false_skip") {
        it("never flips: adjudicated false skips replay proceed with zero shadow candidates", () => {
          // A shadow class matching a known false skip is a FUTURE false
          // skip — new suppression classes must design their exclusions
          // around this corpus before they can be enabled.
          for (const item of file.cases) {
            expect(item.expected.triage?.deterministicSkipKind).toBeNull();
            expect(item.expected.triage?.shadowSkipClassIds).toEqual([]);
          }
        });
      }

      if (file.class === "numeric_unresolved") {
        it("never flips: unresolved numeric cases must keep UNEXPECTED_NUMBERS", () => {
          for (const item of file.cases) {
            expect(item.expected.validation?.hasUnexpectedNumbers).toBe(true);
          }
        });
      }

      if (file.class === "checker_error_published") {
        it("never flips: checker-error cases keep classified errors and coverage evidence", () => {
          for (const item of file.cases) {
            expect(
              item.expected.checkerOutcome?.checkerErrorKinds.length
            ).toBeGreaterThan(0);
            // The published fail-opens all carried real coverage that the
            // legacy gate discarded; the outcome model must keep evaluating it.
            expect(item.expected.checkerOutcome?.evaluatedCoverage).not.toBe(
              "none"
            );
          }
        });

        it("never flips: 675348 remains the published run enforcement would have blocked", () => {
          // The concrete release-record pin (like numeric_unresolved's
          // UNEXPECTED_NUMBERS): a regression in the gate or the coverage
          // reconstruction followed by --update-expected must not silently
          // rewrite the fail-open proof.
          const proof = file.cases.find((item) => item.messageId === 675348);
          expect(proof?.expected.checkerOutcome?.state).toBe(
            "residual_unsupported"
          );
          expect(proof?.expected.checkerOutcome?.wouldBlock).toBe(true);
        });
      }

      if (file.class === "marker_leak") {
        it("never flips: marker-leak cases must always detect a role marker", () => {
          for (const item of file.cases) {
            expect(item.expected.marker?.categories).toContain("role_marker");
            expect(item.expected.marker?.wouldBlock).toBe(true);
          }
        });
      }
    });
  }
});

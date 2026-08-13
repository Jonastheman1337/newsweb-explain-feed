import { describe, expect, it } from "vitest";
import { sha256CanonicalJson } from "./editorial-eval-artifact.js";
import {
  loadSafetyFixtureFile,
  loadSafetyFixtureManifest,
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
        } else {
          it(`case ${item.messageId} retains stored evidence`, () => {
            expect(item.sourcePayload.messageId).toBe(item.messageId);
            expect(item.storedValidation).toBeTruthy();
          });
        }
      }

      if (file.class === "numeric_unresolved") {
        it("never flips: unresolved numeric cases must keep UNEXPECTED_NUMBERS", () => {
          for (const item of file.cases) {
            expect(item.expected.validation?.hasUnexpectedNumbers).toBe(true);
          }
        });
      }
    });
  }
});

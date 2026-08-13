import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getRegularPromptVariantProfile,
  regularPromptVariantIds
} from "@newsweb/prompt-kit";
import { describe, expect, it } from "vitest";
import {
  assertEvalProfileCompatibility,
  canonicalJson,
  createCorpusIdentity,
  evalResponseSchemaProfiles,
  getEvalResponseSchemaProfile,
  resolveEvalArmRunProfile,
  sha256CanonicalJson,
  sourcePayloadSha256,
  writeNewJsonArtifact
} from "./editorial-eval-artifact.js";

describe("evaluation profile registry", () => {
  it("resolves exactly one compatible response schema for every variant", () => {
    for (const variantId of regularPromptVariantIds) {
      const variant = getRegularPromptVariantProfile(variantId);
      const response = getEvalResponseSchemaProfile(variant.responseSchemaId);
      expect(() => assertEvalProfileCompatibility(variant, response)).not.toThrow();
      const runProfile = resolveEvalArmRunProfile({
        arm: "control",
        variantId,
        model: "gpt-test",
        reasoningEffort: "medium",
        serviceTier: "flex"
      });
      expect(runProfile.responseSchemaId).toBe(variant.responseSchemaId);
      expect(runProfile.schemaSha256).toHaveLength(64);
      expect(runProfile.profileSha256).toHaveLength(64);
    }
  });

  it("rejects a deliberate prompt/schema mismatch", () => {
    const variant = getRegularPromptVariantProfile("regular_v6_draft_2");
    expect(() =>
      assertEvalProfileCompatibility(
        variant,
        evalResponseSchemaProfiles.rewrite_v5_title_first_v1
      )
    ).toThrow(/profile mismatch/);
  });
});

describe("evaluation artifact identity", () => {
  it("uses canonical object ordering while preserving array order", () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      '{"a":{"c":3,"d":4},"b":2}'
    );
    expect(sha256CanonicalJson({ a: 1, b: 2 })).toBe(
      sha256CanonicalJson({ b: 2, a: 1 })
    );
    expect(sha256CanonicalJson([1, 2])).not.toBe(sha256CanonicalJson([2, 1]));
  });

  it("derives corpus identity from case IDs and source hashes", () => {
    const cases = [
      { caseId: "c1", payload: { title: "One", body: [1, 2] } },
      { caseId: "c2", payload: { title: "Two", body: [3] } }
    ];
    const identity = createCorpusIdentity(cases, "cases.json");
    expect(identity.corpusId).toBe(
      `editorial_eval_${identity.corpusSha256.slice(0, 16)}`
    );
    expect(identity.caseCount).toBe(2);
    expect(sourcePayloadSha256(cases[0]!.payload)).toHaveLength(64);
  });

  it("writes a complete artifact once and refuses overwrites", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "editorial-eval-"));
    const artifactPath = path.join(directory, "run.json");
    try {
      const artifact = { schemaVersion: 3, assignments: [{ caseId: "c1" }] };
      await writeNewJsonArtifact(artifactPath, artifact);
      expect(JSON.parse(await fs.readFile(artifactPath, "utf8"))).toEqual(artifact);
      await expect(writeNewJsonArtifact(artifactPath, artifact)).rejects.toThrow(
        /Refusing to overwrite immutable artifact/
      );
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

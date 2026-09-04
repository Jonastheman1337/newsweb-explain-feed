import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createRegularPromptVariantMessages,
  getRegularPromptVariantProfile,
  regularPromptVariantIds
} from "@newsweb/prompt-kit";
import { describe, expect, it } from "vitest";
import {
  assertEvalProfileCompatibility,
  assertLockedManualAbPlan,
  assertRetrospectiveBaselineArtifact,
  assertRewriteExecutionParity,
  canonicalJson,
  createCorpusIdentity,
  createLockedManualAbPlan,
  createRetrospectiveBaselineArtifact,
  evalResponseSchemaProfiles,
  getEvalResponseSchemaProfile,
  resolveEvalArmRunProfile,
  resolveReferenceRunProfile,
  sha256CanonicalJson,
  sourcePayloadSha256,
  writeNewJsonArtifact
} from "./editorial-eval-artifact.js";
import {
  blindPipelineSignals,
  blindReviewSourceText,
  createReviewProtocol
} from "./editorial-eval.js";

const baselinePayload = (index: number) => ({
  messageId: 700000 + index,
  title: `Notice ${index}`,
  issuerName: `Issuer ${index}`,
  issuerSign: `I${index}`,
  publishedAt: `2026-09-${String(index + 1).padStart(2, "0")}T08:00:00.000Z`,
  categories: [],
  markets: [],
  bodyText: `Source notice ${index}.`,
  hasAttachments: false,
  sourceBodyChars: 16
});

function retrospectiveRows(count = 15) {
  return Array.from({ length: count }, (_, index) => {
    const payload = baselinePayload(index);
    const prompts = createRegularPromptVariantMessages(
      "regular_v5_9_2_frozen",
      payload
    );
    return {
      id: `run${index}`,
      publishedRewriteId: `published${index}`,
      messageId: 700000 + index,
      version: 1,
      status: "published",
      reason: "new-message",
      requestedAt: "2026-09-03T08:00:00.000Z",
      startedAt: "2026-09-03T08:00:01.000Z",
      finishedAt: "2026-09-03T08:00:02.000Z",
      model: "gpt-5.6-terra",
      promptVersion: "v5.9.2",
      promptChars: 123,
      inputJson: {
        sourcePayload: payload,
        previousRewrite: null,
        reasoningEffortOverride: null,
        modelCalls: [
          {
            provider: "openai",
            schemaName: "rewrite_output",
            model: "gpt-5.6-terra",
            reasoningEffort: "medium",
            requestedServiceTier: "default",
            serviceTier: "default",
            responseModel: "gpt-5.6-terra-2026-08-07",
            maxOutputTokens: 16384,
            systemPrompt: prompts.systemPrompt,
            developerPrompt: prompts.developerPrompt,
            userPrompt: prompts.userPrompt
          },
          {
            provider: "openai",
            schemaName: "reference_check_result",
            model: "gpt-5.6-terra",
            reasoningEffort: "medium",
            requestedServiceTier: "default",
            serviceTier: "default",
            responseModel: "gpt-5.6-terra-2026-08-07",
            maxOutputTokens: 16384,
            systemPrompt: "Reference system",
            developerPrompt: "Reference developer",
            userPrompt: `Reference user ${index}`
          }
        ]
      },
      outputJson: { title: `Output ${index}`, lead: "Lead", body: [] },
      publishedRewriteJson: { title: `Output ${index}`, lead: "Lead", body: [] },
      validationJson: {
        valid: index >= 3,
        errorCode: index < 3 ? "NON_BLOCKING_VALIDATION_WARNINGS" : null,
        referenceCheck: { blocking: false, correctionAttempts: 0 },
        validationRepair: { applied: false },
        styleSanitization: { changed: false }
      }
    };
  });
}

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

describe("retrospective baseline identity", () => {
  it("locks exactly 15 homogeneous stored controls by generation-run ID", () => {
    const rows = retrospectiveRows();
    const artifact = createRetrospectiveBaselineArtifact({
      createdAt: "2026-09-04T00:00:00.000Z",
      host: "test",
      messageIds: rows.map((item) => item.messageId),
      schemaSha256: sha256CanonicalJson(
        evalResponseSchemaProfiles.rewrite_v5_title_first_v1.schema
      ),
      rows
    });

    expect(artifact.cases).toHaveLength(15);
    expect(artifact.source.generationRunIds).toEqual(
      rows.map((item) => item.id)
    );
    expect(artifact.profile).toMatchObject({
      requestedModel: "gpt-5.6-terra",
      requestedReasoningEffort: "medium",
      requestedServiceTier: "default",
      responseModel: "gpt-5.6-terra-2026-08-07",
      serviceTier: "default",
      maxOutputTokens: 16384,
      reference: {
        requestedModel: "gpt-5.6-terra",
        requestedReasoningEffort: "medium",
        requestedServiceTier: "default",
        responseModel: "gpt-5.6-terra-2026-08-07",
        serviceTier: "default",
        maxOutputTokens: 16384
      }
    });
    expect(() => assertRetrospectiveBaselineArtifact(artifact)).not.toThrow();
  });

  it("rejects repaired controls and schema-specific execution drift", () => {
    const repairedRows = retrospectiveRows();
    const firstInput = repairedRows[0]!.inputJson;
    firstInput.modelCalls.push({ ...firstInput.modelCalls[0]! });
    expect(() =>
      createRetrospectiveBaselineArtifact({
        createdAt: "2026-09-04T00:00:00.000Z",
        host: "test",
        messageIds: repairedRows.map((item) => item.messageId),
        schemaSha256: sha256CanonicalJson(
          evalResponseSchemaProfiles.rewrite_v5_title_first_v1.schema
        ),
        rows: repairedRows
      })
    ).toThrow(/homogeneous regular v5\.9\.2 pass/);

    const driftedRows = retrospectiveRows();
    driftedRows[1]!.inputJson.modelCalls[1]!.responseModel = "other-model";
    expect(() =>
      createRetrospectiveBaselineArtifact({
        createdAt: "2026-09-04T00:00:00.000Z",
        host: "test",
        messageIds: driftedRows.map((item) => item.messageId),
        schemaSha256: sha256CanonicalJson(
          evalResponseSchemaProfiles.rewrite_v5_title_first_v1.schema
        ),
        rows: driftedRows
      })
    ).toThrow(/does not match the stored control/);

    const sanitizedRows = retrospectiveRows();
    sanitizedRows[0]!.validationJson.styleSanitization.changed = true;
    expect(() =>
      createRetrospectiveBaselineArtifact({
        createdAt: "2026-09-04T00:00:00.000Z",
        host: "test",
        messageIds: sanitizedRows.map((item) => item.messageId),
        schemaSha256: sha256CanonicalJson(
          evalResponseSchemaProfiles.rewrite_v5_title_first_v1.schema
        ),
        rows: sanitizedRows
      })
    ).toThrow(/homogeneous regular v5\.9\.2 pass/);
  });

  it("requires fresh one-shot calls to match stored requested and actual profiles", () => {
    const rows = retrospectiveRows();
    const baseline = createRetrospectiveBaselineArtifact({
      createdAt: "2026-09-04T00:00:00.000Z",
      host: "test",
      messageIds: rows.map((item) => item.messageId),
      schemaSha256: sha256CanonicalJson(
        evalResponseSchemaProfiles.rewrite_v5_title_first_v1.schema
      ),
      rows
    });
    const call = (schemaName: string) => ({
      schemaName,
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      serviceTierRequested: "default",
      requestedServiceTier: "default",
      responseModel: "gpt-5.6-terra-2026-08-07",
      serviceTier: "default",
      maxOutputTokens: 16384,
      promptHashes: {
        systemSha256: "a",
        developerSha256: "b",
        userSha256: "c",
        combinedSha256: "d"
      }
    });
    const rewriteCall = call("rewrite_output");
    const expected = {
      requestedModel: baseline.profile.requestedModel,
      requestedReasoningEffort: baseline.profile.requestedReasoningEffort,
      requestedServiceTier: baseline.profile.requestedServiceTier,
      responseModel: baseline.profile.responseModel,
      serviceTier: baseline.profile.serviceTier
    };

    expect(() =>
      assertRewriteExecutionParity(expected, rewriteCall, "fresh rewrite")
    ).not.toThrow();
    rewriteCall.serviceTier = "flex";
    expect(() =>
      assertRewriteExecutionParity(expected, rewriteCall, "fresh rewrite")
    ).toThrow(/does not match the stored control/);
  });

  it("keeps prior source text and blind pipeline failures visible", () => {
    expect(
      blindReviewSourceText({
        payload: {
          title: "Current title",
          publishedAt: "2026-09-02T00:00:00.000Z",
          bodyText: "Primary source",
          pdfSupplementText: "Current PDF source",
          supplementalMaterials: [
            {
              id: "material-1",
              sourceId: "editor-1",
              kind: "editor_note",
              title: "Supplement title",
              text: "Supplement source text"
            }
          ],
          relatedNotices: [
            {
              messageId: 1,
              relation: "sibling",
              title: "Related title",
              issuerName: "Issuer",
              issuerSign: "ISS",
              publishedAt: "2026-09-01T00:00:00.000Z",
              text: "Actual prior source text",
              textChars: 24,
              resolvedBy: "db",
              score: 1
            }
          ]
        }
      })
    ).toContain("Current title");
    expect(
      blindReviewSourceText({
        payload: {
          title: "Current title",
          publishedAt: "2026-09-02T00:00:00.000Z",
          bodyText: "Primary source",
          pdfSupplementText: "Current PDF source",
          supplementalMaterials: [
            {
              id: "material-1",
              sourceId: "editor-1",
              kind: "editor_note",
              title: "Supplement title",
              text: "Supplement source text"
            }
          ],
          relatedNotices: [
            {
              messageId: 1,
              relation: "sibling",
              title: "Related title",
              issuerName: "Issuer",
              issuerSign: "ISS",
              publishedAt: "2026-09-01T00:00:00.000Z",
              text: "Actual prior source text",
              textChars: 24,
              resolvedBy: "db",
              score: 1
            }
          ]
        }
      })
    ).toMatch(/Current PDF source[\s\S]*Supplement source text[\s\S]*relation sibling[\s\S]*Actual prior source text/);
    expect(
      blindPipelineSignals({
        validation: { valid: false },
        fatalStatus: { fatal: true },
        referenceCheck: { checkerError: "timeout" }
      })
    ).toEqual(["fatal", "invalid", "checker error"]);
  });

  it("rejects a short baseline and tampered exact prompt provenance", () => {
    const shortRows = retrospectiveRows(14);
    expect(() =>
      createRetrospectiveBaselineArtifact({
        createdAt: "2026-09-04T00:00:00.000Z",
        host: "test",
        messageIds: shortRows.map((item) => item.messageId),
        schemaSha256: "schema",
        rows: shortRows
      })
    ).toThrow(/exactly 15/);

    const rows = retrospectiveRows();
    const artifact = createRetrospectiveBaselineArtifact({
      createdAt: "2026-09-04T00:00:00.000Z",
      host: "test",
      messageIds: rows.map((item) => item.messageId),
      schemaSha256: sha256CanonicalJson(
        evalResponseSchemaProfiles.rewrite_v5_title_first_v1.schema
      ),
      rows
    });
    artifact.cases[0]!.rewriteCall.developerPrompt = "tampered";
    expect(() => assertRetrospectiveBaselineArtifact(artifact)).toThrow(
      /first rewrite call does not match/
    );
  });

  it("creates a deterministic 15-case 7/8 blind plan with stored identities", () => {
    const rows = retrospectiveRows();
    const baseline = createRetrospectiveBaselineArtifact({
      createdAt: "2026-09-04T00:00:00.000Z",
      host: "test",
      messageIds: rows.map((item) => item.messageId),
      schemaSha256: sha256CanonicalJson(
        evalResponseSchemaProfiles.rewrite_v5_title_first_v1.schema
      ),
      rows
    });
    const control = resolveEvalArmRunProfile({
      arm: "control",
      variantId: "regular_v5_9_2_frozen",
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      serviceTier: "default"
    });
    const challenger = resolveEvalArmRunProfile({
      arm: "challenger",
      variantId: "regular_v5_6_control",
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      serviceTier: "default"
    });
    const reference = resolveReferenceRunProfile({
      schema: {},
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      serviceTier: "default"
    });
    const cases = baseline.cases.map((item) => ({
      caseId: item.caseId,
      messageId: item.messageId,
      payload: item.inputJson.sourcePayload,
      sourceSha256: item.sourcePayloadSha256
    }));
    const corpus = createCorpusIdentity(cases, "cases-15.json");
    const generations = baseline.cases.flatMap((item) => [
      {
        id: item.generationRunId,
        caseId: item.caseId,
        arm: "control" as const,
        variantId: "regular_v5_9_2_frozen" as const,
        category: "hard_other" as const,
        fatalStatus: { fatal: false, reasons: [] }
      },
      {
        id: `challenger-${item.messageId}`,
        caseId: item.caseId,
        arm: "challenger" as const,
        variantId: "regular_v5_6_control" as const,
        category: "hard_other" as const,
        fatalStatus: { fatal: false, reasons: [] }
      }
    ]);
    const reviewProtocol = createReviewProtocol(
      generations,
      "regular_v5_9_2_frozen",
      "regular_v5_6_control",
      { assignmentSeed: "sides-15", orderingSeed: "order-15" }
    );
    const plan = createLockedManualAbPlan({
      createdAt: "2026-09-04T00:00:00.000Z",
      corpus,
      control,
      challenger,
      reference,
      baseline,
      baselinePath: "baseline-15.json",
      caseInputs: baseline.cases.map((item) => ({
        caseId: item.caseId,
        lockedSourceSha256: item.sourcePayloadSha256,
        controlPayloadSha256: item.sourcePayloadSha256,
        challengerPayloadSha256: item.sourcePayloadSha256,
        controlPromptHashes: item.promptHashes,
        challengerPromptHashes: item.promptHashes
      })),
      reviewProtocol
    });

    expect(plan.diagnostics.caseCount).toBe(15);
    expect(plan.diagnostics.sideDifference).toBe(1);
    expect(plan.diagnostics.challengerOnA + plan.diagnostics.challengerOnB).toBe(15);
    expect(plan.diagnostics.assignmentIdentitySha256).toHaveLength(64);
    expect(plan.diagnostics.displayedOrderSha256).toHaveLength(64);
    expect(() => assertLockedManualAbPlan(plan)).not.toThrow();
  });
});

import type { PromptPayload } from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";
import type { OpenAIReasoningEffort } from "./openai-responses.js";
import { assessReferenceCheckGate, buildCorrectionInstruction, classifyCheckerErrorKind,
  type ReferenceCoverageReport, type ReferenceCheckerErrorEntry } from "./reference-check.js";
import type { ReferenceRepairHistoryEntry } from "./reference-check-outcome.js";

// Two corrections before final editorial/style edits; the third is reserved
// for the final draft. Report callers retain their existing three-pass flow.
export const NOTICE_INITIAL_REPAIR_LIMIT = 2;
export const NOTICE_TOTAL_REPAIR_LIMIT = 3;

export function createReferenceCheckRepair<TModelCall>({ callModelReferenceCheck, collectFailedModelCall }: {
  callModelReferenceCheck: (payload: PromptPayload, rewrite: RewriteOutput) => Promise<{
    coverage: ReferenceCoverageReport; promptChars: number; modelCall: TModelCall | null;
  }>;
  collectFailedModelCall: (error: unknown, calls: TModelCall[]) => number;
}) {
  return async function applyReferenceCheckRepair<TPayload extends PromptPayload>({
    referencePayload,
    rewritePayload,
    rewrite,
    revisionInstructionForPrompt,
    correctionReasoningEffort,
    existingCorrectionAttempts = 0,
    maxCorrectionAttempts = 3,
    validationInstruction,
    modelCalls,
    callRewrite
  }: {
    referencePayload: PromptPayload;
    rewritePayload: TPayload;
    rewrite: RewriteOutput;
    revisionInstructionForPrompt?: string;
    correctionReasoningEffort: OpenAIReasoningEffort;
    existingCorrectionAttempts?: number;
    maxCorrectionAttempts?: number;
    validationInstruction?: (rewrite: RewriteOutput) => string | null;
    modelCalls: TModelCall[];
    callRewrite: (
      payload: TPayload,
      revisionInstruction?: string,
      previousOutput?: RewriteOutput,
      reasoningEffort?: OpenAIReasoningEffort
    ) => Promise<{
      rewrite: RewriteOutput;
      promptChars: number;
      modelCall: TModelCall;
    }>;
  }): Promise<{
    rewrite: RewriteOutput;
    promptChars: number;
    checkerError: string | null;
    checkerErrors: ReferenceCheckerErrorEntry[];
    correctionAttempts: number;
    validationCorrectionAttempts: number;
    initialCoverage: ReferenceCoverageReport | null;
    finalCoverage: ReferenceCoverageReport | null;
    repairHistory: ReferenceRepairHistoryEntry[];
  }> {
    let currentRewrite = rewrite;
    let promptChars = 0;
    let correctionAttempts = 0;
    let validationCorrectionAttempts = 0;
    let initialCoverage: ReferenceCoverageReport | null = null;
    let finalCoverage: ReferenceCoverageReport | null = null;
    const repairHistory: ReferenceRepairHistoryEntry[] = [];
    // Classified failures, call-local stages: a checker failure is numbered as
    // the check that never completed (repairHistory.length + 1); a repair-
    // rewrite failure belongs to the pass of the check that triggered it
    // (repairHistory.length). Flow-level accumulation re-offsets stages.
    const checkerErrors: ReferenceCheckerErrorEntry[] = [];

    while (true) {
      let referenceCheck: Awaited<ReturnType<typeof callModelReferenceCheck>>;
      try {
        referenceCheck = await callModelReferenceCheck(
          referencePayload,
          currentRewrite
        );
      } catch (error) {
        promptChars += collectFailedModelCall(error, modelCalls);
        checkerErrors.push({
          stage: repairHistory.length + 1,
          kind: classifyCheckerErrorKind(error),
          message: error instanceof Error ? error.message : String(error),
          // A prior correction in this call means the last successful coverage
          // describes the pre-repair draft.
          afterCorrection: correctionAttempts > 0
        });
        return {
          rewrite: currentRewrite,
          promptChars,
          checkerError: error instanceof Error ? error.message : String(error),
          checkerErrors,
          correctionAttempts,
          validationCorrectionAttempts,
          initialCoverage,
          finalCoverage,
          repairHistory
        };
      }

      if (referenceCheck.modelCall) {
        modelCalls.push(referenceCheck.modelCall);
      }
      promptChars += referenceCheck.promptChars;
      initialCoverage ??= referenceCheck.coverage;
      finalCoverage = referenceCheck.coverage;

      const gate = assessReferenceCheckGate(referenceCheck.coverage);
      repairHistory.push({
        checkNumber: repairHistory.length + 1,
        correctionAttempt: existingCorrectionAttempts + correctionAttempts,
        coveragePercent: referenceCheck.coverage.coveragePercent,
        unsupportedSentenceCount: referenceCheck.coverage.unsupportedSentences.length,
        highRiskUnsupportedSentenceCount:
          gate.highRiskUnsupportedSentences.length,
        blocking: gate.blocking,
        blockingReason: gate.reason,
        unsupportedSentences: referenceCheck.coverage.unsupportedSentences.map(
          (item) => ({
            index: item.index,
            sentence: item.sentence,
            interpretation: item.interpretation
          })
        ),
        ...(referenceCheck.coverage.priorContext
          ? { priorContextViolationCount: gate.priorContextViolations.length }
          : {})
      });

      const totalCorrectionAttempts =
        existingCorrectionAttempts + correctionAttempts;
      const referenceInstruction = buildCorrectionInstruction(
        referenceCheck.coverage,
        {
          attempt: totalCorrectionAttempts + 1,
          maxAttempts: maxCorrectionAttempts,
          gate
        }
      );

      // Validate the very same draft as the source checker before asking for a repair.
      const numericInstruction = validationInstruction?.(currentRewrite);
      const correctionInstruction = [referenceInstruction, numericInstruction]
        .filter(Boolean).join("\n\n");

      if (!correctionInstruction) {
        return {
          rewrite: currentRewrite,
          promptChars,
          checkerError: null,
          checkerErrors,
          correctionAttempts,
          validationCorrectionAttempts,
          initialCoverage,
          finalCoverage,
          repairHistory
        };
      }

      if (
        totalCorrectionAttempts >= maxCorrectionAttempts ||
        (!gate.blocking && !numericInstruction && correctionAttempts > 0)
      ) {
        return {
          rewrite: currentRewrite,
          promptChars,
          checkerError: null,
          checkerErrors,
          correctionAttempts,
          validationCorrectionAttempts,
          initialCoverage,
          finalCoverage,
          repairHistory
        };
      }

      const combinedCorrection = [
        revisionInstructionForPrompt,
        correctionInstruction,
        ...(validationInstruction ? [
          "Rett bare de påviste feilene. Behold ordlyden i støttede setninger og kildehenvisninger som ikke berøres av feilene. Ikke legg til nye fakta.",
          "Kontroller alle rettelsene samlet: tall, hvem som handler, og hvilken kilde som dokumenterer hver opplysning."
        ] : [])
      ]
        .filter(Boolean)
        .join("\n\n");

      try {
        const correctedResult = await callRewrite(
          rewritePayload,
          combinedCorrection,
          currentRewrite,
          correctionReasoningEffort
        );
        modelCalls.push(correctedResult.modelCall);
        promptChars += correctedResult.promptChars;
        currentRewrite = correctedResult.rewrite;
        correctionAttempts += 1;
        if (numericInstruction) validationCorrectionAttempts += 1;
      } catch (error) {
        promptChars += collectFailedModelCall(error, modelCalls);
        checkerErrors.push({
          stage: repairHistory.length,
          kind: "repair_rewrite_failed",
          message: error instanceof Error ? error.message : String(error)
        });
        return {
          rewrite: currentRewrite,
          promptChars,
          checkerError: error instanceof Error ? error.message : String(error),
          checkerErrors,
          correctionAttempts,
          validationCorrectionAttempts,
          initialCoverage,
          finalCoverage,
          repairHistory
        };
      }
    }
  }

}

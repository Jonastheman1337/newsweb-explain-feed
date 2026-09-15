import { createNoticeProgress } from "./notice-progress.js";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import type { PromptPayload } from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";
import { createReferenceCheckRepair, NOTICE_INITIAL_REPAIR_LIMIT, NOTICE_TOTAL_REPAIR_LIMIT } from "./reference-repair.js";
import { assessReferenceCheckGate, type ReferenceCoverageReport } from "./reference-check.js";
import { absorbReferenceRepairResult, createReferenceRepairAccumulator, resolveAccumulatedReferenceCheckOutcome } from "./reference-check-outcome.js";
import { validateRewriteOutput } from "./rewrite-validation.js";

const stored = JSON.parse(readFileSync(new URL("../fixtures/reference-repair/682375.json", import.meta.url), "utf8")) as {
  blockedRewrite: RewriteOutput;
  initialCoverage: ReferenceCoverageReport & { sentenceReviews: ReferenceCoverageReport["items"] };
  finalCoverage: ReferenceCoverageReport & { sentenceReviews: ReferenceCoverageReport["items"] };
};
const fixture = { ...stored,
  initialCoverage: { ...stored.initialCoverage, items: stored.initialCoverage.sentenceReviews },
  finalCoverage: { ...stored.finalCoverage, items: stored.finalCoverage.sentenceReviews }
};
const bodyText = fixture.finalCoverage.items.map(r => r.sourceEvidence).join("\n");
const payload: PromptPayload = {
  messageId: 682375, title: "Outlet Group – Subscriptions", issuerName: "Outlet Group",
  issuerSign: "-", publishedAt: "2026-09-15T13:08:00Z", categories: [], markets: [],
  bodyText, sourceBodyChars: bodyText.length, hasAttachments: false
};
const draft = fixture.blockedRewrite;
const corrected = { ...draft, lead: "Selskaper knyttet til ledere i Outlet Group tegner aksjer i den planlagte børsnoteringen.", key_facts: ["To tilknyttede selskaper tegner 290.909 aksjer hver"] };
// The corrected review is a controlled checker response, not a new live model result.
function passing(): ReferenceCoverageReport {
  const result = structuredClone(fixture.finalCoverage);
  result.items[1] = { ...result.items[1], sentence: corrected.lead, grounded: true, source: "primary" };
  result.unsupportedSentences = [];
  result.groundedSentences = result.totalSentences;
  result.coveragePercent = 100;
  return result;
}
function setup(reviews: Array<ReferenceCoverageReport | Error>, outputs = [corrected]) {
  let index = 0;
  const check = vi.fn(async () => {
    const review = reviews[index++];
    if (!review) throw Error("Unexpected extra check");
    if (review instanceof Error) throw review;
    return { coverage: review, promptChars: 10, modelCall: { kind: "check" } };
  });
  let outputIndex = 0;
  const write = vi.fn(async (_payload: PromptPayload, _instruction?: string, _draft?: RewriteOutput) => ({
    rewrite: outputs[Math.min(outputIndex++, outputs.length - 1)], promptChars: 20, modelCall: { kind: "rewrite" }
  }));
  const repair = createReferenceCheckRepair({ callModelReferenceCheck: check, collectFailedModelCall: () => 0 });
  const args = { referencePayload: payload, rewritePayload: payload, rewrite: draft,
    correctionReasoningEffort: "medium" as const, modelCalls: [] as { kind: string }[], callRewrite: write };
  return { repair, args, check, write };
}

it("gives a single repair the saved 682375 source, citation and numeric findings", async () => {
  const review = structuredClone(fixture.initialCoverage);
  review.items[4].priorUses = [{ priorMessageId: 682195, fact: review.items[4].sentence,
    sourceEvidence: "Wrong notice evidence", historicalMarker: "i går", sourceEvidenceMatchesCitedSource: false }];
  expect(assessReferenceCheckGate(review).priorContextViolations.length).toBeGreaterThan(0);
  const { repair, args, write } = setup([review, passing()]);
  const result = await repair({ ...args, validationInstruction: r => r === draft ? "UNEXPECTED_NUMBERS: 914.011, 30,2, 33" : null });
  expect(write).toHaveBeenCalledOnce();
  const instruction = write.mock.calls[0][1]!;
  expect(instruction).toContain("under – ikke drøyt");
  expect(instruction).toContain("finnes ikke i akkurat den meldingen");
  expect(instruction).toContain("UNEXPECTED_NUMBERS");
  expect(instruction).toContain("Behold ordlyden i støttede setninger");
  expect(write.mock.calls[0][2]).toBe(draft);
  expect(result.validationCorrectionAttempts).toBe(1);
  expect(assessReferenceCheckGate(result.finalCoverage).blocking).toBe(false);
});

it("reserves a correction for the final 682375 wording after two earlier attempts", async () => {
  const { repair, args, write, check } = setup([
    fixture.initialCoverage, fixture.initialCoverage, fixture.initialCoverage,
    fixture.finalCoverage, passing()
  ], [draft, draft, corrected]);
  const state = createReferenceRepairAccumulator();
  const initial = await repair({ ...args, maxCorrectionAttempts: NOTICE_INITIAL_REPAIR_LIMIT });
  absorbReferenceRepairResult(state, initial);
  expect(write).toHaveBeenCalledTimes(2);
  const final = await repair({ ...args, rewrite: initial.rewrite,
    existingCorrectionAttempts: state.correctionAttempts, maxCorrectionAttempts: NOTICE_TOTAL_REPAIR_LIMIT });
  absorbReferenceRepairResult(state, final);
  expect(write).toHaveBeenCalledTimes(3);
  expect(check).toHaveBeenCalledTimes(5);
  expect(write.mock.calls[2][1]).toContain("operative ledelsen selv tegner");
  expect(final.rewrite.body).toEqual(draft.body);
  expect(final.rewrite.title).toBe(draft.title);
  expect(state.correctionAttempts).toBe(3);
  expect(resolveAccumulatedReferenceCheckOutcome(state).wouldBlock).toBe(false);
  expect(validateRewriteOutput(final.rewrite, payload).publicationNumberAssessments.filter(a => a.disposition === "unexpected")).toEqual([]);
});

it("stops at the total budget and keeps an unresolved source claim blocked", async () => {
  const { repair, args, write } = setup([fixture.finalCoverage, fixture.finalCoverage], [draft]);
  const result = await repair({ ...args, existingCorrectionAttempts: 2, maxCorrectionAttempts: 3 });
  expect(write).toHaveBeenCalledOnce();
  expect(result.correctionAttempts).toBe(1);
  expect(assessReferenceCheckGate(result.finalCoverage).blocking).toBe(true);
});

it("repairs a numeric error even when the source checker passes", async () => {
  const bad = { ...corrected, lead: "Selskapet får 987654321 kroner." };
  const { repair, args, write } = setup([passing(), passing()]);
  const validationInstruction = (r: RewriteOutput) => {
    const issues = validateRewriteOutput(r, payload).issues.filter(i => i.code === "UNEXPECTED_NUMBERS");
    return issues.length ? issues.map(i => i.message).join("\n") : null;
  };
  const result = await repair({ ...args, rewrite: bad, validationInstruction });
  expect(write).toHaveBeenCalledOnce();
  expect(write.mock.calls[0][1]).toContain("987654321");
  expect(result.validationCorrectionAttempts).toBe(1);
  expect(validationInstruction(result.rewrite)).toBeNull();
});

it("does not spend a correction on a draft that already passes both checks", async () => {
  const { repair, args, write, check } = setup([passing()]);
  const result = await repair({ ...args, rewrite: corrected, validationInstruction: () => null });
  expect(check).toHaveBeenCalledOnce();
  expect(write).not.toHaveBeenCalled();
  expect(result.correctionAttempts).toBe(0);
});

it("records final checker failure after a repair instead of treating old coverage as fresh", async () => {
  const { repair, args } = setup([fixture.finalCoverage, Error("checker timeout")]);
  const result = await repair(args);
  expect(result.checkerError).toBe("checker timeout");
  const state = createReferenceRepairAccumulator();
  absorbReferenceRepairResult(state, result);
  const outcome = resolveAccumulatedReferenceCheckOutcome(state);
  expect(outcome.evidenceStale).toBe(true);
  expect(outcome.wouldRetry).toBe(true);
});

it("records a failed rewrite without consuming a successful correction or losing the block", async () => {
  const { repair, args } = setup([fixture.finalCoverage]);
  const result = await repair({ ...args, callRewrite: async () => { throw Error("rewrite unavailable"); } });
  expect(result.rewrite).toBe(draft);
  expect(result.correctionAttempts).toBe(0);
  expect(result.checkerErrors[0].kind).toBe("repair_rewrite_failed");
  expect(assessReferenceCheckGate(result.finalCoverage).blocking).toBe(true);
});

it("leaves persistent numeric errors available for blocking even if reference coverage passes", async () => {
  const bad = { ...corrected, lead: "Selskapet får 987654321 kroner." };
  const { repair, args, write } = setup([passing(), passing()], [bad]);
  const result = await repair({ ...args, rewrite: bad, existingCorrectionAttempts: 2,
    maxCorrectionAttempts: NOTICE_TOTAL_REPAIR_LIMIT, validationInstruction: () => "UNEXPECTED_NUMBERS: 987654321" });
  expect(write).toHaveBeenCalledOnce();
  expect(result.validationCorrectionAttempts).toBe(1);
  expect(validateRewriteOutput(result.rewrite, payload).issues.some(i => i.code === "UNEXPECTED_NUMBERS")).toBe(true);
});

it("emits writing, correction and rechecking from the real repair loop without changing its result", async () => {
  const phases: string[] = [];
  const progress = createNoticeProgress(async phase => { phases.push(phase); });
  const { args, check, write: repairWrite } = setup([fixture.initialCoverage, passing()]);
  let writes = 0;
  const write = progress.writer(async (...values: Parameters<typeof repairWrite>) =>
    writes++ === 0 ? { rewrite: draft, promptChars: 0, modelCall: { kind: "rewrite" } } : repairWrite(...values));
  const initial = await write(payload);
  const repair = createReferenceCheckRepair({ callModelReferenceCheck: () => progress.check(check), collectFailedModelCall: () => 0 });
  const result = await repair({ ...args, rewrite: initial.rewrite, callRewrite: write });
  expect(phases).toEqual(["writing_notice", "checking_references", "correcting_notice", "rechecking_references"]);
  expect(result.rewrite).toEqual(corrected);
  expect(result.correctionAttempts).toBe(1);
  expect(check).toHaveBeenCalledTimes(2);
  expect(repairWrite).toHaveBeenCalledTimes(1);
});

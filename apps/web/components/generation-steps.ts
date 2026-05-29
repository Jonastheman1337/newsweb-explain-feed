import {
  GENERATION_PHASE_LABELS,
  isGenerationPhase,
  type GenerationPhase
} from "@newsweb/shared";

export const GENERATION_STEP_DURATION_MS = 6000;

const BASE_GENERATION_STEP_PHASES = [
  "reading_notice",
  "analyzing_content",
  "writing_notice",
  "checking_references",
  "finalizing"
] as const;

const PDF_GENERATION_STEP_PHASE = "reading_pdf_attachment";

function getGenerationStepPhases(hasAttachments?: boolean): readonly GenerationPhase[] {
  return hasAttachments
    ? [
        BASE_GENERATION_STEP_PHASES[0],
        PDF_GENERATION_STEP_PHASE,
        ...BASE_GENERATION_STEP_PHASES.slice(1)
      ]
    : BASE_GENERATION_STEP_PHASES;
}

function normalizeStepPhase(phase: GenerationPhase | null): GenerationPhase | null {
  if (
    phase === "finalizing" ||
    phase === "publishing" ||
    phase === "published" ||
    phase === "skipped"
  ) {
    return "finalizing";
  }
  if (phase === "failed" || phase === "queued") {
    return null;
  }
  return phase;
}

export function getGenerationSteps(hasAttachments?: boolean): readonly string[] {
  return getGenerationStepPhases(hasAttachments).map(
    (phase) => GENERATION_PHASE_LABELS[phase]
  );
}

export function getGenerationStepIndex(
  phase: GenerationPhase | string | null | undefined,
  hasAttachments?: boolean
): number {
  const parsedPhase = isGenerationPhase(phase) ? phase : null;
  const stepPhase = normalizeStepPhase(parsedPhase);
  if (!stepPhase) {
    return -1;
  }

  const phases = getGenerationStepPhases(hasAttachments);
  const index = phases.indexOf(stepPhase);
  if (index >= 0) {
    return index;
  }

  if (stepPhase === "reading_pdf_attachment") {
    return Math.min(1, phases.length - 1);
  }
  return 0;
}

export function getGenerationPhaseLabel(
  phase: GenerationPhase | string | null | undefined
): string {
  return isGenerationPhase(phase)
    ? GENERATION_PHASE_LABELS[phase]
    : GENERATION_PHASE_LABELS.queued;
}

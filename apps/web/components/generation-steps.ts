import {
  GENERATION_PHASE_LABELS,
  getGenerationStepPhases,
  isGenerationPhase,
  type GenerationPhase
} from "@newsweb/shared";

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

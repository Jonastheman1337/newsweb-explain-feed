import { z } from "zod";

export const GENERATION_PHASES = [
  "queued",
  "reading_notice",
  "reading_pdf_attachment",
  "analyzing_content",
  "writing_notice",
  "checking_references",
  "finalizing",
  "publishing",
  "published",
  "skipped",
  "failed"
] as const;

export const generationPhaseSchema = z.enum(GENERATION_PHASES);

export type GenerationPhase = z.infer<typeof generationPhaseSchema>;

export const BASE_GENERATION_STEP_PHASES = [
  "reading_notice",
  "analyzing_content",
  "writing_notice",
  "checking_references",
  "finalizing"
] as const satisfies readonly GenerationPhase[];

export const PDF_GENERATION_STEP_PHASE =
  "reading_pdf_attachment" satisfies GenerationPhase;

export const GENERATION_PHASE_LABELS: Record<GenerationPhase, string> = {
  queued: "Venter på generering",
  reading_notice: "Leser original melding",
  reading_pdf_attachment: "Leser PDF-vedlegg",
  analyzing_content: "Analyserer innhold",
  writing_notice: "Skriver AI-notis",
  checking_references: "Sjekker referanser",
  finalizing: "Ferdigstiller",
  publishing: "Ferdigstiller",
  published: "Ferdigstiller",
  skipped: "Ferdigstiller",
  failed: "Generering feilet"
};

export function isGenerationPhase(value: unknown): value is GenerationPhase {
  return generationPhaseSchema.safeParse(value).success;
}

export function getGenerationStepPhases(
  hasAttachments?: boolean
): readonly GenerationPhase[] {
  return hasAttachments
    ? [
        BASE_GENERATION_STEP_PHASES[0],
        PDF_GENERATION_STEP_PHASE,
        ...BASE_GENERATION_STEP_PHASES.slice(1)
      ]
    : BASE_GENERATION_STEP_PHASES;
}

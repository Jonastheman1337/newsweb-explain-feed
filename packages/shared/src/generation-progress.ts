import { z } from "zod";

export const GENERATION_PHASES = [
  "queued",
  "reading_notice",
  "reading_pdf_attachment",
  "analyzing_content",
  "loading_context",
  "writing_notice",
  "correcting_notice",
  "rechecking_references",
  "checking_references",
  "finalizing",
  "publishing",
  "published",
  "skipped",
  "failed"
] as const;

export const generationPhaseSchema = z.enum(GENERATION_PHASES);

export type GenerationPhase = z.infer<typeof generationPhaseSchema>;

// A run that has not reported phase progress for this long is considered dead.
export const GENERATION_RUN_STALE_MS = 20 * 60 * 1000;

export const GENERATION_PHASE_LABELS: Record<GenerationPhase, string> = {
  queued: "Venter på generering",
  reading_notice: "Leser original melding",
  reading_pdf_attachment: "Leser PDF-vedlegg",
  analyzing_content: "Analyserer innhold",
  loading_context: "Henter tidligere meldinger",
  correcting_notice: "Retter teksten",
  rechecking_references: "Kontrollerer teksten på nytt",
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

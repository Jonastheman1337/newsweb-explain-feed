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

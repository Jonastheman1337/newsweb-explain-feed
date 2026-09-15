import type { GenerationPhase } from "@newsweb/shared";
import styles from "./generation-activity.module.css";

const labels: Partial<Record<GenerationPhase, string>> = {
  queued: "Venter på tur",
  reading_notice: "Leser børsmeldingen",
  reading_pdf_attachment: "Leser PDF-vedlegg",
  analyzing_content: "Finner hovedpoengene",
  writing_notice: "Skriver notisen",
  checking_references: "Sjekker kildene",
  finalizing: "Gjør notisen klar",
  publishing: "Gjør notisen klar"
};

export function GenerationActivity({ phase, label }: { phase?: GenerationPhase; label?: string }) {
  return (
    <span className={styles.activity} role="status" aria-live="polite">
      <span className={styles.paper} aria-hidden="true"><span /><span /><span /></span>
      <span className={styles.label}>{label ?? (phase && labels[phase]) ?? "Lager notisen"}</span>
    </span>
  );
}

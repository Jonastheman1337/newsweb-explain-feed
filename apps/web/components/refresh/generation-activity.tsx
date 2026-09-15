import type { GenerationPhase } from "@newsweb/shared";
import styles from "./generation-activity.module.css";

const labels: Partial<Record<GenerationPhase, string>> = {
  queued: "Venter på tur",
  reading_notice: "Leser børsmeldingen",
  reading_pdf_attachment: "Leser vedleggene",
  analyzing_content: "Vurderer nyhetsinnholdet",
  loading_context: "Henter tidligere meldinger",
  correcting_notice: "Retter teksten",
  rechecking_references: "Kontrollerer teksten på nytt",
  writing_notice: "Skriver notisen",
  checking_references: "Sjekker teksten mot kildene",
  finalizing: "Kontrollerer teksten",
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

"use client";

import { SAK_TARGET_CHARS_DEFAULT, SAK_TARGET_CHARS_PRESETS, type SakActiveGeneration, type SakEditedArticle, type SakMaterial, type SakVersion } from "@newsweb/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { generateSak, getSakStatus, SakApiError } from "../lib/sak-client";
import { getSakGenerationStepIndex, getSakGenerationSteps } from "./generation-steps";

type Action = "revise" | "shorten" | "angle" | "lead";
type Props = {
  draftId: string;
  materials: SakMaterial[];
  activeVersion: SakVersion | null;
  activeGeneration: SakActiveGeneration;
  initialTitleOverride: string | null;
  initialTargetChars: number | null;
  sourceBusy: boolean;
  getRevisionCopy: () => { baseVersionId: string; editedArticle: SakEditedArticle } | null;
  onReady: (version: number) => void;
  onChange: () => void;
  onBusyChange: (busy: boolean) => void;
};
const RUNNING_STATES = new Set(["active", "delayed", "prioritized", "waiting", "waiting-children"]);
const STEPS = getSakGenerationSteps();

export function SakInstructionInput({ draftId, materials, activeVersion, activeGeneration, initialTitleOverride, initialTargetChars, sourceBusy, getRevisionCopy, onReady, onChange, onBusyChange }: Props) {
  const [title, setTitle] = useState(initialTitleOverride ?? "");
  const [targetChars, setTargetChars] = useState(initialTargetChars ?? SAK_TARGET_CHARS_DEFAULT);
  const [text, setText] = useState("");
  const [action, setAction] = useState<Action>("revise");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("Klargjør");
  const [error, setError] = useState<string | null>(null);
  const [coverageWarning, setCoverageWarning] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollingKey = useRef<string | null>(null);
  const requestLocked = useRef(false);
  const callbacks = useRef({ onReady, onChange, onBusyChange });
  callbacks.current = { onReady, onChange, onBusyChange };

  const finish = useCallback((version: number | null, message?: string) => {
    if (timer.current) clearTimeout(timer.current);
    requestLocked.current = false; setBusy(false); callbacks.current.onBusyChange(false);
    setError(message ?? null);
    if (version != null) { setText(""); callbacks.current.onReady(version); }
    else callbacks.current.onChange();
  }, []);
  const startPolling = useCallback((jobId: string | null, version: number, runId: string) => {
    if (timer.current) clearTimeout(timer.current);
    pollingKey.current = runId;
    requestLocked.current = true; setBusy(true); callbacks.current.onBusyChange(true);
    const started = Date.now();
    let errors = 0;
    const poll = async () => {
      if (pollingKey.current !== runId) return;
      try {
        const status = await getSakStatus(draftId, { jobId, version });
        if (pollingKey.current !== runId) return;
        errors = 0;
        setElapsed(Math.floor((Date.now() - started) / 1000));
        const step = getSakGenerationStepIndex(status.phase);
        setPhase(step >= 0 ? STEPS[step] ?? "Arbeider" : "Venter på ledig kapasitet");
        if (status.ready) { finish(version); return; }
        if (status.failed || status.jobState === "failed") { finish(null, "Genereringen feilet. Instruksjonen er beholdt, så du kan prøve igjen."); return; }
        if (Date.now() - started > 540_000 && !RUNNING_STATES.has(status.jobState ?? "")) { finish(null, "Fikk ikke bekreftet at utkastet ble ferdig. Oppdater siden for å sjekke status."); return; }
      } catch (error) {
        if (pollingKey.current !== runId) return;
        errors++;
        if (error instanceof SakApiError && (error.status === 404 || error.status === 401)) { finish(null, error.message); return; }
        if (errors >= 10) { finish(null, "Forbindelsen er brutt. Genereringen kan fortsatt pågå. Oppdater siden for å hente status."); return; }
      }
      timer.current = setTimeout(() => void poll(), 3000);
    };
    void poll();
  }, [draftId, finish]);

  useEffect(() => {
    if (activeGeneration && pollingKey.current !== activeGeneration.generationRunId) startPolling(activeGeneration.jobId, activeGeneration.version, activeGeneration.generationRunId);
  }, [activeGeneration, startPolling]);
  useEffect(() => () => { pollingKey.current = null; if (timer.current) clearTimeout(timer.current); }, []);

  const hasArticle = Boolean(activeVersion?.article);
  const canGenerate = materials.some((source) => source.enabled && source.status === "ready") && !busy && !sourceBusy && !(action === "angle" && !text.trim());
  async function run(nextAction = action, nextTarget = targetChars) {
    if (!canGenerate || requestLocked.current) return;
    requestLocked.current = true; setBusy(true); onBusyChange(true); setError(null); setCoverageWarning(null); setPhase("Klargjør"); setElapsed(0);
    try {
      const copy = getRevisionCopy();
      let titleOverride = title.trim();
      if (copy && copy.editedArticle.title !== activeVersion?.article?.title && title === (initialTitleOverride ?? "")) titleOverride = "";
      const response = await generateSak(draftId, {
        instruction: text.trim() || undefined, titleOverride, targetChars: nextTarget,
        selectedMaterialIds: materials.filter((source) => source.enabled).map((source) => source.id),
        revisionAction: nextAction, ...(copy ?? {})
      });
      if (response.materials.truncated.length || response.materials.dropped.length) {
        const names = materials.filter((item) => [...response.materials.truncated, ...response.materials.dropped].includes(item.id)).map((item) => item.title);
        setCoverageWarning(`Kilder med begrenset dekning i denne versjonen: ${names.join(", ")}.`);
      }
      setTitle(titleOverride); setTargetChars(nextTarget);
      startPolling(response.jobId, response.version, response.generationRunId);
      onChange();
    } catch (error) {
      finish(null, error instanceof Error ? error.message : "Kunne ikke starte genereringen.");
    }
  }
  function chooseAction(next: Action) { setAction(next); textarea.current?.focus(); }
  const shorterTarget = [...SAK_TARGET_CHARS_PRESETS].reverse().find((value) => value < targetChars) ?? SAK_TARGET_CHARS_PRESETS[0];
  return (
    <section className="sakComposer" aria-label={hasArticle ? "Revider saken" : "Lag utkast"}>
      <div className="sakPanelHeading"><h2>{hasArticle ? "Jobb videre med teksten" : "Hva er saken?"}</h2>
        <label className="sakLengthLabel">Lengde<select aria-label="Lengde" value={targetChars} disabled={busy} onChange={(event) => setTargetChars(Number(event.target.value))}>
          {[...new Set([...SAK_TARGET_CHARS_PRESETS, targetChars])].sort((a,b) => a-b).map((value) => <option key={value} value={value}>{value.toLocaleString("nb-NO")} tegn</option>)}
        </select></label>
      </div>
      {hasArticle && <div className="sakRevisionActions">
        <button type="button" className="sakSecondaryButton" aria-pressed={action === "revise"} disabled={busy} onClick={() => chooseAction("revise")}>Revider</button>
        <button type="button" className="sakSecondaryButton" disabled={!canGenerate} onClick={() => void run("shorten", shorterTarget)}>Kort ned</button>
        <button type="button" className="sakSecondaryButton" aria-pressed={action === "angle"} disabled={busy} onClick={() => chooseAction("angle")}>Endre vinkel</button>
        <button type="button" className="sakSecondaryButton" aria-pressed={action === "lead"} disabled={busy} onClick={() => chooseAction("lead")}>Skriv om ingressen</button>
      </div>}
      <label className="sakVisuallyHidden" htmlFor="sak-instruction">Redaksjonell instruksjon</label>
      <textarea id="sak-instruction" ref={textarea} value={text} onChange={(event) => setText(event.target.value)} disabled={busy} rows={2}
        placeholder={action === "angle" ? "Hvilken ny vinkel skal saken ha?" : action === "lead" ? "Hvordan skal ingressen endres?" : hasArticle ? "Hva skal endres? Dine rettelser blir med." : "Vinkel, viktige poenger eller hva som skal ut. La stå tomt for å få et forslag."}
        onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void run(); } }} />
      <details className="sakHeadlineSetting"><summary>Fast tittel{title.trim() ? `: ${title}` : " (valgfritt)"}</summary>
        <input aria-label="Fast tittel" placeholder="Bruk denne tittelen ordrett" value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy} />
        <p className="sakHelp">For å endre sakens vinkel, velg «Endre vinkel» og beskriv den.</p>
      </details>
      <div className="sakComposerFooter">
        <p className="sakHelp">{hasArticle ? `Utgangspunkt: versjon ${activeVersion?.version}, med dine redigeringer.` : "Velg minst én lesbar kilde for å starte."}</p>
        <button className="sakPrimaryButton" type="button" disabled={!canGenerate} onClick={() => void run()}>{busy ? "Arbeider …" : hasArticle ? "Lag ny versjon" : "Lag utkast"}</button>
      </div>
      {busy && <div className="sakProgress" role="status"><span className="sakProgressDot" />{phase} …{elapsed > 0 ? ` ${elapsed} sek` : ""}</div>}
      {error && <p className="sakError" role="alert">{error}</p>}
      {coverageWarning && <p className="sakSourceWarning" role="status">{coverageWarning}</p>}
    </section>
  );
}

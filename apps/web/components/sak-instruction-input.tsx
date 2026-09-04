"use client";

import {
  SAK_TARGET_CHARS_DEFAULT,
  SAK_TARGET_CHARS_PRESETS,
  type SakActiveGeneration,
  type SakMaterial,
  type SakStatusResponse
} from "@newsweb/shared";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type SetStateAction
} from "react";

import {
  addSakPdf,
  addSakText,
  addSakUrl,
  deleteSakMaterial,
  generateSak,
  getSakStatus,
  patchSakMaterial,
  SakApiError
} from "../lib/sak-client";
import { E24Loader } from "./e24-loader";
import {
  GENERATION_STEP_DURATION_MS,
  getSakGenerationStepIndex,
  getSakGenerationSteps
} from "./generation-steps";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 180;
const RUNNING_JOB_STATES = new Set([
  "active",
  "delayed",
  "prioritized",
  "waiting",
  "waiting-children"
]);
const PROGRESS_STEPS = getSakGenerationSteps();
const GENERATION_FAILED_MESSAGE = "Genereringen feilet";

type SakInstructionInputProps = {
  draftId: string;
  materials: SakMaterial[];
  setMaterials: Dispatch<SetStateAction<SakMaterial[]>>;
  versionCount: number;
  activeGeneration: SakActiveGeneration;
  initialTitleOverride: string | null;
  initialTargetChars: number | null;
  onReady: (version: number) => void;
  onChange: () => void;
};

function errorMessageOf(error: unknown, fallback: string): string {
  return error instanceof SakApiError ? error.message : fallback;
}

function materialMeta(material: SakMaterial): string {
  if (material.status === "failed") return "Feilet";
  const kind =
    material.kind === "pdf" ? "PDF" : material.kind === "url" ? "Lenke" : "Tekst";
  return `${kind} – ${material.extractedTextChars.toLocaleString("nb-NO")} tegn`;
}

export function SakInstructionInput({
  draftId,
  materials,
  setMaterials,
  versionCount,
  activeGeneration,
  initialTitleOverride,
  initialTargetChars,
  onReady,
  onChange
}: SakInstructionInputProps) {
  const [title, setTitle] = useState(initialTitleOverride ?? "");
  const [targetChars, setTargetChars] = useState<number>(
    initialTargetChars ?? SAK_TARGET_CHARS_DEFAULT
  );
  const [text, setText] = useState("");
  const [materialsOpen, setMaterialsOpen] = useState(materials.length === 0);
  const [materialSaving, setMaterialSaving] = useState(false);
  const [materialError, setMaterialError] = useState<string | null>(null);
  const [materialInputMode, setMaterialInputMode] = useState<"url" | "text" | null>(null);
  const [materialTitle, setMaterialTitle] = useState("");
  const [materialText, setMaterialText] = useState("");
  const [materialUrl, setMaterialUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "polling" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progressStep, setProgressStep] = useState(0);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingKeyRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const materialTextareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const onReadyRef = useRef(onReady);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onReadyRef.current = onReady;
    onChangeRef.current = onChange;
  }, [onReady, onChange]);

  const resizeTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    }
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [text, resizeTextarea]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (progressRef.current) {
      clearInterval(progressRef.current);
      progressRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  // pollingKeyRef keeps the run key after a generation settles so the reload
  // that follows cannot restart polling for the same run.
  const failGeneration = useCallback(
    (message: string) => {
      stopPolling();
      setStatus("error");
      setErrorMessage(message);
      onChangeRef.current();
    },
    [stopPolling]
  );

  const finishGeneration = useCallback(
    (version: number) => {
      stopPolling();
      setStatus("idle");
      setErrorMessage(null);
      onReadyRef.current(version);
    },
    [stopPolling]
  );

  const isJobStillRunning = (data: SakStatusResponse | null) =>
    data?.jobState ? RUNNING_JOB_STATES.has(data.jobState) : false;

  const startPolling = useCallback(
    (jobId: string | null, version: number) => {
      stopPolling();
      setStatus("polling");
      setErrorMessage(null);
      setProgressStep(0);
      progressRef.current = setInterval(() => {
        setProgressStep((prev) => Math.min(prev + 1, PROGRESS_STEPS.length - 1));
      }, GENERATION_STEP_DURATION_MS);

      async function checkFinalStatusAfterTimeout() {
        stopPolling();
        try {
          const data = await getSakStatus(draftId, { jobId, version });
          if (data.ready) {
            finishGeneration(version);
            return;
          }
        } catch {
          /* fall through */
        }
        failGeneration(GENERATION_FAILED_MESSAGE);
      }

      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts++;
        let data: SakStatusResponse | null = null;
        try {
          data = await getSakStatus(draftId, { jobId, version });
          const phaseStep = getSakGenerationStepIndex(data.phase);
          if (phaseStep >= 0) {
            setProgressStep((prev) => Math.max(prev, phaseStep));
          }
          if (data.ready) {
            finishGeneration(version);
            return;
          }
          if (data.failed || data.jobState === "failed") {
            failGeneration(GENERATION_FAILED_MESSAGE);
            return;
          }
        } catch (error) {
          if (error instanceof SakApiError && error.status === 404) {
            failGeneration(error.message);
            return;
          }
          /* keep polling */
        }
        if (attempts >= MAX_POLL_ATTEMPTS && !isJobStillRunning(data)) {
          void checkFinalStatusAfterTimeout();
        }
      }, POLL_INTERVAL_MS);
    },
    [draftId, failGeneration, finishGeneration, stopPolling]
  );

  // Resume polling for a generation that was running when the page loaded.
  const activeJobId = activeGeneration?.jobId ?? null;
  const activeRunId = activeGeneration?.generationRunId ?? null;
  const activeVersion = activeGeneration?.version ?? null;
  useEffect(() => {
    if (activeVersion == null || !activeRunId) return;
    const key = `${activeRunId}:${activeVersion}`;
    if (pollingKeyRef.current === key) return;
    pollingKeyRef.current = key;
    startPolling(activeJobId, activeVersion);
  }, [activeJobId, activeRunId, activeVersion, startPolling]);

  const busy = status === "loading" || status === "polling";
  const materialBusy = busy || materialSaving;
  const readyMaterialCount = materials.filter(
    (material) => material.enabled && material.status === "ready"
  ).length;
  const canGenerate = readyMaterialCount > 0 && !busy;

  function resetMaterialInputs() {
    setMaterialInputMode(null);
    setMaterialTitle("");
    setMaterialText("");
    setMaterialUrl("");
  }

  async function runMaterialAction(action: () => Promise<void>, fallback: string) {
    setMaterialSaving(true);
    setMaterialError(null);
    try {
      await action();
    } catch (error) {
      setMaterialError(errorMessageOf(error, fallback));
    } finally {
      setMaterialSaving(false);
    }
  }

  function appendMaterial(material: SakMaterial) {
    setMaterials((current) => [...current, material]);
    setMaterialsOpen(true);
  }

  function saveTextMaterial() {
    if (!materialText.trim()) return;
    void runMaterialAction(async () => {
      const material = await addSakText(draftId, {
        ...(materialTitle.trim() ? { title: materialTitle.trim() } : {}),
        text: materialText.trim()
      });
      appendMaterial(material);
      resetMaterialInputs();
    }, "Kunne ikke lagre teksten");
  }

  function saveUrlMaterial() {
    if (!materialUrl.trim()) return;
    void runMaterialAction(async () => {
      const material = await addSakUrl(draftId, materialUrl.trim());
      appendMaterial(material);
      resetMaterialInputs();
    }, "Kunne ikke hente lenken");
  }

  function uploadPdfMaterial(file: File) {
    void runMaterialAction(async () => {
      try {
        appendMaterial(await addSakPdf(draftId, file));
      } finally {
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    }, "Kunne ikke laste opp PDF-en");
  }

  async function setMaterialEnabled(material: SakMaterial, enabled: boolean) {
    setMaterials((current) =>
      current.map((item) => (item.id === material.id ? { ...item, enabled } : item))
    );
    try {
      const updated = await patchSakMaterial(draftId, material.id, enabled);
      setMaterials((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
    } catch (error) {
      setMaterialError(errorMessageOf(error, "Kunne ikke oppdatere materialet"));
      setMaterials((current) =>
        current.map((item) =>
          item.id === material.id ? { ...item, enabled: material.enabled } : item
        )
      );
    }
  }

  async function removeMaterial(materialId: string) {
    const previous = materials;
    setMaterials((current) => current.filter((item) => item.id !== materialId));
    try {
      await deleteSakMaterial(draftId, materialId);
    } catch (error) {
      setMaterialError(errorMessageOf(error, "Kunne ikke fjerne materialet"));
      setMaterials(previous);
    }
  }

  function pasteInsteadOf(material: SakMaterial) {
    setMaterialsOpen(true);
    setMaterialInputMode("text");
    setMaterialTitle(material.title);
    setMaterialText("");
    requestAnimationFrame(() => materialTextareaRef.current?.focus());
  }

  async function handleGenerate() {
    if (!canGenerate) return;
    const instruction = text.trim();
    const titleOverride = title.trim();
    stopPolling();
    setStatus("loading");
    setErrorMessage(null);

    try {
      const response = await generateSak(draftId, {
        ...(instruction ? { instruction } : {}),
        // Always sent so an emptied field clears a stored override.
        titleOverride,
        targetChars,
        selectedMaterialIds: materials
          .filter((material) => material.enabled)
          .map((material) => material.id)
      });
      setText("");
      pollingKeyRef.current = `${response.generationRunId}:${response.version}`;
      startPolling(response.jobId, response.version);
      onChangeRef.current();
    } catch (error) {
      setStatus("error");
      setErrorMessage(errorMessageOf(error, GENERATION_FAILED_MESSAGE));
      if (error instanceof SakApiError && error.status === 409) {
        onChangeRef.current();
      }
    }
  }

  function handleSubmitKey(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canGenerate) {
      event.preventDefault();
      void handleGenerate();
    }
  }

  const lengthOptions: number[] = SAK_TARGET_CHARS_PRESETS.includes(
    targetChars as (typeof SAK_TARGET_CHARS_PRESETS)[number]
  )
    ? [...SAK_TARGET_CHARS_PRESETS]
    : [...SAK_TARGET_CHARS_PRESETS, targetChars].sort((a, b) => a - b);

  const buttonLabel =
    status === "loading"
      ? "Sender ..."
      : status === "polling"
        ? `${PROGRESS_STEPS[progressStep]}...`
        : versionCount
          ? "Ny versjon"
          : "Lag utkast";

  return (
    <div className="instructionWrap">
      <div className="sakFields">
        <input
          className="materialInput"
          placeholder="Tittel (valgfri, brukes ordrett)"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={handleSubmitKey}
          disabled={busy}
          aria-label="Tittel"
        />
        <select
          className="materialInput sakSelect"
          value={targetChars}
          onChange={(event) => setTargetChars(Number(event.target.value))}
          disabled={busy}
          aria-label="Lengde"
        >
          {lengthOptions.map((chars) => (
            <option key={chars} value={chars}>
              {chars.toLocaleString("nb-NO")} tegn
            </option>
          ))}
        </select>
      </div>
      <textarea
        ref={textareaRef}
        className="instructionTextarea"
        placeholder={
          versionCount
            ? "Hva skal endres?"
            : "Instruksjon: vinkel, hva som skal med, hva som skal ut"
        }
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleSubmitKey}
        disabled={busy}
        rows={2}
      />
      <div className="materialBar">
        <button
          className="ghostButton"
          type="button"
          onClick={() => setMaterialsOpen((open) => !open)}
          disabled={busy}
        >
          + Materiale{readyMaterialCount ? ` (${readyMaterialCount})` : ""}
        </button>
        {materialSaving && <span className="muted">Lagrer ...</span>}
        {materialError && <span className="muted">{materialError}</span>}
      </div>
      {materialsOpen && (
        <div className="materialTray">
          <div className="materialActions">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="materialFileInput"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) uploadPdfMaterial(file);
              }}
              disabled={materialBusy}
            />
            <button
              className="ghostButton"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={materialBusy}
            >
              PDF
            </button>
            <button
              className="ghostButton"
              type="button"
              onClick={() => setMaterialInputMode((mode) => (mode === "url" ? null : "url"))}
              disabled={busy}
            >
              Lenke
            </button>
            <button
              className="ghostButton"
              type="button"
              onClick={() => setMaterialInputMode((mode) => (mode === "text" ? null : "text"))}
              disabled={busy}
            >
              Tekst
            </button>
          </div>

          {materialInputMode === "url" && (
            <div className="materialInlineForm">
              <input
                className="materialInput"
                placeholder="https://"
                value={materialUrl}
                onChange={(event) => setMaterialUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && materialUrl.trim() && !materialBusy) {
                    event.preventDefault();
                    saveUrlMaterial();
                  }
                }}
                disabled={materialBusy}
                aria-label="Lenke"
              />
              <button
                className="ghostButton"
                type="button"
                onClick={saveUrlMaterial}
                disabled={!materialUrl.trim() || materialBusy}
              >
                Legg til
              </button>
            </div>
          )}

          {materialInputMode === "text" && (
            <div className="materialTextForm">
              <input
                className="materialInput"
                placeholder="Tittel"
                value={materialTitle}
                onChange={(event) => setMaterialTitle(event.target.value)}
                disabled={materialBusy}
                aria-label="Tittel på tekstmateriale"
              />
              <textarea
                ref={materialTextareaRef}
                className="materialTextarea"
                placeholder="Lim inn kildetekst"
                value={materialText}
                onChange={(event) => setMaterialText(event.target.value)}
                disabled={materialBusy}
                rows={3}
              />
              <button
                className="ghostButton"
                type="button"
                onClick={saveTextMaterial}
                disabled={!materialText.trim() || materialBusy}
              >
                Legg til
              </button>
            </div>
          )}

          {materials.length > 0 && (
            <ul className="materialList">
              {materials.map((material) => {
                const failed = material.status === "failed";
                return (
                  <li
                    key={material.id}
                    className={`materialItem${failed ? " materialItemFailed" : ""}`}
                  >
                    <label className="materialToggle">
                      <input
                        type="checkbox"
                        checked={material.enabled}
                        disabled={busy}
                        onChange={(event) =>
                          void setMaterialEnabled(material, event.currentTarget.checked)
                        }
                      />
                      <span className="materialTitle">{material.title}</span>
                      <span className={`materialMeta${failed ? " materialError" : ""}`}>
                        {materialMeta(material)}
                      </span>
                    </label>
                    <span className="actionsRight">
                      {failed && material.kind === "url" && (
                        <button
                          className="ghostButton"
                          type="button"
                          onClick={() => pasteInsteadOf(material)}
                          disabled={busy}
                        >
                          Lim inn teksten i stedet
                        </button>
                      )}
                      <button
                        className="draftIconButton"
                        type="button"
                        onClick={() => void removeMaterial(material.id)}
                        disabled={busy}
                        aria-label="Fjern materiale"
                        title="Fjern materiale"
                      >
                        x
                      </button>
                    </span>
                    {failed && material.errorText && (
                      <span className="materialMeta materialError materialErrorLine">
                        {material.errorText}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      <div className="instructionActions">
        <button
          className="ghostButton"
          type="button"
          onClick={() => void handleGenerate()}
          disabled={!canGenerate}
        >
          {buttonLabel}
        </button>
        {status === "polling" && <E24Loader />}
        {status === "error" && errorMessage && (
          <span className="muted">{errorMessage}</span>
        )}
      </div>
    </div>
  );
}

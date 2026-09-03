"use client";

import type { NoticeMaterial, OutputMode } from "@newsweb/shared";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useEditorialTelemetry } from "../lib/editorial-telemetry";
import { E24Loader } from "./e24-loader";
import {
  GENERATION_STEP_DURATION_MS,
  getGenerationStepIndex,
  getGenerationSteps
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

type GenerateResponse = {
  jobId?: string | number | null;
  version?: number | null;
};

type RewriteStatusResponse = {
  ready?: boolean;
  failed?: boolean;
  version?: number | null;
  generatedAt?: string | null;
  jobState?: string | null;
  phase?: string | null;
};

type InstructionInputProps = {
  messageId: number;
  activeVersion?: number;
  rewriteId?: string;
  publicationRevision?: number;
  contentHash?: string;
  isFinal?: boolean;
  hasAttachments?: boolean;
};

export function InstructionInput({
  messageId,
  activeVersion,
  rewriteId,
  publicationRevision,
  contentHash,
  isFinal,
  hasAttachments
}: InstructionInputProps) {
  const PROGRESS_STEPS = getGenerationSteps(hasAttachments);
  const router = useRouter();
  const [text, setText] = useState("");
  const [xhighEnabled, setXhighEnabled] = useState(false);
  const [outputMode, setOutputMode] = useState<OutputMode>("notice");
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [materials, setMaterials] = useState<NoticeMaterial[]>([]);
  const [materialStatus, setMaterialStatus] = useState<"idle" | "loading" | "saving" | "error">("idle");
  const [materialInputMode, setMaterialInputMode] = useState<"text" | "newsweb" | null>(null);
  const [materialTitle, setMaterialTitle] = useState("");
  const [materialText, setMaterialText] = useState("");
  const [materialUrl, setMaterialUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "polling" | "sent" | "error">("idle");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const versionBeforeRef = useRef<number | null>(null);
  const generatedAtBeforeRef = useRef<string | null>(null);
  const isRegenRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { buildTelemetry } = useEditorialTelemetry(messageId, {
    version: activeVersion,
    rewriteId,
    publicationRevision,
    contentHash,
    isFinal
  });

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

  const [progressStep, setProgressStep] = useState(0);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  async function loadMaterials() {
    setMaterialStatus("loading");
    try {
      const response = await fetch(`/api/notice/${messageId}/materials`, {
        credentials: "include"
      });
      if (!response.ok) {
        setMaterialStatus("error");
        return;
      }
      const data = (await response.json()) as { materials: NoticeMaterial[] };
      setMaterials(data.materials);
      setMaterialStatus("idle");
    } catch {
      setMaterialStatus("error");
    }
  }

  useEffect(() => {
    void loadMaterials();
  }, [messageId]);

  function selectedMaterialIds() {
    return materials
      .filter((material) => material.enabled && material.status === "ready")
      .map((material) => material.id);
  }

  function resetMaterialInputs() {
    setMaterialInputMode(null);
    setMaterialTitle("");
    setMaterialText("");
    setMaterialUrl("");
  }

  async function saveTextMaterial() {
    if (!materialText.trim()) return;
    setMaterialStatus("saving");
    try {
      const response = await fetch(`/api/notice/${messageId}/materials/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...(materialTitle.trim() ? { title: materialTitle.trim() } : {}),
          text: materialText.trim()
        })
      });
      if (!response.ok) {
        setMaterialStatus("error");
        return;
      }
      const material = (await response.json()) as NoticeMaterial;
      setMaterials((current) => [...current, material]);
      resetMaterialInputs();
      setMaterialStatus("idle");
    } catch {
      setMaterialStatus("error");
    }
  }

  async function saveNewswebMaterial() {
    if (!materialUrl.trim()) return;
    setMaterialStatus("saving");
    try {
      const response = await fetch(`/api/notice/${messageId}/materials/newsweb`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ url: materialUrl.trim() })
      });
      if (!response.ok) {
        setMaterialStatus("error");
        return;
      }
      const material = (await response.json()) as NoticeMaterial;
      setMaterials((current) => [...current, material]);
      resetMaterialInputs();
      setMaterialStatus("idle");
    } catch {
      setMaterialStatus("error");
    }
  }

  async function uploadPdfMaterial(file: File) {
    setMaterialStatus("saving");
    const formData = new FormData();
    formData.append("file", file);
    try {
      const response = await fetch(`/api/notice/${messageId}/materials/pdf`, {
        method: "POST",
        credentials: "include",
        body: formData
      });
      if (!response.ok) {
        setMaterialStatus("error");
        return;
      }
      const material = (await response.json()) as NoticeMaterial;
      setMaterials((current) => [...current, material]);
      setMaterialsOpen(true);
      setMaterialStatus("idle");
    } catch {
      setMaterialStatus("error");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function setMaterialEnabled(material: NoticeMaterial, enabled: boolean) {
    setMaterials((current) =>
      current.map((item) => item.id === material.id ? { ...item, enabled } : item)
    );
    try {
      const response = await fetch(
        `/api/notice/${messageId}/materials/${material.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ enabled })
        }
      );
      if (!response.ok) {
        throw new Error("Material update failed");
      }
      const updated = (await response.json()) as NoticeMaterial;
      setMaterials((current) =>
        current.map((item) => item.id === updated.id ? updated : item)
      );
    } catch {
      setMaterialStatus("error");
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
      const response = await fetch(
        `/api/notice/${messageId}/materials/${materialId}`,
        {
          method: "DELETE",
          credentials: "include"
        }
      );
      if (!response.ok) {
        throw new Error("Material delete failed");
      }
    } catch {
      setMaterialStatus("error");
      setMaterials(previous);
    }
  }

  function statusChanged(data: { version?: number | null; generatedAt?: string | null }) {
    return (
      data.version !== versionBeforeRef.current ||
      data.generatedAt !== generatedAtBeforeRef.current
    );
  }

  function isJobStillRunning(data: RewriteStatusResponse | null) {
    return data?.jobState ? RUNNING_JOB_STATES.has(data.jobState) : false;
  }

  async function fetchRewriteStatus(jobId?: string | null): Promise<RewriteStatusResponse | null> {
    const query = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";
    const check = await fetch(`/api/notice/${messageId}/status${query}`, {
      credentials: "include"
    });
    if (!check.ok) {
      return null;
    }
    return (await check.json()) as RewriteStatusResponse;
  }

  async function checkFinalStatusAfterTimeout(jobId?: string | null) {
    stopPolling();

    try {
      const data = await fetchRewriteStatus(jobId);
      if (data?.failed) {
        setStatus("error");
        return;
      }
      if (data?.ready && statusChanged(data)) {
        setStatus("idle");
        router.refresh();
        return;
      }
    } catch { /* fall through to timeout handling */ }

    setStatus("error");
    router.refresh();
  }

  async function handleGenerate(options: { reasoningEffortOverride?: "xhigh" } = {}) {
    const instruction = text.trim();
    const reasoningEffortOverride =
      options.reasoningEffortOverride ?? (xhighEnabled ? "xhigh" : undefined);
    isRegenRef.current = !instruction;
    versionBeforeRef.current = null;
    generatedAtBeforeRef.current = null;
    stopPolling();
    setStatus("loading");
    setXhighEnabled(false);

    try {
      // Capture current version and generatedAt right before triggering
      try {
        const data = await fetchRewriteStatus();
        if (data) {
          versionBeforeRef.current = data.version ?? null;
          generatedAtBeforeRef.current = data.generatedAt ?? null;
        }
      } catch { /* ignore */ }

      const fetchOptions: RequestInit = {
        method: "POST",
        credentials: "include",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
      };
      const requestBody = {
        ...(instruction ? { instruction } : {}),
        outputMode,
        selectedMaterialIds: selectedMaterialIds(),
        ...(reasoningEffortOverride ? { reasoningEffortOverride } : {}),
        telemetry: buildTelemetry({
          actionSource:
            reasoningEffortOverride === "xhigh"
              ? "instruction_input_xhigh"
              : "instruction_input"
        })
      };
      fetchOptions.body = JSON.stringify(requestBody);
      const response = await fetch(`/api/notice/${messageId}/generate`, fetchOptions);

      if (!response.ok) {
        setStatus("error");
        return;
      }
      let jobId: string | null = null;
      try {
        const data = (await response.json()) as GenerateResponse;
        jobId = data.jobId != null ? String(data.jobId) : null;
      } catch { /* response body is optional */ }

      setStatus("polling");
      setText("");
      setProgressStep(0);
      progressRef.current = setInterval(() => {
        setProgressStep((prev) => Math.min(prev + 1, PROGRESS_STEPS.length - 1));
      }, GENERATION_STEP_DURATION_MS);
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts++;
        let data: RewriteStatusResponse | null = null;
        try {
          data = await fetchRewriteStatus(jobId);
          const phaseStep = getGenerationStepIndex(data?.phase, hasAttachments);
          if (phaseStep >= 0) {
            setProgressStep((prev) => Math.max(prev, phaseStep));
          }
          if (data?.ready && statusChanged(data)) {
            stopPolling();
            setStatus("idle");
            router.refresh();
            return;
          }
          if (data?.failed || data?.jobState === "failed") {
            stopPolling();
            setStatus("error");
            return;
          }
        } catch { /* keep polling */ }
        if (attempts >= MAX_POLL_ATTEMPTS && !isJobStillRunning(data)) {
          void checkFinalStatusAfterTimeout(jobId);
        }
      }, POLL_INTERVAL_MS);
    } catch {
      setStatus("error");
    }
  }

  async function handleFeedback() {
    if (!text.trim()) return;
    setStatus("loading");

    try {
      const response = await fetch(`/api/notice/${messageId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          text: text.trim(),
          ...(activeVersion != null ? { version: activeVersion } : {}),
          telemetry: buildTelemetry({
            actionSource: "instruction_input"
          })
        })
      });

      if (!response.ok) {
        setStatus("error");
        return;
      }

      setText("");
      setStatus("sent");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
    }
  }

  const busy = status === "loading" || status === "polling";
  const activeMaterialCount = selectedMaterialIds().length;

  function materialMeta(material: NoticeMaterial): string {
    if (material.status === "failed") return "Feilet";
    const kind =
      material.kind === "pdf"
        ? "PDF"
        : material.kind === "newsweb"
          ? "Newsweb"
          : "Tekst";
    return `${kind} - ${material.extractedTextChars.toLocaleString("nb-NO")} tegn`;
  }

  return (
    <div className="instructionWrap">
      <textarea
        ref={textareaRef}
        className="instructionTextarea"
        placeholder="Skriv instruksjoner for ny versjon eller gi feedback..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy) {
            e.preventDefault();
            handleGenerate();
          }
        }}
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
          + Materiale{activeMaterialCount ? ` (${activeMaterialCount})` : ""}
        </button>
        {materialStatus === "loading" && <span className="muted">Laster ...</span>}
        {materialStatus === "saving" && <span className="muted">Lagrer ...</span>}
        {materialStatus === "error" && <span className="muted">Materiale feilet</span>}
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
                if (file) void uploadPdfMaterial(file);
              }}
              disabled={busy || materialStatus === "saving"}
            />
            <button
              className="ghostButton"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || materialStatus === "saving"}
            >
              PDF
            </button>
            <button
              className="ghostButton"
              type="button"
              onClick={() => setMaterialInputMode((mode) => mode === "newsweb" ? null : "newsweb")}
              disabled={busy}
            >
              Newsweb
            </button>
            <button
              className="ghostButton"
              type="button"
              onClick={() => setMaterialInputMode((mode) => mode === "text" ? null : "text")}
              disabled={busy}
            >
              Tekst
            </button>
          </div>

          {materialInputMode === "newsweb" && (
            <div className="materialInlineForm">
              <input
                className="materialInput"
                placeholder="Newsweb-lenke eller messageId"
                value={materialUrl}
                onChange={(event) => setMaterialUrl(event.target.value)}
                disabled={busy || materialStatus === "saving"}
              />
              <button
                className="ghostButton"
                type="button"
                onClick={saveNewswebMaterial}
                disabled={!materialUrl.trim() || busy || materialStatus === "saving"}
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
                disabled={busy || materialStatus === "saving"}
              />
              <textarea
                className="materialTextarea"
                placeholder="Lim inn kildetekst"
                value={materialText}
                onChange={(event) => setMaterialText(event.target.value)}
                disabled={busy || materialStatus === "saving"}
                rows={3}
              />
              <button
                className="ghostButton"
                type="button"
                onClick={saveTextMaterial}
                disabled={!materialText.trim() || busy || materialStatus === "saving"}
              >
                Legg til
              </button>
            </div>
          )}

          {materials.length > 0 && (
            <ul className="materialList">
              {materials.map((material) => (
                <li key={material.id} className="materialItem">
                  <label className="materialToggle">
                    <input
                      type="checkbox"
                      checked={material.enabled && material.status === "ready"}
                      disabled={busy || material.status !== "ready"}
                      onChange={(event) =>
                        void setMaterialEnabled(material, event.currentTarget.checked)
                      }
                    />
                    <span className="materialTitle">{material.title}</span>
                    <span className="materialMeta">{materialMeta(material)}</span>
                  </label>
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
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="instructionActions">
        <div className="outputModeToggle" aria-label="Lengde">
          <button
            type="button"
            className={`outputModeButton${outputMode === "notice" ? " active" : ""}`}
            onClick={() => setOutputMode("notice")}
            disabled={busy}
          >
            Notis
          </button>
          <button
            type="button"
            className={`outputModeButton${outputMode === "extended_notice" ? " active" : ""}`}
            onClick={() => setOutputMode("extended_notice")}
            disabled={busy}
          >
            Utvidet
          </button>
        </div>
        <button
          className="ghostButton"
          onClick={() => handleGenerate()}
          disabled={busy}
        >
          {status === "loading"
            ? "Sender ..."
            : status === "polling"
              ? PROGRESS_STEPS[progressStep] + "..."
              : (text.trim() ? "Generer ny versjon" : "Regenerer notis")}
        </button>
        <button
          className={`xhighToggle${xhighEnabled ? " xhighToggleActive" : ""}`}
          type="button"
          onClick={() => setXhighEnabled((enabled) => !enabled)}
          disabled={busy}
          aria-label="Bruk xhigh-resonnering ved neste generering"
          aria-pressed={xhighEnabled}
          title="Bruk xhigh-resonnering ved neste generering"
        >
          <svg
            className="xhighIcon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M8.4 18.8c-2.1 0-3.8-1.7-3.8-3.8 0-.8.2-1.5.7-2.1a4 4 0 0 1-.5-2 4.1 4.1 0 0 1 4.1-4.1h.3A4.1 4.1 0 0 1 16.8 6a3.8 3.8 0 0 1 2.6 6.8c.4.6.6 1.3.6 2.1 0 2.1-1.7 3.8-3.8 3.8" />
            <path d="M8.8 6.8v12" />
            <path d="M15.2 6v12.8" />
            <path d="M8.8 10.4c1.2 0 2.1-.6 2.5-1.6" />
            <path d="M15.2 10.2c-1.2 0-2.1-.5-2.6-1.4" />
            <path d="M8.8 14.2c1.2 0 2.1.5 2.6 1.4" />
            <path d="M15.2 14.4c-1.2 0-2.1.6-2.5 1.6" />
          </svg>
        </button>
        {status === "polling" && <E24Loader />}
        {status === "error" && (
          <span className="muted">
            Noe gikk galt — prøv igjen
          </span>
        )}
        <span className="actionsRight">
          <button
            className="ghostButton"
            onClick={handleFeedback}
            disabled={!text.trim() || busy}
          >
            {status === "sent" ? "Takk!" : "Feedback"}
          </button>
        </span>
      </div>
    </div>
  );
}

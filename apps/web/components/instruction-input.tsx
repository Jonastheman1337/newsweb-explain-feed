"use client";

import type { GenerationPhase, RewriteStatusResponse } from "@newsweb/shared";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useEditorialTelemetry } from "../lib/editorial-telemetry";
import { E24Loader } from "./e24-loader";
import { getGenerationPhaseLabel } from "./generation-steps";

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

type InstructionInputProps = {
  messageId: number;
  activeVersion?: number;
  hasAttachments?: boolean;
};

export function InstructionInput({ messageId, activeVersion }: InstructionInputProps) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [xhighEnabled, setXhighEnabled] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "polling" | "sent" | "error">("idle");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const versionBeforeRef = useRef<number | null>(null);
  const generatedAtBeforeRef = useRef<string | null>(null);
  const isRegenRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { buildTelemetry } = useEditorialTelemetry(messageId, activeVersion);

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

  const [phase, setPhase] = useState<GenerationPhase | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setPhase(null);
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

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
        headers: { "Content-Type": "application/json" },
      };
      const requestBody = {
        ...(instruction ? { instruction } : {}),
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
      setPhase("queued");
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts++;
        let data: RewriteStatusResponse | null = null;
        try {
          data = await fetchRewriteStatus(jobId);
          setPhase(data?.phase ?? "queued");
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
      <div className="instructionActions">
        <button
          className="ghostButton"
          onClick={() => handleGenerate()}
          disabled={busy}
        >
          {status === "loading"
            ? "Sender ..."
            : status === "polling"
              ? getGenerationPhaseLabel(phase ?? "queued") + "..."
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
            Noe gikk galt — prov igjen
          </span>
        )}
        <span className="actionsRight">
          <button
            className="ghostButton"
            onClick={handleFeedback}
            disabled={!text.trim() || busy}
          >
            {status === "sent" ? "Feedback sendt!" : "Gi feedback"}
          </button>
        </span>
      </div>
    </div>
  );
}

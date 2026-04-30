"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { E24Loader } from "./e24-loader";

const BASE_STEPS = [
  "Leser original melding",
  "Analyserer innhold",
  "Skriver AI-notis",
  "Sjekker referanser",
  "Ferdigstiller"
];

const PDF_STEP = "Leser PDF-vedlegg";
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
};

type RewriteStatusResponse = {
  ready?: boolean;
  version?: number | null;
  generatedAt?: string | null;
  jobState?: string | null;
};

type InstructionInputProps = {
  messageId: number;
  activeVersion?: number;
  hasAttachments?: boolean;
};

export function InstructionInput({ messageId, activeVersion, hasAttachments }: InstructionInputProps) {
  const PROGRESS_STEPS = hasAttachments
    ? [BASE_STEPS[0], PDF_STEP, ...BASE_STEPS.slice(1)]
    : BASE_STEPS;
  const router = useRouter();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "polling" | "sent" | "error">("idle");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const versionBeforeRef = useRef<number | null>(null);
  const generatedAtBeforeRef = useRef<string | null>(null);
  const isRegenRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    setProgressStep(0);
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
      if (data?.ready && statusChanged(data)) {
        setStatus("idle");
        router.refresh();
        return;
      }
    } catch { /* fall through to timeout handling */ }

    setStatus("error");
    router.refresh();
  }

  async function handleGenerate() {
    const instruction = text.trim();
    isRegenRef.current = !instruction;
    versionBeforeRef.current = null;
    generatedAtBeforeRef.current = null;
    stopPolling();
    setStatus("loading");

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
      };
      if (instruction) {
        fetchOptions.headers = { "Content-Type": "application/json" };
        fetchOptions.body = JSON.stringify({ instruction });
      }
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
      }, 6000);
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts++;
        let data: RewriteStatusResponse | null = null;
        try {
          data = await fetchRewriteStatus(jobId);
          if (data?.ready && statusChanged(data)) {
            stopPolling();
            setStatus("idle");
            router.refresh();
            return;
          }
          if (data?.jobState === "failed") {
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
          ...(activeVersion != null ? { version: activeVersion } : {})
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
          onClick={handleGenerate}
          disabled={busy}
        >
          {status === "loading"
            ? "Sender ..."
            : status === "polling"
              ? PROGRESS_STEPS[progressStep] + "..."
              : (text.trim() ? "Generer ny versjon" : "Regenerer notis")}
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

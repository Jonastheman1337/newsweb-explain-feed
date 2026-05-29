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

type GenerateButtonProps = {
  messageId: number;
  label?: string;
  hasAttachments?: boolean;
  reasoningEffortOverride?: "xhigh";
};

export function GenerateButton({
  messageId,
  label,
  reasoningEffortOverride
}: GenerateButtonProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "polling" | "done" | "error">(
    "idle"
  );
  const [phase, setPhase] = useState<GenerationPhase | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { buildTelemetry } = useEditorialTelemetry(messageId);

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

  function hasStatusChanged(
    data: RewriteStatusResponse,
    versionBefore: number | null,
    generatedAtBefore: string | null
  ) {
    return data.version !== versionBefore || data.generatedAt !== generatedAtBefore;
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

  async function checkFinalStatusAfterTimeout(
    versionBefore: number | null,
    generatedAtBefore: string | null,
    jobId?: string | null
  ) {
    stopPolling();

    try {
      const data = await fetchRewriteStatus(jobId);
      if (data?.failed) {
        setStatus("error");
        return;
      }
      if (data?.ready && hasStatusChanged(data, versionBefore, generatedAtBefore)) {
        setStatus("done");
        router.refresh();
        return;
      }
    } catch { /* fall through to timeout handling */ }

    setStatus("error");
  }

  async function handleClick() {
    stopPolling();
    setStatus("loading");
    try {
      // Capture current version before triggering
      let versionBefore: number | null = null;
      let generatedAtBefore: string | null = null;
      try {
        const data = await fetchRewriteStatus();
        if (data) {
          versionBefore = data.version ?? null;
          generatedAtBefore = data.generatedAt ?? null;
        }
      } catch { /* ignore */ }

      const response = await fetch(`/api/notice/${messageId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...(reasoningEffortOverride ? { reasoningEffortOverride } : {}),
          telemetry: buildTelemetry({
            actionSource:
              reasoningEffortOverride === "xhigh"
                ? "generate_button_xhigh"
                : "generate_button"
          })
        })
      });

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
      setPhase("queued");

      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts++;
        let data: RewriteStatusResponse | null = null;
        try {
          data = await fetchRewriteStatus(jobId);
          setPhase(data?.phase ?? "queued");
          if (data?.ready && hasStatusChanged(data, versionBefore, generatedAtBefore)) {
            stopPolling();
            setStatus("done");
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
          void checkFinalStatusAfterTimeout(versionBefore, generatedAtBefore, jobId);
        }
      }, POLL_INTERVAL_MS);
    } catch {
      setStatus("error");
    }
  }

  if (status === "polling" || status === "done") {
    return (
      <span className="muted" style={{ display: "inline-flex", alignItems: "center", gap: "0.75rem" }}>
        {getGenerationPhaseLabel(phase ?? "queued")}... <E24Loader />
      </span>
    );
  }

  if (status === "error") {
    return (
      <button className="ghostButton" onClick={handleClick}>
        Feilet — prov igjen
      </button>
    );
  }

  return (
    <button
      className="ghostButton"
      onClick={handleClick}
      disabled={status === "loading"}
    >
      {status === "loading" ? "Sender ..." : (label || "Generer notis")}
    </button>
  );
}

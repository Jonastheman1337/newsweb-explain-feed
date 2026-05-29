"use client";

import type { GenerationPhase, RewriteStatusResponse } from "@newsweb/shared";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { E24Loader } from "./e24-loader";
import {
  getGenerationPhaseLabel,
  getGenerationStepIndex,
  getGenerationSteps
} from "./generation-steps";

type ProcessingIndicatorProps = {
  messageId: number;
  hasAttachments?: boolean;
};

export function ProcessingIndicator({ messageId, hasAttachments }: ProcessingIndicatorProps) {
  const steps = getGenerationSteps(hasAttachments);
  const router = useRouter();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [phase, setPhase] = useState<GenerationPhase | null>("queued");
  const [failed, setFailed] = useState(false);

  // Poll for completion
  useEffect(() => {
    let attempts = 0;
    async function checkStatus() {
      attempts++;
      try {
        const res = await fetch(`/api/notice/${messageId}/status`, {
          credentials: "include"
        });
        if (res.ok) {
          const data = (await res.json()) as RewriteStatusResponse;
          setPhase(data.phase ?? "queued");
          if (data.ready) {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            router.refresh();
            return;
          }
          if (data.failed || data.jobState === "failed") {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            setFailed(true);
            return;
          }
        }
      } catch {
        /* keep polling */
      }
      if (attempts >= 60) {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        router.refresh();
      }
    }

    void checkStatus();
    pollRef.current = setInterval(checkStatus, 5000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [messageId, router]);

  const stepIndex = getGenerationStepIndex(phase, hasAttachments);
  const progress = stepIndex < 0 ? 0 : ((stepIndex + 1) / steps.length) * 100;

  if (failed) {
    return (
      <div className="processingWrap">
        <span className="muted">Generering feilet.</span>
        <button className="ghostButton" onClick={() => router.refresh()}>
          Oppdater
        </button>
      </div>
    );
  }

  return (
    <div className="processingWrap">
      {stepIndex < 0 && (
        <p className="muted" aria-live="polite">
          {getGenerationPhaseLabel(phase)}...
        </p>
      )}
      <div className="processingSteps">
        {steps.map((step, i) => (
          <div
            key={step}
            className={`processingStep${i < stepIndex ? " stepDone" : i === stepIndex ? " stepActive" : ""}`}
          >
            <span className="stepDot">
              {i < stepIndex ? "✓" : i === stepIndex ? <E24Loader /> : ""}
            </span>
            <span>{step}</span>
          </div>
        ))}
      </div>
      <div className="progressBarTrack">
        <div className="progressBarFill" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { E24Loader } from "./e24-loader";
import {
  GENERATION_STEP_DURATION_MS,
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
  const [stepIndex, setStepIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [failed, setFailed] = useState(false);

  // Advance steps on a timer
  useEffect(() => {
    setStepIndex(0);
    setElapsed(0);
    const interval = setInterval(() => {
      setElapsed((prev) => prev + 1000);
    }, 1000);
    return () => clearInterval(interval);
  }, [steps.length]);

  useEffect(() => {
    setStepIndex(
      Math.min(Math.floor(elapsed / GENERATION_STEP_DURATION_MS), steps.length - 1)
    );
  }, [elapsed, steps.length]);

  // Poll for completion
  useEffect(() => {
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const res = await fetch(`/api/notice/${messageId}/status`, {
          credentials: "include"
        });
        if (res.ok) {
          const data = await res.json();
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
    }, 5000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [messageId, router]);

  const progress = Math.min(
    ((stepIndex / (steps.length - 1)) * 80) + (elapsed > 0 ? Math.min(elapsed / 500, 15) : 0),
    95
  );

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

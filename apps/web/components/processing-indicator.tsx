"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { E24Loader } from "./e24-loader";

type ProcessingIndicatorProps = {
  messageId: number;
  hasAttachments?: boolean;
};

const BASE_STEPS = [
  "Leser original melding",
  "Analyserer innhold",
  "Skriver AI-notis",
  "Sjekker referanser",
  "Ferdigstiller"
];

const PDF_STEP = "Leser PDF-vedlegg";

const STEP_DURATION_MS = 6000;

export function ProcessingIndicator({ messageId, hasAttachments }: ProcessingIndicatorProps) {
  const STEPS = hasAttachments
    ? [BASE_STEPS[0], PDF_STEP, ...BASE_STEPS.slice(1)]
    : BASE_STEPS;
  const router = useRouter();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  // Advance steps on a timer
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed((prev) => prev + 1000);
      setStepIndex((prev) => {
        const next = Math.floor((prev * STEP_DURATION_MS + 1000) / STEP_DURATION_MS);
        return Math.min(next, STEPS.length - 1);
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

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
    ((stepIndex / (STEPS.length - 1)) * 80) + (elapsed > 0 ? Math.min(elapsed / 500, 15) : 0),
    95
  );

  return (
    <div className="processingWrap">
      <div className="processingSteps">
        {STEPS.map((step, i) => (
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

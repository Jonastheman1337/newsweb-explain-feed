"use client";

import { useEffect, useMemo, useState } from "react";

import {
  GENERATION_STEP_DURATION_MS,
  getGenerationStepIndex,
  getGenerationSteps
} from "./generation-steps";

type FeedProcessingIndicatorProps = {
  hasAttachments?: boolean;
  phase?: string | null;
};

/**
 * Shows the pipeline step for an in-flight generation. The timer provides a
 * smooth floor; the real phase (from SSE events and server render) advances
 * or corrects the display — same monotonic max() as the detail page.
 */
export function FeedProcessingIndicator({
  hasAttachments,
  phase
}: FeedProcessingIndicatorProps) {
  const steps = useMemo(() => getGenerationSteps(hasAttachments), [hasAttachments]);
  const [timerIndex, setTimerIndex] = useState(0);
  const [phaseIndex, setPhaseIndex] = useState(() =>
    Math.max(0, getGenerationStepIndex(phase, hasAttachments))
  );

  useEffect(() => {
    setTimerIndex(0);
    const interval = setInterval(() => {
      setTimerIndex((prev) => Math.min(prev + 1, steps.length - 1));
    }, GENERATION_STEP_DURATION_MS);

    return () => clearInterval(interval);
  }, [steps.length]);

  useEffect(() => {
    const next = getGenerationStepIndex(phase, hasAttachments);
    if (next >= 0) {
      setPhaseIndex((prev) => Math.max(prev, next));
    }
  }, [phase, hasAttachments]);

  const stepIndex = Math.max(timerIndex, phaseIndex);
  const currentStep = steps[Math.min(stepIndex, steps.length - 1)] ?? "Ferdigstiller";

  return (
    <div className="feedProcessingStatus" role="status" aria-live="polite">
      <span className="feedProcessingRing" aria-hidden="true" />
      <span key={currentStep} className="feedProcessingStep">
        {currentStep}...
      </span>
    </div>
  );
}

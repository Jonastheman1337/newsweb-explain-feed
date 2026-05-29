"use client";

import { useEffect, useMemo, useState } from "react";

import {
  GENERATION_STEP_DURATION_MS,
  getGenerationSteps
} from "./generation-steps";

type FeedProcessingIndicatorProps = {
  hasAttachments?: boolean;
};

export function FeedProcessingIndicator({ hasAttachments }: FeedProcessingIndicatorProps) {
  const steps = useMemo(() => getGenerationSteps(hasAttachments), [hasAttachments]);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    setStepIndex(0);
    const interval = setInterval(() => {
      setStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
    }, GENERATION_STEP_DURATION_MS);

    return () => clearInterval(interval);
  }, [steps.length]);

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

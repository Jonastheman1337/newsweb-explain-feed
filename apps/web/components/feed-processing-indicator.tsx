"use client";

import type { GenerationPhase, RewriteStatusResponse } from "@newsweb/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { getGenerationPhaseLabel } from "./generation-steps";

const POLL_INTERVAL_MS = 3000;

type FeedProcessingIndicatorProps = {
  messageId: number;
};

export function FeedProcessingIndicator({ messageId }: FeedProcessingIndicatorProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<GenerationPhase | null>("queued");

  useEffect(() => {
    let stopped = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function checkStatus() {
      try {
        const res = await fetch(`/api/notice/${messageId}/status`, {
          credentials: "include"
        });
        if (!res.ok || stopped) {
          return;
        }
        const data = (await res.json()) as RewriteStatusResponse;
        setPhase(data.phase ?? "queued");
        if (data.ready || data.failed || data.jobState === "failed") {
          stopped = true;
          if (interval) {
            clearInterval(interval);
          }
          router.refresh();
        }
      } catch {
        /* keep polling */
      }
    }

    void checkStatus();
    interval = setInterval(checkStatus, POLL_INTERVAL_MS);

    return () => {
      stopped = true;
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [messageId, router]);

  return (
    <div className="feedProcessingStatus" role="status" aria-live="polite">
      <span className="feedProcessingRing" aria-hidden="true" />
      <span key={phase} className="feedProcessingStep">
        {getGenerationPhaseLabel(phase)}...
      </span>
    </div>
  );
}

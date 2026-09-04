"use client";

import type { SakVersion } from "@newsweb/shared";
import { useEffect, useState } from "react";
import {
  hasRewriteDraft,
  REWRITE_DRAFT_CHANGE_EVENT,
  type RewriteDraftChangeDetail
} from "../lib/rewrite-drafts";

type SakTabsProps = {
  draftId: string;
  versions: SakVersion[];
  activeVersionId: string | null;
  onSelect: (version: SakVersion) => void;
};

function tabTitle(version: SakVersion): string | undefined {
  switch (version.status) {
    case "pending":
    case "needs_retry":
      return "Genereres";
    case "failed":
      return "Feilet";
    case "needs_review":
      return "Trenger gjennomsyn";
    default:
      return undefined;
  }
}

export function SakTabs({ draftId, versions, activeVersionId, onSelect }: SakTabsProps) {
  const [draftVersions, setDraftVersions] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setDraftVersions(
      new Set(
        versions
          .filter((version) =>
            hasRewriteDraft({
              messageId: draftId,
              version: version.version,
              rewriteId: version.id
            })
          )
          .map((version) => version.id)
      )
    );

    function handleDraftChange(event: Event) {
      const detail = (event as CustomEvent<RewriteDraftChangeDetail>).detail;
      if (!detail || detail.messageId !== draftId) return;

      setDraftVersions((current) => {
        const next = new Set(current);
        const draftKey = detail.rewriteId ?? String(detail.version);
        if (detail.hasDraft) {
          next.add(draftKey);
        } else {
          next.delete(draftKey);
        }
        return next;
      });
    }

    window.addEventListener(REWRITE_DRAFT_CHANGE_EVENT, handleDraftChange);
    return () => {
      window.removeEventListener(REWRITE_DRAFT_CHANGE_EVENT, handleDraftChange);
    };
  }, [draftId, versions]);

  if (versions.length < 2) return null;

  return (
    <div className="rewriteTabs">
      {versions.map((version) => (
        <button
          key={version.id}
          type="button"
          className={`rewriteTab${version.id === activeVersionId ? " active" : ""}`}
          title={tabTitle(version)}
          onClick={() => onSelect(version)}
        >
          {version.version}
          {draftVersions.has(version.id) && (
            <span className="tabDraftDot" title="Redigert utkast" aria-hidden="true" />
          )}
        </button>
      ))}
    </div>
  );
}

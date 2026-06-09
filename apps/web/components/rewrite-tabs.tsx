"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { RewriteOutput } from "@newsweb/shared";
import { useEditorialTelemetry } from "../lib/editorial-telemetry";
import {
  hasRewriteDraft,
  REWRITE_DRAFT_CHANGE_EVENT,
  type RewriteDraftChangeDetail
} from "../lib/rewrite-drafts";
import { EditableRewrite } from "./editable-rewrite";
import { InstructionInput } from "./instruction-input";

type RewriteVersion = {
  version: number;
  rewrite: RewriteOutput;
  userInstruction: string | null;
  generatedAt: string;
};

type RewriteTabsProps = {
  rewrites: RewriteVersion[];
  messageId: number;
  dateline: ReactNode;
  hasAttachments?: boolean;
};

export function RewriteTabs({ rewrites, messageId, dateline, hasAttachments }: RewriteTabsProps) {
  const [activeIndex, setActiveIndex] = useState(rewrites.length - 1);
  const [draftVersions, setDraftVersions] = useState<Set<number>>(() => new Set());
  const { logEvent } = useEditorialTelemetry(messageId);

  useEffect(() => {
    setActiveIndex(rewrites.length - 1);
  }, [rewrites.length]);

  const refreshDraftVersions = useCallback(() => {
    setDraftVersions(
      new Set(
        rewrites
          .filter((rewrite) =>
            hasRewriteDraft({
              messageId,
              version: rewrite.version,
              originalTitle: rewrite.rewrite.title,
              originalBody: [rewrite.rewrite.lead, ...rewrite.rewrite.body]
                .filter(Boolean)
                .join("\n\n")
            })
          )
          .map((rewrite) => rewrite.version)
      )
    );
  }, [messageId, rewrites]);

  useEffect(() => {
    refreshDraftVersions();

    function handleDraftChange(event: Event) {
      const detail = (event as CustomEvent<RewriteDraftChangeDetail>).detail;
      if (!detail || detail.messageId !== messageId) return;

      setDraftVersions((current) => {
        const next = new Set(current);
        if (detail.hasDraft) {
          next.add(detail.version);
        } else {
          next.delete(detail.version);
        }
        return next;
      });
    }

    window.addEventListener(REWRITE_DRAFT_CHANGE_EVENT, handleDraftChange);
    return () => {
      window.removeEventListener(REWRITE_DRAFT_CHANGE_EVENT, handleDraftChange);
    };
  }, [messageId, refreshDraftVersions]);

  const active = rewrites[activeIndex];

  if (!active) return null;

  return (
    <>
      {rewrites.length > 1 && (
        <div className="rewriteTabs">
          {rewrites.map((r, i) => (
            <button
              key={r.version}
              className={`rewriteTab${i === activeIndex ? " active" : ""}`}
              onClick={() => {
                setActiveIndex(i);
                void logEvent({
                  action: "rewrite_version_view",
                  version: r.version,
                  actionSource: "rewrite_tabs",
                  payload: { selectedVersion: r.version }
                }).catch(() => { /* passive telemetry */ });
              }}
            >
              {i + 1}
              {draftVersions.has(r.version) && (
                <span className="tabDraftDot" title="Redigert utkast" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      )}
      <EditableRewrite
        messageId={messageId}
        originalTitle={active.rewrite.title}
        originalBody={[active.rewrite.lead, ...active.rewrite.body]
          .filter(Boolean)
          .join("\n\n")}
        activeVersion={active.version}
        dateline={dateline}
        panelTitle="AI-generert notis"
      />
      <InstructionInput messageId={messageId} activeVersion={active.version} hasAttachments={hasAttachments} />
    </>
  );
}

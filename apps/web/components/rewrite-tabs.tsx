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
  rewriteId: string;
  version: number;
  rewrite: RewriteOutput;
  userInstruction: string | null;
  generatedAt: string;
  contentHash: string;
  isFinal: true;
};

type RewriteTabsProps = {
  rewrites: RewriteVersion[];
  messageId: number;
  dateline: ReactNode;
  hasAttachments?: boolean;
  publicationRevision?: number;
};

export function RewriteTabs({
  rewrites,
  messageId,
  dateline,
  hasAttachments,
  publicationRevision
}: RewriteTabsProps) {
  const [activeIndex, setActiveIndex] = useState(rewrites.length - 1);
  const [draftVersions, setDraftVersions] = useState<Set<string>>(() => new Set());
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
              rewriteId: rewrite.rewriteId,
              originalTitle: rewrite.rewrite.title,
              originalBody: [rewrite.rewrite.lead, ...rewrite.rewrite.body]
                .filter(Boolean)
                .join("\n\n")
            })
          )
          .map((rewrite) => rewrite.rewriteId)
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
  }, [messageId, refreshDraftVersions]);

  const active = rewrites[activeIndex];

  if (!active) return null;

  return (
    <>
      {rewrites.length > 1 && (
        <div className="rewriteTabs">
          {rewrites.map((r, i) => (
            <button
              key={r.rewriteId}
              className={`rewriteTab${i === activeIndex ? " active" : ""}`}
              onClick={() => {
                setActiveIndex(i);
                void logEvent({
                  action: "rewrite_version_view",
                  version: r.version,
                  rewriteId: r.rewriteId,
                  publicationRevision,
                  contentHash: r.contentHash,
                  isFinal: true,
                  actionSource: "rewrite_tabs",
                  payload: { selectedVersion: r.version }
                }).catch(() => { /* passive telemetry */ });
              }}
            >
              {i + 1}
              {draftVersions.has(r.rewriteId) && (
                <span className="tabDraftDot" title="Redigert utkast" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      )}
      <EditableRewrite
        key={active.rewriteId}
        messageId={messageId}
        originalTitle={active.rewrite.title}
        originalBody={[active.rewrite.lead, ...active.rewrite.body]
          .filter(Boolean)
          .join("\n\n")}
        activeVersion={active.version}
        rewriteId={active.rewriteId}
        publicationRevision={publicationRevision}
        contentHash={active.contentHash}
        isFinal={active.isFinal}
        dateline={dateline}
        panelTitle="AI-generert notis"
      />
      <InstructionInput
        messageId={messageId}
        activeVersion={active.version}
        rewriteId={active.rewriteId}
        publicationRevision={publicationRevision}
        contentHash={active.contentHash}
        isFinal={active.isFinal}
        hasAttachments={hasAttachments}
      />
    </>
  );
}

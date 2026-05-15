"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { RewriteOutput } from "@newsweb/shared";
import { useEditorialTelemetry } from "../lib/editorial-telemetry";
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
  const { logEvent } = useEditorialTelemetry(messageId);

  useEffect(() => {
    setActiveIndex(rewrites.length - 1);
  }, [rewrites.length]);

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

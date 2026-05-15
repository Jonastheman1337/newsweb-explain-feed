"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useEditorialTelemetry } from "../lib/editorial-telemetry";
import { useTitleSuggestions } from "./title-suggestions";

type EditableRewriteProps = {
  messageId: number;
  originalTitle: string;
  originalBody: string;
  activeVersion?: number;
  dateline?: ReactNode;
  children?: ReactNode;
  extraActions?: ReactNode;
  panelTitle?: string;
  className?: string;
};

export function EditableRewrite({
  messageId,
  originalTitle,
  originalBody,
  activeVersion,
  dateline,
  children,
  extraActions,
  panelTitle,
  className,
}: EditableRewriteProps) {
  const [editedTitle, setEditedTitle] = useState(originalTitle);
  const [editedBody, setEditedBody] = useState(originalBody);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { buildTelemetry } = useEditorialTelemetry(messageId, activeVersion);

  // Reset when the AI output changes (e.g. after regeneration)
  useEffect(() => {
    setEditedTitle(originalTitle);
    setEditedBody(originalBody);
  }, [originalTitle, originalBody]);

  // Auto-resize textarea to fit content
  const resizeTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    }
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [editedBody, resizeTextarea]);

  useEffect(() => {
    window.addEventListener("resize", resizeTextarea);
    return () => window.removeEventListener("resize", resizeTextarea);
  }, [resizeTextarea]);

  async function handleCopy() {
    const text = editedTitle + "\n\n" + editedBody;
    await navigator.clipboard.writeText(text);

    setCopied(true);
    setTimeout(() => setCopied(false), 2000);

    const hasEdits = editedTitle !== originalTitle || editedBody !== originalBody;

    fetch(`/api/notice/${messageId}/edit-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        originalTitle,
        originalBody,
        editedTitle,
        editedBody,
        hasEdits,
        telemetry: buildTelemetry({
          actionSource: "editable_rewrite"
        })
      })
    }).catch(() => {
      // Logging failure is silent — copy must feel instant
    });
  }

  const titleSuggestions = useTitleSuggestions({
    messageId,
    activeVersion,
    currentTitle: editedTitle,
    onPreview(title) {
      if (titleRef.current) titleRef.current.textContent = title;
    },
    onRevert() {
      if (titleRef.current) titleRef.current.textContent = editedTitle;
    },
    onCommit(title) {
      setEditedTitle(title);
      if (titleRef.current) titleRef.current.textContent = title;
    },
  });

  return (
    <div className={`editableWrap${className ? ` ${className}` : ""}`}>
      {panelTitle && (
        <div className="panelTitleRow">
          <p className="noticePanelTitle">{panelTitle}</p>
          {titleSuggestions.button}
        </div>
      )}
      <h2
        ref={titleRef}
        className="editableTitle"
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => setEditedTitle(e.currentTarget.textContent ?? "")}
      >
        {originalTitle}
      </h2>
      {titleSuggestions.dropdown}
      {dateline}
      <textarea
        ref={textareaRef}
        className="editableBody"
        value={editedBody}
        onChange={(e) => setEditedBody(e.target.value)}
        rows={1}
      />
      <div className="editableActions">
        {children}
        <span className="actionsRight">
          {extraActions}
          <button className="copyButton" onClick={handleCopy} title="Kopier tekst">
            {copied ? "Kopiert!" : <>Kopier <svg className="copyIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></>}
          </button>
        </span>
      </div>
    </div>
  );
}

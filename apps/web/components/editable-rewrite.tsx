"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useEditorialTelemetry } from "../lib/editorial-telemetry";
import {
  deleteRewriteDraft,
  getRewriteDraft,
  saveRewriteDraft,
  type RewriteDraft
} from "../lib/rewrite-drafts";
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
  const [storedDraft, setStoredDraft] = useState<RewriteDraft | null>(null);
  const [viewMode, setViewMode] = useState<"draft" | "original">("draft");
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedValueRef = useRef("");
  const latestDraftStateRef = useRef({
    messageId,
    version: activeVersion,
    title: originalTitle,
    body: originalBody,
    originalTitle,
    originalBody,
    viewMode: "draft" as "draft" | "original"
  });
  const { buildTelemetry } = useEditorialTelemetry(messageId, activeVersion);

  const setDisplayedRewrite = useCallback((title: string, body: string) => {
    setEditedTitle(title);
    setEditedBody(body);
    if (titleRef.current && titleRef.current.textContent !== title) {
      titleRef.current.textContent = title;
    }
  }, []);

  function draftValue(title: string, body: string): string {
    return `${title}\u0000${body}`;
  }

  function persistDraftState(
    state = latestDraftStateRef.current,
    updateState = true
  ): RewriteDraft | null {
    if (state.viewMode !== "draft") return storedDraft;

    const currentValue = draftValue(state.title, state.body);
    if (currentValue === lastSavedValueRef.current) {
      return storedDraft;
    }

    const draft = saveRewriteDraft({
      messageId: state.messageId,
      version: state.version,
      title: state.title,
      body: state.body,
      originalTitle: state.originalTitle,
      originalBody: state.originalBody
    });
    if (updateState) {
      setStoredDraft(draft);
    }
    lastSavedValueRef.current = currentValue;
    return draft;
  }

  useEffect(() => {
    latestDraftStateRef.current = {
      messageId,
      version: activeVersion,
      title: editedTitle,
      body: editedBody,
      originalTitle,
      originalBody,
      viewMode
    };
  }, [
    activeVersion,
    editedBody,
    editedTitle,
    messageId,
    originalBody,
    originalTitle,
    viewMode
  ]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      persistDraftState(latestDraftStateRef.current, false);
    };
  }, []);

  // Reset when the AI output/version changes, preferring a saved local draft.
  useEffect(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const draft = getRewriteDraft({
      messageId,
      version: activeVersion,
      originalTitle,
      originalBody
    });
    const nextTitle = draft?.title ?? originalTitle;
    const nextBody = draft?.body ?? originalBody;

    setStoredDraft(draft);
    setViewMode("draft");
    setDisplayedRewrite(nextTitle, nextBody);
    lastSavedValueRef.current = draftValue(nextTitle, nextBody);
  }, [activeVersion, messageId, originalBody, originalTitle, setDisplayedRewrite]);

  useEffect(() => {
    if (viewMode !== "draft") return;

    const currentValue = draftValue(editedTitle, editedBody);
    if (currentValue === lastSavedValueRef.current) return;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      persistDraftState({
        messageId,
        version: activeVersion,
        title: editedTitle,
        body: editedBody,
        originalTitle,
        originalBody,
        viewMode
      });
      saveTimerRef.current = null;
    }, 350);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [
    activeVersion,
    editedBody,
    editedTitle,
    messageId,
    originalBody,
    originalTitle,
    viewMode
  ]);

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
    persistDraftState();

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
      // Logging failure is silent; copy must feel instant.
    });
  }

  function enterDraftMode() {
    if (viewMode === "original") {
      setViewMode("draft");
    }
  }

  function handleToggleDraftView() {
    if (viewMode === "original") {
      const draft =
        storedDraft ??
        getRewriteDraft({
          messageId,
          version: activeVersion,
          originalTitle,
          originalBody
        });
      const nextTitle = draft?.title ?? originalTitle;
      const nextBody = draft?.body ?? originalBody;

      setStoredDraft(draft);
      setViewMode("draft");
      setDisplayedRewrite(nextTitle, nextBody);
      lastSavedValueRef.current = draftValue(nextTitle, nextBody);
      return;
    }

    setViewMode("original");
    setDisplayedRewrite(originalTitle, originalBody);
  }

  function handleResetDraft() {
    deleteRewriteDraft({ messageId, version: activeVersion });
    setStoredDraft(null);
    setViewMode("draft");
    setDisplayedRewrite(originalTitle, originalBody);
    lastSavedValueRef.current = draftValue(originalTitle, originalBody);
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
      enterDraftMode();
      setEditedTitle(title);
      if (titleRef.current) titleRef.current.textContent = title;
    },
  });

  const hasDraft = storedDraft != null;
  const showingOriginal = viewMode === "original";

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
        onInput={(e) => {
          enterDraftMode();
          setEditedTitle(e.currentTarget.textContent ?? "");
        }}
      >
        {originalTitle}
      </h2>
      {titleSuggestions.dropdown}
      {dateline}
      <textarea
        ref={textareaRef}
        className="editableBody"
        value={editedBody}
        onChange={(e) => {
          enterDraftMode();
          setEditedBody(e.target.value);
        }}
        rows={1}
      />
      <div className="editableActions">
        {children}
        <span className="actionsRight">
          {extraActions}
          {hasDraft && (
            <>
              <span className="draftDot" title="Redigert utkast" aria-label="Redigert utkast" />
              <button
                className={`draftIconButton${showingOriginal ? " draftIconButtonActive" : ""}`}
                onClick={handleToggleDraftView}
                title={showingOriginal ? "Vis redigert utkast" : "Vis AI-original"}
                aria-label={showingOriginal ? "Vis redigert utkast" : "Vis AI-original"}
                type="button"
              >
                {showingOriginal ? (
                  <svg className="draftIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                ) : (
                  <svg className="draftIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 5c5 0 8.5 4.5 9.5 7-1 2.5-4.5 7-9.5 7s-8.5-4.5-9.5-7C3.5 9.5 7 5 12 5Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
              <button
                className="draftIconButton"
                onClick={handleResetDraft}
                title="Tilbakestill til AI-original"
                aria-label="Tilbakestill til AI-original"
                type="button"
              >
                <svg className="draftIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 12a9 9 0 1 0 3-6.7" />
                  <path d="M3 4v6h6" />
                </svg>
              </button>
            </>
          )}
          <button className="copyButton" onClick={handleCopy} title="Kopier tekst">
            {copied ? "Kopiert!" : <>Kopier <svg className="copyIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></>}
          </button>
        </span>
      </div>
    </div>
  );
}

"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from "react";
import { createNoticeClipboardPlainText } from "../lib/ai-disclosure";
import { useEditorialTelemetry } from "../lib/editorial-telemetry";
import {
  createNoticeClipboardHtml,
  createSakClipboard,
  normalizePastedTitle,
  normalizeLinkHref,
  plainTextToRichHtml,
  richHtmlToPlainText,
  sanitizePastedRichHtml,
  sanitizeRichHtml
} from "../lib/rich-text";
import { linkSourceAttributions, type SourceLinkTargets } from "../lib/source-links";
import {
  deleteRewriteDraft,
  getRewriteDraft,
  saveRewriteDraft,
  type RewriteDraft
} from "../lib/rewrite-drafts";
import { useTitleSuggestions } from "./title-suggestions";

type EditableRewriteProps = {
  messageId: number | string;
  originalTitle: string;
  originalBody: string;
  // Pre-sanitised HTML for the original body (sak articles carry <h3> and
  // <a href> that plain text cannot express). Defaults to plainTextToRichHtml.
  originalBodyHtml?: string;
  // "sak": no title suggestions, no edit-log POST, sak clipboard (no AI
  // disclosure). Defaults to the notice behaviour.
  variant?: "notice" | "sak";
  activeVersion?: number;
  rewriteId?: string;
  publicationRevision?: number;
  contentHash?: string;
  isFinal?: boolean;
  dateline?: ReactNode;
  children?: ReactNode;
  extraActions?: ReactNode;
  panelTitle?: string;
  className?: string;
  // Newsweb links for the first attribution phrase (primary notice) and the
  // first "meldte i juni" clause (earlier notice). Applied once when the
  // generated text is turned into HTML; stored drafts are never re-linked.
  sourceLinks?: SourceLinkTargets;
};

type DraftState = {
  messageId: number | string;
  version?: number | null;
  title: string;
  body: string;
  bodyHtml: string;
  originalTitle: string;
  originalBody: string;
  originalBodyHtml: string;
  viewMode: "draft" | "original";
};

function draftValue(title: string, body: string, bodyHtml: string): string {
  return `${title}\u0000${body}\u0000${bodyHtml}`;
}

function isNodeInside(root: Node | null, node: Node | null): boolean {
  return !!root && !!node && (node === root || root.contains(node));
}

function isEventInsideNode(event: Event, root: Node | null, target: Node | null): boolean {
  if (!root) return false;
  if (target && isNodeInside(root, target)) return true;
  return event.composedPath().includes(root);
}

function getBodySelectionRange(root: HTMLElement | null): Range | null {
  if (!root) return null;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  if (
    !isNodeInside(root, selection.anchorNode) ||
    !isNodeInside(root, selection.focusNode)
  ) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!range.toString().trim()) return null;
  return range;
}

function getCachedBodyRange(root: HTMLElement | null, range: Range | null): Range | null {
  if (!root || !range) return null;
  if (!isNodeInside(root, range.commonAncestorContainer)) return null;
  if (!range.toString().trim()) return null;
  return range;
}

function getToolbarPosition(range: Range): { top: number; left: number } {
  const rect = range.getBoundingClientRect();
  const center = rect.left + rect.width / 2;
  const toolbarHalfWidth = 112;
  const left = Math.min(
    Math.max(center, toolbarHalfWidth),
    Math.max(toolbarHalfWidth, window.innerWidth - toolbarHalfWidth)
  );
  const top = rect.top > 44 ? rect.top - 40 : rect.bottom + 8;

  return {
    left,
    top: Math.max(8, top)
  };
}

function getRangeLinkHref(range: Range, root: HTMLElement | null): string {
  const anchor = getClosestLink(range.startContainer, root);
  return anchor?.href ?? "";
}

function getClosestLink(node: Node | null, root: HTMLElement | null): HTMLAnchorElement | null {
  if (node?.nodeType === Node.TEXT_NODE) {
    node = node.parentNode;
  }

  while (node && root && isNodeInside(root, node)) {
    if (
      node.nodeType === Node.ELEMENT_NODE &&
      (node as Element).tagName.toLowerCase() === "a"
    ) {
      return node as HTMLAnchorElement;
    }
    node = node.parentNode;
  }

  return null;
}

function unwrapLinks(container: ParentNode) {
  for (const anchor of Array.from(container.querySelectorAll("a"))) {
    const parent = anchor.parentNode;
    if (!parent) continue;

    while (anchor.firstChild) {
      parent.insertBefore(anchor.firstChild, anchor);
    }
    parent.removeChild(anchor);
  }
}

function insertLinkForRange(range: Range, root: HTMLElement | null, href: string): boolean {
  if (!root || !isNodeInside(root, range.commonAncestorContainer)) {
    return false;
  }
  if (!range.toString().trim()) {
    return false;
  }

  const existingAnchor = getClosestLink(range.startContainer, root);
  if (existingAnchor && existingAnchor.contains(range.endContainer)) {
    existingAnchor.setAttribute("href", href);
    return true;
  }

  try {
    const doc = root.ownerDocument;
    const anchor = doc.createElement("a");
    anchor.setAttribute("href", href);

    const fragment = range.extractContents();
    unwrapLinks(fragment);
    anchor.appendChild(fragment);

    if (!anchor.textContent?.trim()) {
      return false;
    }

    range.insertNode(anchor);

    const selection = window.getSelection();
    if (selection) {
      const nextRange = doc.createRange();
      nextRange.selectNodeContents(anchor);
      selection.removeAllRanges();
      selection.addRange(nextRange);
    }

    return true;
  } catch {
    return false;
  }
}

function runRichTextCommand(command: string, value?: string): boolean {
  try {
    document.execCommand("styleWithCSS", false, "false");
  } catch {
    // Unsupported in some browsers; the sanitizer still normalizes styled spans.
  }

  return document.execCommand(command, false, value);
}

function insertPlainTextAtSelection(root: HTMLElement, text: string) {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;

  if (!selection || !range || !isNodeInside(root, range.commonAncestorContainer)) {
    root.append(root.ownerDocument.createTextNode(text));
    return;
  }

  range.deleteContents();
  const textNode = root.ownerDocument.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function copyNoticeWithCopyEvent(plainText: string, html: string): boolean {
  if (typeof document === "undefined") return false;

  let handled = false;
  function handleCopy(event: ClipboardEvent) {
    event.clipboardData?.setData("text/html", html);
    event.clipboardData?.setData("text/plain", plainText);
    event.preventDefault();
    handled = true;
  }

  document.addEventListener("copy", handleCopy);
  try {
    return document.execCommand("copy") && handled;
  } catch {
    return false;
  } finally {
    document.removeEventListener("copy", handleCopy);
  }
}

async function copyNoticeToClipboard(plainText: string, html: string) {
  if (copyNoticeWithCopyEvent(plainText, html)) {
    return;
  }

  if (
    navigator.clipboard?.write &&
    typeof ClipboardItem !== "undefined"
  ) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plainText], { type: "text/plain" })
        })
      ]);
      return;
    } catch {
      // Fall through to the plain text clipboard API below.
    }
  }

  if (!navigator.clipboard?.writeText) {
    throw new Error("clipboard_unavailable");
  }
  await navigator.clipboard.writeText(plainText);
}

export function EditableRewrite({
  messageId,
  originalTitle,
  originalBody,
  originalBodyHtml: originalBodyHtmlProp,
  variant = "notice",
  activeVersion,
  rewriteId,
  publicationRevision,
  contentHash,
  isFinal,
  dateline,
  children,
  extraActions,
  panelTitle,
  className,
  sourceLinks,
}: EditableRewriteProps) {
  const originalBodyHtml = useMemo(
    () =>
      originalBodyHtmlProp ??
      (sourceLinks
        ? linkSourceAttributions(plainTextToRichHtml(originalBody), sourceLinks)
        : plainTextToRichHtml(originalBody)),
    [originalBody, originalBodyHtmlProp, sourceLinks]
  );
  const isSak = variant === "sak";
  const [editedTitle, setEditedTitle] = useState(originalTitle);
  const [editedBody, setEditedBody] = useState(originalBody);
  const [editedBodyHtml, setEditedBodyHtml] = useState(originalBodyHtml);
  const [storedDraft, setStoredDraft] = useState<RewriteDraft | null>(null);
  const [viewMode, setViewMode] = useState<"draft" | "original">("draft");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const selectionRangeRef = useRef<Range | null>(null);
  const lastBodyRangeRef = useRef<Range | null>(null);
  const isSelectingRef = useRef(false);
  const isToolbarInteractingRef = useRef(false);
  const toolbarActionHandledRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storedDraftRef = useRef<RewriteDraft | null>(null);
  const linkModeRef = useRef(false);
  const lastSavedValueRef = useRef("");
  const latestDraftStateRef = useRef<DraftState>({
    messageId,
    version: activeVersion,
    title: originalTitle,
    body: originalBody,
    bodyHtml: originalBodyHtml,
    originalTitle,
    originalBody,
    originalBodyHtml,
    viewMode: "draft"
  });
  const { buildTelemetry } = useEditorialTelemetry(messageId, {
    version: activeVersion,
    rewriteId,
    publicationRevision,
    contentHash,
    isFinal
  });

  function setCopyStateWithReset(state: "copied" | "failed") {
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
    }
    setCopyState(state);
    copyResetTimerRef.current = setTimeout(() => {
      copyResetTimerRef.current = null;
      setCopyState("idle");
    }, 2000);
  }

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  function setStoredDraftValue(draft: RewriteDraft | null) {
    storedDraftRef.current = draft;
    setStoredDraft(draft);
  }

  function hideToolbarElement() {
    const toolbarElement = toolbarRef.current;
    if (!toolbarElement) return;

    delete toolbarElement.dataset.visible;
    toolbarElement.style.top = "";
    toolbarElement.style.left = "";
  }

  function showToolbarForRange(range: Range) {
    const toolbarElement = toolbarRef.current;
    if (!toolbarElement) return;

    const position = getToolbarPosition(range);
    toolbarElement.style.top = `${position.top}px`;
    toolbarElement.style.left = `${position.left}px`;
    toolbarElement.dataset.visible = "true";
  }

  const hideToolbar = useCallback(() => {
    isToolbarInteractingRef.current = false;
    selectionRangeRef.current = null;
    lastBodyRangeRef.current = null;
    toolbarActionHandledRef.current = false;
    hideToolbarElement();
    if (linkModeRef.current) {
      linkModeRef.current = false;
      setLinkMode(false);
      setLinkValue("");
    }
  }, []);

  const readBodyState = useCallback(() => {
    const html = sanitizeRichHtml(bodyRef.current?.innerHTML ?? editedBodyHtml);
    return {
      body: richHtmlToPlainText(html),
      bodyHtml: html
    };
  }, [editedBodyHtml]);

  const syncBodyState = useCallback(() => {
    const next = readBodyState();
    setEditedBody(next.body);
    setEditedBodyHtml(next.bodyHtml);
    return next;
  }, [readBodyState]);

  const setDisplayedRewrite = useCallback((title: string, body: string, bodyHtml?: string) => {
    const nextHtml = sanitizeRichHtml(bodyHtml ?? plainTextToRichHtml(body));

    setEditedTitle(title);
    setEditedBody(body);
    setEditedBodyHtml(nextHtml);

    if (titleRef.current && titleRef.current.textContent !== title) {
      titleRef.current.textContent = title;
    }
    if (bodyRef.current && bodyRef.current.innerHTML !== nextHtml) {
      bodyRef.current.innerHTML = nextHtml;
    }
  }, []);

  function persistDraftState(
    state = latestDraftStateRef.current,
    updateState = true
  ): RewriteDraft | null {
    if (state.viewMode !== "draft") return storedDraftRef.current;

    const currentValue = draftValue(state.title, state.body, state.bodyHtml);
    if (currentValue === lastSavedValueRef.current) {
      return storedDraftRef.current;
    }

    const draft = saveRewriteDraft({
      messageId: state.messageId,
      version: state.version,
      rewriteId,
      title: state.title,
      body: state.body,
      bodyHtml: state.bodyHtml,
      originalTitle: state.originalTitle,
      originalBody: state.originalBody,
      originalBodyHtml: state.originalBodyHtml
    });
    if (updateState) {
      setStoredDraftValue(draft);
    }
    lastSavedValueRef.current = currentValue;
    return draft;
  }

  const updateToolbarFromSelection = useCallback(() => {
    if (linkModeRef.current || isSelectingRef.current) return;

    const range = getBodySelectionRange(bodyRef.current);
    if (!range) {
      const cachedRange = getCachedBodyRange(
        bodyRef.current,
        selectionRangeRef.current
      );
      if (!cachedRange || !isToolbarInteractingRef.current) {
        selectionRangeRef.current = null;
        hideToolbarElement();
      }
      return;
    }

    selectionRangeRef.current = range.cloneRange();
    lastBodyRangeRef.current = range.cloneRange();
    showToolbarForRange(range);
  }, []);

  function getActionRange(): Range | null {
    const liveRange = getBodySelectionRange(bodyRef.current);
    if (liveRange) {
      selectionRangeRef.current = liveRange.cloneRange();
      lastBodyRangeRef.current = liveRange.cloneRange();
      return liveRange;
    }

    return (
      getCachedBodyRange(bodyRef.current, selectionRangeRef.current) ??
      getCachedBodyRange(bodyRef.current, lastBodyRangeRef.current)
    );
  }

  function restoreBodySelection(): boolean {
    const range = selectionRangeRef.current;
    const root = bodyRef.current;
    if (!range || !root) return false;
    if (!isNodeInside(root, range.commonAncestorContainer)) return false;

    const selection = window.getSelection();
    if (!selection) return false;

    root.focus({ preventScroll: true });
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  function enterDraftMode() {
    if (viewMode === "original") {
      setViewMode("draft");
    }
  }

  function applyFormat(command: "bold" | "italic" | "insertUnorderedList" | "insertOrderedList") {
    try {
      enterDraftMode();
      const range = getActionRange();
      if (!range) {
        hideToolbar();
        return;
      }

      selectionRangeRef.current = range.cloneRange();
      if (!restoreBodySelection()) return;

      runRichTextCommand(command);
      syncBodyState();
      updateToolbarFromSelection();
    } finally {
      isToolbarInteractingRef.current = false;
    }
  }

  function openLinkInput() {
    const range = getActionRange();
    if (!range) {
      hideToolbar();
      return;
    }

    selectionRangeRef.current = range.cloneRange();
    lastBodyRangeRef.current = range.cloneRange();
    setLinkValue(getRangeLinkHref(range, bodyRef.current));
    showToolbarForRange(range);
    linkModeRef.current = true;
    isToolbarInteractingRef.current = true;
    setLinkMode(true);
  }

  function handleLinkSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const href = normalizeLinkHref(linkValue);
    if (!href || !restoreBodySelection()) {
      linkInputRef.current?.focus();
      return;
    }

    enterDraftMode();
    const selection = window.getSelection();
    const range =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const inserted =
      range && insertLinkForRange(range, bodyRef.current, href);

    if (!inserted) {
      runRichTextCommand("createLink", href);
    }

    syncBodyState();
    hideToolbar();
  }

  function handleBodyInput() {
    enterDraftMode();
    syncBodyState();
  }

  function handleTitlePaste(event: ReactClipboardEvent<HTMLHeadingElement>) {
    event.preventDefault();
    enterDraftMode();

    const html = event.clipboardData.getData("text/html");
    const clipboardText =
      event.clipboardData.getData("text/plain") || richHtmlToPlainText(html);
    const text = normalizePastedTitle(clipboardText);
    if (text) {
      insertPlainTextAtSelection(event.currentTarget, text);
    }
    setEditedTitle(event.currentTarget.textContent ?? "");
  }

  function handleBodyPaste(event: ReactClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    enterDraftMode();

    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    if (html) {
      const safeHtml = sanitizePastedRichHtml(html);
      if (safeHtml) {
        runRichTextCommand("insertHTML", safeHtml);
      } else if (text) {
        runRichTextCommand("insertText", text);
      }
    } else if (text) {
      runRichTextCommand("insertText", text);
    }

    syncBodyState();
    updateToolbarFromSelection();
  }

  function handleBodyKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openLinkInput();
    }
  }

  function handleToolbarMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    isToolbarInteractingRef.current = true;
    const target = event.target instanceof Element ? event.target : null;

    if (target?.tagName.toLowerCase() !== "input") {
      event.preventDefault();
    }
  }

  function handleToolbarActionMouseDown(
    event: ReactMouseEvent<HTMLButtonElement>,
    action: () => void
  ) {
    event.preventDefault();
    event.stopPropagation();
    toolbarActionHandledRef.current = true;
    isToolbarInteractingRef.current = true;
    action();
  }

  function handleToolbarActionClick(
    event: ReactMouseEvent<HTMLButtonElement>,
    action: () => void
  ) {
    event.preventDefault();
    if (event.detail !== 0 && toolbarActionHandledRef.current) {
      toolbarActionHandledRef.current = false;
      return;
    }

    toolbarActionHandledRef.current = false;
    isToolbarInteractingRef.current = true;
    action();
  }

  function handleBodyMouseDown() {
    if (linkModeRef.current) return;
    isSelectingRef.current = true;
    selectionRangeRef.current = null;
    lastBodyRangeRef.current = null;
    hideToolbarElement();
  }

  function handleBodyMouseUp() {
    isSelectingRef.current = false;
    requestAnimationFrame(updateToolbarFromSelection);
  }

  function handleBodyKeyUp() {
    requestAnimationFrame(updateToolbarFromSelection);
  }

  useEffect(() => {
    linkModeRef.current = linkMode;
  }, [linkMode]);

  useEffect(() => {
    if (!linkMode) return;
    requestAnimationFrame(() => linkInputRef.current?.focus());
  }, [linkMode]);

  useEffect(() => {
    latestDraftStateRef.current = {
      messageId,
      version: activeVersion,
      title: editedTitle,
      body: editedBody,
      bodyHtml: editedBodyHtml,
      originalTitle,
      originalBody,
      originalBodyHtml,
      viewMode
    };
  }, [
    activeVersion,
    editedBody,
    editedBodyHtml,
    editedTitle,
    messageId,
    originalBody,
    originalBodyHtml,
    originalTitle,
    viewMode
  ]);

  useEffect(() => {
    function handleSelectionChange() {
      if (isSelectingRef.current || linkModeRef.current) return;
      requestAnimationFrame(updateToolbarFromSelection);
    }

    function handleDocumentMouseDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (
        isEventInsideNode(event, bodyRef.current, target) ||
        isEventInsideNode(event, toolbarRef.current, target)
      ) {
        return;
      }
      hideToolbar();
    }

    function handleDocumentMouseUp() {
      if (!isSelectingRef.current) return;
      isSelectingRef.current = false;
      requestAnimationFrame(updateToolbarFromSelection);
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("mousedown", handleDocumentMouseDown);
    document.addEventListener("mouseup", handleDocumentMouseUp);
    window.addEventListener("resize", updateToolbarFromSelection);
    window.addEventListener("scroll", updateToolbarFromSelection, true);

    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("mousedown", handleDocumentMouseDown);
      document.removeEventListener("mouseup", handleDocumentMouseUp);
      window.removeEventListener("resize", updateToolbarFromSelection);
      window.removeEventListener("scroll", updateToolbarFromSelection, true);
    };
  }, [hideToolbar, updateToolbarFromSelection]);

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
  useLayoutEffect(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const draft = getRewriteDraft({
      messageId,
      version: activeVersion,
      rewriteId,
      originalTitle,
      originalBody,
      originalBodyHtml
    });
    const nextTitle = draft?.title ?? originalTitle;
    const nextBody = draft?.body ?? originalBody;
    // No draft: show the original HTML (keeps links and subheads). A legacy
    // draft without bodyHtml is rebuilt from its plain text.
    const nextBodyHtml = sanitizeRichHtml(
      draft?.bodyHtml ?? (draft ? plainTextToRichHtml(nextBody) : originalBodyHtml)
    );

    setStoredDraftValue(draft);
    setViewMode("draft");
    hideToolbar();
    setDisplayedRewrite(nextTitle, nextBody, nextBodyHtml);
    lastSavedValueRef.current = draftValue(nextTitle, nextBody, nextBodyHtml);
  }, [
    activeVersion,
    hideToolbar,
    messageId,
    originalBody,
    originalBodyHtml,
      originalTitle,
      setDisplayedRewrite
    ]);

  useEffect(() => {
    if (viewMode !== "draft") return;

    const currentValue = draftValue(editedTitle, editedBody, editedBodyHtml);
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
        bodyHtml: editedBodyHtml,
        originalTitle,
        originalBody,
        originalBodyHtml,
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
    editedBodyHtml,
    editedTitle,
    messageId,
    originalBody,
    originalBodyHtml,
    originalTitle,
    viewMode
  ]);

  async function handleCopy() {
    const currentBody = syncBodyState();
    persistDraftState({
      messageId,
      version: activeVersion,
      title: editedTitle,
      body: currentBody.body,
      bodyHtml: currentBody.bodyHtml,
      originalTitle,
      originalBody,
      originalBodyHtml,
      viewMode
    });

    const clipboard = isSak
      ? createSakClipboard(editedTitle, currentBody.bodyHtml)
      : {
          text: createNoticeClipboardPlainText(editedTitle, currentBody.body),
          html: createNoticeClipboardHtml(editedTitle, currentBody.bodyHtml)
        };
    try {
      await copyNoticeToClipboard(clipboard.text, clipboard.html);
    } catch {
      setCopyStateWithReset("failed");
      return;
    }

    setCopyStateWithReset("copied");

    if (isSak) return;

    const hasEdits =
      editedTitle !== originalTitle ||
      currentBody.body !== originalBody ||
      currentBody.bodyHtml !== originalBodyHtml;

    fetch(`/api/notice/${messageId}/edit-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        originalTitle,
        originalBody,
        editedTitle,
        editedBody: currentBody.body,
        hasEdits,
        telemetry: buildTelemetry({
          actionSource: "editable_rewrite"
        })
      })
    }).catch(() => {
      // Logging failure is silent; copy must feel instant.
    });
  }

  function handleToggleDraftView() {
    if (viewMode === "original") {
      const draft =
        storedDraftRef.current ??
        getRewriteDraft({
          messageId,
          version: activeVersion,
          rewriteId,
          originalTitle,
          originalBody,
          originalBodyHtml
        });
      const nextTitle = draft?.title ?? originalTitle;
      const nextBody = draft?.body ?? originalBody;
      const nextBodyHtml = sanitizeRichHtml(
        draft?.bodyHtml ?? (draft ? plainTextToRichHtml(nextBody) : originalBodyHtml)
      );

      setStoredDraftValue(draft);
      setViewMode("draft");
      setDisplayedRewrite(nextTitle, nextBody, nextBodyHtml);
      lastSavedValueRef.current = draftValue(nextTitle, nextBody, nextBodyHtml);
      return;
    }

    // Flush edits made within the save debounce window before leaving draft view.
    const currentBody = syncBodyState();
    persistDraftState({
      messageId,
      version: activeVersion,
      title: editedTitle,
      body: currentBody.body,
      bodyHtml: currentBody.bodyHtml,
      originalTitle,
      originalBody,
      originalBodyHtml,
      viewMode
    });

    hideToolbar();
    setViewMode("original");
    setDisplayedRewrite(originalTitle, originalBody, originalBodyHtml);
  }

  function handleResetDraft() {
    deleteRewriteDraft({ messageId, version: activeVersion, rewriteId });
    setStoredDraftValue(null);
    setViewMode("draft");
    hideToolbar();
    setDisplayedRewrite(originalTitle, originalBody, originalBodyHtml);
    lastSavedValueRef.current = draftValue(
      originalTitle,
      originalBody,
      originalBodyHtml
    );
  }

  const titleSuggestions = useTitleSuggestions({
    messageId,
    activeVersion,
    rewriteId,
    publicationRevision,
    contentHash,
    isFinal,
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
  const titleSuggestButton = isSak ? null : titleSuggestions.button;
  const titleSuggestDropdown = isSak ? null : titleSuggestions.dropdown;
  const titleEditor = (
    <h2
      ref={titleRef}
      className="editableTitle"
      contentEditable
      tabIndex={0}
      suppressContentEditableWarning
      onInput={(e) => {
        enterDraftMode();
        setEditedTitle(e.currentTarget.textContent ?? "");
      }}
      onPaste={handleTitlePaste}
    >
    </h2>
  );

  return (
    <div className={`editableWrap${className ? ` ${className}` : ""}`}>
      {panelTitle && (
        <div className="panelTitleRow">
          <p className="noticePanelTitle">{panelTitle}</p>
          {titleSuggestButton}
        </div>
      )}
      {panelTitle || isSak ? titleEditor : (
        <div className="editableTitleRow">
          {titleEditor}
          <span className="titleSuggestWrap">{titleSuggestButton}</span>
        </div>
      )}
      {titleSuggestDropdown}
      {dateline}
      <div
        ref={bodyRef}
        className="editableBody"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={isSak ? "Rediger sakstekst" : "Rediger notistekst"}
        tabIndex={0}
        spellCheck
        onInput={handleBodyInput}
        onPaste={handleBodyPaste}
        onMouseDown={handleBodyMouseDown}
        onMouseUp={handleBodyMouseUp}
        onKeyUp={handleBodyKeyUp}
        onKeyDown={handleBodyKeyDown}
      />
      <div
        ref={toolbarRef}
        className={`richEditToolbar${linkMode ? " richEditToolbarLink" : ""}`}
        onMouseDown={handleToolbarMouseDown}
      >
        {linkMode ? (
          <form className="richEditLinkForm" onSubmit={handleLinkSubmit}>
            <input
              ref={linkInputRef}
              className="richEditLinkInput"
              value={linkValue}
              onChange={(event) => setLinkValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  hideToolbar();
                }
              }}
              placeholder="https://"
              aria-label="Lenke"
            />
            <button
              className="richEditToolButton"
              type="submit"
              title="Sett inn lenke"
              aria-label="Sett inn lenke"
            >
              <svg className="richEditToolIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m20 6-11 11-5-5" />
              </svg>
            </button>
          </form>
        ) : (
          <>
            <button
              className="richEditToolButton"
              type="button"
              title="Fet"
              aria-label="Fet"
              onMouseDown={(event) =>
                handleToolbarActionMouseDown(event, () => applyFormat("bold"))
              }
              onClick={(event) =>
                handleToolbarActionClick(event, () => applyFormat("bold"))
              }
            >
              <strong>B</strong>
            </button>
            <button
              className="richEditToolButton"
              type="button"
              title="Kursiv"
              aria-label="Kursiv"
              onMouseDown={(event) =>
                handleToolbarActionMouseDown(event, () => applyFormat("italic"))
              }
              onClick={(event) =>
                handleToolbarActionClick(event, () => applyFormat("italic"))
              }
            >
              <em>I</em>
            </button>
            <button
              className="richEditToolButton"
              type="button"
              title="Punktliste"
              aria-label="Punktliste"
              onMouseDown={(event) =>
                handleToolbarActionMouseDown(event, () =>
                  applyFormat("insertUnorderedList")
                )
              }
              onClick={(event) =>
                handleToolbarActionClick(event, () =>
                  applyFormat("insertUnorderedList")
                )
              }
            >
              <svg className="richEditToolIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 6h13" />
                <path d="M8 12h13" />
                <path d="M8 18h13" />
                <path d="M3 6h.01" />
                <path d="M3 12h.01" />
                <path d="M3 18h.01" />
              </svg>
            </button>
            <button
              className="richEditToolButton"
              type="button"
              title="Nummerert liste"
              aria-label="Nummerert liste"
              onMouseDown={(event) =>
                handleToolbarActionMouseDown(event, () =>
                  applyFormat("insertOrderedList")
                )
              }
              onClick={(event) =>
                handleToolbarActionClick(event, () =>
                  applyFormat("insertOrderedList")
                )
              }
            >
              <svg className="richEditToolIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 6h11" />
                <path d="M10 12h11" />
                <path d="M10 18h11" />
                <path d="M4 6h1v4" />
                <path d="M4 10h2" />
                <path d="M4 14h2l-2 4h2" />
              </svg>
            </button>
            <button
              className="richEditToolButton"
              type="button"
              title="Lenke"
              aria-label="Lenke"
              onMouseDown={(event) =>
                handleToolbarActionMouseDown(event, openLinkInput)
              }
              onClick={(event) =>
                handleToolbarActionClick(event, openLinkInput)
              }
            >
              <svg className="richEditToolIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
                <path d="M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1" />
              </svg>
            </button>
          </>
        )}
      </div>
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
          <button
            className="copyButton"
            onClick={() => {
              void handleCopy();
            }}
            title="Kopier tekst"
          >
            {copyState === "copied" ? "Kopiert!" : copyState === "failed" ? "Kunne ikke kopiere" : <>Kopier <svg className="copyIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></>}
          </button>
        </span>
      </div>
    </div>
  );
}

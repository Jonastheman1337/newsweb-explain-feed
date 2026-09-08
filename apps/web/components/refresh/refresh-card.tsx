"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import type { FeedItem } from "@newsweb/shared";
import { getNotice, getNoticeModelSource, type RewriteVersion } from "../../lib/api";
import { formatCategoryList } from "../../lib/format-category";
import { hasRewriteDraft, REWRITE_DRAFT_CHANGE_EVENT } from "../../lib/rewrite-drafts";
import { splitParagraphs, splitPdfPages } from "../../lib/source-text";
import { useEditorialTelemetry } from "../../lib/editorial-telemetry";
import { EditableRewrite } from "../editable-rewrite";
import { AttachmentLinks } from "../attachment-links";
import { GenerateButton } from "../generate-button";
import { InstructionInput } from "../instruction-input";
import { getGenerationPhaseLabel } from "../generation-steps";
import { RefreshEditorActions, type WorkspacePanel } from "./editor-actions";
import { FeedbackDialog } from "./feedback-dialog";
import { fastDraftToFeedItem, type FeedEntry } from "./feed-state";
import {
  SOURCE_FONT_STEPS,
  SOURCE_RATIO_MAX,
  SOURCE_RATIO_MIN,
  SOURCE_RATIO_STEP,
  clampSourceRatio,
  useNextPrefs,
  writeNextPrefs
} from "./prefs";
import { versionToFeedItem } from "./selection";
import styles from "./refresh.module.css";

function RefreshDateline({ item }: { item: FeedItem }) {
  const category = formatCategoryList(item.categories);
  return (
    <div className={styles.dateline}>
      <a href={`https://newsweb.oslobors.no/message/${item.messageId}`} target="_blank" rel="noopener noreferrer">
        <time dateTime={item.publishedAt}>{new Intl.DateTimeFormat("nb-NO", {
          dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo"
        }).format(new Date(item.publishedAt))}</time>
        {` | ${item.issuerName} (${item.issuerSign})${category ? ` | ${category}` : ""}`}
      </a>
    </div>
  );
}

// The instruction form stays mounted once revealed: InstructionInput owns the
// generation polling and the typed text.
type ComposeState = "unmounted" | "open" | "closed";
type PdfState = {
  status: "idle" | "loading" | "ready" | "error";
  text: string | null;
  pageCount: number | null;
};

export function RefreshCard({
  entry,
  onSelect,
  onVersion,
  showEditingHint = false
}: {
  entry: FeedEntry;
  onSelect: () => void;
  onVersion: (item: FeedItem) => void;
  showEditingHint?: boolean;
}) {
  const { current: item, latest, pending } = entry;
  const isFast = item.publicationKind === "fast";
  const isGenerated = Boolean(item.isFinal && item.rewriteId);
  const isMutedSource = !isGenerated && (item.notGenerated || item.skipped || !item.processing);
  const firstDraft = fastDraftToFeedItem(latest);
  const [panel, setPanel] = useState<WorkspacePanel | null>(null);
  const [focused, setFocused] = useState(false);
  const [compose, setCompose] = useState<ComposeState>("unmounted");
  const composing = compose === "open";
  const [editingHint, setEditingHint] = useState(false);
  const [opened, setOpened] = useState(false);
  const [versions, setVersions] = useState<RewriteVersion[]>([]);
  const [details, setDetails] = useState<Awaited<ReturnType<typeof getNotice>> | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">("idle");
  const [feedback, setFeedback] = useState(false);
  const [drafts, setDrafts] = useState<Set<string>>(() => new Set());
  const [versionRequest, setVersionRequest] = useState(0);
  const [pdf, setPdf] = useState<PdfState>({ status: "idle", text: null, pageCount: null });
  const [pdfRequest, setPdfRequest] = useState(0);
  const prefs = useNextPrefs();
  const cardRef = useRef<HTMLElement>(null);
  const composeRef = useRef<HTMLDivElement>(null);
  const composeFocusPending = useRef(false);
  const pdfKeyRef = useRef<string | null>(null);
  const drag = useRef<{ left: number; width: number } | null>(null);
  const savedScroll = useRef(0);
  const wasOpen = useRef(false);
  const wasFocused = useRef(false);
  useEffect(() => {
    try {
      setEditingHint(showEditingHint && sessionStorage.getItem("newsweb:next-editing-hint") !== "seen");
    } catch {
      setEditingHint(showEditingHint);
    }
  }, [showEditingHint]);
  const { logEvent } = useEditorialTelemetry(item.messageId);
  const sourceLinks = useMemo(
    () => ({
      primary: {
        url: `https://newsweb.oslobors.no/message/${item.messageId}`,
        issuerName: item.issuerName,
        issuerSign: item.issuerSign
      },
      related: details && "relatedNotices" in details ? details.relatedNotices : undefined
    }),
    [item.messageId, item.issuerName, item.issuerSign, details]
  );

  // The longer text gets the wider column unless the reader has set a width.
  const noticeChars = [item.lead, ...item.body].filter(Boolean).join("\n\n").length;
  const baseRatio = item.sourceBodyText.length > noticeChars ? 0.57 : 0.43;
  const sourceRatio = prefs.sourceRatio ?? (focused ? Math.max(0.5, baseRatio) : baseRatio);
  const fontPx = prefs.sourceFontPx ?? 14;
  const fontIndex = SOURCE_FONT_STEPS.indexOf(fontPx);
  const pdfRewriteId = isFast ? latest.rewriteId ?? undefined : item.rewriteId ?? undefined;
  const pdfKey = `${item.messageId}:${pdfRewriteId ?? ""}:${pdfRequest}`;

  function openPanel(next: WorkspacePanel) {
    if (!panel) savedScroll.current = window.scrollY;
    setOpened(true);
    setPanel(next);
  }
  function closePanel() {
    setPanel(null);
    setFocused(false);
  }
  function openCompose() {
    composeFocusPending.current = true;
    setCompose("open");
  }
  function closeCompose() {
    setCompose("closed");
    cardRef.current
      ?.querySelector<HTMLButtonElement>("[data-compose-trigger]")
      ?.focus({ preventScroll: true });
  }
  function toggleCompose() {
    if (composing) closeCompose();
    else openCompose();
  }
  function toggleFocused() {
    if (focused) {
      setFocused(false);
      return;
    }
    setFocused(true);
    // Focused work usually continues with an instruction: show the form, but
    // never move focus away from where the reader was.
    if (compose !== "open") setCompose("open");
  }
  useEffect(() => {
    if (!composing || !composeFocusPending.current) return;
    composeFocusPending.current = false;
    composeRef.current?.querySelector("textarea")?.focus();
  }, [composing]);
  useEffect(() => {
    const entering = focused && !wasFocused.current;
    const leaving = !focused && wasFocused.current;
    const closing = !panel && wasOpen.current;
    if (entering) {
      savedScroll.current = window.scrollY;
      window.scrollTo({ top: 0, behavior: "instant" });
    } else if (panel && !wasOpen.current && window.innerWidth <= 850) {
      cardRef.current?.querySelector("aside")?.scrollIntoView({ block: "start" });
    }
    if (leaving || (closing && window.innerWidth <= 850))
      window.scrollTo({ top: savedScroll.current, behavior: "instant" });
    if (closing)
      cardRef.current
        ?.querySelector<HTMLButtonElement>("[data-source-trigger]")
        ?.focus({ preventScroll: true });
    wasOpen.current = !!panel;
    wasFocused.current = focused;
  }, [panel, focused]);
  useEffect(() => {
    const card = cardRef.current;
    const editor = card?.querySelector<HTMLElement>("[data-editor-pane]");
    if (!panel || !card || !editor) return;
    const measure = () => card.style.setProperty("--editor-pane-height", `${Math.max(260, editor.getBoundingClientRect().height)}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(editor);
    return () => observer.disconnect();
  }, [panel]);
  useEffect(() => {
    const card = cardRef.current;
    if ((!panel && !composing) || !card) return;
    // One native listener decides what Escape closes: an open menu or "Valg"
    // first, then the instruction form, then the panel.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest(".richEditLinkForm")) return;
      const open = target?.closest<HTMLDetailsElement>("details[open]");
      if (open) {
        if (!open.hasAttribute("data-actions-menu")) {
          open.open = false;
          open.querySelector<HTMLElement>("summary")?.focus();
          event.stopPropagation();
        }
        return;
      }
      if (composing && target?.closest("[data-compose]")) {
        event.stopPropagation();
        closeCompose();
        return;
      }
      if (panel) {
        event.stopPropagation();
        closePanel();
      }
    };
    card.addEventListener("keydown", escape);
    return () => card.removeEventListener("keydown", escape);
  }, [panel, composing]);
  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    setLoadState("loading");
    getNotice(null, item.messageId, "v2")
      .then((notice) => {
        if (cancelled) return;
        setDetails(notice);
        setVersions("rewrites" in notice ? (notice.rewrites ?? []) : []);
        setLoadState("idle");
      })
      .catch(() => {
        if (!cancelled) setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [opened, item.messageId, latest.rewriteId, versionRequest]);
  useEffect(() => {
    // Lazy and cached per version; switching tabs and back keeps the request.
    if (panel !== "pdf" || pdfKeyRef.current === pdfKey) return;
    pdfKeyRef.current = pdfKey;
    setPdf({ status: "loading", text: null, pageCount: null });
    getNoticeModelSource(item.messageId, pdfRewriteId).then(
      (result) => {
        if (pdfKeyRef.current === pdfKey)
          setPdf({ status: "ready", text: result.text, pageCount: result.pageCount });
      },
      () => {
        if (pdfKeyRef.current === pdfKey) setPdf({ status: "error", text: null, pageCount: null });
      }
    );
  }, [panel, pdfKey, item.messageId, pdfRewriteId]);
  useEffect(() => {
    const refresh = () =>
      setDrafts(
        new Set(
          versions
            .filter((version) =>
              hasRewriteDraft({
                messageId: item.messageId,
                version: version.version,
                rewriteId: version.rewriteId,
                originalTitle: version.rewrite.title,
                originalBody: [version.rewrite.lead, ...version.rewrite.body]
                  .filter(Boolean)
                  .join("\n\n")
              })
            )
            .map((version) => version.rewriteId)
        )
      );
    refresh();
    window.addEventListener(REWRITE_DRAFT_CHANGE_EVENT, refresh);
    return () => window.removeEventListener(REWRITE_DRAFT_CHANGE_EVENT, refresh);
  }, [versions, item.messageId]);

  function ratioAt(clientX: number): number | null {
    const bounds = drag.current;
    return bounds ? clampSourceRatio(1 - (clientX - bounds.left) / bounds.width) : null;
  }
  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const card = cardRef.current;
    const bounds = card?.getBoundingClientRect();
    if (event.button !== 0 || !card || !bounds?.width) return;
    drag.current = { left: bounds.left, width: bounds.width };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    card.dataset.dragging = "";
    event.preventDefault();
  }
  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const ratio = ratioAt(event.clientX);
    if (ratio != null) cardRef.current?.style.setProperty("--source-ratio", String(ratio));
  }
  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const ratio = ratioAt(event.clientX);
    drag.current = null;
    const card = cardRef.current;
    if (card) delete card.dataset.dragging;
    if (ratio != null) writeNextPrefs({ sourceRatio: ratio });
  }
  function keyDrag(event: ReactKeyboardEvent<HTMLDivElement>) {
    const next =
      event.key === "ArrowLeft"
        ? sourceRatio + SOURCE_RATIO_STEP
        : event.key === "ArrowRight"
          ? sourceRatio - SOURCE_RATIO_STEP
          : event.key === "Home"
            ? SOURCE_RATIO_MAX
            : event.key === "End"
              ? SOURCE_RATIO_MIN
              : null;
    if (next == null) return;
    event.preventDefault();
    writeNextPrefs({ sourceRatio: clampSourceRatio(next) });
  }

  const source = details?.source;
  const composeTrigger = (label: string) => (
    <button type="button" data-compose-trigger aria-expanded={composing} onClick={toggleCompose}>
      {label}
    </button>
  );
  return (
    <article
      ref={cardRef}
      id={`notice-${item.messageId}`}
      className={`${styles.card} ${isMutedSource ? styles.sourceOnly : ""} ${item.importance === "viktig" ? styles.important : ""} ${panel ? styles.workspace : ""} ${focused ? styles.focused : ""}`}
      style={{ "--source-ratio": sourceRatio, "--source-font": `${fontPx}px` } as CSSProperties}
      data-generation-state={isGenerated ? "generated" : "not-generated"}
      aria-label={item.issuerName}
      onFocusCapture={(event) => {
        if (!editingHint || !(event.target as HTMLElement).closest('[contenteditable="true"]')) return;
        setEditingHint(false);
        try { sessionStorage.setItem("newsweb:next-editing-hint", "seen"); } catch { /* Hint only. */ }
      }}
    >
      <div className={styles.editorPane} data-editor-pane>
        {focused && (
          <button type="button" className={styles.backToFeed} onClick={closePanel}>
            ← Feed
          </button>
        )}
        {item.importance === "viktig" && <div className={styles.importance}>Viktig</div>}
        {isFast && <div className={styles.versionLink}>Førsteutkast</div>}
        {isGenerated && item.rewriteId ? (
          <EditableRewrite
            key={`${item.rewriteId}:${item.contentHash}`}
            messageId={item.messageId}
            originalTitle={item.title}
            originalBody={[item.lead, ...item.body].filter(Boolean).join("\n\n")}
            activeVersion={item.rewriteVersion ?? undefined}
            rewriteId={item.rewriteId}
            publicationRevision={item.publicationRevision}
            contentHash={item.contentHash ?? undefined}
            isFinal={item.isFinal}
            className={styles.editor}
            dateline={<RefreshDateline item={item} />}
            showTitleButton
            sourceLinks={sourceLinks}
            renderActions={(controls) => (
              <RefreshEditorActions
                controls={controls}
                sourcesOpen={!!panel}
                composeOpen={composing}
                onPanel={openPanel}
                onClosePanel={closePanel}
                onCompose={toggleCompose}
                onFeedback={() => setFeedback(true)}
                showEditingHint={editingHint}
              />
            )}
          />
        ) : (
          <div className={styles.waiting}>
            <RefreshDateline item={item} />
            <h2>{item.sourceTitle || item.title}</h2>
            <div className={styles.waitActions}>
              <button type="button" data-source-trigger aria-expanded={!!panel} onClick={() => panel ? closePanel() : openPanel("sources")}>
                {panel ? "Lukk kilder" : "Kilder"}
              </button>
              {!latest.processing && !latest.failed && (
                <span className={styles.waitGenerate}>
                  {composeTrigger("Instruksjon")}
                  <GenerateButton
                    messageId={item.messageId}
                    hasAttachments={item.hasAttachments}
                    label="Lag notis"
                  />
                </span>
              )}
            </div>
          </div>
        )}
        {compose !== "unmounted" && (
          <div ref={composeRef} className={styles.compose} data-compose hidden={!composing}>
            <InstructionInput
              messageId={item.messageId}
              activeVersion={isFast ? latest.isFinal ? latest.rewriteVersion ?? undefined : undefined : item.rewriteVersion ?? undefined}
              rewriteId={isFast ? latest.rewriteId ?? undefined : item.rewriteId ?? undefined}
              publicationRevision={latest.publicationRevision}
              contentHash={isFast ? latest.contentHash ?? undefined : item.contentHash ?? undefined}
              isFinal={isFast ? latest.isFinal : item.isFinal}
              hasAttachments={item.hasAttachments}
              presentation="refresh"
            />
          </div>
        )}
        {(latest.processing || latest.regenerating) && (
          <div role="status" className={styles.progress}>
            <span />
            {isFast ? "Utfyllende versjon lages" : latest.phase ? getGenerationPhaseLabel(latest.phase) : "Notis lages"}
          </div>
        )}
        {latest.failed && (
          <div role="status" className={styles.failure}>
            Generering feilet{" "}
            {!latest.processing && !latest.regenerating && <GenerateButton messageId={item.messageId} hasAttachments={item.hasAttachments} label="Prøv igjen" />}
            {composeTrigger("Tilpass instruksjon")}
          </div>
        )}
        {pending && (
          <div className={styles.ready} role="status">
            <span>{isFast ? "Utfyllende versjon klar" : "Ny versjon klar"}</span>
            <button type="button" onClick={onSelect}>
              Vis versjon
            </button>
          </div>
        )}
        {item.rewriteVersion && item.rewriteVersion > 1 && !pending && (
          <button
            type="button"
            className={styles.versionLink}
            onClick={() => openPanel("versions")}
          >
            Versjon {item.rewriteVersion}
          </button>
        )}
      </div>
      {opened && panel && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Bredde på kildepanelet"
          aria-valuemin={Math.round(SOURCE_RATIO_MIN * 100)}
          aria-valuemax={Math.round(SOURCE_RATIO_MAX * 100)}
          aria-valuenow={Math.round(sourceRatio * 100)}
          tabIndex={0}
          className={styles.splitHandle}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={() => writeNextPrefs({ sourceRatio: undefined })}
          onKeyDown={keyDrag}
        />
      )}
      {opened && (
        <aside className={styles.sourcePane} hidden={!panel} aria-label="Kilder og versjoner">
          <button
            type="button"
            className={styles.mobileBackToEditor}
            onClick={() => cardRef.current?.scrollIntoView({ block: "start" })}
          >
            ↑ Notis
          </button>
          <div className={styles.panelHeader}>
          <div
            className={styles.panelTabs}
            role="tablist"
            aria-label="Vis kilde eller versjon"
            onKeyDown={(event) => {
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")
              );
              const index = buttons.indexOf(event.target as HTMLButtonElement);
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % buttons.length
                  : event.key === "ArrowLeft"
                    ? (index + buttons.length - 1) % buttons.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? buttons.length - 1
                        : -1;
              if (next >= 0) {
                event.preventDefault();
                buttons[next].focus();
                buttons[next].click();
              }
            }}
          >
            <button
              type="button"
              role="tab"
              id={`sources-tab-${item.messageId}`}
              aria-selected={panel === "sources"}
              tabIndex={panel === "sources" ? 0 : -1}
              aria-controls={`sources-panel-${item.messageId}`}
              onClick={() => setPanel("sources")}
            >
              Kilder
            </button>
            {item.hasAttachments && (
              <button
                type="button"
                role="tab"
                id={`pdf-tab-${item.messageId}`}
                aria-selected={panel === "pdf"}
                tabIndex={panel === "pdf" ? 0 : -1}
                aria-controls={`pdf-panel-${item.messageId}`}
                onClick={() => setPanel("pdf")}
              >
                PDF-tekst
              </button>
            )}
            <button
              type="button"
              role="tab"
              id={`versions-tab-${item.messageId}`}
              aria-selected={panel === "versions"}
              tabIndex={panel === "versions" ? 0 : -1}
              aria-controls={`versions-panel-${item.messageId}`}
              onClick={() => setPanel("versions")}
            >
              Versjoner {versions.length || ""}
            </button>
          </div>
          <div className={styles.panelTools}>
            <button
              type="button"
              className={styles.fontStep}
              aria-label="Mindre kildetekst"
              disabled={fontIndex <= 0}
              onClick={() => writeNextPrefs({ sourceFontPx: SOURCE_FONT_STEPS[fontIndex - 1] })}
            >
              A−
            </button>
            <button
              type="button"
              className={styles.fontStep}
              aria-label="Større kildetekst"
              disabled={fontIndex < 0 || fontIndex >= SOURCE_FONT_STEPS.length - 1}
              onClick={() => writeNextPrefs({ sourceFontPx: SOURCE_FONT_STEPS[fontIndex + 1] })}
            >
              A+
            </button>
            <button type="button" className={styles.expandToggle} aria-pressed={focused} onClick={toggleFocused}>
              {focused ? "Tilbake til feed" : "Utvid"}
            </button>
            <button type="button" className={styles.closeSource} onClick={closePanel} aria-label="Lukk kildepanelet" title="Lukk kilder">×</button>
          </div>
          </div>
          <div
            role="tabpanel"
            id={`sources-panel-${item.messageId}`}
            aria-labelledby={`sources-tab-${item.messageId}`}
            hidden={panel !== "sources"}
            className={styles.sourceText}
          >
            <div className={styles.sourceHeading}>
              <span>Børsmelding</span>
              <a href={sourceLinks.primary.url} target="_blank" rel="noreferrer">
                Newsweb ↗
              </a>
            </div>
            <AttachmentLinks
              messageId={item.messageId}
              attachments={source?.attachments ?? item.attachments}
            />
            <h3>{source?.title ?? item.sourceTitle}</h3>
            <div className={styles.sourceBody}>
              {splitParagraphs(source?.bodyText ?? item.sourceBodyText).map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
            {details && "relatedNotices" in details && !!details.relatedNotices?.length && (
              <div className={styles.related}>
                <h4>Relaterte meldinger</h4>
                {details.relatedNotices.map((notice) => (
                  <a key={notice.messageId} href={notice.url} target="_blank" rel="noreferrer">
                    {notice.title} ↗
                  </a>
                ))}
              </div>
            )}
          </div>
          {item.hasAttachments && (
            <div
              role="tabpanel"
              id={`pdf-panel-${item.messageId}`}
              aria-labelledby={`pdf-tab-${item.messageId}`}
              hidden={panel !== "pdf"}
              className={styles.sourceText}
            >
              <div className={styles.sourceHeading}>
                <span>{pdf.pageCount ? `PDF · ${pdf.pageCount} sider` : "PDF"}</span>
                <span>Lest av modellen</span>
              </div>
              {pdf.status === "loading" && <p role="status">Henter PDF-tekst…</p>}
              {pdf.status === "error" && (
                <p role="alert">
                  Kunne ikke hente PDF-tekst.{" "}
                  <button type="button" onClick={() => setPdfRequest((request) => request + 1)}>
                    Prøv igjen
                  </button>
                </p>
              )}
              {pdf.status === "ready" && pdf.text === null && (
                <p>Ingen PDF-tekst lagret for denne versjonen</p>
              )}
              {pdf.status === "ready" && pdf.text && (
                <div className={styles.sourceBody}>
                  {splitPdfPages(pdf.text).map((section, index) => (
                    <Fragment key={index}>
                      {section.page !== null && <h4>Side {section.page}</h4>}
                      {section.paragraphs.map((paragraph, paragraphIndex) => (
                        <p key={paragraphIndex}>{paragraph}</p>
                      ))}
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          )}
          <div
            role="tabpanel"
            id={`versions-panel-${item.messageId}`}
            aria-labelledby={`versions-tab-${item.messageId}`}
            hidden={panel !== "versions"}
          >
            {loadState === "loading" && !versions.length && <p role="status">Henter versjoner…</p>}
            {loadState === "error" && (
              <p role="alert">
                Kunne ikke hente versjoner.{" "}
                <button onClick={() => setVersionRequest((request) => request + 1)}>
                  Prøv igjen
                </button>
              </p>
            )}
            <div className={styles.versionList}>
              {firstDraft && (
                <button type="button" className={styles.versionRow} aria-pressed={isFast} onClick={() => onVersion(firstDraft)}>
                  <span><strong>Førsteutkast</strong><small>{firstDraft.title}</small></span>
                  <span>{hasRewriteDraft({ messageId: item.messageId, version: 1, rewriteId: firstDraft.rewriteId ?? undefined, originalTitle: firstDraft.title, originalBody: firstDraft.lead }) ? "Redigert" : isFast ? "Valgt" : ""}</span>
                </button>
              )}
              {[...versions]
                .sort((a, b) => b.version - a.version)
                .map((version) => (
                  <button
                    type="button"
                    key={version.rewriteId}
                    className={styles.versionRow}
                    aria-pressed={item.rewriteId === version.rewriteId}
                    onClick={() => {
                      onVersion(versionToFeedItem(version, latest));
                      void logEvent({
                        action: "rewrite_version_view",
                        version: version.version,
                        rewriteId: version.rewriteId,
                        publicationRevision: latest.publicationRevision,
                        contentHash: version.contentHash,
                        isFinal: true,
                        actionSource: "refresh_versions",
                        payload: { selectedVersion: version.version }
                      }).catch(() => {});
                    }}
                  >
                    <span>
                      <strong>
                        {version.version === 1 ? firstDraft ? "Utfyllende versjon" : "Første versjon" : `Versjon ${version.version}`}
                      </strong>
                      <time>
                        {new Intl.DateTimeFormat("nb-NO", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "Europe/Oslo"
                        }).format(new Date(version.generatedAt))}
                      </time>
                    </span>
                    <span>
                      {drafts.has(version.rewriteId)
                        ? "Redigert"
                        : item.rewriteId === version.rewriteId
                          ? "Valgt"
                          : ""}
                    </span>
                    <small>{version.rewrite.title}</small>
                  </button>
                ))}
            </div>
            {loadState === "idle" && !versions.length && !firstDraft && <p>Ingen versjoner ennå</p>}
          </div>
        </aside>
      )}
      <FeedbackDialog item={item} open={feedback} onClose={() => setFeedback(false)} />
    </article>
  );
}

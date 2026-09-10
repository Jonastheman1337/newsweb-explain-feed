"use client";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type {
  FeedItem,
  NoticeEditorSnapshot,
  NoticeGenerationRequest,
} from "@newsweb/shared";
import {
  getNotice,
  getNoticeModelSource,
  type RewriteVersion,
} from "../../lib/api";
import { formatCategoryList } from "../../lib/format-category";
import {
  getRewriteDraft,
  REWRITE_DRAFT_CHANGE_EVENT,
} from "../../lib/rewrite-drafts";
import { splitParagraphs, splitPdfPages } from "../../lib/source-text";
import { useEditorialTelemetry } from "../../lib/editorial-telemetry";
import {
  EditableRewrite,
  type RewriteActionControls,
} from "../editable-rewrite";
import { AttachmentDownloads } from "./attachment-downloads";
import { getGenerationPhaseLabel } from "../generation-steps";
import { FeedbackDialog } from "./feedback-dialog";
import { ActionMenu } from "./controls";
import { fastDraftToFeedItem, type FeedEntry } from "./feed-state";
import { versionToFeedItem } from "./selection";
import { useNoticeComposer } from "./next-composer";
import { ChevronIcon, CompareIcon } from "./next-icons";
import styles from "./next-editor.module.css";

type ReadingView = "notice" | "original" | "compare";
type Details = Awaited<ReturnType<typeof getNotice>>;
function Dateline({ item }: { item: FeedItem }) {
  const category = formatCategoryList(item.categories);
  return (
    <a
      className={styles.dateline}
      href={`https://newsweb.oslobors.no/message/${item.messageId}`}
      target="_blank"
      rel="noopener noreferrer"
    >
      <time dateTime={item.publishedAt}>
        {new Intl.DateTimeFormat("nb-NO", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Europe/Oslo",
        }).format(new Date(item.publishedAt))}
      </time>
      {` | ${item.issuerName}${item.issuerSign ? ` (${item.issuerSign})` : ""}${category ? ` | ${category}` : ""}`}
    </a>
  );
}
function ChangedText({
  before,
  after,
  heading = false,
}: {
  before: string;
  after: string;
  heading?: boolean;
}) {
  const Tag = heading ? "h2" : "p";
  return (
    <Tag>
      {before === after ? (
        after
      ) : (
        <>
          {before && <del>{before}</del>}
          {before && after ? " " : ""}
          {after && <ins>{after}</ins>}
        </>
      )}
    </Tag>
  );
}
export function RefreshCard({
  entry,
  onSelect,
  onVersion,
}: {
  entry: FeedEntry;
  onSelect: () => void;
  onVersion: (item: FeedItem) => void;
  showEditingHint?: boolean;
}) {
  const { current: item, latest, pending } = entry;
  const generated = !!(item.isFinal && item.rewriteId),
    fast = item.publicationKind === "fast";
  const first = fastDraftToFeedItem(latest);
  const [view, setView] = useState<ReadingView>("notice");
  const [compose, setCompose] = useState(false),
    [composeMounted, setComposeMounted] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false),
    [details, setDetails] = useState<Details | null>(null);
  const [versions, setVersions] = useState<RewriteVersion[]>([]),
    [loading, setLoading] = useState(false),
    [loadError, setLoadError] = useState(false);
  const [feedback, setFeedback] = useState(false),
    [draftTick, setDraftTick] = useState(0);
  const [sourceMode, setSourceMode] = useState<"newsweb" | "pdf">("newsweb");
  const [pdf, setPdf] = useState<{
    state: "loading" | "ready" | "failed";
    text: string | null;
    pages: number | null;
  } | null>(null);
  const [pdfRetry, setPdfRetry] = useState(0);
  const [result, setResult] = useState<{
      item: FeedItem;
      base?: NoticeEditorSnapshot;
    } | null>(null),
    [resultViewed, setResultViewed] = useState(false),
    [showDiff, setShowDiff] = useState(false);
  const card = useRef<HTMLElement>(null),
    composeTrigger = useRef<HTMLButtonElement>(null),
    versionTrigger = useRef<HTMLButtonElement>(null),
    history = useRef<HTMLDivElement>(null);
  const controls = useRef<RewriteActionControls | null>(null);
  const props = useRef({ entry, onVersion });
  props.current = { entry, onVersion };
  const interaction = useRef(0),
    lastEditor = useRef(""),
    selectedIdentity = useRef(item.rewriteId);
  if (selectedIdentity.current !== item.rewriteId) {
    selectedIdentity.current = item.rewriteId;
    interaction.current++;
  }
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const detailRequest = useRef<Promise<Details> | null>(null);
  const { logEvent } = useEditorialTelemetry(item.messageId);
  const onDraftChange = useCallback(
    (draft: { title: string; body: string; bodyHtml: string }) => {
      const value = JSON.stringify(draft);
      if (value !== lastEditor.current) {
        lastEditor.current = value;
        interaction.current++;
      }
    },
    [],
  );
  const getSnapshot = useCallback(() => {
    const current = props.current.entry.current;
    if (!current.rewriteId || !current.contentHash) return undefined;
    const text = controls.current?.getSnapshot() ?? {
      title: current.title,
      body: [current.lead, ...current.body].filter(Boolean).join("\n\n"),
    };
    return {
      rewriteId: current.rewriteId,
      contentHash: current.contentHash,
      title: text.title,
      body: text.body,
    };
  }, []);
  async function loadDetails() {
    if (detailRequest.current) return detailRequest.current;
    setLoading(true);
    setLoadError(false);
    const promise = getNotice(null, item.messageId, "v2");
    detailRequest.current = promise;
    try {
      const data = await promise;
      if (!alive.current) return data;
      setDetails(data);
      setVersions("rewrites" in data ? (data.rewrites ?? []) : []);
      return data;
    } catch (error) {
      if (alive.current) setLoadError(true);
      throw error;
    } finally {
      detailRequest.current = null;
      if (alive.current) setLoading(false);
    }
  }
  const onResult = useCallback(
    async (
      request: NoticeGenerationRequest,
      base: NoticeEditorSnapshot | undefined,
      canAutoOpen: () => boolean,
    ) => {
      const data = await getNotice(
        null,
        props.current.entry.current.messageId,
        "v2",
      );
      if (!alive.current) return;
      const rows = "rewrites" in data ? (data.rewrites ?? []) : [];
      const version = rows.find((row) => row.rewriteId === request.rewriteId);
      if (!version)
        throw new Error("Den ferdige versjonen er ikke tilgjengelig ennå.");
      setDetails(data);
      setVersions(rows);
      const next = versionToFeedItem(version, props.current.entry.latest);
      const autoOpen = canAutoOpen();
      setResult({ item: next, base });
      setResultViewed(
        autoOpen || props.current.entry.current.rewriteId === next.rewriteId,
      );
      if (autoOpen) {
        props.current.onVersion(next);
        setCompose(false);
        setShowDiff(false);
      }
    },
    [],
  );
  const composer = useNoticeComposer({
    messageId: item.messageId,
    rewriteId: item.rewriteId ?? undefined,
    enabled: generated && compose,
    getSnapshot,
    getInteractionVersion: () => interaction.current,
    onResult,
  });
  useEffect(() => {
    const changed = () => setDraftTick((value) => value + 1);
    window.addEventListener(REWRITE_DRAFT_CHANGE_EVENT, changed);
    return () =>
      window.removeEventListener(REWRITE_DRAFT_CHANGE_EVENT, changed);
  }, []);
  useEffect(() => {
    if (view !== "notice" || historyOpen) void loadDetails().catch(() => {});
  }, [view, historyOpen, latest.rewriteId]);
  useEffect(() => {
    // Version numbers also count unsuccessful runs; verify actual alternatives.
    if (latest.isFinal && (latest.rewriteVersion ?? 0) > 1)
      void loadDetails().catch(() => {});
  }, [latest.rewriteId, latest.rewriteVersion, latest.isFinal]);
  useEffect(() => {
    if (sourceMode !== "pdf" || view === "notice") return;
    if (fast || !generated) {
      setPdf({ state: "ready", text: null, pages: null });
      return;
    }
    let active = true;
    setPdf({ state: "loading", text: null, pages: null });
    const rewriteId = fast
      ? (latest.rewriteId ?? undefined)
      : (item.rewriteId ?? undefined);
    getNoticeModelSource(item.messageId, rewriteId).then(
      (value) => {
        if (active)
          setPdf({ state: "ready", text: value.text, pages: value.pageCount });
      },
      () => {
        if (active) setPdf({ state: "failed", text: null, pages: null });
      },
    );
    return () => {
      active = false;
    };
  }, [view, sourceMode, item.rewriteId, latest.rewriteId, pdfRetry]);
  useEffect(() => {
    if (!historyOpen) return;
    const close = (event: PointerEvent) => {
      if (!history.current?.contains(event.target as Node))
        setHistoryOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [historyOpen]);
  useEffect(() => {
    if (compose) composer.focus();
  }, [compose]);
  useEffect(() => {
    if (view !== "compare") return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && card.current && !card.current.contains(event.target)) {
        interaction.current++;
        setView("notice");
        setHistoryOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [view]);
  function toggleCompose() {
    interaction.current++;
    setComposeMounted(true);
    setCompose(!compose);
    if (compose) composeTrigger.current?.focus({ preventScroll: true });
  }
  function changeView(next: ReadingView) {
    interaction.current++;
    setView(next === "compare" && view === "compare" ? "notice" : next);
    setHistoryOpen(false);
  }
  function select(next: FeedItem) {
    interaction.current++;
    setResultViewed(true);
    setShowDiff(false);
    setHistoryOpen(false);
    onVersion(next);
    versionTrigger.current?.focus({ preventScroll: true });
    void logEvent({
      action: "rewrite_version_view",
      version: next.rewriteVersion ?? undefined,
      rewriteId: next.rewriteId ?? undefined,
      publicationRevision: latest.publicationRevision,
      contentHash: next.contentHash ?? undefined,
      isFinal: true,
      actionSource: "refresh_versions",
      payload: { selectedVersion: next.rewriteVersion },
    }).catch(() => {});
  }
  const completed =
    result && !resultViewed && result.item.rewriteId !== item.rewriteId
      ? result.item
      : pending;
  const atLatest = item.rewriteId === latest.rewriteId;
  const earliestRow = [...versions].sort((a, b) => a.version - b.version)[0];
  const earliest =
    first ?? (earliestRow ? versionToFeedItem(earliestRow, latest) : undefined);
  const firstTarget =
    earliest?.rewriteId !== item.rewriteId ? earliest : undefined;
  const latestTarget = latest.isFinal && !atLatest ? latest : undefined;
  const versionTarget =
    completed ?? latestTarget ?? (atLatest ? firstTarget : undefined);
  const historyUnavailable =
    loadError && generated && (latest.rewriteVersion ?? 0) > 1;
  const versionControl = (versionTarget || historyUnavailable) && (
    <div
      ref={history}
      className={styles.versionControl}
      onKeyDown={(event) => {
        if (event.key === "Escape" && historyOpen) {
          event.preventDefault();
          event.stopPropagation();
          setHistoryOpen(false);
          versionTrigger.current?.focus({ preventScroll: true });
        }
      }}
    >
      <button
        ref={versionTrigger}
        type="button"
        className={completed ? styles.primary : undefined}
        disabled={loading && !versionTarget}
        onClick={() => {
          if (versionTarget) select(versionTarget);
          else setHistoryOpen(true);
        }}
      >
        {completed
          ? fast && completed.rewriteVersion === 1
            ? "Fullstendig melding klar"
            : "Ny versjon klar"
          : latestTarget
            ? "Vis nyeste"
            : firstTarget
              ? "Vis første"
              : "Versjoner"}
      </button>
      <button
        type="button"
        className={styles.historyTrigger}
        aria-label="Velg blant alle versjoner"
        aria-expanded={historyOpen}
        onClick={() => setHistoryOpen(!historyOpen)}
      >
        <ChevronIcon />
      </button>
      {historyOpen && (
        <div className={styles.historyMenu} aria-label="Alle versjoner">
          {loading && <p role="status">Henter versjoner …</p>}
          {loadError && (
            <p role="alert">
              Kunne ikke hente versjoner.{" "}
              <button
                type="button"
                onClick={() => void loadDetails().catch(() => {})}
              >
                Prøv igjen
              </button>
            </p>
          )}
          {[
            ...[...versions]
              .sort((a, b) => b.version - a.version)
              .map((v) => ({
                item: versionToFeedItem(v, latest),
                label:
                  v.version === 1
                    ? first
                      ? "Fullstendig melding"
                      : "Første versjon"
                    : `Versjon ${v.version}`,
              })),
            ...(first ? [{ item: first, label: "Førsteutkast" }] : []),
          ].map(({ item: version, label }) => {
            const edited = getRewriteDraft({
              messageId: item.messageId,
              version: version.rewriteVersion,
              rewriteId: version.rewriteId ?? undefined,
              originalTitle: version.title,
              originalBody: [version.lead, ...version.body]
                .filter(Boolean)
                .join("\n\n"),
            });
            return (
              <button
                key={version.rewriteId}
                type="button"
                aria-pressed={item.rewriteId === version.rewriteId}
                onClick={() => select(version)}
              >
                <span className={styles.historyMeta}>
                  <span>{label}</span>
                  {version.finalizedAt && (
                    <time>
                      {new Intl.DateTimeFormat("nb-NO", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Europe/Oslo",
                      }).format(new Date(version.finalizedAt))}
                    </time>
                  )}
                  <span>
                    {[
                      item.rewriteId === version.rewriteId
                        ? "Valgt"
                        : version.rewriteId === latest.rewriteId
                          ? "Nyeste"
                          : "",
                      edited ? "Redigert" : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span>{edited?.title ?? version.title}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
  const sourceLinks = {
    primary: {
      url: `https://newsweb.oslobors.no/message/${item.messageId}`,
      issuerName: item.issuerName,
      issuerSign: item.issuerSign,
    },
    related:
      details && "relatedNotices" in details
        ? details.relatedNotices
        : undefined,
  };
  const source = details?.source;
  const diffAvailable =
    !!result?.base && result.item.rewriteId === item.rewriteId;
  function actions(editor: RewriteActionControls) {
    controls.current = editor;
    const visible = editor.getSnapshot();
    const before = result?.base;
    return (
      <>
        {showDiff && before && (
          <div
            className={styles.diff}
            aria-label="Endringer fra teksten som ble sendt inn"
          >
            <ChangedText before={before.title} after={visible.title} heading />
            <Dateline item={item} />
            {Array.from(
              {
                length: Math.max(
                  splitParagraphs(before.body).length,
                  splitParagraphs(visible.body).length,
                ),
              },
              (_, i) => (
                <ChangedText
                  key={i}
                  before={splitParagraphs(before.body)[i] ?? ""}
                  after={splitParagraphs(visible.body)[i] ?? ""}
                />
              ),
            )}
          </div>
        )}
        <div className={styles.actions}>
          <button
            ref={composeTrigger}
            type="button"
            className={styles.editAction}
            data-compose-trigger
            aria-expanded={compose}
            aria-controls={`compose-${item.messageId}`}
            onClick={toggleCompose}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="m16 3 5 5M4 16l-1 5 5-1L21 7a2 2 0 0 0-4-4Z" />
            </svg>
            Endre
          </button>
          {versionControl}
          <div className={styles.requestActions}>
            {composer.status}
            {!composer.busy &&
              !completed &&
              (latest.processing || latest.regenerating) && (
                <span className={styles.requestStatus} role="status">
                  {fast
                    ? "Utfyllende lages …"
                    : latest.phase
                      ? getGenerationPhaseLabel(latest.phase)
                      : "Notis lages …"}
                </span>
              )}
            {latest.failed && !composer.busy && !composer.request && (
              <span role="status">
                Kunne ikke fullføre{" "}
                <button
                  type="button"
                  disabled={!composer.canGenerate}
                  onClick={() => void composer.generate()}
                >
                  Prøv igjen
                </button>
              </span>
            )}
          </div>
          {diffAvailable && (
            <button
              type="button"
              aria-pressed={showDiff}
              onClick={() => setShowDiff(!showDiff)}
            >
              {showDiff ? "Skjul endringer" : "Vis endringer"}
            </button>
          )}
          <div className={styles.rightActions}>
            <ActionMenu>
              {editor.hasDraft && (
                <>
                  <button type="button" onClick={editor.toggleOriginal}>
                    {editor.showingOriginal
                      ? "Vis redigert tekst"
                      : "Vis uredigert AI-tekst"}
                  </button>
                  <button type="button" onClick={editor.reset}>
                    Tilbakestill egne endringer
                  </button>
                </>
              )}
              {editor.canUndoReset && (
                <button type="button" onClick={editor.undoReset}>
                  Angre tilbakestilling
                </button>
              )}
              <button type="button" onClick={() => setFeedback(true)}>
                Meld feil
              </button>
            </ActionMenu>
            <button
              type="button"
              className={styles.primary}
              aria-live="polite"
              onClick={() => void editor.copy()}
            >
              {editor.copyState === "copied"
                ? "Kopiert"
                : editor.copyState === "failed"
                  ? "Prøv å kopiere igjen"
                  : "Kopier"}
            </button>
          </div>
        </div>
        {editor.saveState === "failed" && (
          <p className={styles.error} role="alert">
            Endringene er ikke lagret på denne enheten.
          </p>
        )}
      </>
    );
  }
  return (
    <article
      ref={card}
      id={`notice-${item.messageId}`}
      className={`${styles.card} ${!generated && !latest.processing ? styles.sourceOnly : ""}`}
      aria-label={item.issuerName}
      data-generation-state={generated ? "generated" : "not-generated"}
    >
      <header className={styles.header}>
        <div className={styles.viewSwitch} role="group" aria-label="Lesemodus">
          {(
            [
              ["notice", "Notis"],
              ["original", "Original"],
              ["compare", "Sammenlign"],
            ] as const
          ).map(([mode, label]) => (
            <button
              type="button"
              key={mode}
              className={mode === "compare" ? styles.compareButton : undefined}
              aria-pressed={view === mode}
              onClick={() => changeView(mode)}
            >
              {mode === "compare" && <CompareIcon />}
              {label}
            </button>
          ))}
        </div>
      </header>
      <div
        className={`${styles.reading} ${view === "compare" ? styles.comparing : ""}`}
      >
        <div className={styles.editorPane} hidden={view === "original"}>
          {view === "compare" && (
            <div className={styles.columnHeading}>Notis</div>
          )}
          {generated && item.rewriteId ? (
            <EditableRewrite
              key={`${item.rewriteId}:${item.contentHash}`}
              messageId={item.messageId}
              originalTitle={item.title}
              originalBody={[item.lead, ...item.body]
                .filter(Boolean)
                .join("\n\n")}
              activeVersion={item.rewriteVersion ?? undefined}
              rewriteId={item.rewriteId}
              publicationRevision={item.publicationRevision}
              contentHash={item.contentHash ?? undefined}
              isFinal={item.isFinal}
              showTitleButton
              inlineTitleSuggestions
              titleSuggestionContext={view}
              dateline={!showDiff && <Dateline item={item} />}
              className={`${styles.editor} ${showDiff ? styles.showDiff : ""}`}
              sourceLinks={sourceLinks}
              onDraftChange={onDraftChange}
              renderActions={actions}
            />
          ) : (
            <>
              <h2>{item.sourceTitle || item.title}</h2>
              <Dateline item={item} />
              <div className={`${styles.actions} ${styles.sourceActions}`}>
                {composer.status}
                {!composer.busy && (
                  <span role="status">
                    {latest.failed
                      ? "Kunne ikke fullføre"
                      : latest.processing
                        ? latest.fastDraft?.status === "pending"
                          ? "Førsteutkast lages …"
                          : "Notis lages …"
                        : ""}
                  </span>
                )}
                {!latest.processing && !composer.busy && !composer.request && (
                  <button
                    type="button"
                    className={styles.generateAction}
                    disabled={!composer.canGenerate}
                    onClick={() => void composer.generate()}
                  >
                    Generer
                  </button>
                )}
              </div>
              {composer.error && (
                <p className={styles.error} role="alert">
                  {composer.error}
                </p>
              )}
            </>
          )}
          {generated && (
            <div
              id={`compose-${item.messageId}`}
              className={styles.composeReveal}
              data-open={compose}
              aria-hidden={!compose}
              inert={!compose}
              onKeyDown={(event) => {
                if (event.key === "Escape" && !event.defaultPrevented) {
                  event.stopPropagation();
                  setCompose(false);
                  composeTrigger.current?.focus({ preventScroll: true });
                }
              }}
            >
              <div className={styles.composeClip}>
                {composeMounted && composer.form}
              </div>
            </div>
          )}
        </div>
        <aside
          className={styles.sourcePane}
          hidden={view === "notice"}
          aria-label="Original og kilder"
        >
          <div className={styles.columnHeading}>
            <span>Original · Newsweb</span>
            <div className={styles.sourceHeadingActions}>
              <AttachmentDownloads
                messageId={item.messageId}
                attachments={source?.attachments ?? item.attachments}
              />
              <a
                href={sourceLinks.primary.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Åpne ↗
              </a>
            </div>
          </div>
          {item.hasAttachments && (
            <div
              className={styles.sourceTabs}
              role="group"
              aria-label="Kildetekst"
            >
              <button
                type="button"
                aria-pressed={sourceMode === "newsweb"}
                onClick={() => setSourceMode("newsweb")}
              >
                Børsmelding
              </button>
              <button
                type="button"
                aria-pressed={sourceMode === "pdf"}
                onClick={() => setSourceMode("pdf")}
              >
                PDF-tekst
              </button>
            </div>
          )}
          {sourceMode === "newsweb" ? (
            <>
              <h2>{source?.title ?? item.sourceTitle}</h2>
              <Dateline item={item} />
              {splitParagraphs(source?.bodyText ?? item.sourceBodyText).map(
                (p, i) => (
                  <p key={i}>{p}</p>
                ),
              )}
              {sourceLinks.related?.length ? (
                <div className={styles.related}>
                  <h3>Relaterte meldinger</h3>
                  {sourceLinks.related.map((link) => (
                    <a
                      key={link.messageId}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {link.title} ↗
                    </a>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <>
              {pdf?.state === "loading" && (
                <p role="status">Henter PDF-tekst …</p>
              )}
              {pdf?.state === "failed" && (
                <p role="alert">
                  Kunne ikke hente PDF-tekst.{" "}
                  <button
                    type="button"
                    onClick={() => setPdfRetry((value) => value + 1)}
                  >
                    Prøv igjen
                  </button>
                </p>
              )}
              {pdf?.state === "ready" &&
                (pdf.text ? (
                  <>
                    {pdf.pages && (
                      <p className={styles.requestStatus}>
                        PDF · {pdf.pages} sider · Lest av modellen
                      </p>
                    )}
                    {splitPdfPages(pdf.text).map((section, i) => (
                      <Fragment key={i}>
                        {section.page !== null && <h3>Side {section.page}</h3>}
                        {section.paragraphs.map((text, j) => (
                          <p key={j}>{text}</p>
                        ))}
                      </Fragment>
                    ))}
                  </>
                ) : (
                  <p>Ingen PDF-tekst lagret for denne versjonen.</p>
                ))}
            </>
          )}
        </aside>
      </div>
      <FeedbackDialog
        item={item}
        open={feedback}
        onClose={() => setFeedback(false)}
      />
    </article>
  );
}

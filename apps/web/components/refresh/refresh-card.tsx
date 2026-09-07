"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FeedItem } from "@newsweb/shared";
import { getNotice, type RewriteVersion } from "../../lib/api";
import { hasRewriteDraft, REWRITE_DRAFT_CHANGE_EVENT } from "../../lib/rewrite-drafts";
import { useEditorialTelemetry } from "../../lib/editorial-telemetry";
import { EditableRewrite } from "../editable-rewrite";
import { AttachmentLinks } from "../attachment-links";
import { GenerateButton } from "../generate-button";
import { InstructionInput } from "../instruction-input";
import { getGenerationPhaseLabel } from "../generation-steps";
import { RefreshEditorActions, type WorkspacePanel } from "./editor-actions";
import { FeedbackDialog } from "./feedback-dialog";
import { fastDraftToFeedItem, type FeedEntry } from "./feed-state";
import { versionToFeedItem } from "./selection";
import styles from "./refresh.module.css";

export function RefreshCard({
  entry,
  onSelect,
  onVersion
}: {
  entry: FeedEntry;
  onSelect: () => void;
  onVersion: (item: FeedItem) => void;
}) {
  const { current: item, latest, pending } = entry;
  const isFast = item.publicationKind === "fast";
  const firstDraft = fastDraftToFeedItem(latest);
  const [panel, setPanel] = useState<WorkspacePanel | null>(null);
  const [opened, setOpened] = useState(false);
  const [versions, setVersions] = useState<RewriteVersion[]>([]);
  const [details, setDetails] = useState<Awaited<ReturnType<typeof getNotice>> | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">("idle");
  const [feedback, setFeedback] = useState(false);
  const [drafts, setDrafts] = useState<Set<string>>(() => new Set());
  const [versionRequest, setVersionRequest] = useState(0);
  const cardRef = useRef<HTMLElement>(null);
  const savedScroll = useRef(0);
  const generationRef = useRef<HTMLDetailsElement>(null);
  const wasOpen = useRef(false);
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

  function openPanel(next: WorkspacePanel) {
    if (!panel) savedScroll.current = window.scrollY;
    setOpened(true);
    setPanel(next);
    if (next === "generate")
      requestAnimationFrame(() => {
        if (generationRef.current) generationRef.current.open = true;
        generationRef.current?.querySelector("textarea")?.focus({ preventScroll: true });
      });
  }
  function closePanel() {
    setPanel(null);
  }
  useEffect(() => {
    if (panel && !wasOpen.current) {
      if (window.innerWidth <= 850 && panel !== "generate")
        cardRef.current?.querySelector("aside")?.scrollIntoView({ block: "start" });
      else window.scrollTo({ top: 0, behavior: "instant" });
    }
    if (!panel && wasOpen.current) {
      window.scrollTo({ top: savedScroll.current, behavior: "instant" });
      cardRef.current
        ?.querySelector<HTMLButtonElement>("[data-source-trigger]")
        ?.focus({ preventScroll: true });
    }
    wasOpen.current = !!panel;
  }, [panel]);
  useEffect(() => {
    if (!panel) return;
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !document.querySelector("dialog[open]") &&
        !(event.target as HTMLElement)?.closest("details[open]")
      )
        closePanel();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [panel]);
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

  const source = details?.source;
  return (
    <article
      ref={cardRef}
      id={`notice-${item.messageId}`}
      className={`${styles.card} ${item.importance === "viktig" ? styles.important : ""} ${panel ? styles.workspace : ""}`}
      aria-label={item.issuerName}
    >
      <div className={styles.editorPane}>
        {panel && (
          <button type="button" className={styles.backToFeed} onClick={closePanel}>
            ← Feed
          </button>
        )}
        <div className={styles.metadata}>
          <span>
            {item.issuerName} <span className={styles.ticker}>{item.issuerSign}</span>
          </span>
          <time
            dateTime={item.publishedAt}
            title={new Date(item.publishedAt).toLocaleString("nb-NO", {
              timeZone: "Europe/Oslo"
            })}
          >
            {new Intl.DateTimeFormat("nb-NO", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Europe/Oslo"
            }).format(new Date(item.publishedAt))}
          </time>
        </div>
        {item.importance === "viktig" && <div className={styles.importance}>Viktig</div>}
        {isFast && <div className={styles.versionLink}>Førsteutkast</div>}
        {item.isFinal && item.rewriteId ? (
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
            sourceLinks={sourceLinks}
            renderActions={(controls) => (
              <RefreshEditorActions
                controls={controls}
                sourcesOpen={!!panel}
                onPanel={openPanel}
                onFeedback={() => setFeedback(true)}
              />
            )}
          />
        ) : (
          <div className={styles.waiting}>
            <h2>{item.sourceTitle || item.title}</h2>
            <div className={styles.waitActions}>
              {!panel && (
                <button type="button" data-source-trigger onClick={() => openPanel("sources")}>
                  Kilder
                </button>
              )}
              {!latest.processing && (
                <GenerateButton
                  messageId={item.messageId}
                  hasAttachments={item.hasAttachments}
                  label={latest.failed ? "Prøv igjen" : "Lag notis"}
                />
              )}
            </div>
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
            <button type="button" onClick={() => openPanel("generate")}>
              Prøv igjen
            </button>
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
        {opened && (
          <details
            ref={generationRef}
            className={styles.generation}
            hidden={!panel}
            open={panel === "generate"}
          >
            <summary>Lag versjon</summary>
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
          </details>
        )}
      </div>
      {opened && (
        <aside className={styles.sourcePane} hidden={!panel} aria-label="Kilder og versjoner">
          <button
            type="button"
            className={styles.mobileBackToEditor}
            onClick={() => cardRef.current?.scrollIntoView({ block: "start" })}
          >
            ↑ Notis
          </button>
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
              aria-selected={panel !== "versions"}
              tabIndex={panel !== "versions" ? 0 : -1}
              aria-controls={`sources-panel-${item.messageId}`}
              onClick={() => setPanel("sources")}
            >
              Kilder
            </button>
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
          <div
            role="tabpanel"
            id={`sources-panel-${item.messageId}`}
            aria-labelledby={`sources-tab-${item.messageId}`}
            hidden={panel === "versions"}
            className={styles.sourceText}
          >
            <div className={styles.sourceHeading}>
              <span>Børsmelding</span>
              <a href={sourceLinks.primary.url} target="_blank" rel="noreferrer">
                Newsweb ↗
              </a>
            </div>
            <h3>{source?.title ?? item.sourceTitle}</h3>
            <p>{source?.bodyText ?? item.sourceBodyText}</p>
            <AttachmentLinks
              messageId={item.messageId}
              attachments={source?.attachments ?? item.attachments}
            />
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

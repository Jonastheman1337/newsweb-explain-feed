"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FeedItem } from "@newsweb/shared";
import { EditableRewrite } from "../editable-rewrite";
import { AttachmentLinks } from "../attachment-links";
import { GenerateButton } from "../generate-button";
import { useFeedStreamSubscription } from "../feed-stream-provider";
import {
  initialFeedState,
  receiveFeedItem,
  revealIncoming,
  selectPending,
  type FeedEntry
} from "./feed-state";
import styles from "./refresh.module.css";

function RefreshCard({ entry, onSelect }: { entry: FeedEntry; onSelect: () => void }) {
  const { current: item, latest, pending } = entry;
  const [sources, setSources] = useState(false);
  const sourceId = `source-${item.messageId}`;
  const sourceToggle = (
    <button
      type="button"
      aria-expanded={sources}
      aria-controls={sourceId}
      onClick={() => setSources(!sources)}
    >
      Kilder
    </button>
  );
  return (
    <article
      className={`${styles.card} ${item.importance === "viktig" ? styles.important : ""}`}
      aria-label={item.issuerName}
    >
      <div className={styles.metadata}>
        <span>
          {item.issuerName} <span className={styles.ticker}>{item.issuerSign}</span>
        </span>
        <time dateTime={item.publishedAt}>
          {new Intl.DateTimeFormat("nb-NO", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Europe/Oslo"
          }).format(new Date(item.publishedAt))}
        </time>
      </div>
      {item.importance === "viktig" && <div className={styles.importance}>Viktig</div>}
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
          sourceLinks={{
            primary: {
              url: `https://newsweb.oslobors.no/message/${item.messageId}`,
              issuerName: item.issuerName,
              issuerSign: item.issuerSign
            }
          }}
        >
          {sourceToggle}
        </EditableRewrite>
      ) : (
        <div className={styles.waiting}>
          <h2>{item.sourceTitle || item.title}</h2>
          <div className={styles.waitActions}>
            {sourceToggle}
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
          Notis lages
        </div>
      )}
      {latest.failed && (
        <div role="status" className={styles.failure}>
          Generering feilet
        </div>
      )}
      {pending && (
        <div className={styles.ready} role="status">
          <span>Ny versjon klar</span>
          <button type="button" onClick={onSelect}>
            Vis versjon
          </button>
        </div>
      )}
      <section id={sourceId} hidden={!sources} className={styles.sources} aria-label="Kilder">
        <h3>{item.sourceTitle}</h3>
        <p>{item.sourceBodyText}</p>
        <AttachmentLinks messageId={item.messageId} attachments={item.attachments} />
        <a
          href={`https://newsweb.oslobors.no/message/${item.messageId}`}
          target="_blank"
          rel="noreferrer"
        >
          Newsweb ↗
        </a>
      </section>
    </article>
  );
}

export function RefreshFeed({
  initialItems,
  mutedCategories,
  filtered
}: {
  initialItems: FeedItem[];
  mutedCategories: string[];
  filtered: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState(() => initialFeedState(initialItems));
  const [importantOnly, setImportantOnly] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isVisible = (item: FeedItem) =>
    !item.categories.some((category) => mutedCategories.includes(category));
  const refresh = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 250);
  };
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    []
  );
  useEffect(() => {
    // Reconnects merge into existing entries; they do not replace focused editors.
    setState((previous) => {
      const next = initialItems.reduce(receiveFeedItem, previous);
      if (!filtered) return next;
      const matchingIds = new Set(initialItems.map((item) => item.messageId));
      return {
        entries: next.entries.filter((entry) => matchingIds.has(entry.current.messageId)),
        incoming: next.incoming.filter((item) => matchingIds.has(item.messageId))
      };
    });
  }, [initialItems, filtered]);
  useFeedStreamSubscription({
    onItem: (item) => {
      if (filtered) {
        refresh();
        return;
      }
      setState((previous) => receiveFeedItem(previous, item));
    },
    onReconnect: refresh
  });
  const entries = state.entries.filter(
    (entry) => isVisible(entry.latest) && (!importantOnly || entry.latest.importance === "viktig")
  );
  const incoming = state.incoming.filter(
    (item) => isVisible(item) && (!importantOnly || item.importance === "viktig")
  );
  return (
    <>
      <div className={styles.viewBar}>
        <div role="group" aria-label="Vis meldinger">
          <button aria-pressed={!importantOnly} onClick={() => setImportantOnly(false)}>
            Alle
          </button>
          <button aria-pressed={importantOnly} onClick={() => setImportantOnly(true)}>
            Viktige
          </button>
        </div>
        <span>{entries.length} meldinger</span>
      </div>
      <div className={styles.arrivals} aria-live="polite">
        {incoming.length > 0 && (
          <button onClick={() => setState(revealIncoming)}>
            {incoming.length} {incoming.length === 1 ? "ny melding" : "nye meldinger"} ↓
          </button>
        )}
      </div>
      <div className={styles.feed}>
        {entries.map((entry) => (
          <RefreshCard
            key={entry.current.messageId}
            entry={entry}
            onSelect={() =>
              setState((previous) => selectPending(previous, entry.current.messageId))
            }
          />
        ))}
      </div>
      {!entries.length && <p className={styles.empty}>Ingen meldinger</p>}
    </>
  );
}

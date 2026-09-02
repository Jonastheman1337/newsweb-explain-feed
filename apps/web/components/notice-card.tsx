"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { FeedItem } from "@newsweb/shared";
import { GenerateButton } from "./generate-button";
import { FeedProcessingIndicator } from "./feed-processing-indicator";
import { EditableRewrite } from "./editable-rewrite";
import { SplitViewPanel } from "./split-view-panel";
import { formatCategoryList } from "../lib/format-category";

function formatOsloTime(isoString: string): string {
  return new Intl.DateTimeFormat("nb-NO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Oslo"
  }).format(new Date(isoString));
}

type NoticeCardProps = {
  item: FeedItem;
};

function importanceLabel(value: FeedItem["importance"]): string {
  if (value === "viktig") {
    return "Viktig";
  }
  if (value === "uviktig") {
    return "Uviktig";
  }
  return "Medium";
}

/**
 * Time | issuer (sign) | category, linking to the Newsweb original. The
 * category is plain text in the same muted line — no chip, no extra row.
 */
function CardDateline({ item }: { item: FeedItem }) {
  const category = formatCategoryList(item.categories);
  return (
    <div className="muted">
      <a href={`https://newsweb.oslobors.no/message/${item.messageId}`} target="_blank" rel="noopener noreferrer">
        {formatOsloTime(item.publishedAt)} | {item.issuerName} ({item.issuerSign})
        {category ? ` | ${category}` : ""}
      </a>
    </div>
  );
}

function MaxAiLink({ messageId }: { messageId: number }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const returnPath = `${pathname}${queryString ? `?${queryString}` : ""}`;

  function rememberFeedPosition() {
    sessionStorage.setItem(
      "feed:return-position",
      JSON.stringify({
        returnPath,
        messageId,
        scrollY: window.scrollY
      })
    );
  }

  return (
    <Link
      href={`/notice/${messageId}?from=${encodeURIComponent(returnPath)}`}
      className="originalLink"
      onClick={rememberFeedPosition}
    >
      Max AI →
    </Link>
  );
}

export function NoticeCard({ item }: NoticeCardProps) {
  const [showSplit, setShowSplit] = useState(false);

  if (item.notGenerated || item.skipped) {
    return (
      <article className="card cardSkipped" id={`notice-${item.messageId}`}>
        <CardDateline item={item} />
        <h2>
          <Link href={`/notice/${item.messageId}`} className="headlineLink">
            {item.title}
          </Link>
        </h2>
        {item.regenerating ? (
          <FeedProcessingIndicator hasAttachments={item.hasAttachments} phase={item.phase} />
        ) : null}
        <div className="editableActions">
          <MaxAiLink messageId={item.messageId} />
          <span className="actionsRight">
            <GenerateButton messageId={item.messageId} hasAttachments={item.hasAttachments} />
          </span>
        </div>
      </article>
    );
  }

  if (item.processing) {
    return (
      <article className="card cardProcessing" id={`notice-${item.messageId}`}>
        <CardDateline item={item} />
        <h2>
          <Link href={`/notice/${item.messageId}`} className="headlineLink">
            {item.title}
          </Link>
        </h2>
        <FeedProcessingIndicator hasAttachments={item.hasAttachments} phase={item.phase} />
        <div className="editableActions">
          <MaxAiLink messageId={item.messageId} />
          <span className="actionsRight">
            <GenerateButton messageId={item.messageId} label="Regenerer notis" hasAttachments={item.hasAttachments} />
          </span>
        </div>
      </article>
    );
  }

  if (item.failed) {
    return (
      <article className="card cardSkipped" id={`notice-${item.messageId}`}>
        <CardDateline item={item} />
        <h2>
          <Link href={`/notice/${item.messageId}`} className="headlineLink">
            {item.title}
          </Link>
        </h2>
        {item.regenerating ? (
          <FeedProcessingIndicator hasAttachments={item.hasAttachments} phase={item.phase} />
        ) : null}
        <div className="editableActions">
          <MaxAiLink messageId={item.messageId} />
          <span className="actionsRight">
            <GenerateButton messageId={item.messageId} label="Prøv igjen" hasAttachments={item.hasAttachments} />
            <GenerateButton
              messageId={item.messageId}
              label="Prøv xhigh"
              hasAttachments={item.hasAttachments}
              reasoningEffortOverride="xhigh"
            />
          </span>
        </div>
      </article>
    );
  }

  const articleBody = [item.lead, ...item.body].filter(Boolean).join("\n\n");
  const isImportant = item.importance === "viktig";
  const cardClassName = isImportant && !showSplit ? "card cardImportant" : "card";

  function handleToggleSplit() {
    setShowSplit((prev) => !prev);
    // Trigger resize so EditableRewrite textarea recalculates height
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }

  return (
    <article className={cardClassName} id={`notice-${item.messageId}`}>
      <div className={showSplit ? "cardSplitGrid" : undefined}>
        <div>
          <EditableRewrite
            key={item.rewriteId ?? `source-${item.messageId}`}
            messageId={item.messageId}
            originalTitle={item.title}
            originalBody={articleBody}
            activeVersion={item.rewriteVersion ?? undefined}
            rewriteId={item.rewriteId ?? undefined}
            publicationRevision={item.publicationRevision}
            contentHash={item.contentHash ?? undefined}
            isFinal={item.isFinal}
            className={showSplit && isImportant ? "cardImportantCol" : undefined}
            dateline={<CardDateline item={item} />}
            extraActions={
              <button
                className={`splitButton${showSplit ? " splitButtonActive" : ""}`}
                onClick={handleToggleSplit}
              >
                Splitt <svg className="copyIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
              </button>
            }
          >
            <MaxAiLink messageId={item.messageId} />
          </EditableRewrite>
          {item.regenerating && (
            <div className="feedRegenerationStatus">
              <FeedProcessingIndicator
                hasAttachments={item.hasAttachments}
                phase={item.phase}
              />
            </div>
          )}
        </div>
        {showSplit && (
          <div className="cardSourcePanel">
            <SplitViewPanel
              messageId={item.messageId}
              issuerName={item.issuerName}
              issuerSign={item.issuerSign}
              publishedAt={item.publishedAt}
              categories={item.categories}
              sourceTitle={item.sourceTitle}
              sourceBodyText={item.sourceBodyText}
              attachments={item.attachments}
            />
          </div>
        )}
      </div>
    </article>
  );
}

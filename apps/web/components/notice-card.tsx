"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { FeedItem } from "@newsweb/shared";
import { GenerateButton } from "./generate-button";
import { FeedProcessingIndicator } from "./feed-processing-indicator";
import { EditableRewrite } from "./editable-rewrite";
import { SplitViewPanel } from "./split-view-panel";

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

  if (item.notGenerated) {
    return (
      <article className="card" id={`notice-${item.messageId}`}>
        <div className="muted">
          <a href={`https://newsweb.oslobors.no/message/${item.messageId}`} target="_blank" rel="noopener noreferrer">
            {formatOsloTime(item.publishedAt)} | {item.issuerName} ({item.issuerSign})
          </a>
        </div>
        <h2>
          <Link href={`/notice/${item.messageId}`} className="headlineLink">
            {item.title}
          </Link>
        </h2>
        <p className="muted">Ikke generert enda</p>
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
        <div className="muted">
          <a href={`https://newsweb.oslobors.no/message/${item.messageId}`} target="_blank" rel="noopener noreferrer">
            {formatOsloTime(item.publishedAt)} | {item.issuerName} ({item.issuerSign})
          </a>
        </div>
        <h2>
          <Link href={`/notice/${item.messageId}`} className="headlineLink">
            {item.title}
          </Link>
        </h2>
        <FeedProcessingIndicator messageId={item.messageId} />
        <div className="editableActions">
          <MaxAiLink messageId={item.messageId} />
          <span className="actionsRight">
            <GenerateButton messageId={item.messageId} label="Regenerer notis" hasAttachments={item.hasAttachments} />
          </span>
        </div>
      </article>
    );
  }

  if (item.skipped) {
    return (
      <article className="card cardSkipped" id={`notice-${item.messageId}`}>
        <div className="muted">
          <a href={`https://newsweb.oslobors.no/message/${item.messageId}`} target="_blank" rel="noopener noreferrer">
            {formatOsloTime(item.publishedAt)} | {item.issuerName} ({item.issuerSign})
          </a>
        </div>
        <h2>
          <Link href={`/notice/${item.messageId}`} className="headlineLink">
            {item.title}
          </Link>
        </h2>
        <div className="editableActions">
          <MaxAiLink messageId={item.messageId} />
          <span className="actionsRight">
            <GenerateButton messageId={item.messageId} hasAttachments={item.hasAttachments} />
          </span>
        </div>
      </article>
    );
  }

  if (item.failed) {
    return (
      <article className="card cardSkipped" id={`notice-${item.messageId}`}>
        <div className="muted">
          <a href={`https://newsweb.oslobors.no/message/${item.messageId}`} target="_blank" rel="noopener noreferrer">
            {formatOsloTime(item.publishedAt)} | {item.issuerName} ({item.issuerSign})
          </a>
        </div>
        <h2>
          <Link href={`/notice/${item.messageId}`} className="headlineLink">
            {item.title}
          </Link>
        </h2>
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
            messageId={item.messageId}
            originalTitle={item.title}
            originalBody={articleBody}
            className={showSplit && isImportant ? "cardImportantCol" : undefined}
            dateline={
              <div className="muted">
                <a href={`https://newsweb.oslobors.no/message/${item.messageId}`} target="_blank" rel="noopener noreferrer">
                  {formatOsloTime(item.publishedAt)} | {item.issuerName} ({item.issuerSign})
                </a>
              </div>
            }
            extraActions={
              <button
                className={`splitButton${showSplit ? " splitButtonActive" : ""}`}
                onClick={handleToggleSplit}
              >
                Split <svg className="copyIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
              </button>
            }
          >
            <MaxAiLink messageId={item.messageId} />
          </EditableRewrite>
        </div>
        {showSplit && (
          <div className="cardSourcePanel">
            <SplitViewPanel
              messageId={item.messageId}
              issuerName={item.issuerName}
              issuerSign={item.issuerSign}
              publishedAt={item.publishedAt}
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

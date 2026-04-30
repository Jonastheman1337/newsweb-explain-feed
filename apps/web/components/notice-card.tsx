"use client";

import { useState } from "react";
import Link from "next/link";
import type { FeedItem } from "@newsweb/shared";
import { GenerateButton } from "./generate-button";
import { ProcessingIndicator } from "./processing-indicator";
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

export function NoticeCard({ item }: NoticeCardProps) {
  const [showSplit, setShowSplit] = useState(false);

  if (item.processing) {
    return (
      <article className="card cardProcessing">
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
        <GenerateButton messageId={item.messageId} label="Regenerer notis" hasAttachments={item.hasAttachments} />
      </article>
    );
  }

  if (item.skipped) {
    return (
      <article className="card cardSkipped">
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
        <GenerateButton messageId={item.messageId} hasAttachments={item.hasAttachments} />
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
    <article className={cardClassName}>
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
            <Link href={`/notice/${item.messageId}`} className="originalLink">
              Max AI →
            </Link>
          </EditableRewrite>
        </div>
        {showSplit && (
          <div className="cardSourcePanel">
            <SplitViewPanel
              sourceTitle={item.sourceTitle}
              sourceBodyText={item.sourceBodyText}
            />
          </div>
        )}
      </div>
    </article>
  );
}

"use client";

import { useEffect, type ReactNode } from "react";
import {
  useEditorialTelemetry,
  type PublicationTelemetryIdentity
} from "../lib/editorial-telemetry";

type NoticeTelemetryProps = {
  messageId: number;
  activeVersion?: number;
  publication?: PublicationTelemetryIdentity;
  state: "processing" | "skipped" | "failed" | "published";
};

export function NoticeTelemetry({
  messageId,
  activeVersion,
  publication,
  state
}: NoticeTelemetryProps) {
  const { logEvent } = useEditorialTelemetry(
    messageId,
    publication ?? activeVersion
  );

  useEffect(() => {
    void logEvent({
      action: "notice_view",
      actionSource: "notice_page",
      payload: { state }
    }).catch(() => { /* passive telemetry must not affect reading */ });
  }, [logEvent, state]);

  return null;
}

type SourceLinkProps = {
  messageId: number;
  activeVersion?: number;
  publication?: PublicationTelemetryIdentity;
  href: string;
  className?: string;
  children: ReactNode;
};

export function SourceLink({
  messageId,
  activeVersion,
  publication,
  href,
  className,
  children
}: SourceLinkProps) {
  const { logEvent } = useEditorialTelemetry(
    messageId,
    publication ?? activeVersion
  );

  function handleClick() {
    void logEvent({
      action: "source_link_open",
      actionSource: "notice_page",
      payload: { href }
    }).catch(() => { /* keep navigation instant */ });
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}

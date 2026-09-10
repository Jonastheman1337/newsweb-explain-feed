"use client";

import { useEffect, useRef } from "react";
import type { FeedItem } from "@newsweb/shared";
import { AttachmentLinks } from "../attachment-links";
import { AttachmentIcon } from "./next-icons";
import styles from "./next-editor.module.css";

export function AttachmentDownloads({ messageId, attachments }: {
  messageId: number;
  attachments: FeedItem["attachments"];
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && menu.current?.open && !menu.current.contains(event.target)) {
        menu.current.open = false;
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  if (!attachments.length) return null;
  return (
    <details ref={menu} className={styles.attachmentDownloads}
      onKeyDown={(event) => {
        if (event.key === "Escape" && menu.current?.open) {
          event.stopPropagation();
          menu.current.open = false;
          menu.current.querySelector("summary")?.focus();
        }
      }}>
      <summary><AttachmentIcon />Vedlegg ({attachments.length})</summary>
      <div className={styles.attachmentDownloadList}>
        <AttachmentLinks messageId={messageId} attachments={attachments} />
      </div>
    </details>
  );
}

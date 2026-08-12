"use client";

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent
} from "react";

type Attachment = {
  id: number;
  fileName: string;
  fileType: string | null;
  fileSize: number | null;
};

type AttachmentLinksProps = {
  messageId: number;
  attachments: Attachment[];
};

const ERROR_RESET_MS = 4000;
// Above this size the anchor navigates natively instead of buffering a Blob.
const MAX_BLOB_DOWNLOAD_BYTES = 50 * 1024 * 1024;

function formatFileSize(fileSize: number | null): string | null {
  if (fileSize == null) {
    return null;
  }

  if (fileSize < 1024) {
    return `${fileSize} B`;
  }

  const units = ["KB", "MB", "GB"];
  let size = fileSize / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export function AttachmentLinks({
  messageId,
  attachments
}: AttachmentLinksProps) {
  const [errors, setErrors] = useState<Record<number, string>>({});
  const busyRef = useRef<Set<number>>(new Set());
  const errorTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timers = errorTimersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  function showError(attachmentId: number, message: string) {
    setErrors((prev) => ({ ...prev, [attachmentId]: message }));
    const existing = errorTimersRef.current.get(attachmentId);
    if (existing) {
      clearTimeout(existing);
    }
    errorTimersRef.current.set(
      attachmentId,
      setTimeout(() => {
        errorTimersRef.current.delete(attachmentId);
        setErrors((prev) => {
          const next = { ...prev };
          delete next[attachmentId];
          return next;
        });
      }, ERROR_RESET_MS)
    );
  }

  async function handleDownload(
    event: ReactMouseEvent<HTMLAnchorElement>,
    attachment: Attachment
  ) {
    if (attachment.fileSize != null && attachment.fileSize > MAX_BLOB_DOWNLOAD_BYTES) {
      return;
    }
    event.preventDefault();
    if (busyRef.current.has(attachment.id)) {
      return;
    }
    busyRef.current.add(attachment.id);

    try {
      const response = await fetch(
        `/api/notice/${messageId}/attachments/${attachment.id}`,
        { credentials: "include" }
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { message?: string }
          | null;
        showError(attachment.id, body?.message ?? "Kunne ikke laste ned vedlegg.");
        return;
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = attachment.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      showError(attachment.id, "Kunne ikke laste ned vedlegg.");
    } finally {
      busyRef.current.delete(attachment.id);
    }
  }

  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="attachmentLinks">
      <p className="attachmentLinksTitle">Vedlegg</p>
      <ul>
        {attachments.map((attachment) => {
          const fileSize = formatFileSize(attachment.fileSize);
          const error = errors[attachment.id];
          const meta = error ?? fileSize;
          return (
            <li key={attachment.id}>
              <a
                href={`/api/notice/${messageId}/attachments/${attachment.id}`}
                download={attachment.fileName}
                className="attachmentLink"
                onClick={(event) => {
                  void handleDownload(event, attachment);
                }}
              >
                <span className="attachmentFileName">{attachment.fileName}</span>
                {meta ? <span className="attachmentMeta">{meta}</span> : null}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

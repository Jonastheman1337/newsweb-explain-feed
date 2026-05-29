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
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="attachmentLinks">
      <p className="attachmentLinksTitle">Vedlegg</p>
      <ul>
        {attachments.map((attachment) => {
          const fileSize = formatFileSize(attachment.fileSize);
          return (
            <li key={attachment.id}>
              <a
                href={`/api/notice/${messageId}/attachments/${attachment.id}`}
                download={attachment.fileName}
                className="attachmentLink"
              >
                <span className="attachmentFileName">{attachment.fileName}</span>
                {fileSize ? (
                  <span className="attachmentMeta">{fileSize}</span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

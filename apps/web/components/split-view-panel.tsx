import { SourceBodyText } from "./source-body-text";
import { AttachmentLinks } from "./attachment-links";

type Attachment = {
  id: number;
  fileName: string;
  fileType: string | null;
  fileSize: number | null;
};

type SplitViewPanelProps = {
  messageId: number;
  issuerName: string;
  issuerSign: string;
  publishedAt: string;
  sourceTitle: string;
  sourceBodyText: string;
  attachments: Attachment[];
};

function formatOsloTime(isoString: string): string {
  return new Intl.DateTimeFormat("nb-NO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Oslo"
  }).format(new Date(isoString));
}

export function SplitViewPanel({
  messageId,
  issuerName,
  issuerSign,
  publishedAt,
  sourceTitle,
  sourceBodyText,
  attachments
}: SplitViewPanelProps) {
  return (
    <div>
      <h3>{sourceTitle}</h3>
      <p className="muted">
        <a href={`https://newsweb.oslobors.no/message/${messageId}`} target="_blank" rel="noopener noreferrer">
          {issuerName} ({issuerSign}) | {formatOsloTime(publishedAt)}
        </a>
      </p>
      <SourceBodyText text={sourceBodyText} />
      <AttachmentLinks messageId={messageId} attachments={attachments} />
    </div>
  );
}

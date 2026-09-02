import { SourceBodyText } from "./source-body-text";
import { AttachmentLinks } from "./attachment-links";
import { formatCategoryList } from "../lib/format-category";

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
  categories?: string[];
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
  categories,
  sourceTitle,
  sourceBodyText,
  attachments
}: SplitViewPanelProps) {
  const category = formatCategoryList(categories);
  return (
    <div>
      <h3>{sourceTitle}</h3>
      <p className="muted">
        <a href={`https://newsweb.oslobors.no/message/${messageId}`} target="_blank" rel="noopener noreferrer">
          {issuerName} ({issuerSign}) | {formatOsloTime(publishedAt)}
          {category ? ` | ${category}` : ""}
        </a>
      </p>
      <SourceBodyText text={sourceBodyText} />
      <AttachmentLinks messageId={messageId} attachments={attachments} />
    </div>
  );
}

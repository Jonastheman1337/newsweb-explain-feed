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
  sourceTitle: string;
  sourceBodyText: string;
  attachments: Attachment[];
};

export function SplitViewPanel({
  messageId,
  sourceTitle,
  sourceBodyText,
  attachments
}: SplitViewPanelProps) {
  return (
    <div>
      <h3>{sourceTitle}</h3>
      <SourceBodyText text={sourceBodyText} />
      <AttachmentLinks messageId={messageId} attachments={attachments} />
    </div>
  );
}

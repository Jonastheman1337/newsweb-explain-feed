import { SourceBodyText } from "./source-body-text";

type SplitViewPanelProps = {
  sourceTitle: string;
  sourceBodyText: string;
};

export function SplitViewPanel({ sourceTitle, sourceBodyText }: SplitViewPanelProps) {
  return (
    <div>
      <h3>{sourceTitle}</h3>
      <SourceBodyText text={sourceBodyText} />
    </div>
  );
}

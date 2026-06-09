type SourceBodyTextProps = {
  text: string;
};

export function SourceBodyText({ text }: SourceBodyTextProps) {
  const sourceText = text ? text.replace(/\r\n?/g, "\n") : "Ingen tekst i kilden.";

  return <div className="sourceBody">{sourceText}</div>;
}

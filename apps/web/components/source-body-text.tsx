type SourceBodyTextProps = {
  text: string;
};

function isStructuredLine(line: string): boolean {
  return /^[+|]/.test(line) || /^-{3,}/.test(line) || /^\s{4,}\S/.test(line);
}

function splitBlocks(text: string): Array<{ type: "prose" | "pre"; content: string }> {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: Array<{ type: "prose" | "pre"; content: string }> = [];
  let current: string[] = [];
  let currentType: "prose" | "pre" = "prose";

  for (const line of lines) {
    const structured = isStructuredLine(line);
    const lineType = structured ? "pre" : "prose";

    if (lineType !== currentType && current.length > 0) {
      blocks.push({ type: currentType, content: current.join("\n") });
      current = [];
    }
    currentType = lineType;
    current.push(line);
  }
  if (current.length > 0) {
    blocks.push({ type: currentType, content: current.join("\n") });
  }

  return blocks;
}

function isHeadingLine(line: string, nextLine: string | undefined): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 60) return false;
  if (!nextLine || !nextLine.trim()) return false;
  // Short line that doesn't end with comma, period-continuation, or typical mid-sentence chars
  if (/[,;:\-]$/.test(trimmed)) return false;
  // Next line is substantially longer — looks like body text following a heading
  if (nextLine.trim().length > trimmed.length) return true;
  return false;
}

function reflowProse(text: string): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const result: string[] = [];

  for (const para of paragraphs) {
    const lines = para.split("\n");
    let buf: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const next = lines[i + 1];

      buf.push(line);

      if (isHeadingLine(line, next)) {
        result.push(buf.join(" ").replace(/ {2,}/g, " ").trim());
        buf = [];
      }
    }

    if (buf.length > 0) {
      const joined = buf.join(" ").replace(/ {2,}/g, " ").trim();
      if (joined) result.push(joined);
    }
  }

  return result;
}

export function SourceBodyText({ text }: SourceBodyTextProps) {
  if (!text) {
    return <div className="sourceBodyReflow">Ingen tekst i kilden.</div>;
  }

  const blocks = splitBlocks(text);

  return (
    <div className="sourceBodyReflow">
      {blocks.map((block, i) =>
        block.type === "pre" ? (
          <pre key={i} className="sourceBodyPre">{block.content}</pre>
        ) : (
          reflowProse(block.content).map((para, j) => (
            <p key={`${i}-${j}`}>{para}</p>
          ))
        )
      )}
    </div>
  );
}

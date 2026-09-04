"use client";

import type { SakVersion } from "@newsweb/shared";
import { formatOsloClock } from "../lib/sak-format";

type SakLogProps = {
  versions: SakVersion[];
  activeVersionId: string | null;
  onSelect: (version: SakVersion) => void;
};

function noteFor(version: SakVersion): string {
  switch (version.status) {
    case "failed":
      return version.errorText ?? "Feilet";
    case "needs_retry":
      return "Prøver igjen";
    case "pending":
      return "";
    default:
      return version.changeNote ?? "";
  }
}

export function SakLog({ versions, activeVersionId, onSelect }: SakLogProps) {
  if (!versions.length) return null;

  return (
    <ul className="sakLog">
      {versions.map((version) => {
        const instruction = version.userInstruction?.trim();
        const note = noteFor(version);
        return (
          <li
            key={version.id}
            className={`sakLogItem${version.id === activeVersionId ? " active" : ""}`}
          >
            <button type="button" className="sakLogButton" onClick={() => onSelect(version)}>
              <span className="sakLogVersion">v{version.version}</span>
              <span className="sakLogInstruction">
                {instruction || (version.version === 1 ? "Første utkast" : "Ny versjon")}
              </span>
              {note && (
                <span className={`sakLogNote${version.status === "failed" ? " materialError" : ""}`}>
                  {note}
                </span>
              )}
              <span className="muted sakLogTime">
                {formatOsloClock(version.generatedAt ?? version.requestedAt)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

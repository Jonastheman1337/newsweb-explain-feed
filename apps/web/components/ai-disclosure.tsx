import {
  AI_DISCLOSURE_LINK_HREF,
  AI_DISCLOSURE_LINK_TEXT,
  AI_DISCLOSURE_TEXT
} from "../lib/ai-disclosure";

/** Fixed, non-editable footer shown under every generated notice body. */
export function AiDisclosure() {
  return (
    <p className="aiDisclosure">
      {AI_DISCLOSURE_TEXT}
      <a href={AI_DISCLOSURE_LINK_HREF} target="_blank" rel="noopener noreferrer">
        {AI_DISCLOSURE_LINK_TEXT}
      </a>
      .
    </p>
  );
}

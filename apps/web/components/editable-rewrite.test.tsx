import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AI_DISCLOSURE_TEXT } from "../lib/ai-disclosure";
import { EditableRewrite } from "./editable-rewrite";

describe("EditableRewrite", () => {
  it("does not render the AI disclosure in the notice UI", () => {
    vi.stubGlobal("React", React);
    const markup = renderToStaticMarkup(
      <EditableRewrite
        messageId={123}
        originalTitle="Tittel"
        originalBody="Brødtekst"
      />
    );

    expect(markup).toContain('title="Kopier tekst"');
    expect(markup).not.toContain(AI_DISCLOSURE_TEXT.trim());
  });
});

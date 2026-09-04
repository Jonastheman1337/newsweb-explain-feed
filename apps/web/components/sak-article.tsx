"use client";

import {
  sakArticleToHtml,
  sakMaterialSourceId,
  type SakArticle as SakArticleData,
  type SakHrefResolver,
  type SakMaterial,
  type SakVersion
} from "@newsweb/shared";
import { useMemo } from "react";
import { richHtmlToPlainText, sanitizeRichHtml } from "../lib/rich-text";
import { extractSakBlockingMessages } from "../lib/sak-format";
import { EditableRewrite } from "./editable-rewrite";
import { SakLinkList } from "./sak-link-list";

type SakArticleProps = {
  draftId: string;
  version: SakVersion;
  article: SakArticleData;
  materials: SakMaterial[];
};

export function createSakHrefResolver(materials: SakMaterial[]): SakHrefResolver {
  const urlsBySourceId = new Map(
    materials.map((material) => [sakMaterialSourceId(material.id), material.url] as const)
  );
  return (materialId) => urlsBySourceId.get(materialId) ?? null;
}

export function SakArticle({ draftId, version, article, materials }: SakArticleProps) {
  // bodyHtml/body are strings, so a materials reload that yields the same
  // markup does not reset the editor (EditableRewrite keys off the values).
  const resolveHref = useMemo(() => createSakHrefResolver(materials), [materials]);
  const bodyHtml = useMemo(
    () => sanitizeRichHtml(sakArticleToHtml(article, resolveHref)),
    [article, resolveHref]
  );
  const body = useMemo(() => richHtmlToPlainText(bodyHtml), [bodyHtml]);
  const blockingMessages =
    version.status === "needs_review" ? extractSakBlockingMessages(version.validation) : [];

  return (
    <>
      <EditableRewrite
        key={version.id}
        variant="sak"
        messageId={draftId}
        originalTitle={article.title}
        originalBody={body}
        originalBodyHtml={bodyHtml}
        activeVersion={version.version}
        rewriteId={version.id}
        panelTitle="Utkast"
      />
      {version.status === "needs_review" && (
        <p className="muted sakReviewLine">
          Trenger gjennomsyn
          {blockingMessages.length ? `: ${blockingMessages.join(" · ")}` : ""}
        </p>
      )}
      <SakLinkList article={article} resolveHref={resolveHref} />
    </>
  );
}

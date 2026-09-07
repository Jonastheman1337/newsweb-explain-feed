"use client";

import type { SakArticle as ArticleData, SakMaterial, SakVersion } from "@newsweb/shared";
import { countSakVisibleChars, sakArticleToHtml, sakBlockPlainText, sakMaterialSourceId, type SakHrefResolver } from "@newsweb/shared";
import { useCallback, useMemo, useRef, useState } from "react";
import { richHtmlToPlainText, sanitizeRichHtml } from "../lib/rich-text";
import { EditableRewrite } from "./editable-rewrite";
import { SakDeskNotes } from "./sak-desk-notes";

type Props = {
  draftId: string; version: SakVersion; article: ArticleData; materials: SakMaterial[]; readOnly?: boolean;
  onDraftChange: (value: { versionId: string; title: string; bodyHtml: string }) => void;
};
export function createSakHrefResolver(materials: Pick<SakMaterial, "id" | "url">[]): SakHrefResolver {
  const urls = new Map(materials.map((material) => [sakMaterialSourceId(material.id), material.url] as const));
  return (id) => urls.get(id) ?? null;
}
type Issue = { code: string; severity: string; message: string; location?: string; passage?: string };
export function SakArticle({ draftId, version, article, materials, readOnly, onDraftChange }: Props) {
  const resolveHref = useMemo(() => createSakHrefResolver(materials), [materials]);
  const bodyHtml = useMemo(() => sanitizeRichHtml(sakArticleToHtml(article, resolveHref)), [article, resolveHref]);
  const body = useMemo(() => richHtmlToPlainText(bodyHtml), [bodyHtml]);
  const [edited, setEdited] = useState(false);
  const [chars, setChars] = useState(countSakVisibleChars(article));
  const container = useRef<HTMLDivElement>(null);
  const handleDraft = useCallback((value: { title: string; body: string; bodyHtml: string }) => {
    setEdited(value.title !== article.title || value.bodyHtml !== bodyHtml);
    setChars(value.body.length);
    onDraftChange({ versionId: version.id, title: value.title, bodyHtml: value.bodyHtml });
  }, [article.title, bodyHtml, onDraftChange, version.id]);
  const validation = version.validation as { issues?: Issue[]; checks?: { references?: unknown; editorial?: unknown }; lengthBand?: { min: number; max: number } } | null;
  const issues = (Array.isArray(validation?.issues) ? validation.issues : []).filter((item) => item && typeof item.message === "string");
  const checked = Boolean(validation?.checks?.references && validation.checks.editorial);
  const band = validation?.lengthBand;
  function focusPassage(issue: Issue) {
    const editor = container.current?.querySelector<HTMLElement>(issue.location === "title" ? ".editableTitle" : ".editableBody");
    if (!editor) return;
    editor.focus();
    const index = issue.location === "lead" ? 0 : issue.location?.startsWith("block:") ? Number(issue.location.slice(6)) + 1 : null;
    const target = index == null ? editor : editor.children[index] ?? editor;
    const selection = window.getSelection();
    const range = document.createRange(); range.selectNodeContents(target); selection?.removeAllRanges(); selection?.addRange(range);
    target.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  return <div className="sakArticleWithReview" ref={container}>
    <div className="sakArticleMeta"><span>Versjon {version.version}</span><span>{chars.toLocaleString("nb-NO")} tegn{band ? ` · mål ${band.min.toLocaleString("nb-NO")}–${band.max.toLocaleString("nb-NO")}` : ""}</span></div>
    <EditableRewrite key={version.id} variant="sak" messageId={draftId} originalTitle={article.title} originalBody={body} originalBodyHtml={bodyHtml}
      activeVersion={version.version} rewriteId={version.id} readOnly={readOnly} onDraftChange={handleDraft} panelTitle="Utkast" />
    <p className="sakHelp">Klikk i teksten for å redigere. Endringer lagres i denne nettleseren og følger med til neste versjon.</p>
    <section className="sakChecks" aria-label="Redaksjonell kontroll">
      <div className="sakPanelHeading"><h3>Redaksjonell kontroll</h3><span className={`sakBadge${version.status === "needs_review" ? " sakBadgeWarning" : ""}`}>{edited ? "Endret etter kontroll" : version.status === "needs_review" ? "Trenger gjennomsyn" : checked ? "Kontrollert" : "Eldre kontroll"}</span></div>
      {edited && <p className="sakHelp">Merknadene gjelder den genererte teksten. Lag en ny versjon for å kontrollere rettelsene dine.</p>}
      {issues.length > 0 ? <ul className="sakIssueList">{issues.map((issue, index) => <li key={`${issue.code}:${index}`} className={issue.severity === "blocking" ? "sakIssueBlocking" : ""}>
        <strong>{issue.severity === "blocking" ? "Må gjennomgås" : "Merk"}</strong><p>{issue.message}</p>
        {issue.passage && <blockquote>{sakBlockPlainText(issue.passage)}</blockquote>}
        {issue.location && issue.location !== "article" && !edited && <button type="button" className="sakSecondaryButton" onClick={() => focusPassage(issue)}>Vis i teksten</button>}
      </li>)}</ul> : <p className="sakHelp">{checked ? "Ingen åpne funn fra kilde- og redaksjonskontrollen." : "Denne versjonen ble laget før den utvidede kildekontrollen."}</p>}
      <SakDeskNotes article={article} materials={materials} />
    </section>
  </div>;
}

"use client";

import { sakBlockPlainText, type SakDraftResponse, type SakMaterial, type SakMaterialSnapshot, type SakVersion } from "@newsweb/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSak, SakApiError } from "../lib/sak-client";
import { sakArticleChanges, sakEditedArticleFromHtml } from "../lib/sak-editor";
import { sakVersionHasArticle, sortSakVersions } from "../lib/sak-format";
import { SakArticle } from "./sak-article";
import { SakInstructionInput } from "./sak-instruction-input";
import { SakLog } from "./sak-log";
import { SakSources } from "./sak-sources";

export function SakDraft({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<SakDraftResponse | null>(null);
  const [materials, setMaterials] = useState<SakMaterial[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [compare, setCompare] = useState(false);
  const [compareId, setCompareId] = useState("");
  const edited = useRef<{ versionId: string; title: string; bodyHtml: string } | null>(null);
  const load = useCallback(async (selectVersion?: number) => {
    try {
      const next = await getSak(id);
      const versions = sortSakVersions(next.versions);
      setData(next); setMaterials(next.materials); setError(null);
      setActiveVersionId((current) => versions.find((version) => version.version === selectVersion)?.id
        ?? (current && versions.some((version) => version.id === current) ? current : versions.filter(sakVersionHasArticle).at(-1)?.id ?? versions.at(-1)?.id ?? null));
    } catch (error) {
      if (error instanceof SakApiError && error.status === 404) { router.replace("/sak?gone=1"); return; }
      setError(error instanceof Error ? error.message : "Kunne ikke laste saken.");
    }
  }, [id, router]);
  useEffect(() => { void load(); }, [load]);
  const reload = useCallback(() => { void load(); }, [load]);
  const ready = useCallback((version: number) => { setCompare(false); void load(version); }, [load]);
  const onDraftChange = useCallback((value: { versionId: string; title: string; bodyHtml: string }) => { edited.current = value; }, []);
  const versions = sortSakVersions(data?.versions ?? []);
  const activeVersion = versions.find((version) => version.id === activeVersionId) ?? null;
  // Historical links and checks use the sources captured for that version,
  // including sources whose text/URL has subsequently been updated.
  const snapshots = (activeVersion?.validation as { sourceMaterials?: SakMaterialSnapshot[] } | null)?.sourceMaterials;
  const articleMaterials = Array.isArray(snapshots) ? [
    ...snapshots.map((snapshot) => ({ id: snapshot.id, sakId: id, title: snapshot.title, url: snapshot.url, kind: snapshot.kind, status: snapshot.status, extractedTextChars: snapshot.textChars, extractedText: snapshot.text, publisher: snapshot.publisher, enabled: true, errorText: snapshot.errorText, fileName: null, fileSize: null, metadata: null, createdAt: activeVersion!.requestedAt })),
    ...materials.filter((material) => !snapshots.some((snapshot) => snapshot.id === material.id))
  ] : materials;
  function getRevisionCopy() {
    if (!activeVersion?.article) return null;
    const snapshot = edited.current;
    return { baseVersionId: activeVersion.id, editedArticle: snapshot?.versionId === activeVersion.id
      ? sakEditedArticleFromHtml(snapshot.title, snapshot.bodyHtml, articleMaterials)
      : { title: activeVersion.article.title, lead: activeVersion.article.lead, blocks: activeVersion.article.blocks } };
  }
  const completed = versions.filter(sakVersionHasArticle);
  const baseVersionId = (activeVersion?.validation as { baseVersionId?: string } | null)?.baseVersionId;
  const compareVersion = completed.find((version) => version.id === compareId && version.id !== activeVersionId)
    ?? completed.find((version) => version.id === baseVersionId && version.id !== activeVersionId)
    ?? completed.filter((version) => version.id !== activeVersionId).at(-1);
  const busy = generationBusy || Boolean(data?.activeGeneration);
  return <section className="sakPage sakWorkspace">
    <header className="sakWorkspaceHeader"><div><Link href="/sak" className="sakBackLink">← Saker</Link><h1>Skriv en sak</h1></div><span className="sakHelp">Kilder → utkast → redigering</span></header>
    {error && <div role="alert" className="sakError">{error} <button type="button" className="sakSecondaryButton" onClick={reload}>Prøv igjen</button></div>}
    {!data ? <p className="sakHelp" role="status">{error ? "Saken kunne ikke lastes." : "Laster arbeidsområdet …"}</p> : <div className="sakWorkspaceGrid">
      <SakSources draftId={id} materials={materials} setMaterials={setMaterials} coverage={data.coverage} disabled={busy} onBusyChange={setSourceBusy} onChange={reload} />
      <div className="sakWritingPanel">
        <SakInstructionInput draftId={id} materials={materials} activeVersion={activeVersion} activeGeneration={data.activeGeneration}
          initialTitleOverride={data.draft.titleOverride} initialTargetChars={data.draft.targetChars} sourceBusy={sourceBusy}
          getRevisionCopy={getRevisionCopy} onReady={ready} onChange={reload} onBusyChange={setGenerationBusy} />
        {versions.length > 0 && <div className="sakVersionBar">
          <label>Versjon <select aria-label="Velg versjon" value={activeVersionId ?? ""} disabled={busy} onChange={(event) => setActiveVersionId(event.target.value)}>
            {versions.map((version) => <option key={version.id} value={version.id}>Versjon {version.version}{version.status === "pending" || version.status === "needs_retry" ? " · genereres" : version.status === "failed" ? " · feilet" : version.status === "needs_review" ? " · gjennomsyn" : ""}</option>)}
          </select></label>
          {completed.length > 1 && <button type="button" className="sakSecondaryButton" aria-pressed={compare} onClick={() => setCompare(!compare)}>{compare ? "Skjul sammenligning" : "Sammenlign versjoner"}</button>}
        </div>}
        {compare && activeVersion?.article && compareVersion?.article && <section className="sakComparison" aria-label="Sammenlign versjoner">
          <div className="sakPanelHeading"><h2>Hva er endret?</h2><label>Fra <select aria-label="Sammenlign med versjon" value={compareVersion.id} onChange={(event) => setCompareId(event.target.value)}>
            {completed.filter((version) => version.id !== activeVersionId).map((version) => <option key={version.id} value={version.id}>Versjon {version.version}</option>)}
          </select></label></div>
          <p className="sakHelp">Generert versjon {compareVersion.version} → {activeVersion.version}. Endringer som bare er lagret lokalt, vises i redigeringsfeltet.</p>
          <div className="sakDiff">{sakArticleChanges(compareVersion.article, activeVersion.article).filter((change) => change.kind !== "same").map((change, index) => <p key={index} className={`sakDiff-${change.kind}`}><span>{change.kind === "added" ? "Lagt til" : "Fjernet"}</span>{sakBlockPlainText(change.text)}</p>)}</div>
          <button type="button" className="sakSecondaryButton" disabled={busy} onClick={() => { setActiveVersionId(compareVersion.id); setCompare(false); }}>Jobb videre fra versjon {compareVersion.version}</button>
        </section>}
        {activeVersion && sakVersionHasArticle(activeVersion) ? <SakArticle key={activeVersion.id} draftId={id} version={activeVersion} article={activeVersion.article} materials={articleMaterials} readOnly={busy} onDraftChange={onDraftChange} />
          : activeVersion?.status === "failed" ? <p className="sakError" role="alert">{activeVersion.errorText ?? "Genereringen feilet."}</p>
          : <div className="sakEmptyDraft"><span className="sakEmptyMark" aria-hidden="true">Aa</span><h2>{busy ? "Utkastet er på vei" : "Her tar saken form"}</h2><p>{busy ? "Du kan følge arbeidet over. Saken blir kontrollert mot kildene før den er klar." : "Legg til kildene dine og velg «Lag utkast». Etterpå kan du redigere direkte i teksten."}</p></div>}
        {versions.length > 0 && <details className="sakHistory"><summary>Instruksjoner og versjonshistorikk</summary><SakLog versions={versions} activeVersionId={activeVersionId} onSelect={(version: SakVersion) => { if (!busy) setActiveVersionId(version.id); }} /></details>}
      </div>
    </div>}
  </section>;
}

"use client";

import { sakSourcePublisher, type SakDraftResponse, type SakMaterial } from "@newsweb/shared";
import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { addSakPdf, addSakText, addSakUrl, deleteSakMaterial, patchSakMaterial } from "../lib/sak-client";

type Props = {
  draftId: string;
  materials: SakMaterial[];
  setMaterials: Dispatch<SetStateAction<SakMaterial[]>>;
  coverage?: SakDraftResponse["coverage"];
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onChange: () => void;
};

export function SakSources({ draftId, materials, setMaterials, coverage, disabled, onBusyChange, onChange }: Props) {
  const [input, setInput] = useState("");
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [publisher, setPublisher] = useState("");
  const [replacement, setReplacement] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const urls = input.trim().split(/\s+/).filter(Boolean);
  const linksOnly = urls.length > 0 && urls.every((url) => /^https?:\/\/\S+$/i.test(url));
  const ready = materials.filter((material) => material.enabled && material.status === "ready").length;
  const disabledInput = disabled || busy;

  function remember(material: SakMaterial) {
    setMaterials((current) => current.some((item) => item.id === material.id)
      ? current.map((item) => item.id === material.id ? material : item)
      : [...current, material]);
  }
  async function perform(action: () => Promise<void>) {
    if (locked.current || disabled) return;
    locked.current = true;
    setBusy(true); onBusyChange(true); setError(null);
    try { await action(); }
    catch (error) { setError(error instanceof Error ? error.message : "Kunne ikke lagre kilden."); }
    finally { locked.current = false; setBusy(false); onBusyChange(false); setProgress(""); onChange(); }
  }
  function clearInput() { setInput(""); setTitle(""); setPublisher(""); setSourceUrl(""); setReplacement(null); }
  function addInput() {
    if (!input.trim()) return;
    void perform(async () => {
      if (linksOnly && !replacement) {
        const unique = [...new Set(urls)];
        if (materials.length + unique.length > 20) throw new Error("En sak kan ha opptil 20 kilder. Legg til færre lenker om gangen.");
        const pending = [...unique];
        for (const [index, url] of unique.entries()) {
          setProgress(`Leser lenke ${index + 1} av ${unique.length} …`);
          remember(await addSakUrl(draftId, url));
          pending.shift(); setInput(pending.join("\n"));
        }
      } else {
        if (!replacement && materials.length >= 20) throw new Error("En sak kan ha opptil 20 kilder.");
        setProgress("Lagrer kildeteksten …");
        remember(await addSakText(draftId, {
          text: input, ...(title.trim() ? { title: title.trim() } : {}),
          ...(sourceUrl.trim() ? { url: sourceUrl.trim() } : {}),
          ...(publisher.trim() ? { publisher: publisher.trim() } : {}),
          ...(replacement ? { replaceMaterialId: replacement } : {})
        }));
      }
      clearInput();
    });
  }
  function upload(files: File[]) {
    void perform(async () => {
      if (materials.length + files.length > 20) throw new Error("En sak kan ha opptil 20 kilder.");
      const errors: string[] = [];
      for (const [index, file] of files.entries()) {
        setProgress(`Leser PDF ${index + 1} av ${files.length}: ${file.name}`);
        try {
          if (!/\.pdf$/i.test(file.name)) throw new Error("Bare PDF-filer støttes.");
          remember(await addSakPdf(draftId, file));
        } catch (error) { errors.push(`${file.name}: ${error instanceof Error ? error.message : "Opplastingen feilet"}`); }
      }
      if (fileInput.current) fileInput.current.value = "";
      if (errors.length) throw new Error(errors.join(" · "));
    });
  }
  function replaceSource(material: SakMaterial) {
    setReplacement(material.id); setTitle(material.title); setSourceUrl(material.url ?? "");
    setPublisher(material.publisher ?? ""); setInput(material.status === "failed" ? "" : material.extractedText ?? "");
    textInput.current?.focus();
  }
  const ordered = [...materials].sort((a, b) => Number((b.metadata as { priority?: number } | null)?.priority ?? 0) - Number((a.metadata as { priority?: number } | null)?.priority ?? 0));
  return (
    <aside className="sakSources" aria-label="Kildemateriale">
      <div className="sakPanelHeading"><h2>Kilder</h2><span className="sakBadge">{ready} valgt</span></div>
      <p className="sakHelp">Legg til rapporter, artikler og egne notater. Du ser hva som faktisk blir lest.</p>
      <div className="sakSourceInput" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
        event.preventDefault(); if (!disabledInput && event.dataTransfer.files.length) upload(Array.from(event.dataTransfer.files));
      }}>
        <label htmlFor="sak-source-text">{replacement ? "Erstatt kildeteksten" : "Lenker eller kildetekst"}</label>
        <textarea id="sak-source-text" ref={textInput} value={input} onChange={(event) => setInput(event.target.value)} disabled={disabledInput}
          placeholder="Lim inn lenker, én per linje, eller lim inn teksten fra en artikkel." rows={5} />
        {(!linksOnly || replacement) && input.trim() && (
          <div className="sakSourceMetadata">
            <input aria-label="Navn på kilden" placeholder="Navn på kilden (valgfritt)" value={title} onChange={(event) => setTitle(event.target.value)} disabled={disabledInput} />
            <input aria-label="Publikasjon for ny kilde" placeholder={sakSourcePublisher({ text: input, title, url: sourceUrl }) ?? "Publikasjon, f.eks. Bloomberg"} value={publisher} onChange={(event) => setPublisher(event.target.value)} disabled={disabledInput} />
            <input aria-label="Original lenke" placeholder="Original lenke (valgfritt)" type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} disabled={disabledInput} />
          </div>
        )}
        <div className="sakSourceActions">
          <button type="button" className="sakPrimaryButton" onClick={addInput} disabled={!input.trim() || disabledInput}>{replacement ? "Oppdater kilde" : linksOnly && urls.length > 1 ? `Legg til ${new Set(urls).size} lenker` : "Legg til kilde"}</button>
          <button type="button" className="sakSecondaryButton" onClick={() => fileInput.current?.click()} disabled={disabledInput}>Last opp PDF-er</button>
          {replacement && <button type="button" className="ghostButton" onClick={clearInput} disabled={disabledInput}>Avbryt</button>}
        </div>
        <input ref={fileInput} type="file" multiple accept="application/pdf,.pdf" hidden disabled={disabledInput} onChange={(event) => upload(Array.from(event.target.files ?? []))} />
        <p className="sakHelp">Du kan også slippe PDF-er her.</p>
      </div>
      <div aria-live="polite">{progress && <p className="sakHelp">{progress}</p>}</div>
      {error && <p className="sakError" role="alert">{error}</p>}
      {(coverage?.dropped.length || coverage?.truncated.length) ? <p className="sakSourceWarning" role="status">Deler av materialet får ikke plass. Prioriter de viktigste kildene før du lager utkast.</p> : null}
      <ul className="sakSourceCards">
        {ordered.map((material) => {
          const priority = Number((material.metadata as { priority?: number } | null)?.priority ?? 0) > 0;
          const dropped = coverage?.dropped.includes(material.id);
          const partial = coverage?.truncated.includes(material.id) || /\[\.\.\. .*avkortet/.test(material.extractedText ?? "");
          const actualChars = coverage?.characters[material.id] ?? material.extractedTextChars;
          return <li key={material.id} className={`sakSourceCard${!material.enabled ? " sakSourceDisabled" : ""}`}>
            <label className="sakSourceChoice">
              <input type="checkbox" checked={material.enabled} disabled={disabledInput} onChange={(event) => {
                const enabled = event.currentTarget.checked; void perform(async () => remember(await patchSakMaterial(draftId, material.id, { enabled })));
              }} />
              <strong>{material.title}</strong>
            </label>
            <p className={material.status === "failed" || dropped || partial ? "sakSourceWarning" : "sakHelp"}>
              {!material.enabled ? "Ikke valgt" : material.status === "failed" ? "Ikke lest" : dropped ? "Utelatt fra generering" : `${partial ? "Delvis lest" : "Lest"} · ${actualChars.toLocaleString("nb-NO")} tegn`}
            </p>
            {material.errorText && <p className="sakHelp">{material.errorText}</p>}
            {material.url && <a className="sakSourceUrl" href={material.url} target="_blank" rel="noreferrer">Åpne originalkilden ↗</a>}
            <label className="sakPublisherLabel">Publikasjon
              <input aria-label={`Publikasjon: ${material.title}`} key={`${material.id}:${material.publisher ?? ""}`} defaultValue={material.publisher ?? ""} placeholder="F.eks. Bloomberg" disabled={disabledInput} onBlur={(event) => {
                const value = event.currentTarget.value.trim();
                if (value !== (material.publisher ?? "")) void perform(async () => remember(await patchSakMaterial(draftId, material.id, { publisher: value })));
              }} />
            </label>
            <div className="sakSourceActions">
              <button type="button" className="sakSecondaryButton" aria-pressed={priority} disabled={disabledInput} onClick={() => void perform(async () => remember(await patchSakMaterial(draftId, material.id, { priority: priority ? 0 : 100 })))}>{priority ? "★ Prioritert" : "☆ Prioriter"}</button>
              <button type="button" className="ghostButton" disabled={disabledInput} onClick={() => replaceSource(material)}>{material.status === "failed" ? "Lim inn teksten" : "Oppdater tekst"}</button>
              <button type="button" className="ghostButton" disabled={disabledInput} onClick={() => void perform(async () => { await deleteSakMaterial(draftId, material.id); setMaterials((items) => items.filter((item) => item.id !== material.id)); if (replacement === material.id) clearInput(); })}>Fjern</button>
            </div>
            {material.extractedText && <details className="sakSourcePreview"><summary>{material.enabled && !dropped ? "Se tekst som brukes i neste utkast" : "Se lagret kildetekst"}</summary><pre>{material.enabled && !dropped ? coverage?.texts?.[material.id] ?? material.extractedText : material.extractedText}</pre></details>}
          </li>;
        })}
      </ul>
    </aside>
  );
}

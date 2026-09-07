"use client";

import type { SakListItem } from "@newsweb/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { createSak, deleteSak, listSak, SakApiError } from "../lib/sak-client";
import { formatOsloClock, sakShortId, sakVersionsLabel } from "../lib/sak-format";

type SakListProps = {
  gone?: boolean;
};

export function SakList({ gone }: SakListProps) {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [drafts, setDrafts] = useState<SakListItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSak()
      .then((response) => {
        if (cancelled) return;
        setDrafts(response.drafts);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setErrorMessage(
          error instanceof SakApiError ? error.message : "Kunne ikke laste saker."
        );
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  async function handleCreate() {
    setCreating(true);
    setErrorMessage(null);
    try {
      const draft = await createSak();
      router.push(`/sak/${draft.id}`);
    } catch (error) {
      setErrorMessage(
        error instanceof SakApiError ? error.message : "Kunne ikke opprette saken."
      );
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    const previous = drafts;
    setDrafts((current) => current.filter((item) => item.id !== id));
    try {
      await deleteSak(id);
    } catch (error) {
      setErrorMessage(
        error instanceof SakApiError ? error.message : "Kunne ikke slette saken."
      );
      setDrafts(previous);
    }
  }

  if (state === "loading") return <p className="sakHelp" role="status">Laster sakene dine …</p>;

  return (
    <section className="sakWorkspace">
      <header className="sakWorkspaceHeader"><div><h1>Saker</h1><p className="sakHelp">Fra kildemateriale til en ferdig redigert nyhetssak.</p></div></header>
      <div className="topBar">
        <button
          className="sakPrimaryButton"
          type="button"
          onClick={() => void handleCreate()}
          disabled={creating}
        >
          {creating ? "Åpner arbeidsområdet …" : "+ Ny sak"}
        </button>
        {gone && <span className="muted">Saken er utløpt</span>}
        {errorMessage && <span role="alert" className="sakError">{errorMessage} <button type="button" className="sakSecondaryButton" onClick={() => { setErrorMessage(null); setState("loading"); setRefresh((value) => value + 1); }}>Prøv igjen</button></span>}
      </div>
      {state === "ready" && drafts.length === 0 && <div className="sakEmptyDraft"><h2>Hva vil du skrive om?</h2><p>Legg til artikler, lenker eller PDF-er. Velg vinkel og lengde, og jobb videre i teksten når utkastet er kontrollert.</p><p className="sakHelp">Sakene er knyttet til denne nettleseren. Utløpstid vises på hver sak.</p></div>}
      {drafts.length > 0 && (
        <div className="feedList">
          {drafts.map((item) => (
            <article className="card" key={item.id}>
              <h2>
                <Link href={`/sak/${item.id}`} className="headlineLink">
                  {item.title ?? `Sak ${sakShortId(item.id)}`}
                </Link>
              </h2>
              <p className="muted">
                {sakVersionsLabel(item.versionCount)} · utløper {formatOsloClock(item.expiresAt)}
              </p>
              <div className="editableActions">
                <span className="actionsRight">
                  <button
                    className="ghostButton"
                    type="button"
                    onClick={() => void handleDelete(item.id)}
                  >
                    Slett
                  </button>
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

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
  }, []);

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

  if (state === "loading") return null;

  return (
    <section>
      <div className="topBar">
        <button
          className="ghostButton"
          type="button"
          onClick={() => void handleCreate()}
          disabled={creating}
        >
          Ny sak
        </button>
        {gone && <span className="muted">Saken er utløpt</span>}
        {errorMessage && <span className="muted">{errorMessage}</span>}
      </div>
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

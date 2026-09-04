"use client";

import type { SakDraftResponse, SakMaterial, SakVersion } from "@newsweb/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { getSak, SakApiError } from "../lib/sak-client";
import { sakVersionHasArticle, sortSakVersions } from "../lib/sak-format";
import { SakArticle } from "./sak-article";
import { SakDeskNotes } from "./sak-desk-notes";
import { SakInstructionInput } from "./sak-instruction-input";
import { SakLog } from "./sak-log";
import { SakTabs } from "./sak-tabs";

type SakDraftProps = {
  id: string;
};

type LoadOptions = {
  selectVersion?: number;
};

function pickActiveVersionId(
  versions: SakVersion[],
  current: string | null,
  selectVersion?: number
): string | null {
  if (selectVersion != null) {
    const requested = versions.find((version) => version.version === selectVersion);
    if (requested) return requested.id;
  }
  if (current && versions.some((version) => version.id === current)) {
    return current;
  }
  const withArticle = versions.filter(sakVersionHasArticle);
  return withArticle.at(-1)?.id ?? versions.at(-1)?.id ?? null;
}

export function SakDraft({ id }: SakDraftProps) {
  const router = useRouter();
  const [data, setData] = useState<SakDraftResponse | null>(null);
  const [materials, setMaterials] = useState<SakMaterial[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);

  const load = useCallback(
    async (options: LoadOptions = {}) => {
      try {
        const next = await getSak(id);
        const versions = sortSakVersions(next.versions);
        setData(next);
        setMaterials(next.materials);
        setActiveVersionId((current) =>
          pickActiveVersionId(versions, current, options.selectVersion)
        );
        setState("ready");
      } catch (error) {
        if (error instanceof SakApiError && error.status === 404) {
          setState("missing");
          router.replace("/sak?gone=1");
          return;
        }
        setErrorMessage(
          error instanceof SakApiError ? error.message : "Kunne ikke laste saken."
        );
        setState("error");
      }
    },
    [id, router]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  const handleReady = useCallback(
    (version: number) => {
      void load({ selectVersion: version });
    },
    [load]
  );

  if (state === "loading" || state === "missing") return null;

  const backLink = (
    <Link href="/sak" className="muted" title="Tilbake til saker">
      ←
    </Link>
  );

  if (state === "error" || !data) {
    return (
      <section className="sakPage">
        {backLink}
        <p className="muted">{errorMessage ?? "Kunne ikke laste saken."}</p>
      </section>
    );
  }

  const versions = sortSakVersions(data.versions);
  const activeVersion = versions.find((version) => version.id === activeVersionId) ?? null;
  const versionCount = versions.filter(sakVersionHasArticle).length;

  return (
    <section className="sakPage">
      {backLink}
      <SakTabs
        draftId={id}
        versions={versions}
        activeVersionId={activeVersionId}
        onSelect={(version) => setActiveVersionId(version.id)}
      />
      {activeVersion && sakVersionHasArticle(activeVersion) ? (
        <>
          <SakArticle
            key={activeVersion.id}
            draftId={id}
            version={activeVersion}
            article={activeVersion.article}
            materials={materials}
          />
          <SakDeskNotes article={activeVersion.article} materials={materials} />
        </>
      ) : activeVersion?.status === "failed" ? (
        <p className="muted">{activeVersion.errorText ?? "Genereringen feilet"}</p>
      ) : null}
      <SakInstructionInput
        draftId={id}
        materials={materials}
        setMaterials={setMaterials}
        versionCount={versionCount}
        activeGeneration={data.activeGeneration}
        initialTitleOverride={data.draft.titleOverride}
        initialTargetChars={data.draft.targetChars}
        onReady={handleReady}
        onChange={reload}
      />
      <SakLog
        versions={versions}
        activeVersionId={activeVersionId}
        onSelect={(version) => setActiveVersionId(version.id)}
      />
    </section>
  );
}

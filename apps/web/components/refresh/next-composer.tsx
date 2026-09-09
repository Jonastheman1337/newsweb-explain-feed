"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  isNoticeGenerationTerminal,
  type NoticeEditorSnapshot,
  type NoticeGenerationRequest,
  type NoticeMaterial,
} from "@newsweb/shared";
import { readNextPrefs, writeNextPrefs, clampNoticeChars } from "./prefs";
import styles from "./next-editor.module.css";
import { useEditorialTelemetry } from "../../lib/editorial-telemetry";

export type ComposerDraft = {
  text: string;
  maxChars: number;
  reasoning: boolean;
};
type Submission = {
  body: Record<string, unknown>;
  base?: NoticeEditorSnapshot;
  request?: NoticeGenerationRequest;
};
type SourceChip = {
  key: string;
  label: string;
  state: "loading" | "ready" | "failed";
  material?: NoticeMaterial;
  error?: string;
  retry?: () => void;
};
const memory = new Map<string, unknown>();
function readStored<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
  } catch {
    return (memory.get(key) as T) ?? null;
  }
}
function store(key: string, value: unknown): boolean {
  memory.set(key, value);
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function composerDraftKey(messageId: number, rewriteId?: string) {
  return `newsweb:next-composer:${messageId}:${rewriteId ?? "source"}`;
}
const newId = () => crypto.randomUUID();
const stable = (value: unknown) => JSON.stringify(value);
export function sourceUrl(text: string): URL | null {
  try {
    const url = new URL(text.trim());
    return /^https?:$/.test(url.protocol) && !/\s/.test(text.trim())
      ? url
      : null;
  } catch {
    return null;
  }
}
async function responseJson(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? "Forespørselen feilet.");
  return body;
}
export function useNoticeComposer(args: {
  messageId: number;
  rewriteId?: string;
  enabled: boolean;
  getSnapshot: () => NoticeEditorSnapshot | undefined;
  getInteractionVersion: () => number;
  onResult: (
    request: NoticeGenerationRequest,
    base: NoticeEditorSnapshot | undefined,
    canAutoOpen: () => boolean,
  ) => Promise<void>;
}) {
  const { buildTelemetry } = useEditorialTelemetry(args.messageId, {
    rewriteId: args.rewriteId,
  });
  const key = composerDraftKey(args.messageId, args.rewriteId);
  const requestKey = `newsweb:next-request:${args.messageId}`;
  const [draft, setDraft] = useState<ComposerDraft>({
    text: "",
    maxChars: 1000,
    reasoning: false,
  });
  const [saveFailed, setSaveFailed] = useState(false);
  const [chips, setChips] = useState<SourceChip[]>([]);
  const [sourceError, setSourceError] = useState("");
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [materialsRetry, setMaterialsRetry] = useState(0);
  const [error, setError] = useState("");
  const [retrySnapshot, setRetrySnapshot] = useState(false);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [sending, setSending] = useState(false);
  const [cancelSending, setCancelSending] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const replacingPdf = useRef<SourceChip | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [capabilities, setCapabilities] = useState<{
    queuedGeneration?: boolean;
    cancellation?: boolean;
    urlMaterials?: boolean;
  }>({});
  const [lengthOpen, setLengthOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState("1000");
  const field = useRef<HTMLTextAreaElement>(null),
    lengthTrigger = useRef<HTMLButtonElement>(null),
    lengthMenu = useRef<HTMLDivElement>(null),
    customInput = useRef<HTMLInputElement>(null),
    fileInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const latest = useRef(args);
  latest.current = args;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const keyRef = useRef(key);
  keyRef.current = key;
  const revision = useRef(0);
  const sendingRef = useRef(false);
  const eligible = useRef<{
    interaction: number;
    revision: number;
    base: string;
  } | null>(null);
  const reported = useRef(new Set<string>());
  const removed = useRef(new Set<string>());
  const requestRef = useRef(submission);
  requestRef.current = submission;
  function saveDraft(next: ComposerDraft) {
    draftRef.current = next;
    setDraft(next);
    setSaveFailed(!store(keyRef.current, next));
  }
  function updateDraft(patch: Partial<ComposerDraft>) {
    revision.current++;
    eligible.current = null;
    saveDraft({ ...draftRef.current, ...patch });
  }
  function remember(next: Submission) {
    requestRef.current = next;
    setSubmission(next);
    if (!store(requestKey, next)) setSaveFailed(true);
  }
  useLayoutEffect(() => {
    const saved = readStored<ComposerDraft>(key);
    const next =
      saved && typeof saved.text === "string"
        ? {
            text: saved.text,
            maxChars: clampNoticeChars(saved.maxChars),
            reasoning: !!saved.reasoning,
          }
        : {
            text: "",
            maxChars: readNextPrefs().noticeChars ?? 1000,
            reasoning: false,
          };
    draftRef.current = next;
    setDraft(next);
    eligible.current = null;
    setLengthOpen(false);
  }, [key]);
  useEffect(() => {
    setSubmission(readStored<Submission>(requestKey));
  }, [requestKey]);
  useEffect(() => {
    const ta = field.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${ta.scrollHeight}px`;
    }
  }, [draft.text, args.enabled]);
  useEffect(() => {
    let active = true;
    fetch("/api/notice/editor-capabilities", { credentials: "include" })
      .then(responseJson)
      .then((value) => {
        if (active) setCapabilities(value);
      })
      .catch(() => {});
    if (!args.enabled)
      return () => {
        active = false;
      };
    setMaterialsLoading(true);
    setSourceError("");
    fetch(`/api/notice/${args.messageId}/materials`, { credentials: "include" })
      .then(responseJson)
      .then((value) => {
        if (!active) return;
        setMaterialsLoading(false);
        setChips((current) => [
          ...current.filter((chip) => !chip.material),
          ...(value.materials as NoticeMaterial[])
            .filter((m) => m.enabled)
            .map((m) => ({
              key: m.id,
              label: m.title,
              state: m.status as "ready" | "failed",
              material: m,
              error: m.errorText ?? undefined,
            })),
        ]);
      })
      .catch(() => {
        if (active) setMaterialsLoading(false);
        if (active)
          setSourceError(
            "Kunne ikke hente kildene. Åpne Endre igjen for å prøve på nytt.",
          );
      });
    return () => {
      active = false;
    };
  }, [args.enabled, args.messageId, materialsRetry]);
  useEffect(() => {
    if (!lengthOpen) return;
    const outside = (event: PointerEvent) => {
      if (
        !lengthMenu.current?.contains(event.target as Node) &&
        !lengthTrigger.current?.contains(event.target as Node)
      )
        setLengthOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [lengthOpen]);
  useEffect(() => {
    if (customOpen && lengthOpen) {
      customInput.current?.focus({ preventScroll: true });
      customInput.current?.select();
    }
  }, [customOpen, lengthOpen]);
  async function report(result: NoticeGenerationRequest, current: Submission) {
    if (
      result.state !== "published" ||
      reported.current.has(result.generationRunId)
    )
      return;
    const guard = eligible.current;
    const canAutoOpen = () =>
      alive.current &&
      !!guard &&
      guard.interaction === latest.current.getInteractionVersion() &&
      guard.revision === revision.current &&
      guard.base === stable(latest.current.getSnapshot());
    await latest.current.onResult(result, current.base, canAutoOpen);
    reported.current.add(result.generationRunId);
    eligible.current = null;
  }
  useEffect(() => {
    const current = submission;
    if (!current?.request) return;
    const id = current.request.generationRunId;
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const data = await fetch(
          `/api/notice/${args.messageId}/status?generationRunId=${encodeURIComponent(id)}`,
          { credentials: "include", cache: "no-store" },
        ).then(responseJson);
        if (!active) return;
        setConnectionLost(false);
        const result = data.request as NoticeGenerationRequest;
        if (!result || result.generationRunId !== id)
          throw new Error("Ugyldig forespørselsstatus");
        const next: Submission = { ...current!, request: result };
        remember(next);
        if (result.state === "published") await report(result, next);
        if (isNoticeGenerationTerminal(result.state)) return;
      } catch {
        if (active) setConnectionLost(true);
      }
      if (active) timer = setTimeout(poll, 1500);
    }
    if (
      (current.request.state === "published" && !reported.current.has(id)) ||
      !isNoticeGenerationTerminal(current.request.state)
    )
      void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [submission?.request?.generationRunId, args.messageId]);
  function removeChip(chip: SourceChip) {
    revision.current++;
    eligible.current = null;
    removed.current.add(chip.key);
    setChips((current) => current.filter((c) => c.key !== chip.key));
    if (chip.material)
      void fetch(
        `/api/notice/${args.messageId}/materials/${chip.material.id}`,
        { method: "DELETE", credentials: "include" },
      )
        .then(responseJson)
        .catch(() => {
          removed.current.delete(chip.key);
          setChips((current) => [...current, chip]);
          setSourceError("Kunne ikke fjerne kilden. Prøv igjen.");
        });
  }
  function importSource(
    kind: "url" | "newsweb" | "text" | "pdf",
    value: string | File,
  ) {
    revision.current++;
    eligible.current = null;
    const operation = newId();
    const label =
      value instanceof File
        ? value.name
        : kind === "text"
          ? `Kildetekst · ${value.length.toLocaleString("nb-NO")} tegn`
          : (sourceUrl(value)?.hostname ?? value);
    const retry = () => {
      setChips((current) => current.filter((c) => c.key !== operation));
      importSource(kind, value);
    };
    setChips((current) => [
      ...current,
      { key: operation, label, state: "loading", retry },
    ]);
    let body: BodyInit, headers: Record<string, string> | undefined;
    if (value instanceof File) {
      const form = new FormData();
      form.append("file", value);
      body = form;
    } else {
      headers = { "Content-Type": "application/json" };
      body = JSON.stringify(kind === "text" ? { text: value } : { url: value });
    }
    void fetch(`/api/notice/${args.messageId}/materials/${kind}`, {
      method: "POST",
      credentials: "include",
      headers,
      body,
    })
      .then(responseJson)
      .then((material: NoticeMaterial) => {
        if (removed.current.has(operation)) {
          void fetch(`/api/notice/${args.messageId}/materials/${material.id}`, {
            method: "DELETE",
            credentials: "include",
          })
            .then(responseJson)
            .catch(() => {
              removed.current.delete(operation);
              setChips((current) => [
                ...current,
                {
                  key: operation,
                  label: material.title,
                  material,
                  state: material.status,
                },
              ]);
              setSourceError("Kunne ikke fjerne kilden. Prøv igjen.");
            });
          return;
        }
        setChips((current) =>
          current.map((chip) =>
            chip.key === operation
              ? {
                  ...chip,
                  label: material.title,
                  material,
                  state: material.status,
                  error: material.errorText ?? undefined,
                  retry: () => {
                    removeChip({ ...chip, material });
                    importSource(kind, value);
                  },
                }
              : chip,
          ),
        );
        if (
          material.status === "ready" &&
          kind === "text" &&
          draftRef.current.text === value
        )
          saveDraft({ ...draftRef.current, text: "" });
      })
      .catch((cause) =>
        setChips((current) =>
          current.map((chip) =>
            chip.key === operation
              ? {
                  ...chip,
                  state: "failed",
                  error:
                    cause instanceof Error
                      ? cause.message
                      : "Kilden kunne ikke leses.",
                }
              : chip,
          ),
        ),
      );
  }
  function attachText() {
    const text = draftRef.current.text.trim();
    if (!text) return;
    const url = sourceUrl(text);
    importSource(
      url
        ? url.hostname === "newsweb.oslobors.no"
          ? "newsweb"
          : "url"
        : "text",
      text,
    );
  }
  function pdfs(files: FileList | File[]) {
    if (files.length && replacingPdf.current) {
      removeChip(replacingPdf.current);
      replacingPdf.current = null;
    }
    for (const file of Array.from(files)) {
      if (!/\.pdf$/i.test(file.name) || file.size > 20 * 1024 * 1024) {
        setSourceError("Velg PDF-filer på høyst 20 MB.");
        continue;
      }
      importSource("pdf", file);
    }
  }
  const request = submission?.request;
  const busy =
    sending || (!!request && !isNoticeGenerationTerminal(request.state));
  const blockedSources =
    materialsLoading ||
    chips.some((chip) => chip.state !== "ready") ||
    !!sourceError;
  async function send(retry = false) {
    if (sendingRef.current || busy || (!retry && blockedSources)) return;
    setRetrySnapshot(false);
    if (!capabilities.queuedGeneration) {
      setError(
        "Generering er midlertidig utilgjengelig. Åpne Endre igjen for å prøve på nytt.",
      );
      return;
    }
    const base = latest.current.getSnapshot();
    const current = draftRef.current;
    if (!retry && current.text.trim().length > 2000) {
      setError(
        "Instruksjonen er for lang. Bruk Legg ved teksten for kildetekst.",
      );
      return;
    }
    let next: Submission;
    if (retry && submission) {
      next = {
        body: submission.request
          ? {
              clientRequestId: newId(),
              retryOf: submission.request.generationRunId,
            }
          : submission.body,
        base: submission.base,
      };
    } else
      next = {
        body: {
          clientRequestId: newId(),
          ...(base ? { baseSnapshot: base } : {}),
          ...(current.text.trim() ? { instruction: current.text.trim() } : {}),
          outputMode: "notice",
          maxVisibleArticleChars: current.maxChars,
          ...(current.reasoning ? { reasoningEffortOverride: "xhigh" } : {}),
          selectedMaterialIds: chips.flatMap((chip) =>
            chip.material ? [chip.material.id] : [],
          ),
          telemetry: buildTelemetry({ actionSource: "next_composer" }),
        },
        base,
      };
    const originalKey = keyRef.current;
    const originalRevision = revision.current,
      interaction = latest.current.getInteractionVersion();
    remember(next);
    sendingRef.current = true;
    setSending(true);
    setError("");
    try {
      const result = (await fetch(`/api/notice/${args.messageId}/generate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next.body),
      }).then(responseJson)) as NoticeGenerationRequest;
      if (!result.generationRunId)
        throw new Error("Serveren støtter ikke denne forespørselen ennå.");
      remember({ ...next, request: result });
      if (!retry) {
        if (
          keyRef.current === originalKey &&
          revision.current === originalRevision
        ) {
          saveDraft({ ...draftRef.current, text: "", reasoning: false });
          eligible.current = {
            interaction,
            revision: revision.current,
            base: stable(base),
          };
        } else if (keyRef.current !== originalKey) {
          const saved = readStored<ComposerDraft>(originalKey);
          if (saved?.text === current.text)
            store(originalKey, { ...saved, text: "", reasoning: false });
        }
      } else if (!draftRef.current.text)
        eligible.current = {
          interaction,
          revision: revision.current,
          base: stable(next.base),
        };
    } catch (cause) {
      setRetrySnapshot(true);
      setError(
        cause instanceof Error
          ? cause.message
          : "Kunne ikke sende. Prøv igjen.",
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }
  async function cancel() {
    if (!request || cancelSending) return;
    setCancelSending(true);
    setCancelError("");
    eligible.current = null;
    try {
      const result = await fetch(
        `/api/notice/${args.messageId}/generations/${request.generationRunId}/cancel`,
        { method: "POST", credentials: "include" },
      ).then(responseJson);
      remember({ ...submission!, request: result });
    } catch (cause) {
      setCancelError(
        cause instanceof Error
          ? cause.message
          : "Kunne ikke avbryte. Prøv igjen.",
      );
    } finally {
      setCancelSending(false);
    }
  }
  function applyLength() {
    const input = customInput.current;
    if (!input || !input.reportValidity()) return;
    const value = Number(customValue);
    updateDraft({ maxChars: value });
    writeNextPrefs({ noticeChars: value });
    setLengthOpen(false);
    lengthTrigger.current?.focus({ preventScroll: true });
  }
  const status = (
    <>
      {busy && (
        <span className={styles.requestStatus} role="status">
          {sending
            ? "Sender …"
            : request?.state === "queued"
              ? "I kø"
              : request?.state === "cancelling"
                ? "Avbryter …"
                : "Skriver ny versjon …"}
        </span>
      )}
      {busy && !sending && capabilities.cancellation && (
        <button
          type="button"
          disabled={cancelSending || request?.state === "cancelling"}
          onClick={() => void cancel()}
        >
          Avbryt
        </button>
      )}
      {request?.state === "cancelled" && (
        <span className={styles.requestStatus} role="status">
          Avbrutt
        </span>
      )}
      {(request?.state === "failed" || request?.state === "skipped") && (
        <span className={styles.requestStatus} role="status">
          Kunne ikke fullføre{" "}
          <button type="button" onClick={() => void send(true)}>
            Prøv igjen
          </button>
        </span>
      )}
      {cancelError && busy && (
        <span role="alert" className={styles.requestStatus}>
          {cancelError}{" "}
          <button
            type="button"
            disabled={cancelSending}
            onClick={() => void cancel()}
          >
            Prøv å avbryte igjen
          </button>
        </span>
      )}
      {connectionLost && (
        <span className={styles.requestStatus} role="status">
          Mistet forbindelsen. Prøver igjen …
        </span>
      )}
    </>
  );
  const form = (
    <div
      className={styles.composer}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        pdfs(e.dataTransfer.files);
      }}
    >
      {!!chips.length && (
        <div className={styles.chips} aria-label="Vedlagte kilder">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className={styles.chip}
              data-state={chip.state}
            >
              <span title={chip.error ?? chip.label}>
                {chip.label}
                {chip.state === "loading"
                  ? " · Leser …"
                  : chip.state === "failed"
                    ? " · Feilet"
                    : ""}
              </span>
              {chip.state === "failed" && (
                <button
                  type="button"
                  onClick={() => {
                    if (chip.retry) chip.retry();
                    else if (chip.material?.url) {
                      removeChip(chip);
                      importSource(
                        chip.material.kind === "newsweb" ? "newsweb" : "url",
                        chip.material.url,
                      );
                    } else if (chip.material?.kind === "pdf") {
                      replacingPdf.current = chip;
                      fileInput.current?.click();
                    } else {
                      removeChip(chip);
                      field.current?.focus();
                    }
                  }}
                  aria-label={`Prøv ${chip.label} igjen`}
                >
                  Prøv igjen
                </button>
              )}
              <button
                type="button"
                aria-label={`Fjern ${chip.label}`}
                onClick={() => removeChip(chip)}
              >
                ×
              </button>
              {chip.state === "failed" && chip.error && (
                <small role="alert">{chip.error}</small>
              )}
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={field}
        rows={1}
        value={draft.text}
        aria-label="Instruksjon, lenke eller kildetekst"
        placeholder="Be om endring, lim inn kildetekst eller lenke"
        onChange={(e) => updateDraft({ text: e.target.value })}
        onPaste={(e) => {
          const url = sourceUrl(e.clipboardData.getData("text/plain"));
          if (url) {
            e.preventDefault();
            importSource(
              url.hostname === "newsweb.oslobors.no" ? "newsweb" : "url",
              url.href,
            );
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <div className={styles.composeControls}>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          aria-label="Velg PDF-filer"
          onChange={(e) => {
            if (e.target.files) pdfs(e.target.files);
            e.target.value = "";
          }}
        />
        <button type="button" onClick={() => fileInput.current?.click()}>
          PDF
        </button>
        {!!draft.text.trim() && (
          <button type="button" onClick={attachText}>
            Legg ved teksten
          </button>
        )}
        <div
          className={styles.lengthWrap}
          onKeyDown={(e) => {
            if (e.key === "Escape" && lengthOpen) {
              e.preventDefault();
              e.stopPropagation();
              setLengthOpen(false);
              lengthTrigger.current?.focus({ preventScroll: true });
            }
          }}
        >
          <button
            ref={lengthTrigger}
            type="button"
            aria-label={`Maksimal lengde, ${draft.maxChars} tegn`}
            aria-expanded={lengthOpen}
            onClick={() => {
              setLengthOpen(!lengthOpen);
              setCustomOpen(false);
            }}
          >
            {draft.maxChars.toLocaleString("nb-NO")} tegn⌄
          </button>
          {lengthOpen && (
            <div ref={lengthMenu} className={styles.lengthMenu}>
              {customOpen ? (
                <>
                  <button type="button" onClick={() => setCustomOpen(false)}>
                    ← Lengder
                  </button>
                  <label>
                    Maks antall tegn
                    <input
                      ref={customInput}
                      type="number"
                      min={300}
                      max={4000}
                      step={1}
                      required
                      value={customValue}
                      onChange={(e) => setCustomValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.stopPropagation();
                          applyLength();
                        }
                      }}
                    />
                  </label>
                  <button type="button" onClick={applyLength}>
                    Bruk
                  </button>
                </>
              ) : (
                <>
                  {[300, 500, 1000, 1500].map((value) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={draft.maxChars === value}
                      onClick={() => {
                        updateDraft({ maxChars: value });
                        writeNextPrefs({ noticeChars: value });
                        setLengthOpen(false);
                        lengthTrigger.current?.focus({ preventScroll: true });
                      }}
                    >
                      {value.toLocaleString("nb-NO")}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setCustomValue(String(draft.maxChars));
                      setCustomOpen(true);
                    }}
                  >
                    Annet …
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          className={styles.reasoning}
          aria-label="Grundigere resonnering"
          title="Grundigere resonnering · tar lengre tid"
          aria-pressed={draft.reasoning}
          onClick={() => updateDraft({ reasoning: !draft.reasoning })}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M12 18V5a3 3 0 0 0-5.8-1A4 4 0 0 0 4 11a4 4 0 0 0 3 7 3 3 0 0 0 5 2m0-2V5a3 3 0 0 1 5.8-1A4 4 0 0 1 20 11a4 4 0 0 1-3 7 3 3 0 0 1-5 2M7 9l2 2m8-2-2 2" />
          </svg>
        </button>
        <button
          type="button"
          className={styles.primary}
          aria-label="Lag ny versjon"
          title="Lag ny versjon · Ctrl/⌘ + Enter"
          disabled={busy || blockedSources || !capabilities.queuedGeneration}
          onClick={() => void send()}
        >
          <span>Ny versjon</span> ↑
        </button>
      </div>
      {saveFailed && (
        <p role="alert">Endringene er ikke lagret på denne enheten.</p>
      )}
      {sourceError && (
        <p role="alert">
          {sourceError}{" "}
          <button
            type="button"
            onClick={() => setMaterialsRetry((value) => value + 1)}
          >
            Prøv igjen
          </button>
        </p>
      )}
      {blockedSources && !sourceError && (
        <p role="status">
          Vent på kildene, eller prøv igjen/fjern en kilde som feilet.
        </p>
      )}
      {error && (
        <p role="alert">
          {error}{" "}
          <button type="button" onClick={() => void send(retrySnapshot)}>
            Prøv igjen
          </button>
        </p>
      )}
    </div>
  );
  return {
    form,
    status,
    request,
    busy,
    canGenerate: !!capabilities.queuedGeneration && !busy && !blockedSources,
    generate: () => send(),
    focus: () => field.current?.focus({ preventScroll: true }),
  };
}

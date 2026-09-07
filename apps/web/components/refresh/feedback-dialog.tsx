"use client";

import { useState } from "react";
import type { FeedItem } from "@newsweb/shared";
import { useEditorialTelemetry } from "../../lib/editorial-telemetry";
import { Modal } from "./controls";
import styles from "./refresh.module.css";

export function FeedbackDialog({
  item,
  open,
  onClose
}: {
  item: FeedItem;
  open: boolean;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const { buildTelemetry } = useEditorialTelemetry(item.messageId, {
    version: item.rewriteVersion ?? undefined,
    rewriteId: item.rewriteId ?? undefined,
    publicationRevision: item.publicationRevision,
    contentHash: item.contentHash ?? undefined,
    isFinal: item.isFinal
  });
  async function send(event: React.FormEvent) {
    event.preventDefault();
    setState("sending");
    try {
      const result = await fetch(`/api/notice/${item.messageId}/feedback`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          ...(item.rewriteVersion ? { version: item.rewriteVersion } : {}),
          telemetry: buildTelemetry({ actionSource: "refresh_feedback" })
        })
      });
      if (!result.ok) throw new Error();
      setText("");
      setState("sent");
    } catch {
      setState("error");
    }
  }
  function close() {
    if (state === "sent") setState("idle");
    onClose();
  }
  return (
    <Modal open={open} onClose={close} title="Meld feil">
      {state === "sent" ? (
        <div className={styles.form}>
          <p role="status">Tilbakemelding sendt</p>
          <button
            onClick={() => {
              onClose();
              setState("idle");
            }}
          >
            Ferdig
          </button>
        </div>
      ) : (
        <form className={styles.form} onSubmit={send}>
          <label htmlFor={`feedback-${item.messageId}`}>Hva er feil?</label>
          <textarea
            id={`feedback-${item.messageId}`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={4}
            required
            disabled={state === "sending"}
          />
          {state === "error" && <p role="alert">Kunne ikke sende. Prøv igjen.</p>}
          <div className={styles.formActions}>
            <button type="button" onClick={onClose}>
              Avbryt
            </button>
            <button
              type="submit"
              className={styles.copy}
              disabled={!text.trim() || state === "sending"}
            >
              {state === "sending" ? "Sender…" : "Send"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

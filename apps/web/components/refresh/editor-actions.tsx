"use client";

import { useRef } from "react";
import type { RewriteActionControls } from "../editable-rewrite";
import { ActionMenu, Modal } from "./controls";
import styles from "./refresh.module.css";

export type WorkspacePanel = "sources" | "versions" | "pdf";
export function RefreshEditorActions({
  controls,
  sourcesOpen,
  composeOpen,
  onPanel,
  onClosePanel,
  onCompose,
  onFeedback,
  showEditingHint
}: {
  controls: RewriteActionControls;
  sourcesOpen: boolean;
  composeOpen: boolean;
  onPanel: (panel: "sources" | "versions") => void;
  onClosePanel: () => void;
  onCompose: () => void;
  onFeedback: () => void;
  showEditingHint: boolean;
}) {
  const actionRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={actionRef} className={styles.editorActions}>
        <div className={styles.editorActionsLeft}>
          <button type="button" data-source-trigger aria-expanded={sourcesOpen} onClick={() => sourcesOpen ? onClosePanel() : onPanel("sources")}>
            {sourcesOpen ? "Lukk kilder" : "Kilder"}
          </button>
          <button type="button" data-compose-trigger aria-expanded={composeOpen} onClick={onCompose}>
            Ny versjon
          </button>
          {(controls.hasDraft || controls.saveState !== "idle") && (
            <span className={styles.edited} role="status" data-save-state={controls.saveState}>
              <span />
              {controls.showingOriginal ? "AI-original" : controls.saveState === "failed" ? "Endringer er ikke lagret" : controls.saveState === "saving" ? "Lagrer…" : "Redigert · lagret på denne enheten"}
            </span>
          )}
          {showEditingHint && !controls.hasDraft && controls.saveState === "idle" && (
            <span className={styles.editHint}>Klikk i tittelen eller teksten for å redigere</span>
          )}
          {controls.canUndoReset && (
            <button type="button" onClick={controls.undoReset}>
              Angre
            </button>
          )}
        </div>
        <div className={styles.editorActionsRight}>
          <ActionMenu>
            <button type="button" onClick={() => onPanel("versions")}>
              Versjoner
            </button>
            {controls.hasDraft && (
              <>
                <button type="button" onClick={controls.toggleOriginal}>
                  {controls.showingOriginal ? "Vis redigert" : "AI-original"}
                </button>
                <button type="button" onClick={controls.reset}>
                  Tilbakestill
                </button>
              </>
            )}
            <button type="button" onClick={onFeedback}>
              Meld feil
            </button>
          </ActionMenu>
          <button
            type="button"
            className={styles.copy}
            onClick={() => void controls.copy()}
            aria-live="polite"
          >
            {controls.copyState === "copied"
              ? "Kopiert"
              : controls.copyState === "failed"
                ? "Prøv å kopiere igjen"
                : "Kopier"}
          </button>
        </div>
      </div>
      <Modal
        open={controls.titles.open}
        onClose={controls.titles.close}
        title="Foreslå titler"
        returnFocus={() => actionRef.current?.closest("article")?.querySelector(".titleSuggestBtn") ?? null}
      >
        <div className={styles.titles}>
          {controls.titles.loading ? <p role="status">Henter titler…</p> : controls.titles.dropdown}
        </div>
      </Modal>
    </>
  );
}

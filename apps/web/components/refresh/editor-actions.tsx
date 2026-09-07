"use client";

import { useRef } from "react";
import type { RewriteActionControls } from "../editable-rewrite";
import { ActionMenu, Modal } from "./controls";
import styles from "./refresh.module.css";

export type WorkspacePanel = "sources" | "versions" | "generate";
export function RefreshEditorActions({
  controls,
  sourcesOpen,
  onPanel,
  onFeedback
}: {
  controls: RewriteActionControls;
  sourcesOpen: boolean;
  onPanel: (panel: WorkspacePanel) => void;
  onFeedback: () => void;
}) {
  const actionRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={actionRef} className={styles.editorActions}>
        <div className={styles.editorActionsLeft}>
          {!sourcesOpen && (
            <button type="button" data-source-trigger onClick={() => onPanel("sources")}>
              Kilder
            </button>
          )}
          {controls.hasDraft && (
            <span className={styles.edited}>
              <span />
              {controls.showingOriginal ? "AI-original" : "Redigert"}
            </span>
          )}
          {controls.canUndoReset && (
            <button type="button" onClick={controls.undoReset}>
              Angre
            </button>
          )}
        </div>
        <div className={styles.editorActionsRight}>
          <ActionMenu>
            <button type="button" onClick={controls.titles.toggle}>
              Titler
            </button>
            <button type="button" onClick={() => onPanel("versions")}>
              Versjoner
            </button>
            <button type="button" onClick={() => onPanel("generate")}>
              Lag versjon
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
        title="Titler"
        returnFocus={() => actionRef.current?.querySelector("summary") ?? null}
      >
        <div className={styles.titles}>
          {controls.titles.loading ? <p role="status">Henter titler…</p> : controls.titles.dropdown}
        </div>
      </Modal>
    </>
  );
}

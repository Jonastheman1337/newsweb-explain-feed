"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./refresh.module.css";

export function Modal({
  open,
  onClose,
  title,
  children,
  returnFocus
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  returnFocus?: () => HTMLElement | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const previous = returnFocus?.() ?? (document.activeElement as HTMLElement | null);
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus({ preventScroll: true });
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={styles.modal}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onCloseRef.current();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            onCloseRef.current();
        }
      }}
    >
      <div className={styles.modalHeader}>
        <h2 id={titleId}>{title}</h2>
        <button type="button" onClick={onClose} aria-label="Lukk">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function ActionMenu({
  children,
  label = "Flere valg"
}: {
  children: ReactNode;
  label?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node))
        ref.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return (
    <details
      ref={ref}
      data-actions-menu
      className={styles.actionMenu}
      onKeyDown={(event) => {
        if (event.key === "Escape" && ref.current?.open) {
          event.stopPropagation();
          ref.current.open = false;
          ref.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary aria-label={label} title={label}>
        ···
      </summary>
      <div
        className={styles.menuItems}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button, a") && ref.current)
            ref.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}

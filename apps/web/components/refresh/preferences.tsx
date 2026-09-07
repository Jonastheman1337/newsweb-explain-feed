"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./controls";
import styles from "./refresh.module.css";

export function Preferences({
  categories,
  defaultMuted
}: {
  categories: string[];
  defaultMuted: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [muted, setMuted] = useState(defaultMuted);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [retry, setRetry] = useState<string[] | null>(null);
  const mutedKey = defaultMuted.join("\0");
  useEffect(() => {
    setMuted(defaultMuted);
  }, [mutedKey]);
  const options = useMemo(
    () =>
      Array.from(new Set([...categories, ...defaultMuted, "RENTEREGULERING"])).sort((a, b) =>
        a.localeCompare(b, "nb")
      ),
    [categories, mutedKey]
  );
  const label = (name: string) => (name === "RENTEREGULERING" ? "Rentefastsettelser" : name);
  async function save(next: string[]) {
    const previous = muted;
    setMuted(next);
    setStatus("saving");
    setRetry(next);
    try {
      const result = await fetch("/api/settings/muted-categories", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mutedCategories: next })
      });
      if (!result.ok) throw new Error();
      setRetry(null);
      setStatus("idle");
      router.refresh();
    } catch {
      setMuted(previous);
      setStatus("error");
    }
  }
  return (
    <>
      <button
        type="button"
        className={styles.preferencesButton}
        onClick={() => setOpen(true)}
        aria-label="Innstillinger"
        title="Innstillinger"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path d="M4 7h16M4 17h16" />
          <circle cx="9" cy="7" r="3" fill="var(--bg-main)" />
          <circle cx="15" cy="17" r="3" fill="var(--bg-main)" />
        </svg>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Innstillinger">
        <div className={styles.form}>
          <h3 className={styles.preferencesHeading}>Skjulte kategorier</h3>
          <input
            aria-label="Søk i kategorier"
            placeholder="Søk"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className={styles.categoryList}>
            {options
              .filter((name) =>
                label(name).toLocaleLowerCase("nb").includes(query.toLocaleLowerCase("nb"))
              )
              .map((name) => (
                <label key={name}>
                  <input
                    type="checkbox"
                    checked={muted.includes(name)}
                    disabled={status === "saving"}
                    onChange={(event) =>
                      void save(
                        event.target.checked
                          ? [...muted, name]
                          : muted.filter((value) => value !== name)
                      )
                    }
                  />
                  <span>{label(name)}</span>
                </label>
              ))}
          </div>
          <div className={styles.preferenceStatus} role="status">
            {status === "saving" ? (
              "Lagrer…"
            ) : status === "error" ? (
              <span>
                Kunne ikke lagre.{" "}
                <button type="button" onClick={() => retry && void save(retry)}>
                  Prøv igjen
                </button>
              </span>
            ) : muted.length ? (
              `${muted.length} skjult`
            ) : (
              ""
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type TitleSuggestionsProps = {
  messageId: number;
  currentTitle: string;
  onPreview: (title: string) => void;
  onRevert: () => void;
  onCommit: (title: string) => void;
};

export function useTitleSuggestions({
  messageId,
  currentTitle,
  onPreview,
  onRevert,
  onCommit,
}: TitleSuggestionsProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [titles, setTitles] = useState<string[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    onRevert();
  }, [onRevert]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        dropdownRef.current?.contains(target) ||
        btnRef.current?.contains(target)
      ) return;
      close();
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, close]);

  function logSuggestions(suggestions: string[], selectedTitle?: string | null) {
    fetch(`/api/notice/${messageId}/title-suggestion-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ currentTitle, suggestions, selectedTitle: selectedTitle ?? null })
    }).catch(() => { /* silent */ });
  }

  async function fetchSuggestions() {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/notice/${messageId}/suggest-titles`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        const newTitles = data.titles ?? [];
        setTitles(newTitles);
        if (newTitles.length > 0) {
          logSuggestions(newTitles);
        }
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  function handleToggle() {
    if (open) {
      close();
      return;
    }
    setOpen(true);
    // Only fetch if we don't have suggestions yet
    if (titles.length === 0 && !error) {
      fetchSuggestions();
    }
  }

  function handleCommit(title: string) {
    logSuggestions(titles, title);
    onCommit(title);
    setOpen(false);
  }

  const button = (
    <button
      ref={btnRef}
      className={`titleSuggestBtn${loading ? " titleSuggestBtnLoading" : ""}`}
      onClick={handleToggle}
      title="Foreslå titler"
      type="button"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    </button>
  );

  const dropdown = open && !loading ? (
    <div
      ref={dropdownRef}
      className="titleSuggestDropdown"
      onMouseLeave={() => onRevert()}
    >
      {error ? (
        <div className="titleSuggestLoading">Noe gikk galt — prøv igjen</div>
      ) : titles.length === 0 ? (
        <div className="titleSuggestLoading">Ingen forslag tilgjengelig</div>
      ) : (
        <>
          <button
            className="titleSuggestOption titleSuggestCurrent"
            onClick={() => handleCommit(currentTitle)}
            onMouseEnter={() => onRevert()}
            type="button"
          >
            <span className="titleSuggestLabel">Nåværende</span>
            {currentTitle}
          </button>
          {titles.map((title, i) => (
            <button
              key={i}
              className="titleSuggestOption"
              onClick={() => handleCommit(title)}
              onMouseEnter={() => onPreview(title)}
              type="button"
            >
              {title}
            </button>
          ))}
          <button
            className="titleSuggestRefresh"
            onClick={fetchSuggestions}
            onMouseEnter={() => onRevert()}
            disabled={loading}
            type="button"
          >
            {loading ? "Genererer..." : "Nye forslag"}
          </button>
        </>
      )}
    </div>
  ) : null;

  return { button, dropdown };
}

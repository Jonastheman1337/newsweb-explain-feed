"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";

type Option = {
  value: string;
  label: string;
};

type SearchableSelectProps = {
  name: string;
  options: Option[];
  placeholder: string;
  searchPlaceholder: string;
  defaultValue?: string;
};

const VISIBLE_OPTION_CAP = 100;

/**
 * Folds Norwegian text for matching so "sok" finds "SØK" (and vice versa).
 * NFKD strips the å-ring; ø and æ do not decompose and need the explicit map.
 * Note: æ folds to "ae", so "sarlig" will not match "særlig" — "saerlig" will.
 */
export function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae");
}

export function SearchableSelect({
  name,
  options,
  placeholder,
  searchPlaceholder,
  defaultValue
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(defaultValue ?? "");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setSelected(defaultValue ?? "");
  }, [defaultValue]);

  const sortedOptions = useMemo(
    () => [...options].sort((a, b) => a.label.localeCompare(b.label, "nb")),
    [options]
  );

  const selectedOption = options.find((o) => o.value === selected);
  const query = normalizeSearchText(search);
  const filtered = query
    ? sortedOptions.filter((o) => normalizeSearchText(o.label).includes(query))
    : sortedOptions;

  const pinnedSelected = !query && selectedOption ? selectedOption : null;
  const listOptions = pinnedSelected
    ? [pinnedSelected, ...filtered.filter((o) => o.value !== pinnedSelected.value)]
    : filtered;
  const visibleOptions = listOptions.slice(0, VISIBLE_OPTION_CAP);
  const overflowCount = listOptions.length - visibleOptions.length;

  // Row 0 is the clear-selection row; option rows follow.
  const rowCount = visibleOptions.length + 1;

  useEffect(() => {
    setHighlightIndex(0);
  }, [search, open]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function commitSelection(value: string) {
    setSelected(value);
    setOpen(false);
    setSearch("");
  }

  function closeAndRefocus() {
    setOpen(false);
    setSearch("");
    triggerRef.current?.focus();
  }

  function handleSearchKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((prev) => Math.min(prev + 1, rowCount - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      // The select lives inside a GET form — Enter must pick, not submit.
      e.preventDefault();
      if (highlightIndex === 0) {
        commitSelection("");
      } else {
        const option = visibleOptions[highlightIndex - 1];
        if (option) {
          commitSelection(option.value);
        }
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeAndRefocus();
    }
  }

  return (
    <div ref={wrapRef} className="searchSelect">
      <input type="hidden" name={name} value={selected} />
      <button
        ref={triggerRef}
        type="button"
        className="searchSelectTrigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          setOpen(!open);
          setSearch("");
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        <span className="searchSelectLabel">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <span className="searchSelectArrow">&#x25BE;</span>
      </button>
      {open && (
        <div className="searchSelectDropdown">
          <input
            ref={inputRef}
            type="text"
            className="searchSelectSearch"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            autoFocus
          />
          <div className="searchSelectList" role="listbox">
            <button
              type="button"
              role="option"
              aria-selected={!selected}
              className={`searchSelectOption${!selected ? " active" : ""}${
                highlightIndex === 0 ? " highlighted" : ""
              }`}
              onClick={() => commitSelection("")}
            >
              {placeholder}
            </button>
            {visibleOptions.map((option, i) => (
              <button
                type="button"
                role="option"
                aria-selected={selected === option.value}
                key={`${option.value}-${i}`}
                title={option.label}
                className={`searchSelectOption${
                  selected === option.value ? " active" : ""
                }${highlightIndex === i + 1 ? " highlighted" : ""}`}
                onClick={() => commitSelection(option.value)}
              >
                {option.label}
              </button>
            ))}
            {overflowCount > 0 && (
              <div className="searchSelectMore">
                Skriv for å filtrere ({overflowCount} flere)
              </div>
            )}
            {listOptions.length === 0 && (
              <div className="searchSelectMore">Ingen treff</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

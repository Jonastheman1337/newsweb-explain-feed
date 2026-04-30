"use client";

import { useEffect, useRef, useState } from "react";

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
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find((o) => o.value === selected);
  const query = search.toLowerCase();
  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query))
    : options;

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

  return (
    <div ref={wrapRef} className="searchSelect">
      <input type="hidden" name={name} value={selected} />
      <button
        type="button"
        className="searchSelectTrigger"
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
            autoFocus
          />
          <div className="searchSelectList">
            <button
              type="button"
              className={`searchSelectOption${!selected ? " active" : ""}`}
              onClick={() => {
                setSelected("");
                setOpen(false);
                setSearch("");
              }}
            >
              {placeholder}
            </button>
            {filtered.slice(0, 100).map((option, i) => (
              <button
                type="button"
                key={`${option.value}-${i}`}
                className={`searchSelectOption${selected === option.value ? " active" : ""}`}
                onClick={() => {
                  setSelected(option.value);
                  setOpen(false);
                  setSearch("");
                }}
              >
                {option.label}
              </button>
            ))}
            {filtered.length > 100 && (
              <div className="searchSelectMore">
                Skriv for a filtrere ({filtered.length - 100} flere)
              </div>
            )}
            {filtered.length === 0 && (
              <div className="searchSelectMore">Ingen treff</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

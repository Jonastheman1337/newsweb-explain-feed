"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { SearchableSelect } from "../searchable-select";
import { Preferences } from "./preferences";
import styles from "./refresh.module.css";

export type RefreshFilterValues = {
  q?: string;
  market?: string;
  category?: string;
  issuer?: string;
  important?: string;
};
type Option = { value: string; label: string };

export function RefreshFilters({
  params,
  markets,
  categories,
  issuers,
  mutedCategories,
  connection
}: {
  params: RefreshFilterValues;
  markets: Option[];
  categories: Option[];
  issuers: Option[];
  mutedCategories: string[];
  connection: ReactNode;
}) {
  const filtersRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (filtersRef.current?.open && !filtersRef.current.contains(event.target as Node))
        filtersRef.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const active = [
    { name: "q", value: params.q, label: params.q ? `Søk: ${params.q}` : "" },
    { name: "market", value: params.market, label: markets.find((option) => option.value === params.market)?.label ?? params.market },
    { name: "category", value: params.category, label: categories.find((option) => option.value === params.category)?.label ?? params.category },
    { name: "issuer", value: params.issuer, label: issuers.find((option) => option.value === params.issuer)?.label ?? params.issuer }
  ].filter((filter) => filter.value);
  const filterCount = active.filter((filter) => filter.name !== "q").length + mutedCategories.length;

  function without(name: string) {
    const query = new URLSearchParams();
    for (const key of ["q", "market", "category", "issuer", "important"] as const) {
      if (key !== name && params[key]) query.set(key, params[key]!);
    }
    return `/next${query.size ? `?${query}` : ""}`;
  }

  return (
    <form className={styles.filters} action="/next">
      <div className={styles.filterToolbar}>
        <div className={styles.search}>
          <input name="q" aria-label="Søk i børsmeldinger" placeholder="Søk i børsmeldinger" defaultValue={params.q} />
          <button type="submit">Søk</button>
        </div>
        {params.important === "1" && <input type="hidden" name="important" value="1" />}
        <details
          ref={filtersRef}
          className={styles.filterPopover}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || !filtersRef.current?.open) return;
            if (filtersRef.current.querySelector('[aria-haspopup="listbox"][aria-expanded="true"]')) return;
            event.preventDefault();
            filtersRef.current.open = false;
            filtersRef.current.querySelector("summary")?.focus();
          }}
        >
          <summary>Filter{filterCount ? ` (${filterCount})` : ""}</summary>
          <div className={styles.filterFields}>
            <SearchableSelect name="market" placeholder="Alle markeder" searchPlaceholder="Søk etter marked" defaultValue={params.market} options={markets} />
            <SearchableSelect name="category" placeholder="Alle kategorier" searchPlaceholder="Søk etter kategori" defaultValue={params.category} options={categories} />
            <SearchableSelect name="issuer" placeholder="Alle utstedere" searchPlaceholder="Søk etter selskap eller ticker" defaultValue={params.issuer} options={issuers} />
            <div className={styles.filterActions}>
              <Link href="/next">Nullstill søk og filter</Link>
              <button type="submit">Vis meldinger</button>
            </div>
            <Preferences categories={categories.map((category) => category.value)} defaultMuted={mutedCategories} />
          </div>
        </details>
        {connection}
      </div>
      {active.length > 0 && (
        <div className={styles.activeFilters} aria-label="Aktive søk og filter">
          {active.map((filter) => (
            <Link key={filter.name} href={without(filter.name)} aria-label={`Fjern ${filter.label}`}>
              {filter.label} <span aria-hidden="true">×</span>
            </Link>
          ))}
        </div>
      )}
    </form>
  );
}

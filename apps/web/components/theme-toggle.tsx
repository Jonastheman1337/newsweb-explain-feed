"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    if (stored === "light") {
      document.documentElement.setAttribute("data-theme", "light");
      setDark(false);
    }
  }, []);

  function toggle() {
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    setDark(!dark);
  }

  return (
    <button
      className="themeToggle"
      onClick={toggle}
      aria-label={dark ? "Bytt til lyst tema" : "Bytt til morkt tema"}
      title={dark ? "Lyst tema" : "Morkt tema"}
    >
      {dark ? "\u263C" : "\u25CF"}
    </button>
  );
}

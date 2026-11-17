"use client";

import { Search, X } from "lucide-react";

/** The rounded "Search games…" box used above game lists. */
export function SearchBox({ value, onChange, className = "" }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <label className={`relative block max-w-md ${className}`}>
      <span className="sr-only">Search games</span>
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" strokeWidth={2.4} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search games… (try “draw”, “word”, “2 player”)"
        className="input rounded-full py-2.5 pr-10 pl-10"
        autoComplete="off"
        spellCheck={false}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-panel-2 hover:text-text"
        >
          <X aria-hidden className="size-4" strokeWidth={2.4} />
        </button>
      )}
    </label>
  );
}

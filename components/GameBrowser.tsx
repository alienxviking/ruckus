"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useId, useState } from "react";
import { matchesSearch, searchTerms } from "@/lib/search-games";
import { SearchBox } from "./SearchBox";
import { CATALOG, CATEGORY_LABEL, type GameCategory, type GameMeta } from "@/games/catalog";
import { GameCard } from "./GameCard";

type Filter = "all" | "fits" | GameCategory | "teams" | "call" | "duo" | "solo";

/** Handy groupings across categories. */
const GROUPS: { id: Filter; label: string; test: (g: GameMeta) => boolean }[] = [
  { id: "teams", label: "Teams", test: (g) => !!g.teams },
  { id: "call", label: "On a call", test: (g) => !!g.call },
  { id: "duo", label: "2 players", test: (g) => g.minPlayers <= 2 && g.maxPlayers >= 2 && g.maxPlayers <= 4 },
  { id: "solo", label: "Solo", test: (g) => g.minPlayers === 1 },
];

const CATEGORIES = Object.keys(CATEGORY_LABEL) as GameCategory[];
const GLIDE = { type: "spring", stiffness: 520, damping: 42, mass: 0.8 } as const;

/** The game grid with category filters. In a room, `playerCount` adds a "fits your group" filter. */
export function GameBrowser({
  selectedId,
  onSelect,
  disabled,
  playerCount,
  columns = "sm:grid-cols-2 lg:grid-cols-3",
  compact,
}: {
  selectedId?: string;
  onSelect?: (g: GameMeta) => void;
  disabled?: boolean;
  playerCount?: number;
  columns?: string;
  /** Smaller cards (the room lobby). */
  compact?: boolean;
}) {
  const uid = useId();
  const [filter, setFilter] = useState<Filter>("all");
  // The staggered CSS entrance plays once; after a filter change, motion handles entries.
  const [intro, setIntro] = useState(true);
  // Optimistic pick: highlight the clicked card at once, until the server's choice arrives.
  const [pending, setPending] = useState<{ id: string; from?: string } | null>(null);
  const activeId = pending && pending.from === selectedId ? pending.id : selectedId;
  const fits = (g: GameMeta) => playerCount !== undefined && playerCount >= g.minPlayers && playerCount <= g.maxPlayers;
  const group = GROUPS.find((x) => x.id === filter);
  const [query, setQuery] = useState("");
  const terms = searchTerms(query);
  const matches = (g: GameMeta) => matchesSearch(g, terms);
  const shown = CATALOG.filter(
    (g) => (filter === "all" ? true : filter === "fits" ? fits(g) : group ? group.test(g) : g.category === filter) && matches(g),
  );

  const chips: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "All", count: CATALOG.length },
    ...(playerCount !== undefined && playerCount > 0
      ? [{ id: "fits" as const, label: `Fits ${playerCount} ${playerCount === 1 ? "player" : "players"}`, count: CATALOG.filter(fits).length }]
      : []),
    ...CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABEL[c], count: CATALOG.filter((g) => g.category === c).length })),
    ...GROUPS.map((x) => ({ id: x.id, label: x.label, count: CATALOG.filter(x.test).length })).filter((c) => c.count > 0),
  ];

  return (
    <div>
      <SearchBox
        value={query}
        onChange={(v) => {
          setIntro(false);
          setQuery(v);
        }}
        className="mb-3"
      />
      <div
        className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-line bg-panel/70 p-1 [scrollbar-width:none] sm:inline-flex sm:max-w-full sm:flex-wrap"
        role="group"
        aria-label="Filter games"
      >
        {chips.map((c) => {
          const on = filter === c.id;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setIntro(false);
                setFilter(c.id);
              }}
              className={`relative min-h-9 shrink-0 rounded-lg px-3 text-sm whitespace-nowrap font-semibold transition-colors duration-200 ${
                on ? "text-ink" : "text-muted hover:text-text"
              }`}
            >
              {on && (
                <m.span
                  aria-hidden
                  layoutId={`${uid}-tab`}
                  transition={GLIDE}
                  className="absolute inset-0 rounded-lg bg-brand-2 shadow-[2px_3px_0_#6c8a00]"
                />
              )}
              <span className="relative">
                {c.label}{" "}
                <span className={`font-mono text-xs ${on ? "text-ink/60" : "text-muted/60"}`}>{c.count}</span>
              </span>
            </button>
          );
        })}
      </div>
      {shown.length === 0 ? (
        <p className="card px-4 py-6 text-center text-sm text-muted">
          {terms.length ? (
            <>
              <span className="marker text-lg text-text">kuch nahi mila 🤷</span> No games match “{query}”.{" "}
              <button type="button" className="font-bold text-brand-2 underline" onClick={() => setQuery("")}>
                Clear search
              </button>
            </>
          ) : (
            "No games fit this group size yet."
          )}
        </p>
      ) : (
        <div className={`relative grid ${compact ? "gap-2.5" : "gap-3"} ${columns}`}>
          <AnimatePresence mode="popLayout" initial={false}>
            {shown.map((g, i) => {
              const selected = g.id === activeId;
              return (
                <m.div
                  key={g.id}
                  layout="position"
                  transition={GLIDE}
                  initial={{ opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.16 } }}
                  className="relative"
                >
                  <div
                    className={`h-full ${intro ? "animate-rise" : ""}`}
                    style={intro ? { animationDelay: `${Math.min(i, 12) * 35}ms` } : undefined}
                  >
                    <GameCard
                      index={i}
                      compact={compact}
                      game={g}
                      selected={selected}
                      disabled={disabled}
                      onSelect={
                        onSelect
                          ? () => {
                              if (!disabled && g.id !== selectedId) setPending({ id: g.id, from: selectedId });
                              onSelect(g);
                            }
                          : undefined
                      }
                    />
                  </div>
                  {selected && (
                    // Outside the card (which clips). Keyed per game so it pops in on the new card.
                    <span
                      key={g.id}
                      aria-hidden
                      className="slap marker pointer-events-none absolute -top-2.5 -right-2 z-10 rounded-lg border-2 border-ink bg-brand-2 px-2 pb-0.5 text-lg leading-tight text-ink shadow-[2px_3px_0_#14101f]"
                      style={{ "--tilt": "7deg" } as React.CSSProperties}
                    >
                      picked!
                    </span>
                  )}
                </m.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

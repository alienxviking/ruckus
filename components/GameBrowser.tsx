"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useId, useState } from "react";
import { CATALOG, CATEGORY_LABEL, type GameCategory, type GameMeta } from "@/games/catalog";
import { GameCard } from "./GameCard";

type Filter = "all" | "fits" | GameCategory;

const CATEGORIES = Object.keys(CATEGORY_LABEL) as GameCategory[];
const GLIDE = { type: "spring", stiffness: 520, damping: 42, mass: 0.8 } as const;

/** The game grid with category filters. In a room, `playerCount` adds a "fits your group" filter. */
export function GameBrowser({
  selectedId,
  onSelect,
  disabled,
  playerCount,
  columns = "sm:grid-cols-2 lg:grid-cols-3",
}: {
  selectedId?: string;
  onSelect?: (g: GameMeta) => void;
  disabled?: boolean;
  playerCount?: number;
  columns?: string;
}) {
  const uid = useId();
  const [filter, setFilter] = useState<Filter>("all");
  // The staggered CSS entrance plays once; after a filter change, motion handles entries.
  const [intro, setIntro] = useState(true);
  const fits = (g: GameMeta) => playerCount !== undefined && playerCount >= g.minPlayers && playerCount <= g.maxPlayers;
  const shown = CATALOG.filter((g) =>
    filter === "all" ? true : filter === "fits" ? fits(g) : g.category === filter,
  );

  const chips: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "All", count: CATALOG.length },
    ...(playerCount !== undefined && playerCount > 0
      ? [{ id: "fits" as const, label: `Fits ${playerCount} ${playerCount === 1 ? "player" : "players"}`, count: CATALOG.filter(fits).length }]
      : []),
    ...CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABEL[c], count: CATALOG.filter((g) => g.category === c).length })),
  ];

  return (
    <div>
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
                  className="absolute inset-0 rounded-lg bg-brand-2 shadow-[0_0_24px_-6px_var(--color-brand-2)]"
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
        <p className="card px-4 py-6 text-center text-sm text-muted">No games fit this group size yet.</p>
      ) : (
        <div className={`relative grid gap-3 ${columns}`}>
          <AnimatePresence mode="popLayout" initial={false}>
            {shown.map((g, i) => {
              const selected = g.id === selectedId;
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
                      game={g}
                      selected={selected}
                      disabled={disabled}
                      onSelect={onSelect ? () => onSelect(g) : undefined}
                    />
                  </div>
                  {selected && (
                    // Outside the card (which clips), so the frame can glide across the grid.
                    <m.span
                      aria-hidden
                      layoutId={`${uid}-selected`}
                      transition={GLIDE}
                      className="pointer-events-none absolute -inset-px z-10 rounded-[0.75rem]"
                      style={{
                        boxShadow: `0 0 0 1.5px ${g.accent}, 0 0 32px -6px ${g.accent}, inset 0 0 24px -12px ${g.accent}`,
                      }}
                    />
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

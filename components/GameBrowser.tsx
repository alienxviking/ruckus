"use client";

import { useState } from "react";
import { CATALOG, CATEGORY_LABEL, type GameCategory, type GameMeta } from "@/games/catalog";
import { GameCard } from "./GameCard";

type Filter = "all" | "fits" | GameCategory;

const CATEGORIES = Object.keys(CATEGORY_LABEL) as GameCategory[];

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
  const [filter, setFilter] = useState<Filter>("all");
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
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter games">
        {chips.map((c) => {
          const on = filter === c.id;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(c.id)}
              className={`min-h-9 rounded-full border px-3 text-sm font-semibold transition-colors duration-200 ${
                on ? "border-brand bg-brand/15 text-text" : "border-line bg-panel text-muted hover:border-brand/50 hover:text-text"
              }`}
            >
              {c.label} <span className={on ? "text-brand" : "text-muted/70"}>{c.count}</span>
            </button>
          );
        })}
      </div>
      {shown.length === 0 ? (
        <p className="card px-4 py-6 text-center text-sm text-muted">No games fit this group size yet.</p>
      ) : (
        <div className={`grid gap-3 ${columns}`}>
          {shown.map((g, i) => (
            <GameCard
              key={g.id}
              index={i}
              game={g}
              selected={g.id === selectedId}
              disabled={disabled}
              onSelect={onSelect ? () => onSelect(g) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

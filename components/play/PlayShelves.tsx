"use client";

import Link from "next/link";
import { useState } from "react";
import type { GameMeta } from "@/games/catalog";
import { LOCAL_GAMES } from "@/lib/local-games";
import { matchesSearch, searchTerms } from "@/lib/search-games";
import { GameCard } from "../GameCard";
import { SearchBox } from "../SearchBox";

const SOLO = LOCAL_GAMES.filter((g) => g.minPlayers <= 1);
const BOTS = LOCAL_GAMES.filter((g) => g.minPlayers > 1);

/** The solo / vs-bots game lists, with a search box on top. */
export function PlayShelves() {
  const [query, setQuery] = useState("");
  const terms = searchTerms(query);
  const solo = SOLO.filter((g) => matchesSearch(g, terms));
  const bots = BOTS.filter((g) => matchesSearch(g, terms));
  return (
    <>
      <SearchBox value={query} onChange={setQuery} className="mb-8" />
      {!solo.length && !bots.length && (
        <p className="card mb-12 px-4 py-6 text-center text-sm text-muted">
          <span className="marker text-lg text-text">kuch nahi mila 🤷</span> No games match “{query}”.{" "}
          <button type="button" className="font-bold text-brand-2 underline" onClick={() => setQuery("")}>
            Clear search
          </button>
        </p>
      )}
      <Shelf id="solo" title="Solo" sub="Just you against the clock (bots optional where they fit)." games={solo} />
      <Shelf id="bots" title="You vs bots" sub="Practice bots fill the other seats." games={bots} />
    </>
  );
}

function Shelf({ id, title, sub, games }: { id: string; title: string; sub: string; games: GameMeta[] }) {
  if (!games.length) return null;
  return (
    <section aria-labelledby={`${id}-heading`} className="mb-12">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 id={`${id}-heading`} className="font-hero text-xl font-extrabold tracking-[-0.03em] sm:text-2xl">
            {title}
          </h2>
          <p className="mt-1 text-sm text-muted">{sub}</p>
        </div>
        <span className="text-xs font-bold text-muted">{games.length} games</span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {games.map((g, i) => (
          <li key={g.id} className="animate-rise" style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}>
            <Link href={`/play/${g.id}`} className="badge-trigger block h-full rounded-[0.7rem]" aria-label={`Play ${g.name}`}>
              <GameCard game={g} index={i} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

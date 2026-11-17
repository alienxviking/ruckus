"use client";

import { CATEGORY_LABEL, type GameMeta } from "@/games/catalog";

/** A game as a sticker: its cover art up top, then name, a line, and who it's for. */
export function GameCard({
  game,
  selected,
  onSelect,
  disabled,
  index = 0,
}: {
  game: GameMeta;
  selected?: boolean;
  onSelect?: () => void;
  disabled?: boolean;
  /** Position in the grid (alternates the hover tilt). */
  index?: number;
}) {
  const players =
    game.minPlayers === game.maxPlayers ? `${game.minPlayers}` : `${game.minPlayers}–${game.maxPlayers}`;
  const kind = game.call ? "On a call" : game.teams ? "Teams" : CATEGORY_LABEL[game.category];

  const body = (
    <>
      <span className="gc-cover">
        {/* Static, lazily loaded art (see scripts/gen-covers.tsx): costs nothing until on screen. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVGs; next/image adds nothing */}
        <img src={`/covers/${game.id}.svg`} alt="" width={320} height={200} loading="lazy" decoding="async" draggable={false} />
        {game.isNew && <span className="gc-new marker">new!</span>}
      </span>
      <span className="block px-3 pt-2.5 pb-3">
        <span className="block font-hero text-lg leading-tight font-extrabold tracking-[-0.01em]">{game.name}</span>
        <span className="mt-0.5 line-clamp-2 block text-sm leading-snug text-muted">{game.tagline}</span>
        <span className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="gc-chip">
            <b>{players}</b> players
          </span>
          <span className="gc-chip">~{game.minutes} min</span>
          <span className="gc-chip" style={{ color: game.accent }}>
            {kind}
          </span>
        </span>
        <span className="sr-only">
          {game.original ? ", a Ruckus original" : ""}
          {game.isNew ? ", new" : ""}
        </span>
      </span>
    </>
  );

  const style = { "--accent": game.accent, "--lift-tilt": index % 2 ? "1deg" : "-1deg" } as React.CSSProperties;
  // A column from the top: buttons centre their content vertically by default.
  const cls = `game-card lift flex h-full w-full flex-col justify-start overflow-hidden text-left ${selected ? "is-selected" : ""}`;
  if (!onSelect) {
    return (
      <div className={cls} style={style}>
        {body}
      </div>
    );
  }
  return (
    <button type="button" onClick={onSelect} disabled={disabled} aria-pressed={selected} className={`${cls} disabled:cursor-default`} style={style}>
      {body}
    </button>
  );
}

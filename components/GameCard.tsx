"use client";

import { CATEGORY_LABEL, type GameMeta } from "@/games/catalog";
import { CoverArt } from "./CoverArt";

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
        <CoverArt game={game} />
      </span>
      <span className="block px-3 pt-2.5 pb-3">
        {/* The poster shows the name; keep it for screen readers. */}
        <span className="sr-only">{game.name}: </span>
        <span className="line-clamp-2 block text-sm leading-snug text-muted">{game.tagline}</span>
        <span className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          {game.isNew && <span className="gc-new marker">new!</span>}
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

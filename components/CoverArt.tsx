import type { GameMeta } from "@/games/catalog";
import { GameGlyph } from "./game-icons";

// A game's cover as a printed poster: the name set huge in ink on the game's colour, its glyph
// blown up and cropped off the edge with a pink misprint shadow, a halftone and a small stamp.
// Plain HTML/CSS (real fonts, no images), sized with container units so it scales to any card.

/** Small stable hash, so each game always gets the same composition. */
function hash(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const LAYOUTS = ["tl", "bl", "tr"] as const;

export function CoverArt({ game, className = "" }: { game: GameMeta; className?: string }) {
  const h = hash(game.id);
  const layout = LAYOUTS[h % LAYOUTS.length];
  const tilt = ((h >> 3) % 2 ? 1 : -1) * (8 + ((h >> 5) % 10));
  const players = game.minPlayers === game.maxPlayers ? `${game.minPlayers}P` : `${game.minPlayers}–${game.maxPlayers}P`;
  const stamp = game.call ? "ON A CALL" : game.teams ? "TEAMS" : game.maxPlayers <= 2 ? "1V1" : game.minPlayers === 1 ? "SOLO OK" : "PARTY";
  return (
    <span aria-hidden className={`cover-art cv-${layout} ${className}`} style={{ "--a": game.accent, "--tilt": `${tilt}deg` } as React.CSSProperties}>
      <span className="cv-dots" />
      <span className="cv-glyph cv-glyph-shadow">
        <GameGlyph id={game.id} className="size-full" />
      </span>
      <span className="cv-glyph">
        <GameGlyph id={game.id} className="size-full" />
      </span>
      <span className="cv-name font-hero">{game.name}</span>
      <span className="cv-stamp">
        {stamp} · {players}
      </span>
    </span>
  );
}

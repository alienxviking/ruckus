// Which games can be played in this browser alone (no room, no server): solo games
// (minPlayers 1) and games with practice bots (GameDef.bot, flagged in games/<id>/config.ts).
import { CATALOG, CATALOG_BY_ID, type GameMeta } from "@/games/catalog";
import { GAME_CONFIG } from "@/games/config";

/** Most bots a local game seats (one per bot name). */
export const MAX_BOTS = 11;

export function hasBots(id: string): boolean {
  return !!GAME_CONFIG[id]?.bots;
}

export function canPlayLocal(id: string): boolean {
  const meta = CATALOG_BY_ID[id];
  return !!meta && (meta.minPlayers <= 1 || hasBots(id));
}

export const LOCAL_GAMES: GameMeta[] = CATALOG.filter((g) => canPlayLocal(g.id));

/** How many bots can join you in this game (0–0 for solo-only games). */
export function botRange(meta: GameMeta): { min: number; max: number } {
  if (!hasBots(meta.id)) return { min: 0, max: 0 };
  return { min: Math.max(0, meta.minPlayers - 1), max: Math.min(MAX_BOTS, meta.maxPlayers - 1) };
}

/**
 * The first pick: as few bots as the game allows. Games you can play alone start with none;
 * games that need an opponent start with just enough (usually one). More is one tap away.
 */
export function defaultBots(meta: GameMeta): number {
  return botRange(meta).min;
}

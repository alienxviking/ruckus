// Wins across every room, kept in this browser: they unlock accessories. Cosmetic only, so a
// local count is enough (nothing to cheat for).

import type { AccessoryId } from "@/shared/types";

const KEY = "ruckus:wins";

/** Wins needed for each accessory (0 = free). */
export const UNLOCK_AT: Record<AccessoryId, number> = {
  cap: 0,
  beanie: 0,
  shades: 0,
  bow: 0,
  flower: 0,
  headphones: 0,
  party: 1,
  horns: 2,
  halo: 3,
  tophat: 5,
  wizard: 8,
  crown: 12,
};

export function getWins(): number {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

/** Counts a win; returns the accessories it just unlocked. */
export function recordWin(): AccessoryId[] {
  const before = getWins();
  const after = before + 1;
  try {
    localStorage.setItem(KEY, String(after));
  } catch {
    /* not saved */
  }
  return (Object.keys(UNLOCK_AT) as AccessoryId[]).filter((a) => UNLOCK_AT[a] === after);
}

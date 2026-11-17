// Constants shared by Turf War's server logic and client. Keep this tiny and
// free of anything secret: it ships to browsers.

export const TICK_MS = 120;
export const COUNTDOWN_MS = 3_000;
export const PLAY_MS = 60_000;
/** Owner digits in the tile string are 0-7. */
export const MAX_PAINTERS = 8;
/** Pending turns per painter (a third press replaces the last one). */
export const QUEUE_MAX = 2;
/**
 * A turn may name the tick it should land on (`at`), so the client can show it before the
 * server confirms it. The server holds an early turn until then (never longer than this many
 * ticks); a late one lands on the next tick.
 */
export const MAX_HOLD = 4;

export const DIRS = ["up", "right", "down", "left"] as const;
export type Dir = (typeof DIRS)[number];
/** Column / row step for each entry of DIRS. */
export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;

export const POWER_KINDS = ["dash", "bomb", "freeze"] as const;
export type PowerKind = (typeof POWER_KINDS)[number];
/** `tile` is the badge background, picked so each emoji stays readable (the bomb is dark). */
export const POWER_INFO: Record<PowerKind, { icon: string; label: string; color: string; tile: string }> = {
  dash: { icon: "⚡", label: "Dash", color: "#facc15", tile: "#2a2350" },
  bomb: { icon: "💣", label: "Paint bomb", color: "#fb7185", tile: "#ffe4e6" },
  freeze: { icon: "🧊", label: "Freeze", color: "#7dd3fc", tile: "#0c3b5e" },
};
export const DASH_MS = 3_000;
export const FREEZE_MS = 1_500;
export const BOMB_RADIUS = 2;

/** Board size for a player count (normal: 40x26 up to 4 painters, 48x32 beyond) and the host's map choice. */
export function boardSize(players: number, map: string = "normal"): { w: number; h: number } {
  const few = players <= 4;
  if (map === "small") return few ? { w: 32, h: 21 } : { w: 40, h: 26 };
  if (map === "large") return few ? { w: 50, h: 32 } : { w: 58, h: 38 };
  return few ? { w: 40, h: 26 } : { w: 48, h: 32 };
}

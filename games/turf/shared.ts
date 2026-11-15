// Constants shared by Turf War's server logic and client. Keep this tiny and
// free of anything secret: it ships to browsers.

export const TICK_MS = 120;
export const COUNTDOWN_MS = 3_000;
export const PLAY_MS = 60_000;
/** Owner digits in the tile string are 0-7. */
export const MAX_PAINTERS = 8;

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

/** Board size for a player count: 40x26 up to 4 painters, 48x32 beyond. */
export function boardSize(players: number): { w: number; h: number } {
  return players <= 4 ? { w: 40, h: 26 } : { w: 48, h: 32 };
}

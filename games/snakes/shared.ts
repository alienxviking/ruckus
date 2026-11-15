// Constants and tiny helpers used by both the Snake Brawl server and client.
// (No secrets here: this file ships to browsers.)

export const DIRS = ["up", "right", "down", "left"] as const;
export type Dir = (typeof DIRS)[number];

export const TICK_MS = 110; // one cell per tick
export const COUNTDOWN_MS = 3_000;
export const ROUND_MS = 90_000;
export const ROUND_OVER_MS = 3_000;
export const WINS_NEEDED = 2;
export const MAX_ROUNDS = 5;
export const START_LEN = 4;
export const GOLDEN_VALUE = 3;
export const MAX_QUEUE = 3;
/**
 * A turn may name the step it should happen on (`at`), so the client can show it before the
 * server confirms it. The server holds an early turn until then (never longer than this many
 * steps); a late one simply happens on the next step.
 */
export const MAX_HOLD = 4;
/** With fewer than two players online between rounds, wait this long for someone to come back. */
export const REJOIN_MS = 10_000;
/** Dead snakes stay in the view this long so clients can flash them. */
export const GHOST_MS = 1_200;

export const DELTA: Record<Dir, readonly [number, number]> = {
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
};

export const OPPOSITE: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };

export type Phase = "countdown" | "play" | "roundOver" | "final";

/** How a snake died: wall, its own body, another snake's body, a head-on crash, or its player left. */
export type DeathCause = "wall" | "self" | "snake" | "head" | "left";

/**
 * Why a round ended: last snake standing, everyone crashed (draw),
 * time ran out and one snake was longest, or time ran out on a tie (draw).
 */
export type RoundReason = "last" | "crash" | "time" | "tie";

export function isDir(v: unknown): v is Dir {
  return typeof v === "string" && (DIRS as readonly string[]).includes(v);
}

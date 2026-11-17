// Seeds (Kalah) rules shared by the server, the bot and the client animation.
//
// Board layout: 14 slots, sown counter-clockwise in increasing index order.
//   0..5   seat 0's pits (left to right from seat 0's side)
//   6      seat 0's store
//   7..12  seat 1's pits
//   13     seat 1's store
// Pit i faces pit 12 - i across the board.

export type Seat = 0 | 1;

export const PITS = 6;
export const SLOTS = 14;
export const STORE: readonly [number, number] = [6, 13];
export const DEFAULT_SEEDS = 4;
/** Default move timer. */
export const TURN_MS = 30_000;
/** When the player to move is disconnected, a pit is sown for them this quickly. */
export const AWAY_MS = 5_000;
/** A participant gone this long forfeits the match. */
export const FORFEIT_MS = 60_000;
/** Pause between games (on top of the last move's animation). */
export const PAUSE_MS = 3_500;
/** Client animation: time per seed hop, and the extra beats after the last seed. */
export const HOP_MS = 110;
export const SETTLE_MS = 450;

export const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);
/** Board index of a seat's n-th pit (0-5). */
export const pitIndex = (seat: Seat, n: number) => (seat === 0 ? n : 7 + n);
export const opposite = (i: number) => 12 - i;
export const ownerOf = (i: number): Seat | null => (i >= 0 && i <= 5 ? 0 : i >= 7 && i <= 12 ? 1 : null);

export interface Capture {
  /** The pit the last seed landed in (its seed goes to the store too). */
  pit: number;
  /** The opposite pit whose seeds were taken. */
  from: number;
  /** Total seeds moved to the store (opposite pit + the landing seed). */
  n: number;
}

export interface SowResult {
  board: number[];
  /** Every slot a seed landed in, in order. */
  path: number[];
  capture: Capture | null;
  /** The last seed landed in the mover's store: they go again. */
  extra: boolean;
}

export function newBoard(seeds: number): number[] {
  const b = Array<number>(SLOTS).fill(seeds);
  b[STORE[0]] = 0;
  b[STORE[1]] = 0;
  return b;
}

/** Pit numbers (0-5) the seat may sow from. */
export function legalPits(board: number[], seat: Seat): number[] {
  const out: number[] = [];
  for (let n = 0; n < PITS; n++) if (board[pitIndex(seat, n)] > 0) out.push(n);
  return out;
}

export function sideEmpty(board: number[], seat: Seat): boolean {
  for (let n = 0; n < PITS; n++) if (board[pitIndex(seat, n)] > 0) return false;
  return true;
}

/** Sow from the seat's pit n (assumed legal). Pure: returns a new board. */
export function sow(board: number[], seat: Seat, n: number): SowResult {
  const b = board.slice();
  const start = pitIndex(seat, n);
  let hand = b[start];
  b[start] = 0;
  const skip = STORE[other(seat)];
  const path: number[] = [];
  let i = start;
  while (hand > 0) {
    i = (i + 1) % SLOTS;
    if (i === skip) continue;
    b[i] += 1;
    hand -= 1;
    path.push(i);
  }
  let capture: Capture | null = null;
  const extra = i === STORE[seat];
  if (!extra && ownerOf(i) === seat && b[i] === 1 && b[opposite(i)] > 0) {
    const from = opposite(i);
    const total = b[from] + 1;
    b[STORE[seat]] += total;
    b[from] = 0;
    b[i] = 0;
    capture = { pit: i, from, n: total };
  }
  return { board: b, path, capture, extra };
}

/**
 * When either side is empty the game ends: each seat banks what's left on its side.
 * Returns the seeds swept per seat (mutates the board), or null when play goes on.
 */
export function sweepIfOver(board: number[]): [number, number] | null {
  if (!sideEmpty(board, 0) && !sideEmpty(board, 1)) return null;
  const swept: [number, number] = [0, 0];
  for (const seat of [0, 1] as Seat[]) {
    for (let n = 0; n < PITS; n++) {
      const i = pitIndex(seat, n);
      swept[seat] += board[i];
      board[i] = 0;
    }
    board[STORE[seat]] += swept[seat];
  }
  return swept;
}

/** How long the client animates a move (the server waits this long before the next game). */
export function animMs(pathLen: number, capture: boolean, sweep: boolean): number {
  return pathLen * HOP_MS + SETTLE_MS + (capture ? 500 : 0) + (sweep ? 700 : 0);
}

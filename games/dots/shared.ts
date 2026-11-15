// Board geometry, timings and wire types shared by server.ts and client.tsx.
// Dots & Boxes is a perfect-information game, so nothing here is secret.
//
// Coordinates: a board of `rows` x `cols` boxes has (rows+1) x (cols+1) dots.
//   h line (r, c) joins dot (r, c) to dot (r, c+1):  r in 0..rows,   c in 0..cols-1
//   v line (r, c) joins dot (r, c) to dot (r+1, c):  r in 0..rows-1, c in 0..cols
//   box (r, c) is index r * cols + c; its sides are h(r,c), h(r+1,c), v(r,c), v(r,c+1).
// Line and box arrays are flat, row-major, holding the owner's seat index or -1.

export type Orientation = "h" | "v";

export interface LineRef {
  o: Orientation;
  r: number;
  c: number;
}

export type DotsAction =
  | { type: "line"; o: Orientation; r: number; c: number }
  /** Clear your "away" flag after missing moves (restarts your clock if it's your move). */
  | { type: "back" };

export interface LastLine extends LineRef {
  /** Seat that drew it. */
  seat: number;
  /** Box indices this line completed (0, 1 or 2). */
  claimed: number[];
  /** Drawn automatically (timeout or away player). */
  auto: boolean;
  /** Move number, 1-based. Handy as an animation key. */
  n: number;
}

export interface DotsView {
  rows: number;
  cols: number;
  /** Player ids by seat. Owners and `turn` below are seat indices. */
  seats: string[];
  h: number[];
  v: number[];
  boxes: number[];
  scores: number[];
  /** Seat to move, -1 once the game is over. */
  turn: number;
  /** Deadline of the current move (server ms), null once over. */
  endsAt: number | null;
  /** Full length of the current move's timer, for the timer bar. */
  turnMs: number;
  /** Per seat: missed moves in a row, so their moves are auto-played quickly. */
  idle: boolean[];
  lastLine: LastLine | null;
  /** Lines drawn so far. */
  moves: number;
  /** Too few players connected: the game ends at this time unless someone returns. */
  closeAt: number | null;
  over: boolean;
  reason: "done" | "forfeit" | null;
  /** Winning seats once over. */
  winners: number[];
  /** Viewer's seat, -1 for spectators. */
  you: number;
}

/** Normal thinking time per move. */
export const TURN_MS = 30_000;
/** A disconnected (or idle) player's move auto-plays after this. */
export const AWAY_MS = 5_000;
/** Follow-up auto-moves when an away player's auto-move closed a box. */
export const CHAIN_MS = 1_200;
/** With fewer than two players connected for this long, the game ends. */
export const ABANDON_MS = 30_000;
/** Consecutive timed-out moves (while connected) before a player counts as idle. */
export const IDLE_STRIKES = 2;

export function boardSize(players: number): { rows: number; cols: number } {
  if (players >= 4) return { rows: 6, cols: 6 };
  if (players === 3) return { rows: 5, cols: 6 };
  return { rows: 5, cols: 5 };
}

export function lineCount(o: Orientation, rows: number, cols: number): number {
  return o === "h" ? (rows + 1) * cols : rows * (cols + 1);
}

/** Flat index of a line, or -1 when (r, c) is not a valid line on this board. */
export function lineIndex(o: Orientation, r: number, c: number, rows: number, cols: number): number {
  if (!Number.isInteger(r) || !Number.isInteger(c)) return -1;
  if (o === "h") return r >= 0 && r <= rows && c >= 0 && c < cols ? r * cols + c : -1;
  return r >= 0 && r < rows && c >= 0 && c <= cols ? r * (cols + 1) + c : -1;
}

/** Every line on the board: horizontal ones first, then vertical, row-major. */
export function allLines(rows: number, cols: number): LineRef[] {
  const out: LineRef[] = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c < cols; c++) out.push({ o: "h", r, c });
  for (let r = 0; r < rows; r++) for (let c = 0; c <= cols; c++) out.push({ o: "v", r, c });
  return out;
}

/** Owner seat of a line (-1 = not drawn). Assumes the line is valid. */
export function ownerOf(h: readonly number[], v: readonly number[], l: LineRef, rows: number, cols: number): number {
  return (l.o === "h" ? h : v)[lineIndex(l.o, l.r, l.c, rows, cols)] ?? -1;
}

/** Indices of the one or two boxes on either side of a line. */
export function boxesBeside(l: LineRef, rows: number, cols: number): number[] {
  const out: number[] = [];
  if (l.o === "h") {
    if (l.r > 0) out.push((l.r - 1) * cols + l.c);
    if (l.r < rows) out.push(l.r * cols + l.c);
  } else {
    if (l.c > 0) out.push(l.r * cols + l.c - 1);
    if (l.c < cols) out.push(l.r * cols + l.c);
  }
  return out;
}

/** The four sides of box b as lines: top, bottom, left, right. */
export function sidesOfBox(b: number, cols: number): LineRef[] {
  const r = Math.floor(b / cols);
  const c = b % cols;
  return [
    { o: "h", r, c },
    { o: "h", r: r + 1, c },
    { o: "v", r, c },
    { o: "v", r, c: c + 1 },
  ];
}

/**
 * Display colours by seat. Ownership is shown by colour, so when two players
 * picked the same colour the later one borrows an unused colour from `palette`.
 */
export function distinctColors(wanted: readonly string[], palette: readonly string[]): string[] {
  const taken = new Set<string>();
  return wanted.map((color) => {
    let c = color;
    if (taken.has(c)) c = palette.find((x) => !taken.has(x) && !wanted.includes(x)) ?? c;
    taken.add(c);
    return c;
  });
}

/** How many sides of box b are drawn (0-4). */
export function sideCount(h: readonly number[], v: readonly number[], b: number, cols: number): number {
  const r = Math.floor(b / cols);
  const c = b % cols;
  const vi = r * (cols + 1) + c;
  return (
    (h[r * cols + c] >= 0 ? 1 : 0) +
    (h[(r + 1) * cols + c] >= 0 ? 1 : 0) +
    (v[vi] >= 0 ? 1 : 0) +
    (v[vi + 1] >= 0 ? 1 : 0)
  );
}

// Constants and pure board logic used by both the server and the client UI.
//
// A board is a flat array of size*size cells, row by row: 0 = empty,
// 1 = seat 0's disc, 2 = seat 1's disc. On the wire it travels as a string of
// the same digits ("00012..."), which is far smaller than nested JSON arrays.

export type Seat = 0 | 1;

/** Board sizes the host can pick. */
export const SIZES = [6, 8] as const;
export const DEFAULT_SIZE = 8;
/** Game wins needed to take the match (1 = a single game). */
export const TARGET_WINS = 1;
/** Time to make a move before a random legal move is played for you. */
export const TURN_MS = 30_000;
/** When the player to move is disconnected, their move is auto-played this quickly. */
export const AWAY_MS = 5_000;
/** Pause between games so everyone can see the final board. */
export const PAUSE_MS = 4_000;
/** A participant gone this long forfeits the match. */
export const FORFEIT_MS = 60_000;

const DIRS: readonly [number, number][] = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

export const discOf = (seat: Seat) => seat + 1;
export const otherSeat = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

/** The opening position: four discs in the centre, the starter's on the rising diagonal. */
export function startBoard(size: number, starter: Seat): number[] {
  const b = Array<number>(size * size).fill(0);
  const m = size / 2;
  const s = discOf(starter);
  const o = discOf(otherSeat(starter));
  b[(m - 1) * size + (m - 1)] = o;
  b[m * size + m] = o;
  b[(m - 1) * size + m] = s;
  b[m * size + (m - 1)] = s;
  return b;
}

/** Cells that would flip if `seat` played at `cell` (empty = not a legal move). */
export function flipsFor(board: ArrayLike<number>, size: number, cell: number, seat: Seat): number[] {
  if (!Number.isInteger(cell) || cell < 0 || cell >= size * size || board[cell] !== 0) return [];
  const me = discOf(seat);
  const them = discOf(otherSeat(seat));
  const r0 = Math.floor(cell / size);
  const c0 = cell % size;
  const out: number[] = [];
  for (const [dr, dc] of DIRS) {
    let r = r0 + dr;
    let c = c0 + dc;
    const run: number[] = [];
    while (r >= 0 && r < size && c >= 0 && c < size && board[r * size + c] === them) {
      run.push(r * size + c);
      r += dr;
      c += dc;
    }
    if (run.length && r >= 0 && r < size && c >= 0 && c < size && board[r * size + c] === me) out.push(...run);
  }
  return out;
}

/** Every legal move for `seat`, in cell order. */
export function legalMoves(board: ArrayLike<number>, size: number, seat: Seat): number[] {
  const out: number[] = [];
  for (let i = 0; i < size * size; i++) if (board[i] === 0 && flipsFor(board, size, i, seat).length) out.push(i);
  return out;
}

export function countDiscs(board: ArrayLike<number>): [number, number] {
  let a = 0;
  let b = 0;
  for (let i = 0; i < board.length; i++) {
    if (board[i] === 1) a++;
    else if (board[i] === 2) b++;
  }
  return [a, b];
}

/** Decode the wire string back into numbers. */
export function parseBoard(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) - 48);
  return out;
}

/** Board coordinates in the usual notation: columns a-h, rows 1-8 from the top. */
export function cellName(cell: number, size: number): string {
  return `${String.fromCharCode(97 + (cell % size))}${Math.floor(cell / size) + 1}`;
}

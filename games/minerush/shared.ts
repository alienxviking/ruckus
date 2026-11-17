// Mine Rush: constants and wire types shared by the server and the client.
// Nothing secret lives here (mine layouts never leave server.ts).

export const READY_MS = 3_000;
export const PLAY_MS = 180_000;
export const STUN_MS = 4_000;
export const FREEZE_MS = 2_000;
export const MINE_PENALTY = 10;
export const GEM_POINTS = 15;
export const FLAG_POINTS = 2;
/** A scan covers the (2r+1)² square around the 🔍 cell. */
export const SCAN_RADIUS = 2;
/** With no participant connected for this long, the game ends. */
export const ABANDON_MS = 15_000;

export type Phase = "ready" | "play" | "over";
export type EndReason = "cleared" | "time" | "abandoned";
/** g = 💎 gem, s = 🔍 scan, f = ❄️ freeze. */
export type ItemKind = "g" | "s" | "f";

export const ITEMS: Record<ItemKind, { emoji: string; label: string; blurb: string }> = {
  g: { emoji: "💎", label: "Gem", blurb: `+${GEM_POINTS} points` },
  s: { emoji: "🔍", label: "Scan", blurb: "flags every mine around it, for you only" },
  f: { emoji: "❄️", label: "Freeze", blurb: `freezes everyone else for ${FREEZE_MS / 1000}s` },
};

/** Field sizes, smallest first. "normal" is 24×16, or 30×20 for 4+ players; small/large step one down/up. */
const SIZES = [
  { w: 18, h: 12 },
  { w: 24, h: 16 },
  { w: 30, h: 20 },
  { w: 36, h: 24 },
];

export type BoardChoice = "small" | "normal" | "large";

export function boardSize(players: number, choice: BoardChoice = "normal"): { w: number; h: number } {
  const base = players >= 4 ? 2 : 1;
  const k = base + (choice === "small" ? -1 : choice === "large" ? 1 : 0);
  return { ...SIZES[k] };
}

/** The up-to-8 cells touching `i` on a w×h board (row-major). */
export function neighbors(w: number, h: number, i: number): number[] {
  const x = i % w;
  const y = (i - x) / w;
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    const ny = y + dy;
    if (ny < 0 || ny >= h) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      if ((dx === 0 && dy === 0) || nx < 0 || nx >= w) continue;
      out.push(ny * w + nx);
    }
  }
  return out;
}

// ---------- wire types ----------

export type MrAction =
  | { type: "open"; cell: number }
  /** Click on an open number whose mines you've all flagged: opens the rest around it. */
  | { type: "chord"; cell: number }
  /** `q` is the client's own op counter, so a stale view never undoes a newer flag. */
  | { type: "flag"; cell: number; on: boolean; q: number }
  /** Ask for a fresh copy of the view (after a missed event). */
  | { type: "sync" };

export interface PlayerRow {
  score: number;
  /** Stunned (mine hit) until this server time. */
  stun: number;
  /** Frozen by someone's ❄️ until this server time. */
  frozen: number;
  /** Player index of whoever froze them last (-1 = nobody). */
  frozenBy: number;
}

export interface FinalRow {
  /** Safe cells opened. */
  opened: number;
  gems: number;
  booms: number;
  scans: number;
  freezes: number;
  /** Flags on mines / flags on safe cells at the end. */
  right: number;
  wrong: number;
  flagPts: number;
  score: number;
}

export interface MrView {
  phase: Phase;
  w: number;
  h: number;
  mines: number;
  /** Safe cells on the board / safe cells open. */
  safe: number;
  opened: number;
  startsAt: number;
  endsAt: number;
  /** Centre of the main starting opening (screens start scrolled there). */
  home: number;
  /** Public op counter: every board-changing op bumps it and its event carries the new value. */
  s: number;
  /**
   * w*h chars, row-major: "." hidden, "0"-"8" open, "x" exploded mine,
   * and once the game is over "m" for the mines nobody hit.
   */
  cells: string;
  /** w*h chars: "." nobody (the starting openings), "0"-"7" who opened it (player index). */
  own: string;
  /** Claimed pickups: [cell, kind, player index]. */
  items: [number, ItemKind, number][];
  /** Participant ids by player index. */
  ids: string[];
  ps: PlayerRow[];
  /** The viewer's player index, -1 for spectators. */
  you: number;
  /** The viewer's own flags (private). */
  flags: number[];
  /** The viewer's last flag op the server has processed. */
  fq: number;
  fin: FinalRow[] | null;
  why: EndReason | null;
  /** Everyone left: the game ends at this time unless someone comes back. */
  abandonAt: number | null;
}

/** A reveal (or chord) by player `p`. Cells come in flood order from `a`, the cell they clicked. */
export interface OpEvent {
  t: "op";
  s: number;
  p: number;
  a: number;
  /** Safe cells opened, with their numbers in `n` (one digit each). */
  o: number[];
  n: string;
  /** Mines exploded. */
  x: number[];
  /** Pickups claimed. */
  k: [number, ItemKind][];
  /** Points gained or lost / the player's score after. */
  d: number;
  sc: number;
  /** Stunned until (mine hit). */
  st?: number;
  /** Everyone else frozen until (❄️). */
  fz?: number;
  /** Only in the scanner's own copy: mines the 🔍 flagged for them. */
  sm?: number[];
}
/** Private: the server refused an open/chord on cell `c` or the flag op `q`. */
export interface NoEvent {
  t: "no";
  c?: number;
  q?: number;
}
/** Private: a full view, in reply to "sync". */
export interface FullEvent {
  t: "full";
  v: MrView;
}
export type MrEvent = OpEvent | NoEvent | FullEvent;

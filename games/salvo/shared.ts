// Salvo: constants and pure helpers shared by the server logic and the client UI.

/** A ship on a grid: top-left cell (r, c), direction (0 = across, 1 = down) and length. */
export interface Ship {
  r: number;
  c: number;
  d: 0 | 1;
  len: number;
}

/** Fleets by grid size. Index = ship id; names are shown in the dock and in "sunk" toasts. */
export const FLEETS: Record<number, { len: number; name: string }[]> = {
  10: [
    { len: 5, name: "Dreadnought" },
    { len: 4, name: "Cruiser" },
    { len: 3, name: "Corvette" },
    { len: 3, name: "Submarine" },
    { len: 2, name: "Skiff" },
  ],
  8: [
    { len: 4, name: "Cruiser" },
    { len: 3, name: "Corvette" },
    { len: 3, name: "Submarine" },
    { len: 2, name: "Skiff" },
  ],
};

export const GRID_SIZES = [8, 10] as const;
/** Shots per salvo in the fixed mode. */
export const SALVO = 3;
/** Time to place a fleet before the rest is placed at random for you. */
export const PLACE_MS = 75_000;
/** Default time to aim a salvo before it is fired for you. */
export const TURN_MS = 30_000;
/** A disconnected player's salvo (or unplaced fleet) is handled for them this quickly. */
export const AWAY_MS = 5_000;
/** A participant gone this long forfeits the match. */
export const FORFEIT_MS = 60_000;
/** Reveal pacing: a short lead-in, then one shell lands every SHOT_STEP ms, then a beat to read it. */
export const REVEAL_LEAD = 350;
export const SHOT_STEP = 520;
export const REVEAL_TAIL = 900;

export const revealMs = (shots: number) => REVEAL_LEAD + shots * SHOT_STEP + REVEAL_TAIL;

/** Cells (r * n + c) a ship covers. */
export function shipCells(s: Ship, n: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < s.len; k++) out.push((s.r + (s.d ? k : 0)) * n + (s.c + (s.d ? 0 : k)));
  return out;
}

export function inBounds(s: Ship, n: number): boolean {
  return s.r >= 0 && s.c >= 0 && (s.d ? s.r + s.len <= n && s.c < n : s.c + s.len <= n && s.r < n);
}

/** True when every placed ship is on the grid and none overlap (touching is fine). */
export function fleetOk(ships: (Ship | null)[], n: number): boolean {
  const used = new Set<number>();
  for (const s of ships) {
    if (!s) continue;
    if (!inBounds(s, n)) return false;
    for (const i of shipCells(s, n)) {
      if (used.has(i)) return false;
      used.add(i);
    }
  }
  return true;
}

/** Can `ship` go here given the other placed ships (ignoring index `skip`)? */
export function fits(ship: Ship, ships: (Ship | null)[], skip: number, n: number): boolean {
  if (!inBounds(ship, n)) return false;
  const mine = new Set(shipCells(ship, n));
  for (let i = 0; i < ships.length; i++) {
    const o = ships[i];
    if (i === skip || !o) continue;
    for (const cell of shipCells(o, n)) if (mine.has(cell)) return false;
  }
  return true;
}

/** Places every missing ship at random around the ones already placed. */
export function randomFill(ships: (Ship | null)[], lens: number[], n: number, random: () => number): Ship[] {
  for (let attempt = 0; attempt < 50; attempt++) {
    const out = lens.map((_, i) => ships[i] ?? null);
    let ok = true;
    for (let i = 0; i < lens.length && ok; i++) {
      if (out[i]) continue;
      ok = false;
      for (let tries = 0; tries < 300; tries++) {
        const d: 0 | 1 = random() < 0.5 ? 0 : 1;
        const len = lens[i];
        const r = Math.floor(random() * (d ? n - len + 1 : n));
        const c = Math.floor(random() * (d ? n : n - len + 1));
        const s: Ship = { r, c, d, len };
        if (fits(s, out, i, n)) {
          out[i] = s;
          ok = true;
          break;
        }
      }
    }
    if (ok) return out as Ship[];
    // The kept ships boxed us in: start again from an empty sea.
    ships = [];
  }
  // Unreachable for these grid sizes, but never fail: stack ships in rows.
  return lens.map((len, i) => ({ r: i * 2, c: 0, d: 0, len }));
}

export const colLabel = (c: number) => String.fromCharCode(65 + c);
export const cellName = (i: number, n: number) => `${colLabel(i % n)}${Math.floor(i / n) + 1}`;

// Rebuilds the full Turf War view on the client from the last full view plus the compact
// per-tick delta events (see TurfDelta in server.ts). Pure, so tests can check that the
// rebuilt view always equals what the server would have sent.

import type { PainterTuple, TurfDelta, TurfInputEcho, TurfView, TurfWire } from "./server";

/** Deltas kept for replay on top of the newest full view (a few seconds' worth). */
const KEEP = 48;
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const DIGIT = new Map([...B64].map((ch, i) => [ch, i]));

export function isTurfWire(e: unknown): e is TurfWire {
  if (!e || typeof e !== "object") return false;
  const k = (e as { k?: unknown }).k;
  if (k === "d") {
    const d = e as Partial<TurfDelta>;
    return typeof d.n === "number" && typeof d.at === "number" && typeof d.seq === "number" && Array.isArray(d.p);
  }
  if (k === "m") return typeof (e as Partial<TurfInputEcho>).rx === "number";
  if (k === "K") return !!(e as { v?: unknown }).v && typeof (e as { v: TurfView }).v === "object";
  return false;
}

/** Apply a tile change string (3 characters a tile) to the board string. Null if malformed. */
function paintTiles(tiles: string, c: string): string | null {
  if (c.length % 3) return null;
  const out = tiles.split("");
  for (let k = 0; k < c.length; k += 3) {
    const hi = DIGIT.get(c[k]);
    const lo = DIGIT.get(c[k + 1]);
    if (hi === undefined || lo === undefined) return null;
    const i = hi * 64 + lo;
    if (i >= out.length) return null;
    out[i] = c[k + 2];
  }
  return out.join("");
}

/** Apply one tick to the view of the tick before it. Null when it doesn't fit (a missed tick). */
export function applyDelta(v: TurfView, d: TurfDelta): TurfView | null {
  if (d.n !== v.tick + 1 || v.phase !== "play" || d.p.length !== v.players.length * 5) return null;
  const players = v.players.map((p, i): PainterTuple => {
    const j = i * 5;
    return [p[0], d.p[j], d.p[j + 1], d.p[j + 2], d.p[j + 3], d.p[j + 4], p[6], p[7]];
  });
  if (d.dz) {
    for (let k = 0; k + 2 < d.dz.length; k += 3) {
      const t = players[d.dz[k]];
      if (!t) return null;
      t[6] = d.dz[k + 1];
      t[7] = d.dz[k + 2];
    }
  }
  let tiles = v.tiles;
  if (typeof d.b === "string") {
    if (d.b.length !== v.tiles.length) return null;
    tiles = d.b;
  } else if (typeof d.c === "string" && d.c) {
    const next = paintTiles(tiles, d.c);
    if (next === null) return null;
    tiles = next;
  }
  let me = v.me;
  if (me && d.ap) {
    for (let k = 0; k + 1 < d.ap.length; k += 2) if (d.ap[k] === v.you) me = [d.ap[k + 1], me[1], me[2]];
  }
  const out: TurfView = { ...v, tiles, players, powers: d.pw ?? v.powers, seq: d.seq, tick: d.n, at: d.at };
  if (me) out.me = me;
  return out;
}

/** What the client has heard since the last full view. */
export interface Heard {
  deltas: TurfDelta[];
  /** A full view sent on request (after a missed tick). */
  key: TurfView | null;
  /** Your newest input echo. */
  echo: TurfInputEcho | null;
}

export const nothingHeard: Heard = { deltas: [], key: null, echo: null };

/** Fold a new event into what's been heard (returns a new object, for React state). */
export function hear(h: Heard, e: TurfWire): Heard {
  if (e.k === "d") {
    const deltas = h.deltas.filter((d) => d.n < e.n && d.n > e.n - KEEP);
    deltas.push(e);
    return { ...h, deltas };
  }
  if (e.k === "K") return { ...h, key: e.v };
  return { ...h, echo: e };
}

const newer = (a: TurfView | null, b: TurfView | null) => (!a ? b : !b ? a : b.tick > a.tick || b.seq > a.seq ? b : a);

/**
 * The view to show: the newest full view (from the room or a requested keyframe) with every
 * delta since applied in order. `gap` is true when a tick went missing (ask for a keyframe).
 */
export function rebuild(view: TurfView | null, h: Heard): { view: TurfView | null; gap: boolean; steps: TurfView[] } {
  let cur = newer(view, h.key);
  if (!cur) return { view: null, gap: false, steps: [] };
  let gap = false;
  // Every tick on the way, so the board can play each one even when several land in one render.
  const steps: TurfView[] = [cur];
  for (const d of h.deltas) {
    if (d.n <= cur.tick) continue;
    const next = applyDelta(cur, d);
    if (!next) {
      gap = cur.phase === "play";
      break;
    }
    cur = next;
    steps.push(cur);
  }
  const e = h.echo;
  if (e && cur.me && e.rx >= cur.me[1]) {
    cur = { ...cur, me: [Math.max(cur.me[0], e.ap ?? 0), e.rx, e.sl] };
    steps[steps.length - 1] = cur;
  }
  return { view: cur, gap, steps };
}

/** For tools (the bandwidth harness): apply one raw event to a plain state. */
export function applyEventForTools(state: unknown, e: unknown): unknown {
  if (!isTurfWire(e) || !state) return state;
  if (e.k === "K") return e.v;
  if (e.k !== "d") return state;
  return applyDelta(state as TurfView, e) ?? state;
}

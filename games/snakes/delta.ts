// Rebuilds the full Snake Brawl view on the client from the last full view plus the compact
// per-step delta events (see SnakeDelta in server.ts). Pure, so tests can check that the
// rebuilt view always equals what the server would have sent.

import type { SnakeDelta, SnakeEvent, SnakeInputEcho, SnakeView } from "./server";
import { DELTA, DIRS, GHOST_MS } from "./shared";

/** Deltas kept for replay on top of the newest full view (a few seconds' worth). */
const KEEP = 48;

export function isSnakeEvent(e: unknown): e is SnakeEvent {
  if (!e || typeof e !== "object") return false;
  const k = (e as { k?: unknown }).k;
  if (k === "d") {
    const d = e as Partial<SnakeDelta>;
    return typeof d.n === "number" && typeof d.r === "number" && typeof d.at === "number" && Array.isArray(d.m);
  }
  if (k === "m") return typeof (e as Partial<SnakeInputEcho>).rx === "number";
  if (k === "K") return !!(e as { v?: unknown }).v && typeof (e as { v: SnakeView }).v === "object";
  return false;
}

const newer = (a: SnakeView | null, b: SnakeView | null) => {
  if (!a) return b;
  if (!b) return a;
  if (a.round !== b.round) return a.round > b.round ? a : b;
  return b.tick > a.tick ? b : a;
};

/** Apply one step to the view of the step before it. Null when it doesn't fit (a missed step). */
export function applyDelta(v: SnakeView, d: SnakeDelta, me: string): SnakeView | null {
  if (d.r !== v.round || d.n !== v.tick + 1 || v.phase !== "play") return null;
  let mi = 0;
  let bad = false;
  let mine = -1;
  const best = { ...v.best };
  const snakes = v.snakes.map((sn, i) => {
    if (sn.id === me) mine = i;
    if (!sn.alive) {
      // A crashed snake's body leaves the view once its flash is over (as the server does it).
      return sn.body.length && d.at - (sn.diedAt ?? 0) >= GHOST_MS ? { ...sn, body: [] } : sn;
    }
    const dir = DIRS[d.m[mi]];
    const cells = d.m[mi + 1];
    const len = d.m[mi + 2];
    mi += 3;
    if (!dir || !Number.isInteger(cells) || cells < 1 || !Number.isInteger(len) || sn.body.length < 2) {
      bad = true;
      return sn;
    }
    const [dx, dy] = DELTA[dir];
    const body = [sn.body[0] + dx, sn.body[1] + dy, ...sn.body].slice(0, cells * 2);
    best[sn.id] = Math.max(best[sn.id] ?? 0, len);
    return { ...sn, body, dir, len };
  });
  if (bad || mi !== d.m.length) return null;
  let food = v.food;
  if (d.fa || d.fr) {
    const w = v.w;
    const gone = new Set(d.fr ?? []);
    const next: number[] = [];
    for (let i = 0; i + 1 < food.length; i += 2) if (!gone.has(food[i + 1] * w + food[i])) next.push(food[i], food[i + 1]);
    for (const c of d.fa ?? []) next.push(c % w, Math.floor(c / w));
    food = next;
  }
  const golden = d.g === undefined ? v.golden : d.g < 0 ? null : ([d.g % v.w, Math.floor(d.g / v.w)] as [number, number]);
  let you = v.me;
  if (you && d.ap) {
    for (let i = 0; i + 1 < d.ap.length; i += 2) if (d.ap[i] === mine) you = [d.ap[i + 1], you[1], you[2]];
  }
  const out: SnakeView = { ...v, tick: d.n, at: d.at, snakes, food, golden, best };
  if (you) out.me = you;
  return out;
}

/** What the client has heard since the last full view. */
export interface Heard {
  deltas: SnakeDelta[];
  /** A full view sent on request (after a missed step). */
  key: SnakeView | null;
  /** Your newest input echo. */
  echo: SnakeInputEcho | null;
}

export const nothingHeard: Heard = { deltas: [], key: null, echo: null };

/** Fold a new event into what's been heard (returns a new object, for React state). */
export function hear(h: Heard, e: SnakeEvent): Heard {
  if (e.k === "d") {
    const deltas = h.deltas.filter((d) => d.r === e.r && d.n < e.n && d.n > e.n - KEEP);
    deltas.push(e);
    return { ...h, deltas };
  }
  if (e.k === "K") return { ...h, key: e.v };
  return { ...h, echo: e };
}

/**
 * The view to show: the newest full view (from the room or a requested keyframe) with every
 * delta since applied in order. `gap` is true when deltas arrived that can't be applied yet
 * (a step went missing): the client then asks for a keyframe.
 */
export function rebuild(
  view: SnakeView | null,
  h: Heard,
  me: string,
): { view: SnakeView | null; gap: boolean; steps: SnakeView[] } {
  let cur = newer(view, h.key);
  if (!cur) return { view: null, gap: false, steps: [] };
  let gap = false;
  // Every step on the way, so the renderer can play each one even when several land at once
  // (a bunched delivery is rendered by React as a single update).
  const steps: SnakeView[] = [cur];
  for (const d of h.deltas) {
    if (d.r !== cur.round || d.n <= cur.tick) continue;
    const next = applyDelta(cur, d, me);
    if (!next) {
      gap = d.r === cur.round && cur.phase === "play";
      break;
    }
    cur = next;
    steps.push(cur);
  }
  const e = h.echo;
  if (e && cur.me && e.r === cur.round && e.rx >= cur.me[1]) {
    cur = { ...cur, me: [cur.me[0], e.rx, e.sl] };
    steps[steps.length - 1] = cur;
  }
  return { view: cur, gap, steps };
}

/** For tools (the bandwidth harness): apply one raw event to a plain state. */
export function applyEventForTools(state: unknown, e: unknown): unknown {
  if (!isSnakeEvent(e) || !state) return state;
  if (e.k === "K") return e.v;
  if (e.k !== "d") return state;
  return applyDelta(state as SnakeView, e, "") ?? state;
}

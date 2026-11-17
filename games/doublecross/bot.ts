// Practice bot for Double Cross. It only reads its own view: who it sits with, the public record
// of past flips, and its own pick. It chats in quick phrases, says it's done talking after a
// few seconds, and mostly splits, but it steals more from known thieves (and grudges are real).

import type { GameCtx } from "../../shared/game";
import { QUICK_HEIST, QUICK_PAIR, tallies, type DcAction, type DcView } from "./shared";
import type { DcState } from "./server";

interface Mem {
  key: string;
  /** Quick-chat lines still to say, with when. */
  lines: { at: number; q: number }[];
  readyAt: number;
  chooseAt: number;
}

const memory = new WeakMap<DcState, Map<number, Mem>>();

function stealOdds(v: DcView, seat: number, mates: number[]): number {
  const t = tallies(v.history, v.order.length);
  let threat = 0;
  for (const m of mates) {
    const x = t[m];
    const played = x ? x.splits + x.steals : 0;
    if (played) threat = Math.max(threat, x.steals / played);
  }
  // Grudge: a table-mate who stole while sitting with us.
  const burnedBy = v.history.some((r) =>
    r.tables.some((tb) => {
      const i = tb.seats.indexOf(seat);
      return i >= 0 && tb.c[i] === "split" && tb.seats.some((s2, j) => mates.includes(s2) && tb.c[j] === "steal");
    }),
  );
  if (v.heist) return Math.min(0.4, 0.1 + threat * 0.25);
  let p = 0.18 + threat * 0.4 + (burnedBy ? 0.35 : 0);
  if (v.round === v.rounds - 1) p += 0.1;
  return Math.max(0.05, Math.min(0.75, p));
}

export function dcBot(s: DcState, v: DcView, ctx: GameCtx): DcAction | null {
  const me = v.me;
  if (!me || me.table < 0) return null;
  const now = ctx.now();
  let mems = memory.get(s);
  if (!mems) memory.set(s, (mems = new Map()));
  const key = `${v.round}:${v.phase}`;
  let m = mems.get(me.seat);
  if (!m || m.key !== key) {
    const pool = v.heist ? QUICK_HEIST : QUICK_PAIR;
    const lines: Mem["lines"] = [];
    if (v.phase === "talk") {
      const n = ctx.random() < 0.35 ? 2 : 1;
      for (let i = 0; i < n; i++) lines.push({ at: now + 1200 + i * 2500 + ctx.random() * 2000, q: pool[Math.floor(ctx.random() * pool.length)] });
    }
    m = { key, lines, readyAt: now + 5000 + ctx.random() * 5000, chooseAt: now + 1000 + ctx.random() * 3500 };
    mems.set(me.seat, m);
  }

  if (v.phase === "talk") {
    if (m.lines.length && now >= m.lines[0].at) return { type: "say", q: m.lines.shift()!.q };
    if (!v.ready[me.seat] && now >= m.readyAt) return { type: "ready", v: true };
    return null;
  }
  if (v.phase === "choose") {
    if (me.choice !== null || now < m.chooseAt) return null;
    const mates = (v.tables[me.table]?.seats ?? []).filter((x) => x !== me.seat);
    return { type: "choose", c: ctx.random() < stealOdds(v, me.seat, mates) ? "steal" : "split" };
  }
  return null;
}

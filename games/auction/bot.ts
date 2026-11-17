// Practice bot for Going, Going, Gone!. It only ever sees its own seat's view: its
// peeks, the public bids and what's been opened. Medium skill: it pays up to roughly
// what a crate is worth to it (a hunch when it hasn't peeked), bluffs a little on junk
// it knows about, and reacts to rival bids after a human-ish pause.

import type { GameCtx } from "../../shared/game";
import type { AuAction, AuView } from "./server";
import { STEPS } from "./shared";

interface Mem {
  /** Planned "I've seen enough" time. */
  readyAt: number;
  /** Lot the ceiling was set for, and the most the bot will pay for it. */
  lot: number;
  max: number;
  /** Last lead it reacted to, and when it may bid next. */
  seen: string;
  at: number;
}

const memory = new WeakMap<object, Map<string, Mem>>();
const NEVER = Number.MAX_SAFE_INTEGER;

/** What the crate on the block is worth to this bot, in dollars. */
function ceiling(v: AuView, me: number, random: () => number): number {
  const crate = v.crates[v.lot];
  // What's already in the bot's vault (opened crates it bought).
  let vault = 0;
  for (const c of v.crates) if (c.status === "sold" && c.buyer === me && !c.gift && c.value !== null) vault += c.value;
  if (crate.gift) {
    if (crate.x2 === true) return Math.max(8, Math.round(vault * 0.6 + 10));
    if (crate.x2 === false) return random() < 0.4 ? 2 + Math.floor(random() * 5) : 0; // a small bluff
    return vault > 20 ? 2 : 2 + Math.floor(random() * 6); // a coin flip: not worth much
  }
  if (crate.value !== null) {
    if (crate.value >= 10) return Math.floor(crate.value * (0.65 + random() * 0.25));
    // Junk or cursed: sometimes bid it up a little to bait the others.
    const bluff = crate.value < 0 ? 0.35 : 0.5;
    return random() < bluff ? 2 + Math.floor(random() * 7) : 0;
  }
  // Never peeked: a hunch around the average crate.
  return Math.min(Math.floor(v.cash[me] * 0.6), 5 + Math.floor(random() * 16));
}

export function auctionBot(v: AuView, key: object, botId: string, ctx: GameCtx): AuAction | null {
  const me = v.me;
  if (me < 0) return null;
  const now = ctx.now();
  let bots = memory.get(key);
  if (!bots) memory.set(key, (bots = new Map()));
  let m = bots.get(botId);
  if (!m) {
    m = { readyAt: now + 3_000 + ctx.random() * 5_000, lot: -1, max: 0, seen: "", at: 0 };
    bots.set(botId, m);
  }

  if (v.phase === "peek") return !v.ready[me] && now >= m.readyAt ? { type: "ready" } : null;
  if (v.phase !== "lot" || now < v.openAt) return null;

  if (m.lot !== v.lot) {
    m.lot = v.lot;
    m.max = ceiling(v, me, ctx.random);
    m.seen = "";
  }
  const lead = v.lead;
  if (lead && lead.p === me) return null;
  const seen = `${v.lot}:${lead?.n ?? 0}`;
  if (m.seen !== seen) {
    m.seen = seen;
    m.at = now + 500 + ctx.random() * 2_000; // think before answering a new bid
  }
  if (now < m.at) return null;

  const cap = Math.min(v.cash[me], m.max);
  const min = lead ? lead.a + 1 : 1;
  if (min > cap) {
    m.at = NEVER; // out until someone else bids again
    return null;
  }
  const r = ctx.random();
  const raise = lead ? STEPS[r < 0.55 ? 0 : r < 0.9 ? 1 : 2] : 1 + Math.floor(r * 5);
  const amount = Math.max(min, Math.min(cap, (lead?.a ?? 0) + raise));
  m.at = now + 1_200; // if this bid is refused, try again shortly
  return { type: "bid", lot: v.lot, amount };
}

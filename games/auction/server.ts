import { shuffle, type GameCtx, type GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { auctionBot } from "./bot";
import { config } from "./config";
import {
  ABANDON_MS,
  GIFT_DRUM_MS,
  GIFT_SHOW_MS,
  GIFT_SOLD_MS,
  GOING_MS,
  HIST,
  INTRO_MS,
  LOTS,
  NOSALE_MS,
  NO_BID_MS,
  PEEKERS,
  PEEK_MS,
  SOLD_MS,
  STAMPS,
  START_CASH,
  WOODS,
  type AuEvent,
  type Bid,
  type CrateStatus,
  type Kind,
  type Phase,
} from "./shared";

// Going, Going, Gone!: eight mystery crates, auctioned live one at a time.
// Every crate's contents were privately shown to two random players before the
// auction, so the room is full of half-informed bidders. Score = cash + vault.
//
// Network: bids are tiny events (the action returns false); full views only go
// out when a phase changes. The countdown is derived on every client from the
// server timestamp of the last bid, so every screen shows the same gavel.

export type { Phase } from "./shared";

interface Crate {
  /** Index into STAMPS (-1 for the gift). Flavour only. */
  stamp: number;
  wood: number;
  /** The 🎁 double-or-nothing crate. */
  gift: boolean;
  /** Secret until opened. 0 for the gift. */
  value: number;
  /** Gift only: the coin is already flipped (true = ×2, false = ×0). Secret until the end. */
  x2: boolean;
  /** Slots who peeked inside. Secret until the final. */
  peekers: number[];
  status: CrateStatus;
  buyer: number;
  price: number;
}

export interface AuState {
  ids: string[];
  phase: Phase;
  /** Current phase deadline (for "lot": when the gavel falls). */
  endsAt: number;
  phaseMs: number;
  ready: boolean[];
  lot: number;
  /** Bids on the current lot are accepted from this time. */
  openAt: number;
  crates: Crate[];
  cash: number[];
  lead: Bid | null;
  /** Bids placed on the current lot. */
  n: number;
  /** Recent bids on the current lot: [slot, amount], oldest first. */
  hist: [number, number][];
  /** Gift phase: when the double-or-nothing result is shown. */
  giftAt: number;
  giftShown: boolean;
  /** Last refusal notice per slot (rate limit). */
  noticeAt: number[];
  /** Since when fewer than two players are connected. */
  awaySince: number | null;
  abandoned: boolean;
  over: boolean;
  scores: number[] | null;
}

export type AuAction = { type: "ready" } | { type: "bid"; lot: number; amount: number };

export interface CrateView {
  stamp: number;
  wood: number;
  gift: boolean;
  status: CrateStatus;
  /** Known to this viewer: public once opened, otherwise only your own peek. */
  value: number | null;
  /** You peeked inside this crate. */
  peeked: boolean;
  /** Gift outcome, when this viewer knows it. */
  x2: boolean | null;
  buyer: number;
  price: number;
  /** Who peeked (final only). */
  peekers: number[] | null;
}

export interface AuView {
  phase: Phase;
  ids: string[];
  /** Viewer's slot (-1 = spectator). */
  me: number;
  endsAt: number;
  phaseMs: number;
  ready: boolean[];
  lot: number;
  openAt: number;
  crates: CrateView[];
  cash: number[];
  lead: Bid | null;
  n: number;
  hist: [number, number][];
  giftAt: number;
  giftShown: boolean;
  /** The auction closes early at this time unless more bidders reconnect. */
  closeAt: number | null;
  abandoned: boolean;
  /** Final scores by slot (final only). */
  scores: number[] | null;
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

function rollValue(kind: Kind, random: () => number): number {
  if (kind === "treasure") return 10 + 5 * Math.floor(random() * 11); // 10..60
  if (kind === "cursed") return -(15 + 5 * Math.floor(random() * 6)); // -15..-40
  return Math.floor(random() * 6); // 0..5
}

/**
 * `lots` crates (8 by default): one 🎁 (never the first lot), 1–2 cursed (2–3 with 10),
 * 2 junk (1 with 6), the rest treasure.
 */
export function dealCrates(random: () => number, lots = LOTS): Crate[] {
  const cursed = (random() < 0.5 ? 1 : 2) + (lots >= 10 ? 1 : 0);
  const junk = lots <= 6 ? 1 : 2;
  const kinds = shuffle<Kind>(
    [
      ...Array<Kind>(cursed).fill("cursed"),
      ...Array<Kind>(junk).fill("junk"),
      ...Array<Kind>(lots - 1 - cursed - junk).fill("treasure"),
    ],
    random,
  );
  const giftLot = 1 + Math.floor(random() * (lots - 1));
  const stamps = shuffle(range(STAMPS.length), random);
  let k = 0;
  return range(lots).map((i) => {
    const gift = i === giftLot;
    const kind = gift ? null : kinds[k++];
    return {
      stamp: gift ? -1 : stamps[i],
      wood: Math.floor(random() * WOODS.length),
      gift,
      value: kind ? rollValue(kind, random) : 0,
      x2: gift ? random() < 0.5 : false,
      peekers: [],
      status: "up",
      buyer: -1,
      price: 0,
    };
  });
}

/**
 * Each crate is peeked by PEEKERS different players. Crates are visited in a random
 * order and always go to the players with the fewest peeks so far (ties broken at
 * random), so peeks are spread evenly and the pairings vary.
 */
export function assignPeeks(crates: Crate[], players: number, random: () => number) {
  const count = new Array<number>(players).fill(0);
  for (const c of shuffle(range(crates.length), random)) {
    const pick = shuffle(range(players), random)
      .sort((a, b) => count[a] - count[b])
      .slice(0, Math.min(PEEKERS, players));
    for (const p of pick) count[p] += 1;
    crates[c].peekers = pick.sort((a, b) => a - b);
  }
}

const connected = (ctx: GameCtx, id: string) => ctx.player(id)?.connected !== false;
const nameOf = (s: AuState, ctx: GameCtx, slot: number) => ctx.player(s.ids[slot])?.name ?? "Someone";

/** Sum of the crate values a slot owns, with the gift applied when `withGift`. */
export function vaultOf(s: AuState, slot: number, withGift: boolean): number {
  let v = 0;
  let gift: Crate | null = null;
  for (const c of s.crates) {
    if (c.status !== "sold" || c.buyer !== slot) continue;
    if (c.gift) gift = c;
    else v += c.value;
  }
  if (withGift && gift) v = gift.x2 ? v * 2 : 0;
  return v;
}

function openLot(s: AuState, ctx: GameCtx, lot: number) {
  const now = ctx.now();
  s.phase = "lot";
  s.lot = lot;
  s.openAt = now + INTRO_MS;
  s.endsAt = s.openAt + NO_BID_MS;
  s.phaseMs = NO_BID_MS;
  s.lead = null;
  s.n = 0;
  s.hist = [];
}

/** The gavel falls: sold to the top bidder, or no sale. */
function closeLot(s: AuState, ctx: GameCtx) {
  const c = s.crates[s.lot];
  if (s.lead) {
    c.status = "sold";
    c.buyer = s.lead.p;
    c.price = s.lead.a;
    s.cash[s.lead.p] -= s.lead.a;
    s.phaseMs = c.gift ? GIFT_SOLD_MS : SOLD_MS;
  } else {
    c.status = "unsold";
    s.phaseMs = NOSALE_MS;
  }
  s.phase = "sold";
  s.endsAt = ctx.now() + s.phaseMs;
}

/** After the last lot: the double-or-nothing reveal (if someone bought it), then the final. */
function startGift(s: AuState, ctx: GameCtx) {
  const g = s.crates.find((c) => c.gift);
  if (!g || g.status !== "sold") return finish(s, ctx);
  const now = ctx.now();
  s.phase = "gift";
  s.giftAt = now + GIFT_DRUM_MS;
  s.giftShown = false;
  s.endsAt = s.giftAt + GIFT_SHOW_MS;
  s.phaseMs = GIFT_DRUM_MS + GIFT_SHOW_MS;
}

function finish(s: AuState, ctx: GameCtx) {
  s.phase = "final";
  s.over = true;
  s.awaySince = null;
  s.endsAt = ctx.now();
  s.giftShown = true;
  for (const c of s.crates) if (c.status === "up") c.status = "unsold";
  const scores = s.ids.map((_, i) => s.cash[i] + vaultOf(s, i, true));
  s.scores = scores;
  const best = Math.max(...scores);
  const winners = s.ids.filter((_, i) => scores[i] === best);
  const names = winners.map((id) => ctx.player(id)?.name ?? "Someone");
  const gift = s.crates.find((c) => c.gift && c.status === "sold");
  let headline: string;
  if (s.crates.every((c) => c.status !== "sold")) headline = `Nobody bought a thing: everyone ties at $${best}`;
  else if (winners.length === s.ids.length) headline = `A ${winners.length}-way tie at $${best}!`;
  else if (winners.length > 1) headline = `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]} tie at $${best}`;
  else {
    const w = s.ids.indexOf(winners[0]);
    const doubled = gift && gift.buyer === w && gift.x2 && vaultOf(s, w, false) > 0;
    headline = `${names[0]} wins the auction with $${best}${doubled ? " after a 🎁 double!" : ""}`;
  }
  if (s.abandoned) headline += " (auction closed early)";
  ctx.end({ winners, headline, scores: Object.fromEntries(s.ids.map((id, i) => [id, scores[i]])) });
}

/** Too few bidders stayed: whatever is left goes unsold. */
function closeEarly(s: AuState, ctx: GameCtx) {
  s.abandoned = true;
  s.awaySince = null;
  s.lead = null;
  for (const c of s.crates) if (c.status === "up") c.status = "unsold";
  startGift(s, ctx);
}

/** Track whether at least two players are connected. Returns true if that changed. */
function updateAway(s: AuState, ctx: GameCtx): boolean {
  const here = s.ids.filter((id) => connected(ctx, id)).length;
  if (here >= 2 && s.awaySince !== null) {
    s.awaySince = null;
    return true;
  }
  if (here < 2 && s.awaySince === null && !s.abandoned) {
    s.awaySince = ctx.now();
    return true;
  }
  return false;
}

/** Everyone still connected has pressed ready. */
function allReady(s: AuState, ctx: GameCtx): boolean {
  const here = s.ids.map((id, i) => (connected(ctx, id) ? i : -1)).filter((i) => i >= 0);
  return here.length > 0 && here.every((i) => s.ready[i]);
}

/** Tell a bidder why a bid was refused (at most a few times a second). */
function notice(s: AuState, ctx: GameCtx, slot: number, lot: number, a: number, m: string) {
  const now = ctx.now();
  if (now - s.noticeAt[slot] < 200) return;
  s.noticeAt[slot] = now;
  ctx.emit({ k: "no", lot, a, m } satisfies AuEvent, { to: s.ids[slot] });
}

/** Returns true when shared state changed (a due sale happened); accepted bids go out as events. */
function placeBid(s: AuState, ctx: GameCtx, slot: number, lot: unknown, amount: unknown): boolean {
  if (!isInt(lot) || !isInt(amount) || lot < 0 || lot >= s.crates.length) return false;
  if (s.phase !== "lot" || lot !== s.lot) {
    if (lot === s.lot && s.phase === "sold") notice(s, ctx, slot, lot, amount, "Too late, the gavel already fell!");
    return false;
  }
  const now = ctx.now();
  // A sale that is due lands before the bid does: the server clock is the referee.
  if (now >= s.endsAt) {
    closeLot(s, ctx);
    notice(s, ctx, slot, lot, amount, "Too late, the gavel already fell!");
    return true;
  }
  if (now < s.openAt) {
    notice(s, ctx, slot, lot, amount, "Bidding opens in a moment…");
    return false;
  }
  const lead = s.lead;
  if (lead && lead.p === slot) {
    notice(s, ctx, slot, lot, amount, "You're already the top bidder.");
    return false;
  }
  if (amount < (lead ? lead.a + 1 : 1)) {
    const m = lead
      ? amount === lead.a
        ? `${nameOf(s, ctx, lead.p)} got there first with $${lead.a}.`
        : `Too low: ${nameOf(s, ctx, lead.p)} is already at $${lead.a}.`
      : "Bids start at $1.";
    notice(s, ctx, slot, lot, amount, m);
    return false;
  }
  if (amount > s.cash[slot]) {
    notice(s, ctx, slot, lot, amount, `You only have $${s.cash[slot]}.`);
    return false;
  }
  s.n += 1;
  s.lead = { n: s.n, p: slot, a: amount, at: now };
  s.hist.push([slot, amount]);
  if (s.hist.length > HIST) s.hist.splice(0, s.hist.length - HIST);
  s.endsAt = now + GOING_MS;
  ctx.emit({ k: "bid", lot, n: s.n, p: slot, a: amount, at: now } satisfies AuEvent);
  return false;
}

export const auction: GameDef<AuState, AuAction> = {
  id: "auction",

  setup(ctx) {
    const ids = ctx.players.map((p) => p.id);
    const set = readSettings(config.settings, ctx.settings);
    const crates = dealCrates(ctx.random, Number(set.crates) || LOTS);
    assignPeeks(crates, ids.length, ctx.random);
    const now = ctx.now();
    return {
      ids,
      phase: "peek",
      endsAt: now + PEEK_MS,
      phaseMs: PEEK_MS,
      ready: ids.map(() => false),
      lot: 0,
      openAt: 0,
      crates,
      cash: ids.map(() => START_CASH),
      lead: null,
      n: 0,
      hist: [],
      giftAt: 0,
      giftShown: false,
      noticeAt: ids.map(() => 0),
      awaySince: null,
      abandoned: false,
      over: false,
      scores: null,
    };
  },

  action(s, playerId, raw, ctx) {
    if (s.over) return false;
    const slot = s.ids.indexOf(playerId);
    if (slot < 0) return false;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const a = raw as Record<string, unknown>;
    if (a.type === "ready") {
      if (s.phase !== "peek" || s.ready[slot]) return false;
      s.ready[slot] = true;
      if (allReady(s, ctx)) openLot(s, ctx, 0);
      return true;
    }
    if (a.type === "bid") return placeBid(s, ctx, slot, a.lot, a.amount);
    return false;
  },

  tick(s, ctx) {
    if (s.over) return false;
    let changed = updateAway(s, ctx);
    const now = ctx.now();
    if (s.awaySince !== null && s.phase !== "gift" && now >= s.awaySince + ABANDON_MS) {
      closeEarly(s, ctx);
      return true;
    }
    switch (s.phase) {
      case "peek":
        if (now >= s.endsAt || allReady(s, ctx)) {
          openLot(s, ctx, 0);
          changed = true;
        }
        break;
      case "lot":
        if (now >= s.endsAt) {
          closeLot(s, ctx);
          changed = true;
        }
        break;
      case "sold":
        if (now >= s.endsAt) {
          if (s.lot + 1 < s.crates.length) openLot(s, ctx, s.lot + 1);
          else startGift(s, ctx);
          changed = true;
        }
        break;
      case "gift":
        if (!s.giftShown && now >= s.giftAt) {
          s.giftShown = true;
          changed = true;
        }
        if (now >= s.endsAt) {
          finish(s, ctx);
          changed = true;
        }
        break;
    }
    return changed;
  },
  tickMs: 250,

  bot(s, botId, ctx) {
    if (s.over) return null;
    return auctionBot(auction.view(s, botId, ctx) as AuView, s, botId, ctx);
  },

  playerLeft(s, _id, ctx) {
    if (!s.over) updateAway(s, ctx);
  },

  playerReturned(s, _id, ctx) {
    if (!s.over) updateAway(s, ctx);
  },

  view(s, viewerId): AuView {
    const me = s.ids.indexOf(viewerId);
    const final = s.phase === "final";
    return {
      phase: s.phase,
      ids: s.ids,
      me,
      endsAt: s.endsAt,
      phaseMs: s.phaseMs,
      ready: s.ready,
      lot: s.lot,
      openAt: s.openAt,
      crates: s.crates.map((c) => {
        const peeked = me >= 0 && c.peekers.includes(me);
        const open = c.status !== "up" || final;
        const giftKnown = final || (s.phase === "gift" && s.giftShown) || peeked;
        return {
          stamp: c.stamp,
          wood: c.wood,
          gift: c.gift,
          status: c.status,
          value: c.gift ? null : open || peeked ? c.value : null,
          peeked,
          x2: c.gift && giftKnown ? c.x2 : null,
          buyer: c.buyer,
          price: c.price,
          peekers: final ? c.peekers : null,
        };
      }),
      cash: s.cash,
      lead: s.lead,
      n: s.n,
      hist: s.hist,
      giftAt: s.giftAt,
      giftShown: s.giftShown,
      closeAt: s.awaySince === null || s.over ? null : s.awaySince + ABANDON_MS,
      abandoned: s.abandoned,
      scores: s.scores,
    };
  },
};

export default auction;

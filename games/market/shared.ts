// Constants and helpers used by both the server logic and the client UI.
// Nothing secret lives here: cards are dealt on the server with ctx.random.

export const ROUNDS = 3;
/** Trading time per round. */
export const TRADE_MS = 90_000;
/** Street cards flip this long after the round opens. */
export const FLIP_MS = [25_000, 50_000, 70_000] as const;
export const STREET = 3;
/** The bell: every card is revealed and positions settle. */
export const SETTLE_MS = 8_000;
/** With fewer than two traders connected this long, the market closes early. */
export const ABANDON_MS = 20_000;

/** Biggest size for one quote or one trade. */
export const SIZE_MAX = 5;
/** A trader can be long or short at most this many lots per round. */
export const POS_LIMIT = 15;
export const TAPE_MAX = 30;
/** Chart points per round; older points are thinned out past this. */
export const CHART_MAX = 60;

/** The House (a liquidity bot) uses owner slot -1. */
export const HOUSE = -1;
export const HOUSE_SIZE = 2;
export const HOUSE_SPREAD = 6;
/** The House shifts its prices one point per lot of inventory, at most this much. */
export const HOUSE_SKEW_MAX = 5;
export const HOUSE_LIMIT = 15;
/** Average card value (A=1 ... K=13): what an unseen card is worth on average. */
export const CARD_MEAN = 7;

/** A card is a code 0..51: value = code % 13 + 1, suit = code / 13 (cosmetic). */
export const cardValue = (code: number) => (code % 13) + 1;
export const cardSuit = (code: number) => Math.floor(code / 13) % 4;
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export const SUITS = ["♠", "♥", "♦", "♣"] as const;
export const SUIT_NAMES = ["spades", "hearts", "diamonds", "clubs"] as const;
export const cardRank = (code: number) => RANKS[code % 13];
export const isRedSuit = (code: number) => cardSuit(code) === 1 || cardSuit(code) === 2;

/** Highest legal price: every dealt card a King. */
export const maxPriceFor = (players: number) => 13 * (players + STREET);

/** Public fair value: known street cards plus the average for every card nobody can see. */
export function publicFair(street: readonly (number | null)[], players: number): number {
  let known = 0;
  let unknown = players;
  for (const c of street) {
    if (c === null) unknown += 1;
    else known += cardValue(c);
  }
  return known + CARD_MEAN * unknown;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Where the House quotes: public fair value ± the spread, shifted away from its
 * inventory (long → cheaper, to sell; short → dearer, to buy back). The skew is
 * capped below the spread, so the House always buys below and sells above fair value.
 */
export function houseQuotes(fair: number, inventory: number, maxPrice: number): { bid: number; ask: number } {
  const skew = -clamp(inventory, -HOUSE_SKEW_MAX, HOUSE_SKEW_MAX);
  return {
    bid: clamp(fair - HOUSE_SPREAD + skew, 1, maxPrice),
    ask: clamp(fair + HOUSE_SPREAD + skew, 1, maxPrice),
  };
}

/** One fill: [buyer slot, seller slot, price, qty, deciseconds since the round opened]. Slot -1 = House. */
export type Trade = [buyer: number, seller: number, price: number, qty: number, t: number];

/** Transient events (ctx.emit). */
export type MkEvent =
  /** A fill happened. n = the round's trade counter after it, a = the taker's slot (who hit a resting quote). */
  | { k: "t"; tr: Trade; n: number; a: number }
  /** Street card i turned over. */
  | { k: "flip"; i: number; c: number }
  /** The bell rang: the round settles at `v`. */
  | { k: "bell"; v: number }
  /** A note for one trader (why an order didn't go through, or was cut down). */
  | { k: "msg"; m: string };

export function isMkEvent(e: unknown): e is MkEvent {
  if (!e || typeof e !== "object") return false;
  const x = e as Record<string, unknown>;
  switch (x.k) {
    case "t":
      return (
        Array.isArray(x.tr) &&
        x.tr.length === 5 &&
        x.tr.every((v) => typeof v === "number") &&
        typeof x.n === "number" &&
        typeof x.a === "number"
      );
    case "flip":
      return typeof x.i === "number" && typeof x.c === "number";
    case "bell":
      return typeof x.v === "number";
    case "msg":
      return typeof x.m === "string";
    default:
      return false;
  }
}

/** "+12", "−7", "0". */
export function signed(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return "0";
}

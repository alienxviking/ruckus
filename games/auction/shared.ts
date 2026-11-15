// Constants, flavour and tiny helpers used by both the server and the client.
// Nothing secret lives here: crate values are dealt by the server at setup.

export type Phase = "peek" | "lot" | "sold" | "gift" | "final";
export type CrateStatus = "up" | "sold" | "unsold";
export type Kind = "treasure" | "junk" | "cursed";

export const LOTS = 8;
export const START_CASH = 100;
/** Players who peek inside each crate. */
export const PEEKERS = 2;

export const PEEK_MS = 15_000;
/** A new lot is presented this long before bids are accepted. */
export const INTRO_MS = 1_200;
/** No sale if nobody bids within this long after bidding opens. */
export const NO_BID_MS = 6_000;
/** "Going once", "going twice", "last call": each stage lasts this long. */
export const STAGE_MS = 1_500;
export const GOING_MS = STAGE_MS * 3;
export const SOLD_MS = 4_500;
export const GIFT_SOLD_MS = 3_800;
export const NOSALE_MS = 3_500;
/** Drum roll before the double-or-nothing result shows, then how long it stays up. */
export const GIFT_DRUM_MS = 2_600;
export const GIFT_SHOW_MS = 4_200;
/** With fewer than two bidders connected this long, the auction closes early. */
export const ABANDON_MS = 20_000;
/** Recent bids kept for the ticker. */
export const HIST = 6;
export const STEPS = [1, 5, 10] as const;

/** Stencil stamps on the crates: pure flavour, unrelated to what's inside. */
export const STAMPS = [
  "FRAGILE",
  "DO NOT OPEN",
  "THIS SIDE UP",
  "LOST & FOUND",
  "ATTIC FIND",
  "HANDLE WITH CARE",
  "AIRMAIL",
  "CUSTOMS HOLD",
  "SHIP'S HOLD",
  "ESTATE SALE",
  "UNCLAIMED",
  "TOP SECRET",
] as const;

/** Wood tints: [face, highlight, edge]. */
export const WOODS = [
  ["#c98b4f", "#e0a96f", "#7a4e26"],
  ["#a86f42", "#c48a5a", "#5e3a1d"],
  ["#d6a565", "#ecc286", "#94693a"],
  ["#b5653f", "#cf8159", "#6e331c"],
  ["#a58e6e", "#c0a987", "#64543f"],
] as const;

export const kindOf = (v: number): Kind => (v < 0 ? "cursed" : v <= 5 ? "junk" : "treasure");

const JUNK: [string, string][] = [
  ["🕸️", "Cobwebs"],
  ["🧦", "Odd sock"],
  ["🥫", "Dented can"],
  ["📼", "Old VHS tape"],
  ["🦆", "Rubber duck"],
  ["🧸", "Tatty teddy"],
];

/** What a crate turns out to hold, from its value (only shown once the value is known). */
export function contents(v: number): { emoji: string; name: string } {
  let e: [string, string];
  if (v < 0) e = v > -25 ? ["🪆", "Haunted doll"] : v > -35 ? ["💀", "Cursed skull"] : ["👹", "Demon mask"];
  else if (v <= 5) e = JUNK[Math.max(0, Math.min(5, v))];
  else if (v < 20) e = ["🪙", "Old coins"];
  else if (v < 30) e = ["📿", "Pearl necklace"];
  else if (v < 40) e = ["🏺", "Golden vase"];
  else if (v < 50) e = ["💍", "Diamond ring"];
  else if (v < 60) e = ["👑", "Royal crown"];
  else e = ["💎", "Giant diamond"];
  return { emoji: e[0], name: e[1] };
}

export const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");
export const money = (n: number) => (n < 0 ? `−$${-n}` : `$${n}`);

/** A bid: sequence number within the lot, bidder slot, amount, server time. */
export interface Bid {
  n: number;
  p: number;
  a: number;
  at: number;
}

export type AuEvent =
  /** A bid was accepted (sent to everyone). */
  | ({ k: "bid"; lot: number } & Bid)
  /** Your bid was refused (sent to the bidder only). */
  | { k: "no"; lot: number; a: number; m: string };

export function isAuEvent(e: unknown): e is AuEvent {
  if (!e || typeof e !== "object") return false;
  const k = (e as { k?: unknown }).k;
  return k === "bid" || k === "no";
}

/** When the current lot closes: last bid + the three stages, or the no-sale deadline. */
export const lotDeadline = (openAt: number, lead: Bid | null) => (lead ? lead.at + GOING_MS : openAt + NO_BID_MS);

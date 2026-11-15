// Constants and tiny pure helpers used by both the Liar's Dice server and client.

/** Dice-cup shake at the start of every round (no bidding yet). */
export const ROLL_MS = 1_700;
/** Time to bid or call before the server plays for you. */
export const TURN_MS = 30_000;
/** A disconnected player's turn is auto-played this quickly. */
export const AWAY_MS = 3_000;
/** With fewer than 2 connected players still holding dice for this long, the game ends. */
export const LONELY_MS = 30_000;
/** Faces you can bid on. Ones are wild and can't be bid. */
export const MIN_FACE = 2;
export const MAX_FACE = 6;
export const FACES = [2, 3, 4, 5, 6] as const;

export interface BidLike {
  qty: number;
  face: number;
}

/** Dice each player starts with: 5 for up to 4 players, 4 for 5–6, 3 for 7–8. */
export function startingDice(players: number): number {
  return players <= 4 ? 5 : players <= 6 ? 4 : 3;
}

/** A die counts towards a bid when it shows the face, or a wild one. */
export const matches = (value: number, face: number) => value === face || value === 1;

/** Is `bid` a legal raise over `prev` (or a legal opening bid when prev is null)? */
export function isLegalBid(bid: BidLike, prev: BidLike | null, total: number): boolean {
  if (!Number.isInteger(bid.qty) || !Number.isInteger(bid.face)) return false;
  if (bid.face < MIN_FACE || bid.face > MAX_FACE || bid.qty < 1 || bid.qty > total) return false;
  if (!prev) return true;
  return bid.qty > prev.qty || (bid.qty === prev.qty && bid.face > prev.face);
}

/** Smallest quantity that makes a legal bid on `face`, or null when none fits on the table. */
export function minQtyFor(face: number, prev: BidLike | null, total: number): number | null {
  const qty = !prev ? 1 : face > prev.face ? prev.qty : prev.qty + 1;
  return qty <= total ? qty : null;
}

/** The lowest legal raise over `prev` (null = no raise is possible, call instead). */
export function minRaise(prev: BidLike | null, total: number): BidLike | null {
  if (!prev) return total >= 1 ? { qty: 1, face: MIN_FACE } : null;
  if (prev.face < MAX_FACE) return { qty: prev.qty, face: prev.face + 1 };
  return prev.qty + 1 <= total ? { qty: prev.qty + 1, face: MIN_FACE } : null;
}

/**
 * Timeline of a showdown, in ms from its start: every die flips face up, the
 * matching ones light up one by one (`step` apart), then the verdict lands and
 * stays up until the next round.
 */
export function revealTiming(count: number) {
  const flip = 900;
  const step = count > 0 ? Math.max(110, Math.min(420, Math.round(2600 / count))) : 0;
  const verdict = flip + count * step + 450;
  return { flip, step, verdict, total: verdict + 3_000 };
}

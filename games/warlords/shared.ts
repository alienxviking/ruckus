// Constants and types shared by the Warlords server and client (no secrets here).

export const ROUNDS = 5;
export const CASTLES = 5;
export const TROOPS = 100;

/** Planning time; the first round gets a little longer while people learn the board. */
export const PLAN_MS = 40_000;
export const FIRST_PLAN_MS = 50_000;
/** "Armies march out" beat before the first castle is revealed. */
export const INTRO_MS = 1_400;
/** Each castle's battle stays on screen this long. */
export const STEP_MS = 1_800;
/** The dragon's castle lingers so the roar lands. */
export const DRAGON_EXTRA_MS = 1_200;
/** Round results before the next plan phase (shorter after the last round). */
export const SUMMARY_MS = 7_000;
export const LAST_SUMMARY_MS = 4_500;
/** With fewer than two warlords online this long, the game ends with the current standings. */
export const AWAY_END_MS = 30_000;

export const DRAGON_MIN = 10;
export const DRAGON_MAX = 40;
export const VALUE_MIN = 2;
export const VALUE_MAX = 9;

/** Client-side bar animation timings (ms into a castle's step). */
export const VERDICT_DELAY = 850;
export const DRAGON_VERDICT_DELAY = 1_350;

export type Phase = "plan" | "reveal" | "final";
/** How a player's army was chosen: locked in, an unlocked draft at the deadline, or the automatic even split. */
export type Source = "lock" | "draft" | "auto";

export interface CastleOutcome {
  /** Seats that took the castle (several = a split). Empty = nobody (dragon kept it or nobody came). */
  winners: number[];
  /** Points each winner got. */
  points: number;
}

/** A fully resolved round. Public once its reveal is over. */
export interface RoundRecord {
  round: number;
  names: string[];
  values: number[];
  /** Troops per seat, per castle. */
  alloc: number[][];
  src: Source[];
  dragon: { castle: number; strength: number };
  castles: CastleOutcome[];
  /** Points per seat this round. */
  gained: number[];
}

/** One castle's battle during the reveal. */
export interface CastleView extends CastleOutcome {
  /** Troops per seat at this castle. */
  troops: number[];
  /** Dragon strength when the dragon lives here, else null. */
  dragon: number | null;
}

export interface RevealView {
  /** 0 = armies marching out, 1..CASTLES = castle step-1 is being fought, CASTLES+1 = round summary. */
  step: number;
  /** Castles revealed so far, in order (length = min(step, CASTLES)). */
  castles: CastleView[];
  /** Known once its castle has been revealed. */
  dragon: { castle: number; strength: number } | null;
  src: Source[];
  /** This round's points per seat, only in the summary. */
  gained: number[] | null;
}

export interface WlView {
  phase: Phase;
  round: number;
  rounds: number;
  /** Participant ids in seat order; every per-seat array lines up with it. */
  order: string[];
  names: string[];
  values: number[];
  /** Deadline of the running phase/step (null in the final). */
  endsAt: number | null;
  phaseMs: number;
  /** Plan phase: who has locked in (never what they planned). */
  locked: boolean[];
  /** The viewer's own seat and plan (null for spectators). */
  me: { seat: number; draft: number[] | null; locked: boolean; alloc: number[] | null } | null;
  reveal: RevealView | null;
  /** Rounds whose reveal is over: everyone's past allocations, public. */
  history: RoundRecord[];
  /** Totals so far, counting only castles revealed to everyone. */
  scores: number[];
  /** Fewer than two warlords are online: the game ends at this time. */
  awayEndsAt: number | null;
  endedEarly: boolean;
}

export type WlAction =
  | { type: "plan"; alloc: number[] }
  | { type: "lock"; alloc?: number[] }
  | { type: "unlock" };

/** A valid allocation: CASTLES integers in 0..TROOPS summing to at most TROOPS. Null otherwise. */
export function parseAlloc(x: unknown): number[] | null {
  if (!Array.isArray(x) || x.length !== CASTLES) return null;
  let sum = 0;
  const out: number[] = [];
  for (const v of x) {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > TROOPS) return null;
    sum += v;
    out.push(v + 0); // normalise -0
  }
  return sum <= TROOPS ? out : null;
}

export const sum = (a: readonly number[]) => a.reduce((t, v) => t + v, 0);

export const evenSplit = () => Array.from({ length: CASTLES }, () => TROOPS / CASTLES);

/** "40·0·30·0·30" */
export const allocText = (a: readonly number[]) => a.join("·");

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Constants, types and pure helpers shared by the Double Cross server and client.
// Nothing secret lives here: choices and private chats only exist in server state.

/** Pot for a pair in rounds 1-5. A trio's pot is 1.5x, so a fair split pays the same per head. */
export const PAIR_POTS = [4, 6, 8, 10, 14] as const;
/** Pair rounds plus the final heist. */
export const ROUNDS = PAIR_POTS.length + 1;
/** The heist pot is about this much, rounded so it splits evenly between the crew. */
export const HEIST_POT = 30;

export const TALK_MS = 40_000;
export const HEIST_TALK_MS = 30_000;
export const CHOOSE_MS = 10_000;
/** Cards face down, drumroll. Choices are still secret during this beat. */
export const DRUM_MS = 2_000;
/** Cards face up and the payout, before the next round. */
export const RESULT_MS = 6_500;
/** The heist flips one card at a time, this far apart. */
export const HEIST_STAGGER_MS = 450;
/** Pair rounds: the verdict (stamp, payouts, scores) lands this long after the flip starts. */
export const PAIR_VERDICT_MS = 900;
/** Time after the last heist card flips before the verdict lands. */
export const HEIST_VERDICT_MS = 700;
/** With fewer than two players online this long, the game ends with the current standings. */
export const AWAY_END_MS = 30_000;
/** Players away longer than this when a round starts sit that round out. */
export const SIT_OUT_MS = 12_000;

export const MAX_MSG = 120;
/** Messages kept per table (for refreshes); older ones scroll away. */
export const KEEP_MSGS = 30;
/** Chat flood guard: at most this many messages per window, per player. */
export const SAY_BURST = 6;
export const SAY_WINDOW_MS = 4_000;

/** Quick phrases (sent by index). The first block suits pairs, the second the heist. */
export const QUICK = [
  "I'll split 🤞",
  "Trust me 😇",
  "You first 😏",
  "Deal? 🤝",
  "Check my record 📜",
  "Don't you dare 🗡️",
  "Pinky promise 🤙",
  "😂",
  "Everyone split! 🤝",
  "If two steal, we all lose 💥",
  "Who's the rat? 🐀",
  "I'm stealing. Split anyway 😈",
] as const;
export const QUICK_PAIR = [0, 1, 2, 3, 4, 5, 6, 7];
export const QUICK_HEIST = [8, 9, 10, 1, 11, 7];

export type Choice = "split" | "steal";
export type Phase = "talk" | "choose" | "reveal" | "final";
/** deal = nobody stole, steal = exactly one thief takes the pot, bust = two or more thieves get nothing. */
export type Outcome = "deal" | "steal" | "bust";

/** One chat line. `s` is the sender's seat, then either text `t` or quick phrase `q`. `n` echoes the sender's nonce. */
export interface Msg {
  i: number;
  s: number;
  t?: string;
  q?: number;
  n?: number;
}

/** A table after its flip: public forever after. Arrays line up with `seats`. */
export interface TableRec {
  seats: number[];
  pot: number;
  c: Choice[];
  /** True where nobody chose in time (counted as split). */
  auto: boolean[];
  gain: number[];
  out: Outcome;
}

export interface RoundRec {
  round: number;
  heist: boolean;
  tables: TableRec[];
  /** Seats that sat this round out (away when it started). */
  sitting: number[];
}

export interface TableView {
  seats: number[];
  pot: number;
}

export interface DcView {
  phase: Phase;
  round: number;
  rounds: number;
  heist: boolean;
  /** Reveal: 0 = cards face down (drumroll), 1 = flipped. */
  step: number;
  /** Deadline of the running phase/step (null in the final). */
  endsAt: number | null;
  phaseMs: number;
  /** Participant ids in seat order; per-seat arrays line up with it. */
  order: string[];
  /** This round's tables: who sits with whom (public). */
  tables: TableView[];
  sitting: number[];
  /** Talk: who is done talking (per seat). Empty otherwise. */
  ready: boolean[];
  /** Choose: who has locked a choice (never which). Empty otherwise. */
  locked: boolean[];
  /** Messages sent per table this round: activity only, never content. */
  chatter: number[];
  /** Revision of the ready/locked flags in this view; "ready"/"lock" events with a higher `x` are newer. */
  rev: number;
  /** Points per seat, counting only flipped rounds. */
  scores: number[];
  /** Every flipped round, including the current one once its cards are up. */
  history: RoundRec[];
  /** The viewer's own seat (null for spectators). table = -1 when sitting this round out. */
  me: { seat: number; table: number; msgs: Msg[]; choice: Choice | null } | null;
  /** Fewer than two players online: the game ends at this time. */
  awayEndsAt: number | null;
  endedEarly: boolean;
}

export type DcAction =
  | { type: "say"; t: string; n?: number }
  | { type: "say"; q: number; n?: number }
  | { type: "ready"; v: boolean }
  | { type: "choose"; c: Choice };

export type DcEvent =
  /** A chat line, sent only to the members of that table. */
  | { k: "msg"; r: number; g: number; m: Msg }
  /** Public activity counter for a table (no content). */
  | { k: "chat"; r: number; g: number; c: number }
  /** Your message `n` was not accepted (too fast, or talking is over). */
  | { k: "nope"; n: number }
  /** Your own pick (only you hear about it). */
  | { k: "pick"; r: number; c: Choice }
  /** Someone is (no longer) done talking. `x` orders it against views (DcView.rev). */
  | { k: "ready"; r: number; s: number; v: boolean; x: number }
  /** Someone locked a choice (never which). */
  | { k: "lock"; r: number; s: number; x: number };

/**
 * Pair-round pots for a game with `pairRounds` pair rounds (the host picks the length). Five
 * gives PAIR_POTS; shorter games skip steps, longer ones keep climbing by 2. Always even, so a
 * trio's 1.5x pot is whole.
 */
export function pairPots(pairRounds: number): number[] {
  if (pairRounds === PAIR_POTS.length) return [...PAIR_POTS];
  if (pairRounds < PAIR_POTS.length) {
    const n = Math.max(1, pairRounds);
    if (n === 1) return [PAIR_POTS[0]];
    return Array.from({ length: n }, (_, i) => PAIR_POTS[Math.round((i * (PAIR_POTS.length - 1)) / (n - 1))]);
  }
  return Array.from({ length: pairRounds }, (_, i) => (i < PAIR_POTS.length - 1 ? PAIR_POTS[i] : 12 + 2 * (i - (PAIR_POTS.length - 1))));
}

export const potFor = (round: number, size: number, pots: readonly number[] = PAIR_POTS) => {
  const base = pots[Math.min(pots.length, Math.max(1, round)) - 1];
  return size === 3 ? (base / 2) * 3 : base;
};

export const heistPot = (crew: number) => crew * Math.max(1, Math.round(HEIST_POT / Math.max(1, crew)));

/** Pays out one table: no thief = an even split, one thief takes everything, two or more = nothing. */
export function settle(choices: readonly Choice[], pot: number): { gain: number[]; out: Outcome } {
  const thieves = choices.filter((c) => c === "steal").length;
  if (thieves === 0) {
    const each = Math.floor(pot / Math.max(1, choices.length));
    return { gain: choices.map(() => each), out: "deal" };
  }
  if (thieves === 1) return { gain: choices.map((c) => (c === "steal" ? pot : 0)), out: "steal" };
  return { gain: choices.map(() => 0), out: "bust" };
}

const span = (a: number, b: number) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`;
// Control characters, zero-width and bidi overrides.
const JUNK_RE = new RegExp(
  `[${span(0x00, 0x1f)}${span(0x7f, 0x9f)}${span(0x200b, 0x200f)}${span(0x2028, 0x202e)}${span(0x2060, 0x206f)}${String.fromCharCode(0xfeff)}]`,
  "g",
);

/** Strip control and invisible characters, collapse whitespace, trim and cap (by code point, so emoji stay whole). */
export function cleanText(input: unknown, max = MAX_MSG): string {
  if (typeof input !== "string") return "";
  const s = input
    .slice(0, max * 8)
    .replace(/\s+/g, " ")
    .replace(JUNK_RE, "")
    .replace(/ {2,}/g, " ")
    .trim();
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max).join("").trim();
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/** Per-seat tallies over the flipped rounds (for the reputation board and awards). */
export interface Tally {
  splits: number;
  steals: number;
  /** Rounds where this seat stole alone and took the pot. */
  heists: number;
  stolen: number;
  /** Times this seat split while someone at the table stole. */
  burned: number;
  busts: number;
}

export function tallies(history: readonly RoundRec[], seats: number): Tally[] {
  const out: Tally[] = Array.from({ length: seats }, () => ({ splits: 0, steals: 0, heists: 0, stolen: 0, burned: 0, busts: 0 }));
  for (const r of history) {
    for (const t of r.tables) {
      t.seats.forEach((seat, i) => {
        const me = out[seat];
        if (!me) return;
        if (t.c[i] === "split") {
          me.splits += 1;
          if (t.out !== "deal") me.burned += 1;
        } else {
          me.steals += 1;
          if (t.out === "steal") {
            me.heists += 1;
            me.stolen += t.gain[i];
          }
          if (t.out === "bust") me.busts += 1;
        }
      });
    }
  }
  return out;
}

export interface Award {
  key: "saint" | "backstabber" | "trusting";
  emoji: string;
  title: string;
  seats: number[];
  why: string;
}

/** Saint (fewest steals, then most splits), Backstabber (most stolen), Most trusting (split and got burned most). */
export function awards(history: readonly RoundRec[], seats: number): Award[] {
  const t = tallies(history, seats);
  const played = t.map((x, s) => (x.splits + x.steals > 0 ? s : -1)).filter((s) => s >= 0);
  const out: Award[] = [];
  const best = (score: (s: number) => number, pool: number[]) => {
    const top = Math.max(...pool.map(score));
    return pool.filter((s) => score(s) === top);
  };

  if (played.length) {
    const fewest = Math.min(...played.map((s) => t[s].steals));
    const pool = played.filter((s) => t[s].steals === fewest && t[s].splits > 0);
    if (pool.length) {
      const winners = best((s) => t[s].splits, pool);
      const w = t[winners[0]];
      out.push({
        key: "saint",
        emoji: "😇",
        title: "Saint",
        seats: winners,
        why: fewest === 0 ? `Never stole. Split ${plural(w.splits, "time")}.` : `Stole only ${plural(fewest, "time")}.`,
      });
    }
  }

  const thieves = played.filter((s) => t[s].stolen > 0);
  if (thieves.length) {
    const winners = best((s) => t[s].stolen * 100 + t[s].heists, thieves);
    const w = t[winners[0]];
    out.push({
      key: "backstabber",
      emoji: "🗡️",
      title: "Backstabber",
      seats: winners,
      why: `Stole ${w.stolen} points in ${w.heists} double-cross${w.heists === 1 ? "" : "es"}.`,
    });
  } else {
    const stealers = played.filter((s) => t[s].steals > 0);
    if (stealers.length) {
      const winners = best((s) => t[s].steals, stealers);
      out.push({
        key: "backstabber",
        emoji: "🗡️",
        title: "Would-be backstabber",
        seats: winners,
        why: `Tried to steal ${plural(t[winners[0]].steals, "time")} and never got away with it.`,
      });
    }
  }

  const burned = played.filter((s) => t[s].burned > 0);
  if (burned.length) {
    const winners = best((s) => t[s].burned * 100 + t[s].splits, burned);
    out.push({
      key: "trusting",
      emoji: "🫶",
      title: "Most trusting",
      seats: winners,
      why: `Split and got burned ${plural(t[winners[0]].burned, "time")}.`,
    });
  }
  return out;
}

import { shuffle, type GameCtx, type GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { splitTeams, TEAMS } from "../../shared/teams";
import { config } from "./config";
import {
  ABANDON_MS,
  BEAT_MS,
  BEAT_PULL,
  BEAT_WINDOWS,
  COLOUR_LOCK_MS,
  COLOUR_PULL,
  COLOUR_SLIP,
  COMEBACK,
  COUNTDOWN_MS,
  FIRST_COUNTDOWN_MS,
  FRENZY_MS,
  FRENZY_MULT,
  HEARTBEAT_MS,
  INKS,
  KINDS,
  LINE,
  MASH_MAX_TPS,
  MASH_PULL,
  ROUND_MS,
  ROUND_OVER_MS,
  SUMS_LOCK_MS,
  SUMS_PULL,
  SUMS_SLIP,
  TICK_MS,
  TYPE_BASE,
  TYPE_PER_LETTER,
  beatAt,
  streakMult,
  type AnswerEvent,
  type BeatEvent,
  type Kind,
  type Phase,
  type Prompt,
  type Snap,
} from "./shared";

// Tug of War (Ruckus original): two teams, one rope. Each round is one quick challenge (mash,
// type, sums, ink colours, rhythm); every correct input drags the flag toward your side, scaled by
// 1/team size so a team of 4 can't out-pull a team of 3 just by being bigger. Drag the flag over
// your line (or be ahead when time runs out) to take the round. The team losing ground pulls up to
// 60% harder near its own line, and the last 8 seconds pull 1.6x, so nothing is over until it is.
//
// The server ticks every 100 ms and sends one tiny rope snapshot event (skipped when nothing moved,
// with a heartbeat); full views only go out on phase changes. Answers get a private event back.

// ---------- words ----------

const WORDS = [
  "pull", "heave", "rope", "grip", "yank", "tug", "drag", "haul", "mud", "flag", "team", "win",
  "power", "brave", "storm", "tiger", "rocket", "jumbo", "turbo", "ninja", "pizza", "mango",
  "zebra", "cobra", "laser", "comet", "blaze", "frost", "thunder", "dragon", "muscle", "giant",
  "rumble", "crash", "smash", "bounce", "wobble", "jelly", "noodle", "pickle", "waffle", "banana",
  "rhino", "panda", "otter", "walrus", "moose", "llama", "goose", "badger", "falcon", "shark",
  "anchor", "harbor", "sailor", "pirate", "cannon", "treasure", "island", "volcano", "canyon",
  "glacier", "meteor", "planet", "galaxy", "orbit", "robot", "gadget", "engine", "piston",
  "hammer", "wrench", "bucket", "ladder", "castle", "knight", "shield", "sword", "arrow", "archer",
  "crown", "queen", "royal", "jungle", "safari", "desert", "cactus", "tornado", "bubble", "sparkle",
  "glitter", "confetti", "party", "dance", "disco", "groove", "rhythm", "drum", "guitar", "trumpet",
  "victory", "champion", "legend", "hero", "mighty", "strong", "steady", "quick", "swift", "fierce",
  "cheer", "shout", "roar", "stomp", "march", "sprint", "dash", "leap", "climb", "slide", "skid",
  "splash", "puddle", "muddy", "soggy", "gravy", "toast", "bagel", "donut", "cookie", "taco",
];

// ---------- state ----------

interface Puller {
  slot: number;
  id: string;
  team: 0 | 1;
  prompt: Prompt | null;
  /** The right answer to `prompt` (the word, or the index of the right choice). */
  ans: string | number;
  streak: number;
  lockUntil: number;
  /** Mash token bucket. */
  tokens: number;
  tokensAt: number;
  /** Last rhythm beat answered this round. */
  beat: number;
  /** Rope pulled this match (units) and right / wrong answers. */
  pulled: number;
  right: number;
  wrong: number;
  /** Pulled since the last frame. */
  tick: number;
}

export interface RoundRec {
  kind: Kind;
  /** Winning team, -1 = draw. */
  w: number;
  /** "line" = dragged over, "time" = ahead at the buzzer, "draw". */
  how: "line" | "time" | "draw";
}

export interface TugState {
  ids: string[];
  teams: [string[], string[]];
  winsNeeded: number;
  maxRounds: number;
  /** Challenge for each round, in order. */
  order: Kind[];
  phase: Phase;
  round: number;
  kind: Kind;
  endsAt: number;
  pullAt: number;
  pos: number;
  wins: [number, number];
  history: RoundRec[];
  pl: Puller[];
  nextQ: number;
  champion: number | null;
  forfeit: boolean;
  /** Since when each team has had nobody connected (null = someone is there). */
  gone: [number | null, number | null];
  frenzy: boolean;
  /** Rope pulled by each team since the last frame. */
  force: [number, number];
  snap: Snap;
  sent: Snap | null;
  sentAt: number;
  rev: number;
  /** Recently used words (avoid repeats). */
  recent: string[];
}

export type TugAction =
  | { type: "mash"; n: number }
  | { type: "word"; q: number; text: string }
  | { type: "pick"; q: number; c: number }
  | { type: "beat"; b: number; e: number };

export interface PromptState {
  prompt: Prompt | null;
  streak: number;
  lock: number;
}

export interface TugView {
  phase: Phase;
  round: number;
  kind: Kind;
  /** The challenge of the next round (shown during the round-over break). */
  nextKind: Kind | null;
  endsAt: number;
  pullAt: number;
  roundMs: number;
  frenzyMs: number;
  ids: string[];
  /** Team per slot (0 Red, 1 Blue). */
  team: number[];
  wins: [number, number];
  winsNeeded: number;
  maxRounds: number;
  history: RoundRec[];
  /** Rope pulled this match per slot (whole units). */
  pulled: number[];
  right: number[];
  champion: number | null;
  forfeit: boolean;
  /** The match ends at this time unless someone from the missing team returns. */
  abandonAt: number | null;
  snap: Snap;
  /** Your own question (players only). */
  me: PromptState | null;
}

// ---------- helpers ----------

const connected = (ctx: GameCtx, id: string) => ctx.player(id)?.connected !== false;
const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

function teamSize(s: TugState, ctx: GameCtx, t: number) {
  return Math.max(1, s.teams[t].filter((id) => connected(ctx, id)).length);
}

function newPrompt(s: TugState, p: Puller, ctx: GameCtx) {
  const q = s.nextQ++;
  const r = ctx.random;
  if (s.kind === "type") {
    let w = WORDS[Math.floor(r() * WORDS.length)];
    for (let i = 0; i < 6 && s.recent.includes(w); i++) w = WORDS[Math.floor(r() * WORDS.length)];
    s.recent.push(w);
    if (s.recent.length > 30) s.recent.shift();
    p.prompt = { k: "type", q, w };
    p.ans = w;
  } else if (s.kind === "sums") {
    const op = r();
    let a: number;
    let b: number;
    let ans: number;
    let text: string;
    if (op < 0.45) {
      a = 3 + Math.floor(r() * 17);
      b = 2 + Math.floor(r() * 12);
      ans = a + b;
      text = `${a} + ${b}`;
    } else if (op < 0.75) {
      a = 8 + Math.floor(r() * 22);
      b = 2 + Math.floor(r() * Math.min(a - 1, 12));
      ans = a - b;
      text = `${a} − ${b}`;
    } else {
      a = 2 + Math.floor(r() * 8);
      b = 2 + Math.floor(r() * 8);
      ans = a * b;
      text = `${a} × ${b}`;
    }
    const opts = new Set<number>([ans]);
    const near = shuffle([1, -1, 2, -2, 10, -10, 3, a, b].map((d) => ans + d), r);
    for (const v of near) {
      if (opts.size >= 4) break;
      if (v >= 0 && v !== ans) opts.add(v);
    }
    const c = shuffle([...opts], r);
    p.prompt = { k: "sums", q, a: text, c };
    p.ans = c.indexOf(ans);
  } else if (s.kind === "colour") {
    const n = INKS.length;
    const w = Math.floor(r() * n);
    let i = Math.floor(r() * n);
    // Mostly a clash (the word says one colour, the ink is another): that's the trick.
    if (i === w && r() < 0.85) i = (w + 1 + Math.floor(r() * (n - 1))) % n;
    const pool = shuffle(
      [...Array(n).keys()].filter((x) => x !== i && x !== w),
      r,
    );
    const c = shuffle([i, ...(w !== i ? [w] : []), ...pool].slice(0, 4), r);
    p.prompt = { k: "colour", q, w, i, c };
    p.ans = c.indexOf(i);
  } else {
    p.prompt = null;
    p.ans = -1;
  }
}

/** Move the rope for player `p`'s team: `units` for a team of one (negative = a slip). */
function pull(s: TugState, ctx: GameCtx, p: Puller, units: number): number {
  const dir = p.team === 0 ? -1 : 1;
  let d = units / teamSize(s, ctx, p.team);
  if (units > 0) {
    // Fighting back from your own side of the pit pulls harder, up to +60% at the line.
    if (s.pos * dir < 0) d *= 1 + COMEBACK * Math.min(1, Math.abs(s.pos) / LINE);
    if (s.frenzy) d *= FRENZY_MULT;
  }
  s.pos = Math.max(-LINE, Math.min(LINE, s.pos + dir * d));
  if (d > 0) {
    s.force[p.team] += d;
    p.pulled += d;
    p.tick += d;
  } else s.force[1 - p.team] += -d;
  return d;
}

function makeSnap(s: TugState, ctx: GameCtx): Snap {
  const w = s.pl.map((p) => Math.max(0, Math.min(9, Math.ceil(p.tick / 3)))).join("");
  const snap: Snap = {
    k: "s",
    n: s.round,
    t: ctx.now(),
    p: Math.round(s.pos * 10),
    f: [Math.round(s.force[0] * 10), Math.round(s.force[1] * 10)],
    w,
  };
  s.force = [0, 0];
  for (const p of s.pl) p.tick = 0;
  return snap;
}

function startRound(s: TugState, ctx: GameCtx) {
  s.kind = s.order[(s.round - 1) % s.order.length];
  s.phase = "countdown";
  s.endsAt = ctx.now() + (s.round === 1 ? FIRST_COUNTDOWN_MS : COUNTDOWN_MS);
  s.pullAt = s.endsAt;
  s.pos = 0;
  s.frenzy = false;
  s.force = [0, 0];
  for (const p of s.pl) {
    p.streak = 0;
    p.lockUntil = 0;
    p.tokens = 4;
    p.tokensAt = 0;
    p.beat = -1;
    p.tick = 0;
    newPrompt(s, p, ctx);
  }
}

function teamName(t: number) {
  return TEAMS[t]?.name ?? "Nobody";
}

function finishMatch(s: TugState, ctx: GameCtx, winner: number, forfeit = false) {
  if (s.phase === "final") return;
  s.phase = "final";
  s.endsAt = 0;
  s.champion = winner;
  s.forfeit = forfeit;
  const scores = Object.fromEntries(s.pl.map((p) => [p.id, Math.round(p.pulled)]));
  const [r, b] = s.wins;
  let headline: string;
  if (winner < 0) headline = `Tug of War ends level at ${r}–${b}: the rope wins`;
  else if (forfeit) headline = `${teamName(winner)} team wins the tug: the other side let go`;
  else headline = `${teamName(winner)} team wins the tug ${Math.max(r, b)}–${Math.min(r, b)} 🪢`;
  ctx.end({ winners: winner < 0 ? [] : s.teams[winner].slice(), headline, scores });
}

function finishRound(s: TugState, ctx: GameCtx, how: RoundRec["how"]) {
  const w: number = how === "draw" ? -1 : s.pos < 0 ? 0 : 1;
  s.history.push({ kind: s.kind, w, how });
  if (w === 0 || w === 1) s.wins[w] += 1;
  for (const p of s.pl) {
    p.prompt = null;
    p.ans = -1;
  }
  if ((w === 0 || w === 1) && s.wins[w] >= s.winsNeeded) return finishMatch(s, ctx, w);
  if (s.round >= s.maxRounds) {
    const [r, b] = s.wins;
    return finishMatch(s, ctx, r > b ? 0 : b > r ? 1 : -1);
  }
  s.phase = "roundOver";
  s.endsAt = ctx.now() + ROUND_OVER_MS;
}

/** Track teams with nobody connected; a team gone for ABANDON_MS loses. True when something changed. */
function checkGone(s: TugState, ctx: GameCtx): boolean {
  const now = ctx.now();
  let changed = false;
  for (const t of [0, 1] as const) {
    const here = s.teams[t].some((id) => connected(ctx, id));
    if (here && s.gone[t] !== null) {
      s.gone[t] = null;
      changed = true;
    } else if (!here && s.gone[t] === null) {
      s.gone[t] = now;
      changed = true;
    }
  }
  const [g0, g1] = s.gone;
  if (g0 !== null && g1 !== null) {
    if (now - Math.max(g0, g1) >= ABANDON_MS) {
      const [r, b] = s.wins;
      finishMatch(s, ctx, r > b ? 0 : b > r ? 1 : -1, true);
      return true;
    }
  } else if (g0 !== null && now - g0 >= ABANDON_MS) {
    finishMatch(s, ctx, 1, true);
    return true;
  } else if (g1 !== null && now - g1 >= ABANDON_MS) {
    finishMatch(s, ctx, 0, true);
    return true;
  }
  return changed;
}

function advance(s: TugState, ctx: GameCtx): boolean {
  if (s.phase === "final") return false;
  const now = ctx.now();
  let changed = checkGone(s, ctx);
  if ((s.phase as Phase) === "final") return true;
  switch (s.phase) {
    case "countdown":
      if (now < s.endsAt) return changed;
      s.phase = "pull";
      s.pullAt = now;
      s.endsAt = now + ROUND_MS;
      return true;
    case "pull":
      if (!s.frenzy && now >= s.endsAt - FRENZY_MS) {
        s.frenzy = true;
        changed = true;
      }
      if (Math.abs(s.pos) >= LINE) {
        finishRound(s, ctx, "line");
        return true;
      }
      if (now >= s.endsAt) {
        finishRound(s, ctx, Math.abs(s.pos) < 0.5 ? "draw" : "time");
        return true;
      }
      return changed;
    case "roundOver":
      if (now < s.endsAt) return changed;
      s.round += 1;
      startRound(s, ctx);
      return true;
  }
}

// ---------- view ----------

const viewCache = new WeakMap<TugState, { rev: number; snap: Snap; view: Omit<TugView, "me"> }>();

function sharedView(s: TugState): Omit<TugView, "me"> {
  const hit = viewCache.get(s);
  if (hit && hit.rev === s.rev && hit.snap === s.snap) return hit.view;
  const nextKind = s.phase === "roundOver" ? s.order[s.round % s.order.length] : null;
  const g = s.gone.filter((x): x is number => x !== null);
  const view: Omit<TugView, "me"> = {
    phase: s.phase,
    round: s.round,
    kind: s.kind,
    nextKind,
    endsAt: s.endsAt,
    pullAt: s.pullAt,
    roundMs: ROUND_MS,
    frenzyMs: FRENZY_MS,
    ids: s.ids.slice(),
    team: s.pl.map((p) => p.team),
    wins: [s.wins[0], s.wins[1]],
    winsNeeded: s.winsNeeded,
    maxRounds: s.maxRounds,
    history: s.history.map((h) => ({ ...h })),
    pulled: s.pl.map((p) => Math.round(p.pulled)),
    right: s.pl.map((p) => p.right),
    champion: s.champion,
    forfeit: s.forfeit,
    abandonAt: s.phase === "final" || !g.length ? null : (g.length === 2 ? Math.max(...g) : g[0]) + ABANDON_MS,
    snap: s.snap,
  };
  viewCache.set(s, { rev: s.rev, snap: s.snap, view });
  return view;
}

// ---------- practice bots ----------
// A bot plays its own question like a person would: a few taps a second when mashing, a word
// every couple of seconds with the odd typo, sums and inks right about 85% of the time after a
// short think, and rhythm taps a little off the beat. It sees only its own question (as a human
// in its seat would).

interface BotMem {
  next: number;
  /** Mashing speed (taps/s) this round, and taps owed. */
  tps: number;
  owed: number;
  round: number;
  lastBeat: number;
  /** How far off the beat this bot tends to be (ms). */
  wobble: number;
}

const botMemory = new WeakMap<TugState, Map<string, BotMem>>();

function botAction(s: TugState, botId: string, ctx: GameCtx): TugAction | null {
  const slot = s.ids.indexOf(botId);
  if (slot < 0 || s.phase !== "pull") return null;
  const p = s.pl[slot];
  let mems = botMemory.get(s);
  if (!mems) botMemory.set(s, (mems = new Map()));
  let m = mems.get(botId);
  const now = ctx.now();
  const r = ctx.random;
  if (!m || m.round !== s.round) {
    m = { next: now + 350 + r() * 600, tps: 4.4 + r() * 3.6, owed: 0, round: s.round, lastBeat: -1, wobble: 70 + r() * 130 };
    mems.set(botId, m);
  }
  if (now < m.next || now < p.lockUntil) return null;
  switch (s.kind) {
    case "mash": {
      const gap = 160 + r() * 80;
      m.owed += (m.tps * gap) / 1000;
      m.next = now + gap;
      // Now and then a bot gasps for breath.
      if (r() < 0.04) m.next += 500 + r() * 600;
      const n = Math.floor(m.owed);
      if (n < 1) return null;
      m.owed -= n;
      return { type: "mash", n: Math.min(8, n) };
    }
    case "type": {
      if (p.prompt?.k !== "type") return null;
      const w = p.prompt.w;
      m.next = now + 700 + w.length * (170 + r() * 90);
      const typo = r() < 0.08;
      return { type: "word", q: p.prompt.q, text: typo ? w.slice(0, -1) + "x" : w };
    }
    case "sums":
    case "colour": {
      if (!p.prompt || p.prompt.k === "type") return null;
      const think = s.kind === "sums" ? 1_150 + r() * 1_200 : 850 + r() * 800;
      m.next = now + think;
      const right = r() < (s.kind === "sums" ? 0.86 : 0.82);
      const c = typeof p.ans === "number" ? p.ans : 0;
      return { type: "pick", q: p.prompt.q, c: right ? c : (c + 1 + Math.floor(r() * 3)) % 4 };
    }
    case "rhythm": {
      const b = Math.round((now - beatAt(s.pullAt, 0)) / BEAT_MS);
      if (b < 0 || b <= m.lastBeat) {
        m.next = now + 40;
        return null;
      }
      m.lastBeat = b;
      m.next = now + 40;
      if (r() < 0.14) return null; // missed one
      const e = Math.round((r() + r() + r() - 1.5) * m.wobble);
      return { type: "beat", b, e: Math.max(-220, Math.min(220, e)) };
    }
  }
}

// ---------- game definition ----------

function wrong(s: TugState, ctx: GameCtx, p: Puller, slip: number, lockMs: number) {
  p.streak = 0;
  p.wrong += 1;
  p.lockUntil = ctx.now() + lockMs;
  return slip ? -pull(s, ctx, p, -slip) : 0;
}

export const tug: GameDef<TugState, TugAction> = {
  id: "tug",

  setup(ctx) {
    const ids = ctx.players.map((p) => p.id);
    const set = readSettings(config.settings, ctx.settings);
    const winsNeeded = set.wins as number;
    const mix = set.mix as string;
    const teams = splitTeams(ids, ctx.random);
    const pool: Kind[] = mix === "mash" ? ["mash"] : mix === "brainy" ? ["type", "sums", "colour"] : [...KINDS];
    // Mashing first (nobody needs it explained), then the rest in a shuffled rotation.
    const rest = shuffle(
      pool.filter((k) => k !== "mash" || pool.length === 1),
      ctx.random,
    );
    const order: Kind[] = pool.includes("mash") && pool.length > 1 ? ["mash", ...rest] : rest;
    const s: TugState = {
      ids,
      teams,
      winsNeeded,
      // Room for a couple of drawn rounds.
      maxRounds: winsNeeded * 2 + 1,
      order,
      phase: "countdown",
      round: 1,
      kind: order[0],
      endsAt: 0,
      pullAt: 0,
      pos: 0,
      wins: [0, 0],
      history: [],
      pl: ids.map((id, slot) => ({
        slot,
        id,
        team: (teams[0].includes(id) ? 0 : 1) as 0 | 1,
        prompt: null,
        ans: -1,
        streak: 0,
        lockUntil: 0,
        tokens: 4,
        tokensAt: 0,
        beat: -1,
        pulled: 0,
        right: 0,
        wrong: 0,
        tick: 0,
      })),
      nextQ: 1,
      champion: null,
      forfeit: false,
      gone: [null, null],
      frenzy: false,
      force: [0, 0],
      snap: { k: "s", n: 1, t: ctx.now(), p: 0, f: [0, 0], w: "" },
      sent: null,
      sentAt: 0,
      rev: 0,
      recent: [],
    };
    startRound(s, ctx);
    s.snap = makeSnap(s, ctx);
    return s;
  },

  action(s, playerId, action, ctx) {
    if (s.phase !== "pull") return false;
    const a: unknown = action;
    if (!a || typeof a !== "object" || Array.isArray(a)) return false;
    const slot = s.ids.indexOf(playerId);
    if (slot < 0) return false;
    const p = s.pl[slot];
    const rec = a as Record<string, unknown>;
    const now = ctx.now();
    const reply = (ev: AnswerEvent | BeatEvent) => ctx.emit(ev, { to: playerId });

    if (rec.type === "mash") {
      if (s.kind !== "mash" || !isInt(rec.n, 1, 8)) return false;
      // Token bucket: at most MASH_MAX_TPS taps a second land, with a small burst allowance.
      const dt = p.tokensAt ? Math.max(0, now - p.tokensAt) : 0;
      p.tokensAt = now;
      p.tokens = Math.min(5, p.tokens + (dt / 1000) * MASH_MAX_TPS);
      const n = Math.min(rec.n, Math.floor(p.tokens));
      if (n <= 0) return false;
      p.tokens -= n;
      p.right += n;
      pull(s, ctx, p, n * MASH_PULL);
      return false;
    }

    if (rec.type === "beat") {
      if (s.kind !== "rhythm" || !isInt(rec.b, 0, 10_000) || !isInt(rec.e, -1_000, 1_000)) return false;
      const b = rec.b;
      const t = beatAt(s.pullAt, b);
      // The tap must be about this beat: not far in the future, not long gone (allowing for lag).
      if (b <= p.beat || t > now + 400 || t < now - 1_500 || t > s.endsAt) return false;
      p.beat = b;
      const off = Math.abs(rec.e);
      const g = BEAT_WINDOWS.findIndex((w) => off <= w);
      if (g < 0) {
        reply({ k: "b", b, g: -1 });
        return false;
      }
      p.right += 1;
      pull(s, ctx, p, BEAT_PULL[g]);
      reply({ k: "b", b, g });
      return false;
    }

    if (rec.type === "word" || rec.type === "pick") {
      const pr = p.prompt;
      if (!pr || !isInt(rec.q, 0, 2 ** 31) || rec.q !== pr.q || now < p.lockUntil) return false;
      let ok: boolean;
      let v = 0;
      let lock = 0;
      if (rec.type === "word") {
        if (pr.k !== "type" || typeof rec.text !== "string" || rec.text.length > 40) return false;
        ok = rec.text.trim().toLowerCase() === pr.w;
        if (ok) {
          p.streak += 1;
          p.right += 1;
          v = pull(s, ctx, p, (TYPE_BASE + TYPE_PER_LETTER * pr.w.length) * streakMult(p.streak));
        } else {
          // A wrong word costs nothing but a short stumble.
          wrong(s, ctx, p, 0, 350);
          lock = p.lockUntil;
          reply({ k: "a", q: pr.q, ok: 0, v: 0, streak: 0, lock, next: pr });
          return false;
        }
      } else {
        if (pr.k === "type" || !isInt(rec.c, 0, 3)) return false;
        ok = rec.c === p.ans;
        const sums = pr.k === "sums";
        if (ok) {
          p.streak += 1;
          p.right += 1;
          v = pull(s, ctx, p, (sums ? SUMS_PULL : COLOUR_PULL) * streakMult(p.streak));
        } else {
          v = wrong(s, ctx, p, sums ? SUMS_SLIP : COLOUR_SLIP, sums ? SUMS_LOCK_MS : COLOUR_LOCK_MS);
          lock = p.lockUntil;
        }
      }
      newPrompt(s, p, ctx);
      reply({ k: "a", q: pr.q, ok: ok ? 1 : 0, v: Math.round(v * 10), streak: p.streak, lock, next: p.prompt });
      return false;
    }
    return false;
  },

  tick(s, ctx) {
    if (advance(s, ctx)) {
      s.rev += 1;
      s.snap = makeSnap(s, ctx);
      s.sent = s.snap;
      s.sentAt = ctx.now();
      return true;
    }
    if (s.phase !== "pull") return false;
    const snap = makeSnap(s, ctx);
    s.snap = snap;
    const now = ctx.now();
    const last = s.sent;
    const still = last && last.p === snap.p && snap.f[0] === 0 && snap.f[1] === 0 && last.f[0] === 0 && last.f[1] === 0;
    if (still && now - s.sentAt < HEARTBEAT_MS) return false;
    s.sent = snap;
    s.sentAt = now;
    ctx.emit(snap);
    return false;
  },
  tickMs: TICK_MS,

  bot(s, botId, ctx) {
    return botAction(s, botId, ctx);
  },

  view(s, viewerId) {
    const base = sharedView(s);
    const slot = s.ids.indexOf(viewerId);
    if (slot < 0) return { ...base, me: null } satisfies TugView;
    const p = s.pl[slot];
    return { ...base, me: { prompt: p.prompt, streak: p.streak, lock: p.lockUntil } } satisfies TugView;
  },

  playerLeft(s, _playerId, ctx) {
    checkGone(s, ctx);
    s.rev += 1;
  },

  playerReturned(s, _playerId, ctx) {
    checkGone(s, ctx);
    s.rev += 1;
  },
};

export default tug;

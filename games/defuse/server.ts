import type { GameCtx, GameDef } from "../../shared/game";
import {
  BOMBS,
  BOMB_MS,
  BRIEF_MS,
  CHAT_KEEP,
  DIAL_STEPS,
  GLYPHS,
  MAX_STRIKES,
  PAD_COLORS,
  RESULT_MS,
  STRIKE_SPEEDUP,
  TALK_COLORS,
  TAP_MS,
  cleanText,
  holdDigit,
  type DefuseEvent,
  type Edge,
  type Fact,
  type ModType,
  type ModView,
  type Msg,
} from "./shared";
import { dealFragments, makeBomb, makeManual, publicMod, type ModState } from "./rules";

// Defuse: one defuser sees the bomb, everyone else holds torn pages of a manual
// that is generated fresh every game. 3 bombs, the defuser rotates.

/** A participant away this long has their job handed on (defuser) or pages shared (expert). */
const AWAY_MS = 15_000;
/** With fewer than two connected players for this long, the game ends. */
const ABANDON_MS = 20_000;
/** A hold with no release (lost socket) is dropped after this. */
const HOLD_GIVEUP_MS = 15_000;
/** Release tolerance for the held-button counter (latency jitter). */
const RELEASE_SLACK_MS = 320;
const SAY_GAP_MS = 250;

export type Phase = "brief" | "live" | "result" | "over";
export type Outcome = "defused" | "boom";

interface Bomb {
  no: number;
  edge: Edge;
  mods: ModState[];
  defuser: string;
  /** Expert id -> indices into the manual. */
  frags: Record<string, number[]>;
  strikes: number;
  /** Clock: `left` bomb-ms remained at server time `anchor`; it runs at `rate`. */
  anchor: number;
  left: number;
  rate: number;
  outcome: Outcome | null;
  /** Bomb-ms left when it resolved. */
  leftAtEnd: number;
}

export interface BombRec {
  no: number;
  defuser: string;
  outcome: Outcome;
  left: number;
  strikes: number;
  mods: number;
  solved: number;
  points: number;
}

export interface DefuseState {
  phase: Phase;
  endsAt: number;
  order: string[];
  manual: Fact[];
  bomb: Bomb;
  history: BombRec[];
  ready: string[];
  chat: Msg[];
  chatSeq: number;
  lastSay: Record<string, number>;
  awaySince: Record<string, number>;
  /** Experts whose pages were already shared out while they were away (this bomb). */
  covered: string[];
  fewSince: number | null;
  team: number;
  /** First defuser's seat; bomb k is defused by order[(first + k) % n]. */
  first: number;
  over: boolean;
  abandoned: boolean;
}

export type DefuseAction =
  | { type: "ready" }
  | { type: "cut"; m: number; w: number }
  | { type: "hold"; m: number }
  | { type: "release"; m: number; n: number }
  | { type: "key"; m: number; k: number }
  | { type: "pad"; m: number; c: number }
  | { type: "dial"; m: number; pos: number }
  | { type: "say"; t?: string; g?: number; c?: string; n?: number };

export interface DefuseView {
  phase: Phase;
  endsAt: number;
  briefMs: number;
  resultMs: number;
  bombNo: number;
  bombs: number;
  role: "defuser" | "expert" | "spectator";
  defuser: string;
  order: string[];
  ready: string[];
  strikes: number;
  /** Server time the bomb blows at the current rate (live only). */
  explodeAt: number;
  rate: number;
  /** Bomb-ms left (frozen value outside the live phase). */
  left: number;
  outcome: Outcome | null;
  /** The bomb itself: defuser and spectators always, everyone once it resolves. */
  bomb: { edge: Edge; mods: ModView[] } | null;
  /** Everyone sees which module types are on the bomb and which are done. */
  checklist: { t: ModType; done: boolean }[];
  /** This expert's torn pages (null for the defuser and spectators). */
  page: Fact[] | null;
  /** How many experts share the manual (for the "pages" caption). */
  experts: number;
  chat: Msg[] | null;
  history: BombRec[];
  team: number;
  abandoned: boolean;
}

const connected = (ctx: GameCtx, id: string) => ctx.player(id)?.connected !== false;
const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);

function bombLeft(b: Bomb, now: number) {
  return Math.max(0, b.left - (now - b.anchor) * b.rate);
}
const explodeAt = (b: Bomb) => b.anchor + b.left / b.rate;

function newBomb(s: DefuseState, ctx: GameCtx, no: number): Bomb {
  const n = s.order.length;
  // Rotate; skip anyone who isn't connected right now.
  let defuser = s.order[(s.first + no) % n];
  for (let k = 0; k < n && !connected(ctx, defuser); k++) defuser = s.order[(s.first + no + k + 1) % n];
  const { edge, mods } = makeBomb(ctx.random, s.manual, no);
  const experts = s.order.filter((id) => id !== defuser);
  const frags = dealFragments(
    ctx.random,
    s.manual,
    mods.map((m) => m.t),
    experts,
  );
  return { no, edge, mods, defuser, frags, strikes: 0, anchor: ctx.now(), left: BOMB_MS, rate: 1, outcome: null, leftAtEnd: BOMB_MS };
}

function startBrief(s: DefuseState, ctx: GameCtx, no: number) {
  s.bomb = newBomb(s, ctx, no);
  s.phase = "brief";
  s.endsAt = ctx.now() + BRIEF_MS;
  s.ready = [];
  s.covered = [];
  // Someone already away: share their pages straight away.
  for (const id of Object.keys(s.awaySince)) coverFor(s, id);
}

function goLive(s: DefuseState, ctx: GameCtx) {
  s.phase = "live";
  s.bomb.anchor = ctx.now();
  s.bomb.left = BOMB_MS;
  s.bomb.rate = 1;
  s.endsAt = explodeAt(s.bomb);
}

function resolve(s: DefuseState, ctx: GameCtx, outcome: Outcome) {
  const b = s.bomb;
  const now = ctx.now();
  b.leftAtEnd = outcome === "boom" ? 0 : bombLeft(b, now);
  b.left = b.leftAtEnd;
  b.anchor = now;
  b.outcome = outcome;
  for (const m of b.mods) m.holdAt = null;
  const points = outcome === "defused" ? 100 + Math.ceil(b.leftAtEnd / 1000) : 0;
  s.team += points;
  s.history.push({
    no: b.no,
    defuser: b.defuser,
    outcome,
    left: b.leftAtEnd,
    strikes: b.strikes,
    mods: b.mods.length,
    solved: b.mods.filter((m) => m.done).length,
    points,
  });
  if (b.no + 1 >= BOMBS) finish(s, ctx);
  else {
    s.phase = "result";
    s.endsAt = now + RESULT_MS;
  }
}

function finish(s: DefuseState, ctx: GameCtx, abandoned = false) {
  if (s.over) return;
  s.over = true;
  s.abandoned = abandoned;
  s.phase = "over";
  s.endsAt = ctx.now();
  const defused = s.history.filter((h) => h.outcome === "defused").length;
  const win = !abandoned && defused >= 2;
  const scores: Record<string, number> = {};
  for (const id of s.order) scores[id] = s.team;
  const headline = abandoned
    ? `Bomb squad disbanded: not enough players left (${defused}/${BOMBS} defused)`
    : win
      ? `Bomb squad defused ${defused}/${BOMBS} bombs: team score ${s.team}`
      : `💥 Kaboom. The squad defused only ${defused}/${BOMBS} bombs`;
  ctx.end({ winners: win ? s.order.slice() : [], headline, scores });
}

function strike(s: DefuseState, ctx: GameCtx, m: number) {
  const b = s.bomb;
  const now = ctx.now();
  b.left = bombLeft(b, now);
  b.anchor = now;
  b.strikes += 1;
  b.rate = 1 + STRIKE_SPEEDUP * b.strikes;
  ctx.emit({ k: "strike", m, s: b.strikes } satisfies DefuseEvent);
  if (b.strikes >= MAX_STRIKES) resolve(s, ctx, "boom");
  else s.endsAt = explodeAt(b);
}

function solved(s: DefuseState, ctx: GameCtx, mod: ModState) {
  mod.done = true;
  if (s.bomb.mods.every((m) => m.done)) resolve(s, ctx, "defused");
}

/** Share an away expert's pages with the connected expert holding the fewest lines. */
function coverFor(s: DefuseState, id: string) {
  const b = s.bomb;
  if (s.covered.includes(id) || !b.frags[id]?.length) return;
  const others = Object.keys(b.frags).filter((e) => e !== id && !(e in s.awaySince));
  if (!others.length) return;
  others.sort((a, c) => b.frags[a].length - b.frags[c].length);
  const to = others[0];
  b.frags[to] = [...new Set([...b.frags[to], ...b.frags[id]])].sort((a, c) => a - c);
  s.covered.push(id);
}

/** The defuser vanished: the next connected expert takes over, and their pages are shared. */
function handOver(s: DefuseState, ctx: GameCtx) {
  const b = s.bomb;
  const n = s.order.length;
  const at = s.order.indexOf(b.defuser);
  for (let k = 1; k < n; k++) {
    const id = s.order[(at + k) % n];
    if (!connected(ctx, id)) continue;
    const pages = b.frags[id] ?? [];
    delete b.frags[id];
    b.frags[b.defuser] = [];
    b.defuser = id;
    const others = Object.keys(b.frags).filter((e) => !(e in s.awaySince));
    if (others.length) {
      others.sort((a, c) => b.frags[a].length - b.frags[c].length);
      b.frags[others[0]] = [...new Set([...b.frags[others[0]], ...pages])].sort((a, c) => a - c);
    }
    for (const m of b.mods) m.holdAt = null;
    return true;
  }
  return false;
}

function say(s: DefuseState, ctx: GameCtx, from: string, a: Record<string, unknown>): boolean {
  const now = ctx.now();
  if (now - (s.lastSay[from] ?? 0) < SAY_GAP_MS) return false;
  const msg: Msg = { i: 0, from };
  if (typeof a.t === "string" && a.t.length <= 400) {
    const t = cleanText(a.t);
    if (!t) return false;
    msg.t = t;
  } else if (isInt(a.g) && a.g >= 0 && a.g < GLYPHS.length) msg.g = a.g;
  else if (typeof a.c === "string" && (TALK_COLORS as readonly string[]).includes(a.c)) msg.c = a.c;
  else return false;
  if (isInt(a.n) && a.n >= 0 && a.n < 1e9) msg.n = a.n;
  msg.i = ++s.chatSeq;
  s.lastSay[from] = now;
  s.chat.push(msg);
  if (s.chat.length > CHAT_KEEP) s.chat.splice(0, s.chat.length - CHAT_KEEP);
  // Participants only: the talk may quote the manual, and spectators watch the bomb.
  for (const id of s.order) ctx.emit({ k: "say", m: msg } satisfies DefuseEvent, { to: id });
  return false;
}

function modAction(s: DefuseState, ctx: GameCtx, a: Record<string, unknown>): boolean {
  const b = s.bomb;
  if (!isInt(a.m) || a.m < 0 || a.m >= b.mods.length) return false;
  const mod = b.mods[a.m];
  if (mod.done) return false;
  const now = ctx.now();
  switch (a.type) {
    case "cut": {
      if (mod.t !== "wires" || mod.ans.t !== "wires" || !isInt(a.w) || a.w < 0 || a.w >= mod.wires.length || mod.cut[a.w]) return false;
      mod.cut[a.w] = true;
      if (a.w === mod.ans.wire) solved(s, ctx, mod);
      else strike(s, ctx, a.m);
      return true;
    }
    case "hold": {
      if (mod.t !== "button") return false;
      // A second press while we think it's held means a release got lost: restart the hold.
      const again = mod.holdAt !== null;
      mod.holdAt = now;
      if (again) return false;
      ctx.emit({ k: "hold", m: a.m, on: true } satisfies DefuseEvent, { except: b.defuser });
      return false;
    }
    case "release": {
      if (mod.t !== "button" || mod.ans.t !== "button" || mod.holdAt === null || !isInt(a.n) || a.n < 1 || a.n > 9) return false;
      const held = now - mod.holdAt;
      mod.holdAt = null;
      ctx.emit({ k: "hold", m: a.m, on: false } satisfies DefuseEvent, { except: b.defuser });
      const tapped = held < TAP_MS;
      let ok: boolean;
      if (!mod.ans.hold) ok = tapped;
      else {
        // The client says which number it showed; believe it if the timing roughly agrees.
        const plausible = [held - RELEASE_SLACK_MS, held, held + RELEASE_SLACK_MS].some((t) => holdDigit(t) === a.n);
        ok = !tapped && plausible && a.n === mod.ans.digit;
      }
      if (ok) solved(s, ctx, mod);
      else strike(s, ctx, a.m);
      return true;
    }
    case "key": {
      if (mod.t !== "keypad" || mod.ans.t !== "keypad" || !isInt(a.k) || a.k < 0 || a.k >= mod.glyphs.length || mod.pressed[a.k]) return false;
      if (mod.ans.order[mod.step] === a.k) {
        mod.pressed[a.k] = true;
        mod.step += 1;
        if (mod.step >= mod.glyphs.length) solved(s, ctx, mod);
      } else strike(s, ctx, a.m);
      return true;
    }
    case "pad": {
      if (mod.t !== "signal" || mod.ans.t !== "signal" || !isInt(a.c) || a.c < 0 || a.c >= PAD_COLORS.length) return false;
      if (mod.ans.presses[mod.progress] === PAD_COLORS[a.c]) {
        mod.progress += 1;
        if (mod.progress >= mod.stage + 2) {
          mod.stage += 1;
          mod.progress = 0;
          if (mod.stage >= mod.stages) solved(s, ctx, mod);
        }
      } else {
        mod.progress = 0;
        strike(s, ctx, a.m);
      }
      return true;
    }
    case "dial": {
      if (mod.t !== "dial" || mod.ans.t !== "dial" || !isInt(a.pos) || a.pos < 0 || a.pos >= DIAL_STEPS) return false;
      if (a.pos === mod.ans.pos) {
        mod.at = a.pos;
        solved(s, ctx, mod);
      } else strike(s, ctx, a.m);
      return true;
    }
  }
  return false;
}

function updateAway(s: DefuseState, ctx: GameCtx) {
  const now = ctx.now();
  for (const id of s.order) {
    if (connected(ctx, id)) delete s.awaySince[id];
    else if (!(id in s.awaySince)) s.awaySince[id] = now;
  }
}

export const defuse: GameDef<DefuseState, DefuseAction> = {
  id: "defuse",

  setup(ctx) {
    const order = ctx.players.map((p) => p.id);
    const s: DefuseState = {
      phase: "brief",
      endsAt: 0,
      order,
      manual: makeManual(ctx.random),
      bomb: null as unknown as Bomb,
      history: [],
      ready: [],
      chat: [],
      chatSeq: 0,
      lastSay: {},
      awaySince: {},
      covered: [],
      fewSince: null,
      team: 0,
      first: Math.floor(ctx.random() * order.length),
      over: false,
      abandoned: false,
    };
    startBrief(s, ctx, 0);
    return s;
  },

  action(s, playerId, action, ctx) {
    if (s.over || !s.order.includes(playerId)) return false;
    if (!action || typeof action !== "object" || Array.isArray(action)) return false;
    const a = action as Record<string, unknown>;
    if (a.type === "say") return say(s, ctx, playerId, a);
    if (a.type === "ready") {
      if (s.phase !== "brief" || s.ready.includes(playerId)) return false;
      s.ready.push(playerId);
      if (s.order.every((id) => s.ready.includes(id) || !connected(ctx, id))) goLive(s, ctx);
      return true;
    }
    if (s.phase !== "live" || playerId !== s.bomb.defuser) return false;
    return modAction(s, ctx, a);
  },

  tick(s, ctx) {
    if (s.over) return false;
    const now = ctx.now();
    updateAway(s, ctx);
    let changed = false;

    const here = s.order.filter((id) => connected(ctx, id)).length;
    if (here < 2) {
      if (s.fewSince === null) s.fewSince = now;
      if (now - s.fewSince >= ABANDON_MS) {
        finish(s, ctx, true);
        return true;
      }
    } else s.fewSince = null;

    if (s.phase === "brief") {
      // Everyone still here is ready (someone dropped out after the others readied up).
      const allReady = s.ready.length > 0 && s.order.every((id) => s.ready.includes(id) || !connected(ctx, id));
      if (now >= s.endsAt || allReady) {
        goLive(s, ctx);
        changed = true;
      }
    } else if (s.phase === "live") {
      const b = s.bomb;
      if (now >= explodeAt(b)) {
        resolve(s, ctx, "boom");
        return true;
      }
      for (const m of b.mods) if (m.holdAt !== null && now - m.holdAt > HOLD_GIVEUP_MS) m.holdAt = null;
      const away = s.awaySince[b.defuser];
      if (away !== undefined && now - away >= AWAY_MS && handOver(s, ctx)) changed = true;
    } else if (s.phase === "result" && now >= s.endsAt) {
      startBrief(s, ctx, s.bomb.no + 1);
      changed = true;
    }

    if (s.phase === "brief" || s.phase === "live") {
      for (const [id, since] of Object.entries(s.awaySince)) {
        if (id !== s.bomb.defuser && now - since >= AWAY_MS && !s.covered.includes(id) && s.bomb.frags[id]?.length) {
          coverFor(s, id);
          changed = true;
        }
      }
    }
    return changed;
  },
  tickMs: 250,

  playerLeft(s, _id, ctx) {
    if (!s.over) updateAway(s, ctx);
  },

  playerReturned(s, _id, ctx) {
    if (!s.over) updateAway(s, ctx);
  },

  view(s, viewerId): DefuseView {
    const b = s.bomb;
    const isPart = s.order.includes(viewerId);
    const role = !isPart ? "spectator" : viewerId === b.defuser ? "defuser" : "expert";
    const showBomb = role !== "expert" || b.outcome !== null || s.phase === "over";
    const pageIdx = role === "expert" ? (b.frags[viewerId] ?? []) : null;
    const live = s.phase === "live";
    return {
      phase: s.phase,
      endsAt: s.endsAt,
      briefMs: BRIEF_MS,
      resultMs: RESULT_MS,
      bombNo: b.no,
      bombs: BOMBS,
      role,
      defuser: b.defuser,
      order: s.order,
      ready: s.ready,
      strikes: b.strikes,
      explodeAt: live ? explodeAt(b) : 0,
      rate: b.rate,
      left: b.left,
      outcome: b.outcome,
      bomb: showBomb ? { edge: b.edge, mods: b.mods.map(publicMod) } : null,
      checklist: b.mods.map((m) => ({ t: m.t, done: m.done })),
      page: pageIdx ? pageIdx.map((i) => s.manual[i]) : null,
      experts: Object.keys(b.frags).length,
      chat: isPart ? s.chat : null,
      history: s.history,
      team: s.team,
      abandoned: s.abandoned,
    };
  },
};

export default defuse;

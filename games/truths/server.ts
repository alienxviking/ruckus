import type { GameCtx, GameDef } from "../../shared/game";
import { shuffle, topScorers } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
import {
  ABANDON_MS,
  DRUM_MS,
  FOOL_PTS,
  REVEAL_MS,
  SPOT_PTS,
  TALK_MS,
  WRITE_MS,
  cleanStatement,
  setProblem,
  type TruthAction,
  type TruthAward,
  type TruthDraft,
  type TruthPhase,
  type TruthReveal,
  type TruthView,
} from "./shared";

// Truth Bombs: everyone writes two truths and a lie about themselves. Then each writer
// presents: their three statements show for everyone (in a shuffled order), they read and
// defend them on the call, the others vote on the lie, and the reveal scores it:
// +100 for spotting the lie, +50 to the writer for every friend fooled.

export interface TruthState {
  startedAt: number;
  ids: string[];
  phase: TruthPhase;
  endsAt: number;
  writeMs: number;
  talkMs: number;
  drafts: Record<string, TruthDraft>;
  /** Presenting order (writers with a complete set). */
  order: string[];
  turn: number;
  /** Display order of the current presenter's statements (indices into their draft). */
  perm: number[];
  votes: Record<string, number | null>;
  ready: Record<string, boolean>;
  score: Record<string, number>;
  reveal: TruthReveal | null;
  spots: Record<string, number>;
  fools: Record<string, number>;
  awards: TruthAward[];
  lowSince: number | null;
  abandoned: boolean;
}

const isHere = (ctx: GameCtx, id: string) => ctx.player(id)?.connected !== false;
const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const presenter = (s: TruthState) => s.order[s.turn] ?? null;

function names(ids: string[], ctx: GameCtx): string {
  const n = ids.map((id) => ctx.player(id)?.name ?? "Someone");
  if (n.length <= 1) return n.join("");
  return `${n.slice(0, -1).join(", ")} & ${n[n.length - 1]}`;
}

function complete(d: TruthDraft | undefined): boolean {
  return !!d && setProblem(d.s, d.lie) === null;
}

function startPresenting(s: TruthState, ctx: GameCtx) {
  // Unlocked but complete drafts count too: nobody loses their work to the clock.
  s.order = shuffle(
    s.ids.filter((id) => complete(s.drafts[id])),
    ctx.random,
  );
  for (const id of s.order) s.drafts[id].done = true;
  if (!s.order.length) return finish(s, ctx, false);
  s.turn = 0;
  startVote(s, ctx);
}

function startVote(s: TruthState, ctx: GameCtx) {
  while (s.turn < s.order.length && !s.drafts[s.order[s.turn]]) s.turn++;
  if (s.turn >= s.order.length) return finish(s, ctx, false);
  s.phase = "vote";
  s.endsAt = ctx.now() + s.talkMs;
  s.perm = shuffle([0, 1, 2], ctx.random);
  s.votes = Object.fromEntries(s.ids.filter((id) => id !== presenter(s)).map((id) => [id, null]));
  s.ready = {};
  s.reveal = null;
}

function startDrum(s: TruthState, ctx: GameCtx) {
  s.phase = "drum";
  s.endsAt = ctx.now() + DRUM_MS;
}

function startReveal(s: TruthState, ctx: GameCtx) {
  const p = presenter(s)!;
  const lie = s.perm.indexOf(s.drafts[p].lie);
  const pts: Record<string, number> = { [p]: 0 };
  let fooled = 0;
  let spotted = 0;
  for (const [id, v] of Object.entries(s.votes)) {
    pts[id] = 0;
    if (v === null) continue;
    if (v === lie) {
      pts[id] = SPOT_PTS;
      spotted++;
      s.spots[id] = (s.spots[id] ?? 0) + 1;
    } else {
      fooled++;
    }
  }
  pts[p] = fooled * FOOL_PTS;
  s.fools[p] = (s.fools[p] ?? 0) + fooled;
  for (const [id, x] of Object.entries(pts)) s.score[id] = (s.score[id] ?? 0) + x;
  s.reveal = { lie, votes: { ...s.votes }, pts, fooled, spotted };
  s.phase = "reveal";
  s.endsAt = ctx.now() + REVEAL_MS;
  s.ready = {};
}

function nextTurn(s: TruthState, ctx: GameCtx) {
  s.turn++;
  startVote(s, ctx);
}

function computeAwards(s: TruthState): TruthAward[] {
  const out: TruthAward[] = [];
  const top = (rec: Record<string, number>, min: number) => {
    const best = Math.max(0, ...Object.values(rec));
    return best >= min ? Object.keys(rec).filter((id) => rec[id] === best) : [];
  };
  const det = top(s.spots, 2);
  if (det.length && det.length <= 3) out.push({ icon: "🕵️", title: "Lie detector", ids: det, note: `spotted ${s.spots[det[0]]} lies` });
  const liar = top(s.fools, 2);
  if (liar.length && liar.length <= 3) out.push({ icon: "🎭", title: "Poker face", ids: liar, note: `fooled ${s.fools[liar[0]]} friends` });
  const open = s.order.filter((id) => (s.fools[id] ?? 0) === 0);
  if (open.length && open.length <= 3 && s.order.length >= 2) out.push({ icon: "📖", title: "Open book", ids: open, note: "fooled nobody" });
  return out;
}

function finish(s: TruthState, ctx: GameCtx, abandoned: boolean) {
  if (s.phase === "final") return;
  const never = s.phase === "write" || !s.order.length;
  s.phase = "final";
  s.abandoned = abandoned;
  s.endsAt = 0;
  s.reveal = null;
  s.lowSince = null;
  s.awards = computeAwards(s);
  const winners = topScorers(s.score);
  const best = winners.length ? s.score[winners[0]] : 0;
  let headline: string;
  if (never && !abandoned) headline = "Nobody wrote any truth bombs. Next time!";
  else if (!winners.length) headline = "Nobody scored. Suspiciously honest bunch!";
  else if (winners.length === 1) headline = `${names(winners, ctx)} wins Truth Bombs with ${best} points`;
  else if (winners.length <= 3) headline = `${names(winners, ctx)} tie with ${best} points`;
  else headline = `${winners.length}-way tie at ${best} points`;
  if (abandoned) headline = `Not enough players left. ${headline}`;
  ctx.end({ winners, headline, scores: { ...s.score } });
}

function everyoneDone(s: TruthState, ctx: GameCtx): boolean {
  if (s.phase === "write") {
    const here = s.ids.filter((id) => isHere(ctx, id));
    return here.length > 0 && here.every((id) => s.drafts[id]?.done);
  }
  if (s.phase === "vote") {
    return Object.keys(s.votes).every((id) => !isHere(ctx, id) || s.votes[id] !== null);
  }
  if (s.phase === "reveal") {
    const here = s.ids.filter((id) => isHere(ctx, id));
    return here.length > 0 && here.every((id) => s.ready[id]);
  }
  return false;
}

function advance(s: TruthState, ctx: GameCtx) {
  if (s.phase === "write") startPresenting(s, ctx);
  else if (s.phase === "vote") startDrum(s, ctx);
  else if (s.phase === "drum") startReveal(s, ctx);
  else if (s.phase === "reveal") nextTurn(s, ctx);
}

export const truths: GameDef<TruthState, TruthAction> = {
  id: "truths",

  setup(ctx) {
    const set = readSettings(config.settings, ctx.settings);
    const ids = ctx.players.map((p) => p.id);
    const writeMs = Math.max(60, Math.min(900, Number(set.write) || WRITE_MS / 1000)) * 1000;
    const talkMs = Math.max(30, Math.min(300, Number(set.talk) || TALK_MS / 1000)) * 1000;
    return {
      startedAt: ctx.now(),
      ids,
      phase: "write",
      endsAt: ctx.now() + writeMs,
      writeMs,
      talkMs,
      drafts: {},
      order: [],
      turn: 0,
      perm: [0, 1, 2],
      votes: {},
      ready: {},
      score: Object.fromEntries(ids.map((id) => [id, 0])),
      reveal: null,
      spots: {},
      fools: {},
      awards: [],
      lowSince: null,
      abandoned: false,
    };
  },

  action(s, playerId, action, ctx) {
    if (s.phase === "final" || !s.ids.includes(playerId)) return false;
    if (!action || typeof action !== "object" || Array.isArray(action)) return false;
    const a = action as Record<string, unknown>;
    switch (a.type) {
      case "save": {
        if (s.phase !== "write") return false;
        if (!Array.isArray(a.s) || a.s.length !== 3 || !a.s.every((x) => typeof x === "string")) return false;
        if (!isInt(a.lie, -1, 2) || typeof a.done !== "boolean") return false;
        const st = a.s.map(cleanStatement) as [string, string, string];
        const done = a.done;
        if (done && setProblem(st, a.lie) !== null) return false;
        const prev = s.drafts[playerId];
        s.drafts[playerId] = { s: st, lie: a.lie, done };
        if (done && everyoneDone(s, ctx)) {
          advance(s, ctx);
          return true;
        }
        // Drafts are private and invisible to others: only re-broadcast when "locked in" changes.
        return (prev?.done ?? false) !== done;
      }
      case "vote": {
        if (s.phase !== "vote" || !(playerId in s.votes) || !isInt(a.o, 0, 2) || s.votes[playerId] === a.o) return false;
        s.votes[playerId] = a.o;
        // With the reader gone, move on as soon as everyone has voted.
        if (!isHere(ctx, presenter(s)!) && everyoneDone(s, ctx)) advance(s, ctx);
        return true;
      }
      case "reveal": {
        if (s.phase !== "vote" || playerId !== presenter(s) || !everyoneDone(s, ctx)) return false;
        advance(s, ctx);
        return true;
      }
      case "next": {
        if (s.phase !== "reveal" || s.ready[playerId]) return false;
        s.ready[playerId] = true;
        if (playerId === presenter(s) || everyoneDone(s, ctx)) advance(s, ctx);
        return true;
      }
    }
    return false;
  },

  tick(s, ctx) {
    if (s.phase === "final") return false;
    const now = ctx.now();
    let changed = false;
    const here = s.ids.filter((id) => isHere(ctx, id)).length;
    if (here < 2) {
      if (s.lowSince === null) {
        s.lowSince = now;
        changed = true;
      } else if (now - s.lowSince >= ABANDON_MS) {
        finish(s, ctx, true);
        return true;
      }
    } else if (s.lowSince !== null) {
      s.lowSince = null;
      changed = true;
    }
    if (now >= s.endsAt) {
      advance(s, ctx);
      return true;
    }
    // Someone who was holding things up may have left.
    if ((s.phase === "write" || s.phase === "reveal") && everyoneDone(s, ctx)) {
      advance(s, ctx);
      return true;
    }
    if (s.phase === "vote" && !isHere(ctx, presenter(s)!) && everyoneDone(s, ctx)) {
      advance(s, ctx);
      return true;
    }
    return changed;
  },
  tickMs: 250,

  view(s, viewerId, ctx): TruthView {
    const p = presenter(s);
    const presenting = s.phase === "vote" || s.phase === "drum" || s.phase === "reveal";
    const d = p ? s.drafts[p] : undefined;
    return {
      game: s.startedAt,
      phase: s.phase,
      endsAt: s.endsAt,
      phaseMs: s.phase === "write" ? s.writeMs : s.phase === "vote" ? s.talkMs : s.phase === "drum" ? DRUM_MS : REVEAL_MS,
      seats: s.ids.map((id) => ({
        id,
        score: s.score[id] ?? 0,
        done: s.phase === "write" ? !!s.drafts[id]?.done : s.phase === "vote" ? s.votes[id] != null : s.phase === "reveal" ? !!s.ready[id] : false,
        away: !isHere(ctx, id),
        writer: s.phase === "write" ? !!s.drafts[id]?.done : s.order.includes(id),
      })),
      draft: s.phase === "write" ? (s.drafts[viewerId] ?? null) : null,
      turn: Math.min(s.turn + 1, s.order.length),
      turns: s.order.length,
      presenter: presenting ? p : null,
      statements: presenting && d ? s.perm.map((i) => d.s[i]) : [],
      myVote: presenting ? (s.votes[viewerId] ?? null) : null,
      reveal: s.phase === "reveal" ? s.reveal : null,
      awards: s.phase === "final" ? s.awards : [],
      endingAt: s.lowSince !== null && s.phase !== "final" ? s.lowSince + ABANDON_MS : null,
      abandoned: s.abandoned,
    };
  },

  playerLeft(s, _id, ctx) {
    if (s.phase === "final") return;
    if (s.lowSince === null && s.ids.filter((id) => isHere(ctx, id)).length < 2) s.lowSince = ctx.now();
  },

  playerReturned(s, _id, ctx) {
    if (s.lowSince !== null && s.ids.filter((id) => isHere(ctx, id)).length >= 2) s.lowSince = null;
  },
};

export default truths;

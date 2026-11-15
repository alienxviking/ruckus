// Test helper: a fake GameCtx with controllable time, for exercising game logic
// without a server. Example:
//
//   const t = makeTestCtx(3);
//   const s = mygame.setup(t.ctx);
//   mygame.action(s, t.ids[0], { type: "x" }, t.ctx);
//   t.advance(5000); mygame.tick?.(s, t.ctx);
//   assert(t.result?.winners.length === 1);
//
// Run a test file with:  npx tsx games/<id>/<id>.test.ts

import type { GameCtx } from "./game";
import type { GameResult, Player } from "./types";

export function makeTestCtx(playerCount: number, seed = 42) {
  let time = 1_700_000_000_000;
  let s = seed >>> 0;
  const random = () => {
    // mulberry32: deterministic so tests are repeatable
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const players: Player[] = Array.from({ length: playerCount }, (_, i) => ({
    id: `p${i}`,
    name: `Player${i}`,
    color: "#fff",
    avatar: "🦊",
    connected: true,
  }));
  const events: { event: unknown; to?: string; except?: string }[] = [];
  const harness = {
    ids: players.map((p) => p.id),
    events,
    result: null as GameResult | null,
    advance(ms: number) {
      time += ms;
    },
    ctx: null as unknown as GameCtx,
  };
  harness.ctx = {
    now: () => time,
    players,
    player: (id) => players.find((p) => p.id === id),
    emit: (event, opts) => events.push({ event, ...opts }),
    end: (r) => {
      if (!harness.result) harness.result = r;
    },
    random,
  };
  return harness;
}

export function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}

// Can each game survive a server restart mid-game? The room saves the game's state as JSON and
// carries on from the copy after a restart, so every game's state must be plain JSON: no Maps,
// Sets, class instances, functions, undefined-in-arrays or non-finite numbers.
//
// For every game: play with bots for a while, check the state is plain JSON, swap it for a
// JSON copy (views must match), then keep playing the copy to make sure nothing breaks.
// Any game that fails this would come back broken after a restart, so the check fails.
//
//   npx tsx shared/resume.test.ts

import { CATALOG_BY_ID } from "../games/catalog";
import { GAME_DEFS } from "../games/server-registry";
import { makeTestCtx } from "./testing";

/** Path to the first value that wouldn't survive JSON, or null when the value is plain JSON. */
export function notJson(v: unknown, path = "state"): string | null {
  if (v === null || typeof v === "string" || typeof v === "boolean") return null;
  if (typeof v === "number") return Number.isFinite(v) ? null : `${path} = ${v}`;
  if (typeof v !== "object") return `${path} is a ${typeof v}`;
  const proto = Object.getPrototypeOf(v);
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      if (!(i in v) || v[i] === undefined) return `${path}[${i}] is empty/undefined`;
      const bad = notJson(v[i], `${path}[${i}]`);
      if (bad) return bad;
    }
    return null;
  }
  if (proto !== Object.prototype && proto !== null) return `${path} is a ${proto?.constructor?.name ?? "class instance"}`;
  for (const [k, x] of Object.entries(v)) {
    if (x === undefined) continue; // dropped by JSON, same as missing
    const bad = notJson(x, `${path}.${k}`);
    if (bad) return bad;
  }
  return null;
}

const failures: string[] = [];
const fine: string[] = [];

for (const [id, def] of Object.entries(GAME_DEFS)) {
  const meta = CATALOG_BY_ID[id];
  if (!meta) continue;
  for (const seed of [3, 11]) {
    const n = Math.min(meta.maxPlayers, Math.max(meta.minPlayers, 3));
    // Bots play when the game has them; otherwise the game just runs its clock.
    const t = makeTestCtx(n, seed, {}, def.bot ? n : 0);
    let state: unknown;
    let problem: string | null = null;
    try {
      state = def.setup(t.ctx);
      const step = () => {
        t.advance(def.tickMs ?? 250);
        def.tick?.(state, t.ctx);
        if (def.bot && !t.result) for (const pid of t.ids) {
          const a = def.bot(state, pid, t.ctx);
          if (a != null) def.action(state, pid, a, t.ctx);
        }
      };
      for (let round = 0; round < 3 && !problem && !t.result; round++) {
        for (let i = 0; i < 60 + round * 50 && !t.result; i++) step();
        const bad = notJson(state);
        if (bad) {
          problem = bad;
          break;
        }
        const copy = JSON.parse(JSON.stringify(state));
        for (const pid of [...t.ids, "spectator"]) {
          const a = JSON.stringify(def.view(state, pid, t.ctx) ?? null);
          const b = JSON.stringify(def.view(copy, pid, t.ctx) ?? null);
          if (a !== b) {
            problem = `view for ${pid} differs after a JSON copy`;
            break;
          }
        }
        state = copy; // carry on from the revived copy
      }
      for (let i = 0; i < 400 && !t.result && !problem; i++) step();
    } catch (err) {
      problem = `threw: ${(err as Error).message}`;
    }
    if (problem) {
      failures.push(`${id} (seed ${seed}): ${problem}`);
      break;
    }
    if (seed === 11) fine.push(id);
  }
}

console.log(failures.length ? `✗ can't survive a restart:${failures.map((f) => `\n  ${f}`).join("")}` : `✓ all ${fine.length} games survive a restart (state is plain JSON)`);
process.exitCode = failures.length ? 1 : 0;

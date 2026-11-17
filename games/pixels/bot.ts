// Practice bot for Canvas Clash. It works from its own view only: the public board and its own
// secret emblem. It paints its emblem a little slower than a keen human, patches it when it gets
// defaced, moves to a better copy if one turns up, and now and then scribbles over rival paint.

import type { GameCtx } from "../../shared/game";
import { EMBLEM, EMBLEM_CELLS, PAINTS, bestMatch, digits } from "./shared";
import type { PixelsAction, PixelsState, PixelsView } from "./server";

interface Mem {
  round: number;
  /** Top-left corner of the bot's copy. */
  x: number;
  y: number;
  nextAt: number;
  readyAt: number;
}

const memory = new WeakMap<PixelsState, Map<number, Mem>>();

/** Cells of the 5x5 block at (x, y) that differ from the art, as [cell, wanted colour]. */
function mismatches(board: number[], w: number, x: number, y: number, art: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let j = 0; j < EMBLEM; j++)
    for (let i = 0; i < EMBLEM; i++) {
      const cell = (y + j) * w + x + i;
      const want = art[j * EMBLEM + i];
      if (board[cell] !== want) out.push([cell, want]);
    }
  return out;
}

/** A quiet corner: the least-painted of a few random 5x5 spots. */
function quietSpot(board: number[], w: number, h: number, random: () => number): { x: number; y: number } {
  let best = { x: 0, y: 0 };
  let bestPaint = Infinity;
  for (let k = 0; k < 24; k++) {
    const x = Math.floor(random() * (w - EMBLEM + 1));
    const y = Math.floor(random() * (h - EMBLEM + 1));
    let painted = 0;
    for (let j = -1; j <= EMBLEM; j++)
      for (let i = -1; i <= EMBLEM; i++) {
        const xx = x + i;
        const yy = y + j;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && board[yy * w + xx]) painted++;
      }
    if (painted < bestPaint) {
      bestPaint = painted;
      best = { x, y };
    }
  }
  return best;
}

export function pixelsBot(s: PixelsState, v: PixelsView, ctx: GameCtx): PixelsAction | null {
  const me = v.you;
  if (me < 0) return null;
  const now = ctx.now();
  let mems = memory.get(s);
  if (!mems) memory.set(s, (mems = new Map()));
  let m = mems.get(me);
  if (!m || m.round !== v.round) {
    m = { round: v.round, x: -1, y: -1, nextAt: 0, readyAt: 0 };
    mems.set(me, m);
  }

  if (v.phase === "reveal") {
    if (v.ready.includes(me)) return null;
    if (!m.readyAt) m.readyAt = now + 1500 + ctx.random() * 3000;
    return now >= m.readyAt ? { type: "next" } : null;
  }
  if (v.phase !== "paint" || !v.mine) return null;
  if (now < m.nextAt) return null;
  // About 2.5 pixels a second (the server allows ~5.5): keen but beatable.
  m.nextAt = now + 300 + ctx.random() * 200;

  const board = digits(v.board);
  const art = digits(v.mine.art);
  if (m.x < 0) {
    const q = quietSpot(board, v.w, v.h, ctx.random);
    m.x = q.x;
    m.y = q.y;
  }
  let todo = mismatches(board, v.w, m.x, m.y, art);
  // Someone wrecked our copy but a better one exists (maybe a rival's accidental help): move there.
  if (todo.length > 6) {
    const b = bestMatch(board, v.w, v.h, art);
    if (EMBLEM_CELLS - b.n < todo.length) {
      m.x = b.x;
      m.y = b.y;
      todo = mismatches(board, v.w, m.x, m.y, art);
    }
  }

  const vandal = todo.length ? ctx.random() < 0.12 : ctx.random() < 0.45;
  if (!vandal) {
    if (!todo.length) return null;
    const [cell, color] = todo[Math.floor(ctx.random() * todo.length)];
    return { type: "paint", px: [cell, color] };
  }
  // Scribble over someone else's paint, away from our own copy.
  for (let k = 0; k < 30; k++) {
    const cell = Math.floor(ctx.random() * board.length);
    if (!board[cell]) continue;
    const cx = cell % v.w;
    const cy = Math.floor(cell / v.w);
    if (cx >= m.x - 1 && cx <= m.x + EMBLEM && cy >= m.y - 1 && cy <= m.y + EMBLEM) continue;
    const color = 1 + ((board[cell] + Math.floor(ctx.random() * (PAINTS - 1))) % PAINTS);
    return { type: "paint", px: [cell, color] };
  }
  if (!todo.length) return null;
  const [cell, color] = todo[0];
  return { type: "paint", px: [cell, color] };
}

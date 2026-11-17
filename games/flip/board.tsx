"use client";

// The Flip board: a grid of buttons, each holding a two-faced coin that turns over
// in 3D when it changes hands. Flips ripple outward from the placed disc.

import { useState, type CSSProperties } from "react";
import type { LastMove } from "./server";
import { cellName, flipsFor, type Seat } from "./shared";

// ---------- colours ----------
function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function colorDistance(x: string, y: string): number {
  const a = parseHex(x);
  const b = parseHex(y);
  if (!a || !b) return 999;
  const rm = (a[0] + b[0]) / 2;
  const [dr, dg, db] = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

const FALLBACKS = ["#f472b6", "#38bdf8", "#facc15", "#c084fc", "#fb923c", "#4ade80"];

/** Disc colours per seat: the players' own colours, unless they're too alike to tell apart. */
export function discPalette(a: string | undefined, b: string | undefined): [string, string] {
  const first = a && parseHex(a) ? a : "#f472b6";
  let second = b && parseHex(b) ? b : "#38bdf8";
  if (colorDistance(first, second) < 140) {
    second = FALLBACKS.reduce((best, c) => (colorDistance(first, c) > colorDistance(first, best) ? c : best));
  }
  return [first, second];
}

const vars = (v: Record<string, string | number>) => v as CSSProperties;

/** Small coin icon (seat mark included) for labels and chips. */
export function DiscSwatch({ seat, color, size = 20 }: { seat: Seat; color: string; size?: number }) {
  return (
    <span
      aria-hidden
      className={`fl-face fl-f${seat} relative inline-block shrink-0`}
      style={vars({ width: size, height: size, "--c": color, position: "relative" })}
    />
  );
}

/** One coin: front face is seat 0's colour, back face seat 1's. Rotation shows the owner. */
function Coin({
  seat,
  colors,
  delay,
  liftClass,
}: {
  seat: Seat;
  colors: [string, string];
  delay: number;
  liftClass: string;
}) {
  return (
    <span className={`fl-disc ${liftClass}`} style={vars({ "--d": `${delay}ms` })}>
      <span className="fl-coin" style={{ transform: `rotateY(${seat === 0 ? 0 : 180}deg)`, transitionDelay: `${delay}ms` }}>
        <span className="fl-face fl-f0" style={vars({ "--c": colors[0] })} />
        <span className="fl-face fl-f1 fl-back" style={vars({ "--c": colors[1] })} />
      </span>
    </span>
  );
}

export function Board({
  board,
  size,
  game,
  seq,
  colors,
  last,
  mover,
  legal,
  showHints,
  canPlay,
  glow,
  dimLoser,
  onPlay,
  label,
}: {
  board: number[];
  size: number;
  game: number;
  seq: number;
  colors: [string, string];
  last: LastMove | null;
  /** Seat whose turn it is (null between games). */
  mover: Seat | null;
  /** Legal cells for the viewer when it's their move (empty otherwise). */
  legal: number[];
  showHints: boolean;
  canPlay: boolean;
  glow: string | null;
  /** After a game: the seat whose discs fade back (null = none). */
  dimLoser: Seat | null;
  onPlay: (cell: number) => void;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [shake, setShake] = useState<{ cell: number; n: number } | null>(null);
  const legalSet = new Set(legal);
  const hoverLegal = canPlay && hover !== null && legalSet.has(hover) && mover !== null;
  const preview = hoverLegal ? new Set(flipsFor(board, size, hover!, mover!)) : null;
  const flipped = new Set(last?.flips ?? []);
  const lr = last ? Math.floor(last.cell / size) : 0;
  const lc = last ? last.cell % size : 0;
  const liftClass = seq % 2 ? "fl-lift-a" : "fl-lift-b";

  const press = (cell: number) => {
    if (!canPlay) return;
    if (!legalSet.has(cell)) {
      setShake((s) => ({ cell, n: (s?.n ?? 0) + 1 }));
      onPlay(-1);
      return;
    }
    setHover(null);
    onPlay(cell);
  };

  return (
    <div
      className="fl-frame mx-auto w-full"
      style={vars({ "--glow": glow ?? "transparent", maxWidth: size === 6 ? "26rem" : "30rem" })}
    >
      <div
        key={game}
        role="grid"
        aria-label={label}
        className="fl-grid"
        style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
        onPointerLeave={() => setHover(null)}
      >
        {board.map((v, cell) => {
          const r = Math.floor(cell / size);
          const c = cell % size;
          const seat: Seat | null = v === 1 ? 0 : v === 2 ? 1 : null;
          const isFlip = flipped.has(cell);
          const delay = isFlip ? 90 + (Math.max(Math.abs(r - lr), Math.abs(c - lc)) - 1) * 85 : 0;
          const isLast = last?.cell === cell;
          const isLegal = canPlay && legalSet.has(cell);
          const name = cellName(cell, size);
          const desc =
            seat === null
              ? isLegal
                ? `${name}, empty, you can play here (flips ${flipsFor(board, size, cell, mover!).length})`
                : `${name}, empty`
              : `${name}, ${seat === 0 ? "ring" : "diamond"} disc${isLast ? ", last move" : ""}`;
          return (
            <button
              key={cell}
              type="button"
              role="gridcell"
              aria-label={desc}
              disabled={!canPlay || seat !== null}
              className={`fl-cell ${(r + c) % 2 ? "fl-odd" : ""} ${isLegal ? "fl-legal" : ""} ${
                shake?.cell === cell ? (shake.n % 2 ? "fl-shake-a" : "fl-shake-b") : ""
              }`}
              onPointerEnter={(e) => {
                if (e.pointerType === "mouse") setHover(cell);
              }}
              onClick={() => press(cell)}
            >
              {seat !== null && (
                <span className={`fl-slot ${dimLoser !== null && seat === dimLoser ? "fl-dim" : ""}`}>
                  <span className="fl-in">
                    <Coin seat={seat} colors={colors} delay={delay} liftClass={isFlip ? liftClass : ""} />
                  </span>
                </span>
              )}
              {seat !== null && preview?.has(cell) && <span className="fl-would" style={vars({ "--c": colors[mover!] })} />}
              {isLast && (
                <>
                  <span key={`r${seq}`} className="fl-ripple" style={vars({ "--c": colors[last!.seat] })} />
                  <span className="fl-lastdot" />
                </>
              )}
              {seat === null && hoverLegal && hover === cell && (
                <span className="fl-ghost">
                  <span className={`fl-face fl-f${mover!}`} style={vars({ "--c": colors[mover!] })} />
                  <span className="fl-count">+{preview!.size}</span>
                </span>
              )}
              {seat === null && isLegal && showHints && !(hoverLegal && hover === cell) && (
                <span className="fl-hint" style={vars({ "--c": colors[mover!] })} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const BOARD_CSS = `
.fl-frame {
  padding: 7px; border-radius: 18px;
  background:
    radial-gradient(120% 90% at 50% 0%, color-mix(in oklab, #a3e635 10%, transparent), transparent 60%),
    linear-gradient(180deg, #10141d, #090b11);
  border: 1px solid color-mix(in oklab, #a3e635 28%, var(--color-line));
  box-shadow: 0 0 0 1px color-mix(in oklab, var(--glow) 45%, transparent), 0 18px 50px -24px var(--glow),
    inset 0 1px 0 rgba(255,255,255,0.05);
  transition: box-shadow 0.4s ease;
}
.fl-grid { display: grid; gap: 3px; aspect-ratio: 1; }
.fl-cell {
  position: relative; aspect-ratio: 1; border-radius: 7px; padding: 0; border: 0;
  background: linear-gradient(160deg, #161b27, #11151e);
  box-shadow: inset 0 0 0 1px rgba(163,230,53,0.07), inset 0 -2px 6px rgba(0,0,0,0.35);
  display: grid; place-items: center; overflow: visible; -webkit-tap-highlight-color: transparent;
}
.fl-cell.fl-odd { background: linear-gradient(160deg, #141925, #0f131b); }
.fl-cell:disabled { cursor: default; }
.fl-cell.fl-legal { cursor: pointer; }
.fl-cell.fl-legal:hover { background: linear-gradient(160deg, #1c2433, #141a26); }
.fl-cell:focus-visible { outline: 2px solid #a3e635; outline-offset: 1px; z-index: 2; }
.fl-slot { position: absolute; inset: 9%; transition: opacity 0.5s ease, filter 0.5s ease; }
.fl-slot.fl-dim { opacity: 0.6; filter: saturate(0.55) brightness(0.85); }
.fl-in { position: absolute; inset: 0; animation: fl-in 0.34s cubic-bezier(0.2, 1.5, 0.4, 1) both; }
@keyframes fl-in { from { transform: scale(1.7); opacity: 0; } 60% { opacity: 1; } }
.fl-disc { position: absolute; inset: 0; perspective: 220px; }
.fl-coin {
  position: absolute; inset: 0; transform-style: preserve-3d;
  transition: transform 0.5s cubic-bezier(0.35, 1.35, 0.5, 1);
}
.fl-face {
  position: absolute; inset: 0; border-radius: 50%; backface-visibility: hidden; -webkit-backface-visibility: hidden;
  background:
    radial-gradient(circle at 34% 28%, color-mix(in oklab, var(--c) 45%, white) 0%, var(--c) 46%, color-mix(in oklab, var(--c) 62%, black) 100%);
  box-shadow: 0 2px 5px rgba(0,0,0,0.55), inset 0 0 0 1.5px color-mix(in oklab, var(--c) 60%, black),
    0 0 12px -3px var(--c);
}
.fl-back { transform: rotateY(180deg); }
.fl-face::after { content: ""; position: absolute; }
.fl-f0::after { inset: 27%; border-radius: 50%; border: 2.5px solid rgba(0,0,0,0.28); }
.fl-f1::after { inset: 33%; transform: rotate(45deg); border-radius: 2px; background: rgba(0,0,0,0.26); }
.fl-lift-a { animation: fl-lift-a 0.5s var(--d, 0ms) ease-out both; }
.fl-lift-b { animation: fl-lift-b 0.5s var(--d, 0ms) ease-out both; }
@keyframes fl-lift-a { 40% { transform: translateY(-14%) scale(1.16); } }
@keyframes fl-lift-b { 40% { transform: translateY(-14%) scale(1.16); } }
.fl-hint {
  width: 26%; height: 26%; border-radius: 50%;
  background: color-mix(in oklab, var(--c) 70%, transparent);
  box-shadow: 0 0 10px var(--c);
  animation: fl-breathe 1.6s ease-in-out infinite alternate;
  pointer-events: none;
}
@keyframes fl-breathe { from { opacity: 0.4; transform: scale(0.8); } to { opacity: 0.95; transform: scale(1); } }
.fl-ghost { position: absolute; inset: 9%; pointer-events: none; }
.fl-ghost .fl-face { opacity: 0.45; }
.fl-count {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  font: 700 12px/1 var(--font-mono); color: #fff; text-shadow: 0 1px 3px #000;
}
.fl-would {
  position: absolute; inset: 4%; border-radius: 50%; pointer-events: none;
  box-shadow: 0 0 0 2px var(--c), 0 0 12px var(--c);
  animation: fl-breathe 0.7s ease-in-out infinite alternate;
}
.fl-ripple {
  position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
  border: 2px solid var(--c); animation: fl-ripple 0.7s ease-out both;
}
@keyframes fl-ripple { from { transform: scale(0.5); opacity: 1; } to { transform: scale(1.9); opacity: 0; } }
.fl-lastdot {
  position: absolute; width: 14%; height: 14%; border-radius: 50%; pointer-events: none;
  background: #a3e635; box-shadow: 0 0 6px #a3e635, 0 0 0 1.5px rgba(0,0,0,0.5); z-index: 1;
}
.fl-shake-a { animation: fl-shake-a 0.3s ease both; }
.fl-shake-b { animation: fl-shake-b 0.3s ease both; }
@keyframes fl-shake-a { 25% { transform: translateX(-3px); background: #3a1820; } 75% { transform: translateX(3px); } }
@keyframes fl-shake-b { 25% { transform: translateX(-3px); background: #3a1820; } 75% { transform: translateX(3px); } }
.fl-status { animation: fl-status 0.28s cubic-bezier(0.22, 1, 0.36, 1) both; }
@keyframes fl-status { from { transform: translateY(5px); opacity: 0; } }
.fl-urgent { animation: fl-urgent 0.5s ease-in-out infinite alternate; }
@keyframes fl-urgent { to { opacity: 0.4; } }
.fl-bar { transition: flex-grow 0.6s cubic-bezier(0.22, 1, 0.36, 1); }
@media (prefers-reduced-motion: reduce) {
  .fl-in, .fl-lift-a, .fl-lift-b, .fl-hint, .fl-would, .fl-ripple, .fl-shake-a, .fl-shake-b, .fl-status, .fl-urgent { animation: none; }
  .fl-coin, .fl-bar, .fl-slot { transition: none; }
}
`;

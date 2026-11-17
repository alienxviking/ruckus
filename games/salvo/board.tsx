"use client";

// The Salvo sea: an n x n grid with coordinate labels, ships drawn as overlays,
// shot markers per cell, crosshairs, and the animated reveal of the latest salvo
// (shells drop one after another, then splash or burst; a sunk ship lights up).

import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type Ref } from "react";
import type { LastSalvo, ShipView } from "./server";
import { FLEETS, REVEAL_LEAD, SHOT_STEP, cellName, colLabel, revealMs, shipCells, type Ship } from "./shared";

export const HIT = "#ff7a45";
export const MISS = "#9fb3cf";
export const FOE = "#ff4d6d";

export function shipName(n: number, i: number) {
  return FLEETS[n]?.[i]?.name ?? "Ship";
}

/**
 * Elapsed time into a salvo's reveal, measured once when this component first
 * sees it (so CSS delays stay put across re-renders). Null when there's nothing
 * left to animate.
 */
export function useRevealElapsed(last: LastSalvo | null | undefined, serverNow: () => number): number | null {
  const [seen, setSeen] = useState<{ at: number; elapsed: number } | null>(null);
  if (last && seen?.at !== last.at) {
    const next = { at: last.at, elapsed: serverNow() - last.at };
    setSeen(next);
    return next.elapsed < revealMs(last.cells.length) ? next.elapsed : null;
  }
  if (!last || !seen) return null;
  return seen.elapsed < revealMs(last.cells.length) ? seen.elapsed : null;
}

export const shotDelay = (k: number, elapsed: number) => REVEAL_LEAD + k * SHOT_STEP - elapsed;

function shipStyle(s: Ship, n: number): CSSProperties {
  const u = 100 / n;
  return {
    left: `${s.c * u}%`,
    top: `${s.r * u}%`,
    width: `${(s.d ? 1 : s.len) * u}%`,
    height: `${(s.d ? s.len : 1) * u}%`,
  };
}

/** One ship hull: a rounded steel capsule with a pointed bow and deck turrets. */
export function Hull({
  ship,
  n,
  tone = "own",
  className = "",
  style,
  onPointerDown,
  label,
}: {
  ship: Ship;
  n: number;
  tone?: "own" | "sunk" | "ghost-ok" | "ghost-bad" | "reveal";
  className?: string;
  style?: CSSProperties;
  onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  label?: string;
}) {
  return (
    <div
      className={`sv-ship sv-${tone} ${ship.d ? "sv-v" : "sv-h"} ${onPointerDown ? "sv-grab" : ""} ${className}`}
      style={{ ...shipStyle(ship, n), ...style }}
      onPointerDown={onPointerDown}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      <div className="sv-hull">
        {Array.from({ length: ship.len }, (_, k) => (
          <span key={k} className="sv-turret" />
        ))}
      </div>
    </div>
  );
}

export interface GridProps {
  n: number;
  /** Shots in this sea: "." unknown, "o" miss, "x" hit. */
  board: string;
  /** Ships to draw (yours, sunk ones, or all at the end). */
  ships: ShipView[];
  sunk: boolean[];
  /** "enemy" seas are where you aim; "own" seas show your ships. */
  tone: "own" | "enemy";
  aim?: number[];
  /** The rival's crosshairs (they're aiming at this sea). */
  incoming?: number[];
  /** The latest salvo, when it landed in this sea. */
  last?: LastSalvo | null;
  serverNow: () => number;
  onCell?: (i: number) => void;
  /** Cells that react to clicks (unknown cells while aiming). */
  clickable?: boolean;
  gridRef?: Ref<HTMLDivElement>;
  /** Placement: a ship being dragged / its validity. */
  ghost?: { ship: Ship; ok: boolean } | null;
  hideShip?: number | null;
  onShipDown?: (i: number, e: ReactPointerEvent<HTMLDivElement>) => void;
  /** Ship indices that just failed to turn (shake). */
  shake?: number | null;
  glow?: string | null;
  label: string;
  dimShips?: boolean;
}

export function Grid({
  n,
  board,
  ships,
  sunk,
  tone,
  aim = [],
  incoming = [],
  last,
  serverNow,
  onCell,
  clickable,
  gridRef,
  ghost,
  hideShip,
  onShipDown,
  shake,
  glow,
  label,
  dimShips,
}: GridProps) {
  const elapsed = useRevealElapsed(last, serverNow);
  const fresh = new Map<number, number>(); // cell -> shot index in the animating salvo
  if (last && elapsed !== null) last.cells.forEach((c, k) => fresh.set(c, k));
  const sunkCells = new Set<number>();
  for (const sh of ships) if (sunk[sh.i]) for (const c of shipCells(sh, n)) sunkCells.add(c);
  const sinking = new Map<number, number>(); // ship index -> shot index that sank it (animating)
  if (last && elapsed !== null) for (const s of last.sunk) sinking.set(s.ship, s.shot);
  const aimSet = new Set(aim);
  const incomingSet = new Set(incoming);
  const cellCount = n * n;

  return (
    <div className="sv-frame" style={{ "--glow": glow ?? "transparent" } as CSSProperties}>
      <div className="sv-cols" aria-hidden style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
        {Array.from({ length: n }, (_, c) => (
          <span key={c}>{colLabel(c)}</span>
        ))}
      </div>
      <div className="sv-rows" aria-hidden style={{ gridTemplateRows: `repeat(${n}, 1fr)` }}>
        {Array.from({ length: n }, (_, r) => (
          <span key={r}>{r + 1}</span>
        ))}
      </div>
      <div
        ref={gridRef}
        className={`sv-sea sv-sea-${tone} ${clickable ? "sv-aiming" : ""}`}
        style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}
        role="grid"
        aria-label={label}
      >
        {tone === "enemy" && <div className="sv-sweep" aria-hidden />}
        {Array.from({ length: cellCount }, (_, i) => {
          const v = board[i] ?? ".";
          const k = fresh.get(i);
          const delay = k !== undefined && elapsed !== null ? shotDelay(k, elapsed) : null;
          const open = v === ".";
          const canClick = clickable && open;
          const aimed = aimSet.has(i);
          return (
            <button
              key={i}
              type="button"
              tabIndex={canClick ? 0 : -1}
              className={`sv-cell ${canClick ? "sv-open" : ""} ${aimed ? "sv-aimed" : ""}`}
              onClick={onCell ? () => onCell(i) : undefined}
              aria-label={`${cellName(i, n)}${v === "x" ? (sunkCells.has(i) ? ", sunk" : ", hit") : v === "o" ? ", miss" : ""}${aimed ? ", aimed" : ""}`}
              disabled={!onCell}
            >
              {v === "o" && (
                <span
                  className={`sv-miss ${delay !== null ? "sv-land" : ""}`}
                  style={delay !== null ? { animationDelay: `${delay}ms` } : undefined}
                />
              )}
              {v === "x" && (
                <span
                  className={`sv-hit ${sunkCells.has(i) ? "sv-hit-sunk" : ""} ${delay !== null ? "sv-land" : ""}`}
                  style={delay !== null ? { animationDelay: `${delay}ms` } : undefined}
                />
              )}
              {delay !== null && (
                <>
                  <span className="sv-shell" style={{ animationDelay: `${delay - 300}ms` }} />
                  {v === "x" ? (
                    <span className="sv-burst" style={{ animationDelay: `${delay}ms` }} />
                  ) : (
                    <span className="sv-ripple" style={{ animationDelay: `${delay}ms` }} />
                  )}
                </>
              )}
              {open && aimed && <span className="sv-cross" />}
              {open && !aimed && incomingSet.has(i) && <span className="sv-cross sv-cross-foe" />}
            </button>
          );
        })}

        {/* Ships sit on top of the water, under the shot markers' glow (pointer events off unless placing). */}
        <div className="sv-ships">
          {ships.map((sh) => {
            if (sh.i === hideShip) return null;
            const k = sinking.get(sh.i);
            const isSunk = sunk[sh.i];
            const tone2 = isSunk ? "sunk" : tone === "enemy" ? "reveal" : "own";
            const delay = k !== undefined && elapsed !== null ? shotDelay(k, elapsed) + 200 : null;
            return (
              <Hull
                key={sh.i}
                ship={sh}
                n={n}
                tone={tone2}
                className={`${delay !== null ? "sv-sinking" : ""} ${shake === sh.i ? "sv-shake" : ""} ${dimShips && !isSunk ? "sv-dim" : ""}`}
                style={delay !== null ? { animationDelay: `${delay}ms` } : undefined}
                onPointerDown={onShipDown ? (e) => onShipDown(sh.i, e) : undefined}
                label={`${shipName(n, sh.i)}${isSunk ? " (sunk)" : ""} at ${cellName(sh.r * n + sh.c, n)}`}
              />
            );
          })}
          {ghost && <Hull ship={ghost.ship} n={n} tone={ghost.ok ? "ghost-ok" : "ghost-bad"} />}
        </div>

        {/* "Sunk!" callouts for the salvo being revealed. */}
        {last &&
          elapsed !== null &&
          last.sunk.map((s, j) => (
            <div
              key={`${last.at}-${s.ship}`}
              className="sv-callout"
              style={{
                animationDelay: `${shotDelay(s.shot, elapsed) + 250 + j * 120}ms`,
                top: `${30 + j * 16}%`,
              }}
              aria-hidden
            >
              Sunk · {shipName(n, s.ship)}
            </div>
          ))}
      </div>
    </div>
  );
}

/** A small ship silhouette (dock items, fleet status pips). */
export function MiniShip({ len, sunk, color }: { len: number; sunk?: boolean; color: string }) {
  return (
    <span
      className={`sv-mini ${sunk ? "sv-mini-sunk" : ""}`}
      style={{ width: len * 5 + 2, background: sunk ? undefined : color }}
      aria-hidden
    />
  );
}

export const SALVO_CSS = `
.sv-frame{display:grid;grid-template-columns:14px 1fr;grid-template-rows:14px auto;gap:2px;width:100%;}
.sv-cols{grid-column:2;display:grid;font:600 10px/14px var(--font-mono),monospace;color:var(--color-muted);text-align:center;}
.sv-rows{grid-row:2;display:grid;font:600 10px var(--font-mono),monospace;color:var(--color-muted);text-align:right;align-items:center;padding-right:2px;}
.sv-sea{grid-column:2;grid-row:2;position:relative;display:grid;aspect-ratio:1;border-radius:10px;overflow:hidden;
  background:radial-gradient(120% 90% at 50% 0%,#12305a 0%,#0a1a33 55%,#071022 100%);
  box-shadow:inset 0 0 0 1px #2a4b7a,0 0 0 1px var(--glow),0 14px 40px -18px var(--glow);transition:box-shadow .3s;touch-action:manipulation;}
.sv-sea-own{background:radial-gradient(120% 90% at 50% 0%,#0f2a3d 0%,#0a1b29 55%,#07111b 100%);box-shadow:inset 0 0 0 1px #24485c,0 0 0 1px var(--glow),0 14px 40px -18px var(--glow);}
.sv-sweep{position:absolute;inset:-40%;pointer-events:none;background:conic-gradient(from 0deg,transparent 0deg,rgb(96 165 250/.13) 40deg,transparent 60deg);animation:sv-spin 6s linear infinite;}
@keyframes sv-spin{to{transform:rotate(360deg)}}
.sv-cell{position:relative;border:0;padding:0;background:transparent;box-shadow:inset 0 0 0 .5px rgb(120 170 255/.13);cursor:default;-webkit-tap-highlight-color:transparent;}
.sv-cell:disabled{cursor:default}
.sv-aiming .sv-open{cursor:crosshair}
.sv-aiming .sv-open:hover{background:rgb(96 165 250/.16)}
.sv-cell:focus-visible{outline:2px solid #60a5fa;outline-offset:-2px;z-index:3}
.sv-miss{position:absolute;inset:36%;border-radius:999px;background:${MISS};opacity:.75;box-shadow:0 0 0 2px rgb(159 179 207/.18);z-index:2}
.sv-hit{position:absolute;inset:18%;border-radius:999px;z-index:2;background:radial-gradient(circle at 40% 35%,#ffe0a3,${HIT} 45%,#c2261f 100%);box-shadow:0 0 10px 1px rgb(255 122 69/.7);}
.sv-hit-sunk{inset:24%;background:radial-gradient(circle at 40% 35%,#ffb199,#d4423a 50%,#5c1010 100%);box-shadow:0 0 6px rgb(212 66 58/.6);}
.sv-hit-sunk::before,.sv-hit-sunk::after{content:"";position:absolute;left:50%;top:-18%;width:2px;height:136%;background:#2a0606;border-radius:2px;transform:translateX(-50%) rotate(45deg);opacity:.7}
.sv-hit-sunk::after{transform:translateX(-50%) rotate(-45deg)}
.sv-land{animation:sv-land .45s var(--ease-spring) both}
@keyframes sv-land{0%{opacity:0;transform:scale(.2)}60%{opacity:1;transform:scale(1.35)}100%{opacity:1;transform:scale(1)}}
.sv-shell{position:absolute;left:50%;top:50%;width:30%;height:30%;margin:-15% 0 0 -15%;border-radius:999px;background:#fff;box-shadow:0 0 8px 2px #fff8;z-index:4;pointer-events:none;animation:sv-fall .3s ease-in both;opacity:0}
@keyframes sv-fall{0%{opacity:0;transform:translateY(-260%) scale(1.8)}25%{opacity:1}95%{opacity:1;transform:translateY(0) scale(.6)}100%{opacity:0;transform:translateY(0) scale(.6)}}
.sv-burst{position:absolute;inset:-35%;border-radius:999px;z-index:4;pointer-events:none;opacity:0;background:radial-gradient(circle,#fff6 0%,${HIT}cc 30%,transparent 65%);animation:sv-burst .6s ease-out both}
@keyframes sv-burst{0%{opacity:0;transform:scale(.3)}15%{opacity:1}100%{opacity:0;transform:scale(1.6)}}
.sv-ripple{position:absolute;inset:10%;border-radius:999px;border:2px solid ${MISS};z-index:3;pointer-events:none;opacity:0;animation:sv-ripple .7s ease-out both}
@keyframes sv-ripple{0%{opacity:0;transform:scale(.2)}10%{opacity:.9}100%{opacity:0;transform:scale(1.7)}}
.sv-cross{position:absolute;inset:12%;border-radius:999px;z-index:3;pointer-events:none;border:2px solid #60a5fa;box-shadow:0 0 10px #60a5fa99,inset 0 0 6px #60a5fa66;animation:sv-lock .9s ease-in-out infinite alternate}
.sv-cross::before,.sv-cross::after{content:"";position:absolute;background:#60a5fa;left:50%;top:-22%;width:2px;height:144%;transform:translateX(-50%);border-radius:2px;opacity:.9}
.sv-cross::after{left:-22%;top:50%;width:144%;height:2px;transform:translateY(-50%)}
.sv-cross-foe{border-color:${FOE};box-shadow:0 0 10px ${FOE}99}
.sv-cross-foe::before,.sv-cross-foe::after{background:${FOE}}
@keyframes sv-lock{from{transform:scale(.86)}to{transform:scale(1)}}
.sv-aimed{background:rgb(96 165 250/.18)}
.sv-ships{position:absolute;inset:0;pointer-events:none;z-index:1}
.sv-ship{position:absolute;transition:opacity .2s}
.sv-hull{position:absolute;inset:14% 5%;border-radius:40% 999px 999px 40%/50%;display:flex;align-items:center;justify-content:space-around;
  background:linear-gradient(180deg,#9fb6cf 0%,#6a819c 45%,#43566e 100%);box-shadow:inset 0 1px 0 #ffffff55,inset 0 -2px 0 #0004,0 2px 6px #0008;}
.sv-v .sv-hull{inset:5% 14%;border-radius:50%/40% 40% 999px 999px;flex-direction:column;}
.sv-turret{width:26%;max-width:9px;aspect-ratio:1;border-radius:999px;background:#2c3b4f;box-shadow:inset 0 1px 0 #ffffff33;}
.sv-v .sv-turret{width:auto;height:26%;max-height:9px}
.sv-own .sv-hull{background:linear-gradient(180deg,#a7c4e6 0%,#5f86b8 45%,#3a5a85 100%)}
.sv-reveal .sv-hull{background:linear-gradient(180deg,#c9a6e8 0%,#8a63b8 50%,#553a7a 100%);opacity:.8}
.sv-sunk .sv-hull{background:linear-gradient(180deg,#5b3434 0%,#3b1f1f 60%,#220f0f 100%);box-shadow:inset 0 0 0 1px #ff6b6b55,0 0 10px #ff4d4d55}
.sv-sunk .sv-turret{background:#140707}
.sv-ghost-ok .sv-hull{background:linear-gradient(180deg,#bdf5c9,#4ade80);opacity:.75;box-shadow:0 0 14px #4ade8088}
.sv-ghost-bad .sv-hull{background:linear-gradient(180deg,#ffc2c2,#f87171);opacity:.7;box-shadow:0 0 14px #f8717188}
.sv-grab{pointer-events:auto;cursor:grab;touch-action:none}
.sv-grab:active{cursor:grabbing}
.sv-dim{opacity:.45}
.sv-sinking{animation:sv-sink .8s ease-out both}
@keyframes sv-sink{0%{opacity:0;filter:brightness(3)}30%{opacity:1;filter:brightness(2.2)}100%{opacity:1;filter:none}}
.sv-shake{animation:sv-shake .35s ease}
@keyframes sv-shake{20%,60%{transform:translateX(-4%)}40%,80%{transform:translateX(4%)}}
.sv-callout{position:absolute;left:50%;z-index:6;pointer-events:none;white-space:nowrap;padding:4px 12px;border-radius:999px;font:800 13px/1.2 var(--font-display),sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#fff;
  background:linear-gradient(180deg,#ff6b4a,#c81e3a);box-shadow:0 6px 24px -6px #ff4d6d,0 0 0 1px #ffffff40;opacity:0;animation:sv-callout 1.7s var(--ease-out-expo) both}
@keyframes sv-callout{0%{opacity:0;transform:translate(-50%,10px) scale(.6)}12%{opacity:1;transform:translate(-50%,0) scale(1.08)}20%{transform:translate(-50%,0) scale(1)}80%{opacity:1}100%{opacity:0;transform:translate(-50%,-14px)}}
.sv-mini{display:inline-block;height:6px;border-radius:2px 7px 7px 2px;box-shadow:inset 0 -1px 0 #0005}
.sv-mini-sunk{background:repeating-linear-gradient(135deg,#ff4d6d55 0 3px,transparent 3px 5px);box-shadow:inset 0 0 0 1px #ff4d6d77}
.sv-pop{animation:sv-pop .35s var(--ease-spring) both}
@keyframes sv-pop{from{transform:scale(.7);opacity:0}to{transform:none;opacity:1}}
.sv-fadeout{animation:sv-fadeout .2s ease both}
@keyframes sv-fadeout{to{opacity:0}}
.sv-urgent{animation:sv-urgent .5s ease-in-out infinite alternate}
@keyframes sv-urgent{to{transform:scale(1.15)}}
.sv-dock-ship{touch-action:none}
@media (prefers-reduced-motion:reduce){.sv-sweep,.sv-cross{animation:none}}
`;

"use client";

// The Four in a Row board: an SVG with a frame that has real holes, so discs
// fall *behind* it and show through, plus transparent column buttons on top.

import { useId, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { Disc, LastMove, Seat, WinInfo } from "./server";
import { COLS, ROWS } from "./shared";

// ---------- geometry (SVG user units) ----------
const CELL = 100;
const PAD = 12; // frame border around the holes
const TOP = CELL; // the preview row sits above the board
const VB_W = COLS * CELL + PAD * 2;
const VB_H = TOP + ROWS * CELL + PAD;
const HOLE_R = 39;
const DISC_R = 41;
const cx = (c: number) => c * CELL + CELL / 2;
const cy = (r: number) => TOP + r * CELL + CELL / 2;
const pct = (n: number) => `${n * 100}%`;

const FRAME_PATH = (() => {
  // Inset by 1 so the 2-unit outline stays inside the (clipped) viewBox.
  const x0 = -PAD + 1;
  const y0 = TOP - PAD + 1;
  const w = VB_W - 2;
  const h = ROWS * CELL + PAD * 2 - 2;
  const k = 26;
  let d =
    `M${x0 + k},${y0}H${x0 + w - k}A${k},${k} 0 0 1 ${x0 + w},${y0 + k}V${y0 + h - k}` +
    `A${k},${k} 0 0 1 ${x0 + w - k},${y0 + h}H${x0 + k}A${k},${k} 0 0 1 ${x0},${y0 + h - k}V${y0 + k}` +
    `A${k},${k} 0 0 1 ${x0 + k},${y0}Z`;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      d += `M${cx(c) - HOLE_R},${cy(r)}a${HOLE_R},${HOLE_R} 0 1 0 ${HOLE_R * 2},0a${HOLE_R},${HOLE_R} 0 1 0 ${-HOLE_R * 2},0Z`;
    }
  }
  return d;
})();

// Deterministic confetti burst (no randomness during render).
const CONFETTI = Array.from({ length: 18 }, (_, i) => {
  const angle = (i / 18) * Math.PI * 2 + (i % 3) * 0.4;
  const dist = 70 + ((i * 37) % 70);
  return {
    dx: Math.round(Math.cos(angle) * dist),
    dy: Math.round(Math.sin(angle) * dist - 40),
    rot: ((i * 73) % 360) - 180,
    delay: (i % 4) * 30,
    light: i % 3 === 0,
  };
});

// ---------- colours ----------
function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Blend `hex` towards `to` by t (0..1). */
export function mix(hex: string, to: string, t: number): string {
  const a = parseHex(hex);
  const b = parseHex(to);
  if (!a || !b) return hex;
  return (
    "#" +
    a
      .map((v, i) => Math.round(v + (b[i] - v) * t))
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}

/** "Redmean" colour distance: cheap and close enough to perception. */
export function colorDistance(x: string, y: string): number {
  const a = parseHex(x);
  const b = parseHex(y);
  if (!a || !b) return 999;
  const rm = (a[0] + b[0]) / 2;
  const [dr, dg, db] = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

const FALLBACKS = ["#ffe14d", "#38bdf8", "#4ade80", "#c084fc", "#ff5d73", "#fb923c"];

/** Disc colours per seat: the players' own colours, unless they're too alike to tell apart. */
export function discPalette(a: string | undefined, b: string | undefined): [string, string] {
  const first = a && parseHex(a) ? a : "#ff5d73";
  let second = b && parseHex(b) ? b : "#ffe14d";
  if (colorDistance(first, second) < 125) {
    second = FALLBACKS.reduce((best, c) => (colorDistance(first, c) > colorDistance(first, best) ? c : best));
  }
  return [first, second];
}

// ---------- disc pieces ----------
/** Seat marks so discs never rely on colour alone: seat 0 = ring, seat 1 = star. */
function Mark({ seat, x, y, r }: { seat: Seat; x: number; y: number; r: number }) {
  const k = r / DISC_R;
  if (seat === 0) {
    return <circle cx={x} cy={y} r={12 * k} fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth={7 * k} />;
  }
  const s = 19 * k;
  const i = 6 * k;
  return (
    <path
      d={`M${x},${y - s}L${x + i},${y - i}L${x + s},${y}L${x + i},${y + i}L${x},${y + s}L${x - i},${y + i}L${x - s},${y}L${x - i},${y - i}Z`}
      fill="rgba(0,0,0,0.3)"
    />
  );
}

function DiscShape({ seat, x, y, fill }: { seat: Seat; x: number; y: number; fill: string }) {
  return (
    <>
      <circle cx={x} cy={y} r={DISC_R} fill={fill} />
      <circle cx={x} cy={y} r={DISC_R * 0.74} fill="none" stroke="rgba(0,0,0,0.14)" strokeWidth={3.5} />
      <Mark seat={seat} x={x} y={y} r={DISC_R} />
    </>
  );
}

/** Small disc icon for labels, chips and standings. */
export function DiscSwatch({ seat, color, size = 20 }: { seat: Seat; color: string; size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden className="shrink-0">
      <circle cx="50" cy="50" r="46" fill={color} stroke={mix(color, "#000000", 0.35)} strokeWidth="6" />
      <Mark seat={seat} x={50} y={50} r={52} />
    </svg>
  );
}

function vars(v: Record<string, string | number>): CSSProperties {
  return v as CSSProperties;
}

// ---------- motion ----------
// Discs fall under "gravity": quadratic ease-in, fall time grows with the square
// root of the distance, then one small bounce and a tiny settle. Each drop height
// (1..ROWS cells) gets its own keyframes so the bounce lands at the right moment.
const EASE_IN = "cubic-bezier(0.11, 0, 0.5, 0)"; // quad in: accelerating
const EASE_OUT = "cubic-bezier(0.5, 1, 0.89, 1)"; // quad out: decelerating
/** Win sweep: ms between neighbouring discs lighting up. */
const SWEEP_STEP = 110;

export function dropTiming(rows: number) {
  const n = Math.max(1, Math.min(ROWS, Math.round(rows)));
  const height = n * CELL;
  const fall = 140 * Math.sqrt(n);
  const bounce1 = Math.min(18, 5 + 2.5 * n);
  const bounce2 = bounce1 * 0.28;
  // Time aloft for a bounce of height h under the same gravity: 2 * fall * sqrt(h / height).
  const up1 = 2 * fall * Math.sqrt(bounce1 / height);
  const up2 = 2 * fall * Math.sqrt(bounce2 / height);
  return {
    n,
    height,
    fall,
    bounce1,
    bounce2,
    up1,
    up2,
    /** Disc has landed and bounced once: a good moment for follow-up effects. */
    settled: Math.round(fall + up1),
    total: Math.round(fall + up1 + up2),
  };
}

function dropKeyframes(rows: number): string {
  const t = dropTiming(rows);
  const at = (ms: number) => `${((ms / t.total) * 100).toFixed(2)}%`;
  return (
    `@keyframes fr-drop-${rows} {` +
    `0% { transform: translateY(${-t.height}px); animation-timing-function: ${EASE_IN}; }` +
    `${at(t.fall)} { transform: translateY(0); animation-timing-function: ${EASE_OUT}; }` +
    `${at(t.fall + t.up1 / 2)} { transform: translateY(${-t.bounce1}px); animation-timing-function: ${EASE_IN}; }` +
    `${at(t.fall + t.up1)} { transform: translateY(0); animation-timing-function: ${EASE_OUT}; }` +
    `${at(t.fall + t.up1 + t.up2 / 2)} { transform: translateY(${(-t.bounce2).toFixed(1)}px); animation-timing-function: ${EASE_IN}; }` +
    `100% { transform: translateY(0); } }`
  );
}

export interface BoardPreview {
  col: number;
  seat: Seat;
  /** The viewer's own hover (vs. the opponent's, relayed by the server). */
  mine: boolean;
  /** Already dropped, waiting for the server: hold still. */
  held?: boolean;
}

/** A press (mouse, pen or finger) on the columns that may end in a drop. */
interface Press {
  id: number;
  touch: boolean;
}

export function Board({
  board,
  game,
  colors,
  last,
  win,
  preview,
  glow,
  compact,
  buttons,
  canDrop,
  releasing,
  onHover,
  onDrop,
  label,
}: {
  board: Disc[][];
  /** Game number, so discs remount (and animate) per game. */
  game: number;
  colors: [string, string];
  last: LastMove | null;
  /** Winning line to celebrate, or null. */
  win: WinInfo | null;
  preview: BoardPreview | null;
  /** Colour of the player to move (frame glow), or null. */
  glow: string | null;
  /** Crop the empty preview row (final screen). */
  compact: boolean;
  /** Render the column buttons (players only). */
  buttons: boolean;
  canDrop: boolean;
  /** The next game is about to start: let the discs fall out of the bottom. */
  releasing: boolean;
  onHover: (col: number | null) => void;
  onDrop: (col: number) => void;
  /** Screen-reader summary of the position. */
  label: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const press = useRef<Press | null>(null);
  const grad = (seat: Seat) => `fr${uid}d${seat}`;
  const winSet = new Set(win?.cells.map(([r, c]) => r * COLS + c) ?? []);
  const landing = preview ? landingRowOf(board, preview.col) : -1;
  const pc = preview ? colors[preview.seat] : null;
  const focusCol = preview?.mine ? preview.col : 3;
  // Visible part of the drawing: everything, or just the frame on the final screen.
  const vbY = compact ? TOP - PAD : 0;
  const vbH = VB_H - vbY;
  const fx = (x: number) => (x + PAD) / VB_W; // SVG x -> fraction of the box width
  const fy = (y: number) => (y - vbY) / vbH; // SVG y -> fraction of the box height

  // ----- win choreography: everything waits for the winning disc to land, then
  // sweeps outwards from it along the line(s), one disc every SWEEP_STEP ms.
  const lastDrop = last ? dropTiming(last.row + 1) : null;
  const winDelay = lastDrop ? lastDrop.settled : 0;
  const origin: [number, number] | null = win
    ? last && winSet.has(last.row * COLS + last.col)
      ? [last.row, last.col]
      : (win.cells[0] ?? null)
    : null;
  const sweepAt = (r: number, c: number) =>
    origin ? winDelay + Math.max(Math.abs(r - origin[0]), Math.abs(c - origin[1])) * SWEEP_STEP : winDelay;
  const segments: { d: string; ms: number }[] = [];
  if (win && origin) {
    const [or, oc] = origin;
    for (const [r1, c1, r2, c2] of win.lines) {
      for (const [r, c] of [
        [r1, c1],
        [r2, c2],
      ]) {
        const len = Math.max(Math.abs(r - or), Math.abs(c - oc));
        if (len > 0) segments.push({ d: `M${cx(oc)},${cy(or)}L${cx(c)},${cy(r)}`, ms: len * SWEEP_STEP });
      }
    }
  }
  let burst: { x: number; y: number; color: string; delay: number } | null = null;
  if (win && win.cells.length) {
    const avgR = win.cells.reduce((n, [r]) => n + r, 0) / win.cells.length;
    const avgC = win.cells.reduce((n, [, c]) => n + c, 0) / win.cells.length;
    burst = { x: fx(cx(avgC)), y: fy(cy(avgR)), color: colors[win.seat], delay: winDelay + SWEEP_STEP };
  }

  // ----- pointer: hover follows the mouse; a press can be dragged sideways to
  // pick a column and drops on release (drag off the board to cancel). Vertical
  // swipes still scroll the page on phones (touch-action: pan-y).
  const colAt = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const slack = press.current ? 28 : 0;
    const { clientX: x, clientY: y } = e;
    if (x < rect.left - slack || x > rect.right + slack || y < rect.top - slack || y > rect.bottom + slack) return null;
    return Math.max(0, Math.min(COLS - 1, Math.floor(((x - rect.left) / rect.width) * COLS)));
  };
  const endPress = (e: PointerEvent<HTMLDivElement>, drop: boolean) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    const col = drop ? colAt(e) : null;
    press.current = null;
    if (col !== null && canDrop) onDrop(col);
    // Fingers don't hover: clear the preview once they lift (mice keep pointing).
    if (p.touch || col === null) onHover(e.pointerType === "mouse" ? colAt(e) : null);
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, col: number) => {
    const dir = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    const target = e.key === "Home" ? 0 : e.key === "End" ? COLS - 1 : dir ? col + dir : -1;
    if (target < 0 || target >= COLS) return;
    e.preventDefault();
    const sibling = e.currentTarget.parentElement?.children[target];
    if (sibling instanceof HTMLElement) sibling.focus();
  };

  return (
    <div className="relative mx-auto w-full select-none" style={{ maxWidth: "min(100%, 540px, 55vh)" }}>
      <div className="relative w-full" style={{ aspectRatio: `${VB_W} / ${vbH}` }}>
        {/* Turn glow behind the frame */}
        <div
          aria-hidden
          className="fr-glow absolute rounded-[3.5%]"
          style={{
            left: 0,
            right: 0,
            top: pct(fy(TOP - PAD)),
            bottom: 0,
            boxShadow: glow ? `0 0 0 2px ${glow}66, 0 14px 44px -12px ${glow}` : "0 14px 40px -18px #000",
          }}
        />
        <svg
          viewBox={`${-PAD} ${vbY} ${VB_W} ${vbH}`}
          className="absolute inset-0 h-full w-full overflow-hidden"
          role="img"
          aria-label={label}
        >
          <defs>
            {([0, 1] as Seat[]).map((seat) => (
              <radialGradient key={seat} id={grad(seat)} cx="0.38" cy="0.32" r="0.78">
                <stop offset="0" stopColor={mix(colors[seat], "#ffffff", 0.45)} />
                <stop offset="0.5" stopColor={colors[seat]} />
                <stop offset="1" stopColor={mix(colors[seat], "#000000", 0.4)} />
              </radialGradient>
            ))}
            <linearGradient id={`fr${uid}frame`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#332d63" />
              <stop offset="1" stopColor="#1f1b3d" />
            </linearGradient>
          </defs>

          {/* Dark backing seen through empty holes */}
          <rect x={-PAD / 2} y={TOP - PAD / 2} width={VB_W - PAD} height={ROWS * CELL + PAD} rx={20} fill="#0a0817" />

          {/* Discs (behind the frame) */}
          {board.map((row, r) =>
            row.map((cell, c) => {
              if (cell === null) return null;
              const isLast = !!last && last.row === r && last.col === c;
              const dim = win !== null && !winSet.has(r * COLS + c);
              const t = isLast ? lastDrop : null;
              return (
                <g
                  key={`${game}-${r}-${c}`}
                  className={`fr-dim${t ? " fr-drop" : ""}${releasing ? " fr-out" : ""}`}
                  style={{
                    opacity: dim ? 0.32 : 1,
                    transitionDelay: dim ? `${winDelay}ms` : undefined,
                    ...(t ? vars({ "--fr-drop-name": `fr-drop-${t.n}`, "--fr-drop-dur": `${t.total}ms` }) : {}),
                    ...(releasing
                      ? vars({
                          // Bottom rows go first, columns ripple from the middle out.
                          "--fr-out-delay": `${(ROWS - 1 - r) * 18 + Math.abs(c - 3) * 22}ms`,
                          "--fr-out-dist": `${(ROWS - r) * CELL + PAD * 2}px`,
                        })
                      : {}),
                  }}
                >
                  <DiscShape seat={cell} x={cx(c)} y={cy(r)} fill={`url(#${grad(cell)})`} />
                </g>
              );
            }),
          )}

          {/* The frame, with real holes */}
          <path d={FRAME_PATH} fill={`url(#fr${uid}frame)`} fillRule="evenodd" stroke="#463e80" strokeWidth={2} />
          {board.map((row, r) =>
            row.map((_, c) => (
              <circle
                key={`rim-${r}-${c}`}
                cx={cx(c)}
                cy={cy(r)}
                r={HOLE_R}
                fill="none"
                stroke="#0d0b1e"
                strokeOpacity={0.85}
                strokeWidth={3}
              />
            )),
          )}

          {/* Column highlight + where the disc would land (both glide between columns) */}
          {preview && pc && (
            <g className="fr-appear" style={{ pointerEvents: "none" }}>
              <rect
                className="fr-slide"
                style={{ transform: `translateX(${preview.col * CELL}px)` }}
                x={4}
                y={TOP - PAD + 4}
                width={CELL - 8}
                height={ROWS * CELL + PAD * 2 - 8}
                rx={18}
                fill={pc}
                opacity={preview.mine ? 0.11 : 0.07}
              />
              {landing >= 0 && (
                <circle
                  className="fr-slide"
                  style={{ transform: `translate(${preview.col * CELL}px, ${landing * CELL}px)` }}
                  cx={cx(0)}
                  cy={cy(0)}
                  r={31}
                  fill={pc}
                  fillOpacity={0.14}
                  stroke={pc}
                  strokeOpacity={preview.mine ? 0.85 : 0.5}
                  strokeWidth={4}
                  strokeDasharray="9 8"
                />
              )}
            </g>
          )}

          {/* Column numbers (also the keyboard shortcuts) while it's your move */}
          {canDrop &&
            board[0].map((top, c) => (
              <text
                key={`num-${c}`}
                className="fr-num"
                x={cx(c)}
                y={CELL / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={30}
                fontWeight={700}
                fill="#a39dc8"
                opacity={preview?.col === c ? 0 : top === null ? 0.55 : 0.15}
              >
                {c + 1}
              </text>
            ))}

          {/* Hovering disc above the board (glides between columns) */}
          {preview && (
            <g className="fr-slide" style={{ transform: `translateX(${preview.col * CELL}px)` }}>
              <g className="fr-appear">
                <g
                  className={preview.mine && !preview.held ? "fr-bob" : undefined}
                  style={{ opacity: preview.mine ? 1 : 0.8 }}
                >
                  <DiscShape seat={preview.seat} x={cx(0)} y={CELL / 2} fill={`url(#${grad(preview.seat)})`} />
                </g>
              </g>
            </g>
          )}

          {/* Last move marker (appears once the disc has settled) */}
          {last && !win && (
            <g className={releasing ? "fr-fadeout" : undefined}>
              <circle
                key={`last-${game}-${last.row}-${last.col}`}
                className="fr-fadein"
                style={{ animationDelay: `${lastDrop?.total ?? 0}ms` }}
                cx={cx(last.col)}
                cy={cy(last.row)}
                r={HOLE_R + 4}
                fill="none"
                stroke="#ffffff"
                strokeOpacity={0.6}
                strokeWidth={3.5}
              />
            </g>
          )}

          {/* Winning line: sweeps out from the winning disc */}
          {win && (
            <g key={`win-${game}`} className={releasing ? "fr-fadeout" : undefined} style={{ pointerEvents: "none" }}>
              {segments.map((s, i) => (
                <g key={`line-${i}`}>
                  <path
                    className="fr-line"
                    style={{ animationDuration: `${s.ms}ms`, animationDelay: `${winDelay}ms` }}
                    pathLength={1}
                    d={s.d}
                    stroke={colors[win.seat]}
                    strokeOpacity={0.55}
                    strokeWidth={26}
                    strokeLinecap="round"
                    fill="none"
                  />
                  <path
                    className="fr-line"
                    style={{ animationDuration: `${s.ms}ms`, animationDelay: `${winDelay}ms` }}
                    pathLength={1}
                    d={s.d}
                    stroke="#ffffff"
                    strokeWidth={11}
                    strokeLinecap="round"
                    fill="none"
                  />
                </g>
              ))}
              {win.cells.map(([r, c]) => {
                const at = sweepAt(r, c);
                return (
                  <g key={`cell-${r}-${c}`}>
                    <circle
                      className="fr-glint"
                      style={{ animationDelay: `${at}ms` }}
                      cx={cx(c)}
                      cy={cy(r)}
                      r={HOLE_R - 3}
                      fill="#ffffff"
                    />
                    <circle
                      className="fr-ring"
                      style={vars({ "--fr-at": `${at}ms` })}
                      cx={cx(c)}
                      cy={cy(r)}
                      r={HOLE_R + 5}
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth={5}
                    />
                  </g>
                );
              })}
            </g>
          )}
        </svg>

        {/* Celebration */}
        {burst && !releasing && (
          <div key={`burst-${game}`} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            {CONFETTI.map((p, i) => (
              <span
                key={i}
                className="fr-confetti"
                style={{
                  left: pct(burst.x),
                  top: pct(burst.y),
                  background: p.light ? "#ffffff" : burst.color,
                  animationDelay: `${burst.delay + p.delay}ms`,
                  ...vars({ "--dx": `${p.dx}px`, "--dy": `${p.dy}px`, "--rot": `${p.rot}deg` }),
                }}
              />
            ))}
          </div>
        )}

        {/* Column buttons: the whole column (and the preview row) is the target */}
        {buttons && !compact && (
          <div
            className="absolute grid"
            style={{
              left: pct(fx(0)),
              width: pct((COLS * CELL) / VB_W),
              top: pct(fy(0)),
              height: pct(fy(TOP + ROWS * CELL) - fy(0)),
              gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`,
              touchAction: "pan-y pinch-zoom",
            }}
            role="group"
            aria-label="Board columns"
            onPointerDown={(e) => {
              if (!e.isPrimary || e.button !== 0) return;
              press.current = { id: e.pointerId, touch: e.pointerType !== "mouse" };
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                // Capture is a nicety (keeps tracking a drag that leaves the board).
              }
              onHover(colAt(e));
            }}
            onPointerMove={(e) => {
              const p = press.current;
              if (p ? p.id !== e.pointerId : e.pointerType !== "mouse") return;
              onHover(colAt(e));
            }}
            onPointerUp={(e) => endPress(e, true)}
            onPointerCancel={(e) => endPress(e, false)}
            onPointerLeave={(e) => {
              if (!press.current && e.pointerType === "mouse") onHover(null);
            }}
            onBlur={(e) => {
              if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) onHover(null);
            }}
          >
            {Array.from({ length: COLS }, (_, c) => {
              const full = board[0][c] !== null;
              const live = canDrop && !full;
              return (
                <button
                  key={c}
                  type="button"
                  tabIndex={c === focusCol ? 0 : -1}
                  aria-label={full ? `Column ${c + 1}, full` : `Drop in column ${c + 1}`}
                  aria-disabled={!live}
                  className={`h-full rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-inset ${
                    live ? "cursor-pointer" : "cursor-default"
                  }`}
                  // Keyboard focus previews the column; pointer focus is handled above.
                  onFocus={(e) => {
                    if (e.currentTarget.matches(":focus-visible")) onHover(c);
                  }}
                  onKeyDown={(e) => onKey(e, c)}
                  // Pointer presses drop on release (above); this is Enter / Space.
                  onClick={(e) => {
                    if (e.detail === 0 && live) onDrop(c);
                  }}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function landingRowOf(board: Disc[][], col: number): number {
  for (let r = ROWS - 1; r >= 0; r--) if (board[r]?.[col] === null) return r;
  return -1;
}

export const BOARD_CSS = `
${Array.from({ length: ROWS }, (_, i) => dropKeyframes(i + 1)).join("\n")}
.fr-drop { animation: var(--fr-drop-name, fr-drop-6) var(--fr-drop-dur, 500ms) linear both; }
.fr-out { animation: fr-out 0.45s var(--fr-out-delay, 0ms) cubic-bezier(0.5, 0, 0.9, 0.55) forwards; }
@keyframes fr-out { from { transform: translateY(0); } to { transform: translateY(var(--fr-out-dist, 700px)); } }
.fr-bob { animation: fr-bob 0.9s ease-in-out infinite alternate; }
@keyframes fr-bob { from { transform: translateY(-5px); } to { transform: translateY(3px); } }
.fr-slide { transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1); }
.fr-appear { animation: fr-fade 0.14s ease-out both; }
.fr-num { transition: opacity 0.15s ease; }
.fr-dim { transition: opacity 0.4s ease; }
.fr-glow { transition: box-shadow 0.35s ease; }
.fr-fadein { animation: fr-fade 0.25s ease both; }
@keyframes fr-fade { from { opacity: 0; } }
.fr-fadeout { transition: opacity 0.3s ease; opacity: 0; }
.fr-ring {
  transform-box: fill-box; transform-origin: center;
  animation: fr-ring-in 0.38s var(--fr-at, 0ms) cubic-bezier(0.2, 1.4, 0.4, 1) both,
    fr-wave 1.5s calc(var(--fr-at, 0ms) + 0.9s) ease-in-out 4;
}
@keyframes fr-ring-in { from { transform: scale(0.55); opacity: 0; } }
@keyframes fr-wave { 50% { transform: scale(1.07); opacity: 0.5; } }
.fr-glint { opacity: 0; animation: fr-glint 0.5s ease-out both; }
@keyframes fr-glint { 0% { opacity: 0; } 25% { opacity: 0.6; } 100% { opacity: 0; } }
/* Hidden until its delay ends (a round cap on an undrawn dash would show as a dot). */
.fr-line { stroke-dasharray: 1; stroke-dashoffset: 1; opacity: 0; animation: fr-draw 0.3s linear forwards; }
@keyframes fr-draw { from { stroke-dashoffset: 1; opacity: 1; } to { stroke-dashoffset: 0; opacity: 1; } }
/* Invisible while waiting for its delay (no backwards fill), gone after (forwards). */
.fr-confetti {
  position: absolute; width: 8px; height: 13px; border-radius: 3px; opacity: 0;
  animation: fr-burst 1.05s cubic-bezier(0.15, 0.7, 0.35, 1) forwards;
}
@keyframes fr-burst {
  0% { transform: translate(-50%, -50%) scale(0.3) rotate(0deg); opacity: 1; }
  70% { opacity: 1; }
  100% { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1) rotate(var(--rot)); opacity: 0; }
}
.fr-urgent { animation: fr-urgent 0.5s ease-in-out infinite alternate; }
@keyframes fr-urgent { to { opacity: 0.4; } }
.fr-swap { animation: fr-swap 0.3s cubic-bezier(0.2, 1.4, 0.4, 1) both; }
@keyframes fr-swap { from { transform: scale(0.85); opacity: 0.4; } }
.fr-status { animation: fr-status 0.28s cubic-bezier(0.22, 1, 0.36, 1) both; }
@keyframes fr-status { from { transform: translateY(5px); opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .fr-drop, .fr-out, .fr-bob, .fr-ring, .fr-urgent, .fr-fadein, .fr-swap, .fr-appear, .fr-status { animation: none; }
  .fr-slide, .fr-dim, .fr-glow, .fr-num { transition: none; }
  .fr-fadeout { transition: none; opacity: 1; } /* discs don't fall out either: keep it all until the new board */
  .fr-line { animation: none; stroke-dashoffset: 0; opacity: 1; }
  .fr-glint, .fr-confetti { display: none; }
}
`;

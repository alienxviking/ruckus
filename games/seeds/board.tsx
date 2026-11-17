"use client";

// The Seeds board: a carved, glowing tray. 8 columns (store, 6 pits, store) by
// 2 rows of pits, with each pit's count above (top row) or below (bottom row).
// The viewer's row is the bottom one, sown left to right into their store on
// the right. A "hand" of seeds flies from slot to slot while a move replays.

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { PITS, STORE, pitIndex, type Seat } from "./shared";

export const SIDE: readonly [string, string] = ["#a3e635", "#fbbf24"];
const BEADS = ["#a3e635", "#facc15", "#34d399", "#fb923c", "#e879f9", "#5eead4"];
const PIT_DOTS = 14;
const STORE_DOTS = 48;

export const BOARD_CSS = `
.sd-tray{background:
  radial-gradient(120% 90% at 50% 0%, color-mix(in oklab, var(--sd-accent) 10%, transparent), transparent 60%),
  linear-gradient(180deg,#191510,#0f0d0a);
  box-shadow: inset 0 1px 0 #ffffff14, inset 0 -2px 0 #00000080, 0 18px 40px -22px var(--sd-accent);
  border:1px solid color-mix(in oklab, var(--sd-accent) 28%, #2a2418);}
.sd-pit{background:radial-gradient(circle at 50% 38%, #07060a 0 52%, #15110c 78%, #241d14 100%);
  box-shadow: inset 0 3px 8px #000c, inset 0 -1px 0 #ffffff12, 0 1px 0 #ffffff0d;
  transition: box-shadow .25s, transform .15s, outline-color .25s;}
.sd-store{border-radius:999px;}
.sd-legal{cursor:pointer; box-shadow: inset 0 3px 8px #000c, 0 0 0 2px var(--sd-side), 0 0 18px -2px var(--sd-side);
  animation: sd-breathe 1.6s ease-in-out infinite;}
.sd-legal:hover,.sd-legal:focus-visible{transform:translateY(-2px) scale(1.04); outline:none;
  box-shadow: inset 0 3px 8px #000c, 0 0 0 3px var(--sd-side), 0 0 26px 0 var(--sd-side);}
.sd-target{box-shadow: inset 0 3px 8px #000c, 0 0 0 2px #fff8, 0 0 14px #fff6;}
.sd-flash{animation: sd-flash .5s ease-out 2;}
.sd-land{animation: sd-land .28s var(--ease-spring);}
.sd-bead{position:absolute; border-radius:999px; transform:translate(-50%,-50%);
  box-shadow: inset -1px -2px 2px #0007, 0 1px 1px #0009; animation: sd-drop .26s var(--ease-spring) both;}
.sd-hand{position:absolute; left:0; top:0; z-index:5; pointer-events:none;
  transition: transform .1s cubic-bezier(.3,.7,.4,1), opacity .2s;}
.sd-hand-in{animation: sd-bob .22s ease-in-out infinite alternate;}
.sd-pop{animation: sd-pop 1.3s var(--ease-out-expo) both;}
.sd-status{animation: sd-status .35s var(--ease-out-expo) both;}
.sd-urgent{animation: sd-urgent .5s ease-in-out infinite alternate;}
@keyframes sd-breathe{50%{box-shadow: inset 0 3px 8px #000c, 0 0 0 2px var(--sd-side), 0 0 26px 2px var(--sd-side);}}
@keyframes sd-flash{0%{box-shadow:0 0 0 3px #fff, 0 0 30px 6px var(--sd-side);}100%{}}
@keyframes sd-land{0%{transform:scale(1.12)}100%{transform:scale(1)}}
@keyframes sd-drop{0%{transform:translate(-50%,-160%) scale(.6);opacity:0}100%{transform:translate(-50%,-50%) scale(1);opacity:1}}
@keyframes sd-bob{to{margin-top:-3px}}
@keyframes sd-pop{0%{transform:translate(-50%,-30%) scale(.6);opacity:0}15%{transform:translate(-50%,-50%) scale(1.08);opacity:1}
  75%{transform:translate(-50%,-60%) scale(1);opacity:1}100%{transform:translate(-50%,-90%) scale(.96);opacity:0}}
@keyframes sd-status{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes sd-urgent{to{opacity:.55}}
@media (prefers-reduced-motion: reduce){.sd-legal,.sd-bead,.sd-hand-in,.sd-flash,.sd-land,.sd-pop{animation:none}.sd-hand{transition:none}}
`;

/** Deterministic bead layout: a sunflower spiral, squashed to fit stores. */
function beadPos(k: number, count: number, tall: boolean): { x: number; y: number } {
  if (count === 1) return { x: 50, y: 50 };
  const r = Math.sqrt((k + 0.5) / count);
  const a = k * 2.39996 + 0.6;
  // Stores are tall pills: keep beads clear of the edges and the count badges.
  return tall ? { x: 50 + Math.cos(a) * r * 24, y: 50 + Math.sin(a) * r * 30 } : { x: 50 + Math.cos(a) * r * 33, y: 50 + Math.sin(a) * r * 33 };
}

function Beads({ n, slot, tall }: { n: number; slot: number; tall: boolean }) {
  const shown = Math.min(n, tall ? STORE_DOTS : PIT_DOTS);
  const size = tall ? (shown > 30 ? 13 : 15) : shown > 9 ? 17 : 20;
  return (
    <>
      {Array.from({ length: shown }, (_, k) => {
        const p = beadPos(k, Math.max(shown, tall ? 6 : 1), tall);
        const c = BEADS[(slot * 5 + k * 7) % BEADS.length];
        return (
          <span
            key={k}
            className="sd-bead"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: tall ? `${size * 1.45}%` : `${size}%`,
              height: tall ? `${size * 0.62}%` : `${size}%`,
              background: `radial-gradient(circle at 35% 30%, #fff9 0 12%, ${c} 38%, color-mix(in oklab, ${c} 55%, #000) 100%)`,
            }}
          />
        );
      })}
    </>
  );
}

export interface Hint {
  /** Slot the last seed would land in. */
  slot: number;
  label: string | null;
}

export interface BoardProps {
  board: number[];
  /** Seat shown on the bottom row. */
  bottom: Seat;
  /** Pit numbers the viewer may sow right now. */
  legal: number[];
  onSow: (pit: number) => void;
  onHover: (pit: number | null) => void;
  hint: Hint | null;
  /** The flying hand: where it is and how many seeds are left in it. */
  hand: { slot: number; n: number; seat: Seat } | null;
  /** Slots to flash (captures, sweeps). */
  flash: number[];
  /** Slot that just received a seed (bumps). */
  landed: number | null;
  /** Big floating callout ("Extra turn!", "Capture +6") over a slot. */
  callout: { slot: number; text: string; key: number; color: string } | null;
  /** Last move's starting pit (outlined once the replay is over). */
  lastStart: number | null;
  label: string;
}

export function Board(props: BoardProps) {
  const { board, bottom, legal, onSow, onHover, hint, hand, flash, landed, callout, lastStart, label } = props;
  const top: Seat = bottom === 0 ? 1 : 0;
  const wrap = useRef<HTMLDivElement>(null);
  const slots = useRef<(HTMLElement | null)[]>([]);
  const [centers, setCenters] = useState<{ x: number; y: number }[]>([]);
  const [width, setWidth] = useState(400);

  // Measure slot centres (for the flying hand and callouts) on mount and resize.
  useLayoutEffect(() => {
    const measure = () => {
      const base = wrap.current?.getBoundingClientRect();
      if (!base) return;
      setWidth(base.width);
      setCenters(
        slots.current.map((el) => {
          if (!el) return { x: 0, y: 0 };
          const r = el.getBoundingClientRect();
          return { x: r.left - base.left + r.width / 2, y: r.top - base.top + r.height / 2 };
        }),
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [bottom]);

  const pitCell = (seat: Seat, n: number, row: 2 | 3, col: number) => {
    const i = pitIndex(seat, n);
    const isLegal = seat === bottom && legal.includes(n);
    const count = board[i];
    const cls = [
      "sd-pit relative aspect-square w-full rounded-full",
      isLegal ? "sd-legal" : "",
      hint?.slot === i ? "sd-target" : "",
      flash.includes(i) ? "sd-flash" : "",
      landed === i ? "sd-land" : "",
    ].join(" ");
    const style = { "--sd-side": SIDE[seat], gridRow: row, gridColumn: col } as CSSProperties;
    const content = <Beads n={count} slot={i} tall={false} />;
    const countRow = row === 2 ? 1 : 4;
    return [
      <span
        key={`c${i}`}
        className={`self-center text-center font-mono text-[11px] font-bold tabular-nums sm:text-sm ${count ? "" : "opacity-40"}`}
        style={{ gridRow: countRow, gridColumn: col, color: seat === bottom && isLegal ? SIDE[seat] : "var(--color-muted)" }}
        aria-hidden
      >
        {count}
      </span>,
      <button
        key={`p${i}`}
        ref={(el) => {
          slots.current[i] = el;
        }}
        type="button"
        disabled={!isLegal}
        className={`${cls} disabled:cursor-default`}
        style={{ ...style, outline: !isLegal && lastStart === i ? `2px dashed ${SIDE[seat]}88` : undefined, outlineOffset: 2 }}
        onClick={() => isLegal && onSow(n)}
        onPointerEnter={(e) => isLegal && e.pointerType === "mouse" && onHover(n)}
        onPointerLeave={() => onHover(null)}
        onFocus={() => isLegal && onHover(n)}
        onBlur={() => onHover(null)}
        aria-label={`${seat === bottom ? "Your" : "Their"} pit ${n + 1}: ${count} seeds${isLegal ? ", sow it" : ""}`}
      >
        {content}
      </button>,
    ];
  };

  const storeCell = (seat: Seat, col: number) => {
    const i = STORE[seat];
    return (
      <div
        key={`s${i}`}
        ref={(el) => {
          slots.current[i] = el;
        }}
        className={`sd-pit sd-store relative h-full w-full ${flash.includes(i) ? "sd-flash" : ""} ${landed === i ? "sd-land" : ""} ${
          hint?.slot === i ? "sd-target" : ""
        }`}
        style={{ "--sd-side": SIDE[seat], gridRow: "1 / 5", gridColumn: col, boxShadow: `inset 0 3px 10px #000c, 0 0 0 1px ${SIDE[seat]}55` } as CSSProperties}
        aria-hidden
      >
        <Beads n={board[i]} slot={i} tall />
        <span
          key={board[i]}
          className="animate-pop absolute left-1/2 -translate-x-1/2 rounded-full px-1.5 font-mono text-sm font-black tabular-nums sm:text-lg"
          style={{
            [seat === bottom ? "bottom" : "top"]: "6%",
            color: SIDE[seat],
            background: "#000a",
            textShadow: `0 0 10px ${SIDE[seat]}`,
          }}
        >
          {board[i]}
        </span>
      </div>
    );
  };

  const handPos = hand ? centers[hand.slot] : undefined;
  const calloutPos = callout ? centers[callout.slot] : undefined;

  return (
    <div
      ref={wrap}
      className="sd-tray relative mx-auto w-full max-w-[680px] rounded-[2rem] p-2 sm:p-3"
      style={{ "--sd-accent": SIDE[bottom] } as CSSProperties}
      role="group"
      aria-label={label}
    >
      <div
        className="grid items-center gap-x-1 gap-y-1 sm:gap-x-2"
        style={{ gridTemplateColumns: "minmax(0,1.15fr) repeat(6, minmax(0,1fr)) minmax(0,1.15fr)", gridTemplateRows: "auto auto auto auto" }}
      >
        {storeCell(top, 1)}
        {Array.from({ length: PITS }, (_, k) => pitCell(top, PITS - 1 - k, 2, k + 2))}
        {Array.from({ length: PITS }, (_, k) => pitCell(bottom, k, 3, k + 2))}
        {storeCell(bottom, 8)}
      </div>

      {hint?.label && centers[hint.slot] && (
        <span
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-full border border-white/30 bg-black/80 px-2 py-0.5 text-[10px] font-bold whitespace-nowrap text-white"
          style={{ left: centers[hint.slot].x, top: centers[hint.slot].y - 18 }}
        >
          {hint.label}
        </span>
      )}

      <div
        className="sd-hand"
        style={{
          transform: handPos ? `translate(${handPos.x}px, ${handPos.y}px)` : undefined,
          opacity: hand && handPos ? 1 : 0,
        }}
        aria-hidden
      >
        {hand && (
          <div className="sd-hand-in -translate-x-1/2 -translate-y-[115%]">
            <span
              className="flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 font-mono text-xs font-black text-black"
              style={{ background: SIDE[hand.seat], boxShadow: `0 0 14px ${SIDE[hand.seat]}, 0 2px 6px #000` }}
            >
              {hand.n}
            </span>
          </div>
        )}
      </div>

      {callout && calloutPos && (
        <span
          key={callout.key}
          className="sd-pop pointer-events-none absolute z-10 rounded-full px-3 py-1 font-display text-sm font-black whitespace-nowrap text-black sm:text-base"
          style={{
            left: Math.min(Math.max(calloutPos.x, 60), width - 60),
            top: calloutPos.y,
            background: callout.color,
            boxShadow: `0 0 24px ${callout.color}, 0 4px 12px #000`,
          }}
        >
          {callout.text}
        </span>
      )}
    </div>
  );
}

export function SideSwatch({ seat, size = 14 }: { seat: Seat; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 35% 30%, #fffa 0 14%, ${SIDE[seat]} 40%, color-mix(in oklab, ${SIDE[seat]} 50%, #000))`,
        boxShadow: `0 0 8px ${SIDE[seat]}88`,
      }}
      aria-hidden
    />
  );
}

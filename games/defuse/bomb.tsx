"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTicker } from "@/components/game-ui";
import { DIAL_STEPS, GLYPHS, MODULE_ICON, MODULE_NAME, PAD_COLORS, SWATCH, TAP_MS, holdDigit, type Edge, type ModView } from "./shared";
import { Clock, Glyph, StrikeLeds, cap, fmtClock } from "./ui";
import type { DefuseAction } from "./server";

type Act = (a: DefuseAction) => void;

export interface BombProps {
  edge: Edge;
  mods: ModView[];
  strikes: number;
  live: boolean;
  explodeAt: number;
  rate: number;
  left: number;
  outcome: "defused" | "boom" | null;
  /** Null = look, don't touch (spectators, experts after the bang, the brief). */
  act: Act | null;
  serverNow: () => number;
  /** Buttons someone is holding right now (spectators see it). */
  remoteHeld: Record<number, boolean>;
  caption?: ReactNode;
}

export function Bomb(p: BombProps) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef(p.strikes);
  // Shake the case on every new strike (Web Animations: no re-render, no remount).
  useEffect(() => {
    if (p.strikes > seen.current && ref.current && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      ref.current.animate(
        [
          { transform: "translateX(0)" },
          { transform: "translateX(-9px) rotate(-.7deg)" },
          { transform: "translateX(8px) rotate(.6deg)" },
          { transform: "translateX(-5px)" },
          { transform: "translateX(3px)" },
          { transform: "translateX(0)" },
        ],
        { duration: 420, easing: "cubic-bezier(.36,.07,.19,.97)" },
      );
    }
    seen.current = p.strikes;
  }, [p.strikes]);

  return (
    <div ref={ref} className="relative">
      <div
        className="relative overflow-hidden rounded-[22px] border border-black/70 p-2.5 sm:p-3.5"
        style={{
          background: "linear-gradient(160deg, #5b6170 0%, #3a3f4b 38%, #2a2e37 100%)",
          boxShadow: "inset 0 1px 0 rgb(255 255 255 / .25), inset 0 -3px 0 rgb(0 0 0 / .4), 0 18px 40px -18px rgb(0 0 0 / .9)",
        }}
      >
        {/* brushed metal + rivets */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-25"
          style={{ background: "repeating-linear-gradient(90deg, rgb(255 255 255 / .05) 0 1px, transparent 1px 4px)" }}
        />
        {[
          "left-1.5 top-1.5",
          "right-1.5 top-1.5",
          "left-1.5 bottom-1.5",
          "right-1.5 bottom-1.5",
        ].map((c) => (
          <span key={c} aria-hidden className={`absolute ${c} size-2 rounded-full bg-gradient-to-br from-zinc-300 to-zinc-600 shadow`} />
        ))}

        <Edgework {...p} />

        <div className="relative mt-2.5 grid grid-cols-2 gap-2 sm:gap-3">
          {p.mods.map((m, i) => (
            <Module key={i} mod={m} index={i} act={p.act} serverNow={p.serverNow} remoteHeld={!!p.remoteHeld[i]} />
          ))}
          {p.mods.length % 2 === 1 && <Battery />}
        </div>
        {p.strikes > 0 && <span key={p.strikes} aria-hidden className="df-flash pointer-events-none absolute inset-0 rounded-[22px] bg-red-500/60" />}
      </div>
      {p.outcome && <Outcome outcome={p.outcome} left={p.left} />}
      {p.caption}
    </div>
  );
}

function Edgework({ edge, strikes, live, explodeAt, rate, left, serverNow }: BombProps) {
  return (
    <div className="relative flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Clock live={live} explodeAt={explodeAt} rate={rate} left={left} serverNow={serverNow} />
        <StrikeLeds strikes={strikes} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className="rounded-[4px] border border-zinc-400 bg-[#f4f1e6] px-1.5 py-0.5 font-mono text-[11px] leading-tight font-bold text-zinc-900 shadow-sm"
          aria-label={`Serial number ${edge.serial.split("").join(" ")}`}
        >
          <span className="block text-[7px] tracking-widest text-zinc-500">SERIAL</span>
          {edge.serial}
        </span>
        <span className="flex items-center gap-0.5 rounded-md bg-black/30 px-1.5 py-1" aria-label={`${edge.batteries} batteries`} role="img">
          {edge.batteries === 0 ? (
            <span className="text-[10px] font-semibold text-white/50">no batt.</span>
          ) : (
            Array.from({ length: edge.batteries }, (_, i) => (
              <span key={i} className="relative h-4 w-2 rounded-[2px] bg-gradient-to-b from-amber-300 to-amber-600">
                <span className="absolute -top-0.5 left-1/2 h-0.5 w-1 -translate-x-1/2 rounded-t-sm bg-zinc-300" />
              </span>
            ))
          )}
        </span>
        {edge.lamps.map((l) => (
          <span key={l.l} className="flex items-center gap-1 rounded-md bg-black/30 px-1.5 py-1 text-[10px] font-bold tracking-wide text-white/80">
            <span
              aria-hidden
              className="size-2.5 rounded-full border border-black/50"
              style={l.lit ? { background: "#fde047", boxShadow: "0 0 8px #fde047" } : { background: "#3f3f46" }}
            />
            {l.l}
            <span className="sr-only">{l.lit ? " lit" : " unlit"}</span>
            {!l.lit && (
              <span aria-hidden className="text-[8px] font-medium text-white/40">
                off
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Filler for an odd module count: a decorative battery pack. */
function Battery() {
  return (
    <div aria-hidden className="grid place-items-center rounded-2xl border border-black/50 bg-black/20 p-3">
      <div className="flex gap-1.5 opacity-70">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-14 w-5 rounded-md bg-gradient-to-b from-zinc-500 to-zinc-800 shadow-inner" />
        ))}
      </div>
      <span className="mt-2 font-mono text-[9px] tracking-[0.3em] text-white/30">PWR-CELL</span>
    </div>
  );
}

function Outcome({ outcome, left }: { outcome: "defused" | "boom"; left: number }) {
  if (outcome === "boom")
    return (
      <div className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden rounded-[22px]">
        <span aria-hidden className="df-blast absolute size-40 rounded-full" style={{ background: "radial-gradient(circle, #fff7c2 0%, #ffb020 30%, #ef4444 60%, transparent 70%)" }} />
        <span aria-hidden className="absolute inset-0 bg-black/55" />
        {[0, 1, 2, 3].map((i) => (
          <span key={i} aria-hidden className="df-smoke absolute size-16 rounded-full bg-zinc-400/40 blur-md" style={{ left: `${20 + i * 18}%`, top: "45%", animationDelay: `${i * 0.15}s` }} />
        ))}
        <span className="df-boom relative text-center font-display text-5xl font-black text-amber-300 drop-shadow-[0_4px_0_#7f1d1d] sm:text-6xl">
          💥
          <br />
          BOOM
        </span>
      </div>
    );
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-[22px] bg-emerald-950/55">
      <span className="df-boom rounded-2xl border-2 border-emerald-300 bg-emerald-500/20 px-5 py-3 text-center font-display text-3xl font-black text-emerald-200 shadow-[0_0_30px_rgb(16_185_129/.5)] sm:text-4xl">
        DEFUSED ✓<span className="mt-1 block font-mono text-base font-bold text-emerald-100">{fmtClock(left)} left</span>
      </span>
    </div>
  );
}

// ---------- modules ----------

function Module({ mod, index, act, serverNow, remoteHeld }: { mod: ModView; index: number; act: Act | null; serverNow: () => number; remoteHeld: boolean }) {
  const can = !!act && !mod.done;
  let body: ReactNode;
  if (mod.t === "wires") body = <Wires mod={mod} m={index} act={can ? act : null} />;
  else if (mod.t === "button") body = <BigButton mod={mod} m={index} act={can ? act : null} serverNow={serverNow} remoteHeld={remoteHeld} />;
  else if (mod.t === "keypad") body = <Keypad mod={mod} m={index} act={can ? act : null} />;
  else if (mod.t === "signal") body = <Signal key={mod.stage} mod={mod} m={index} act={can ? act : null} />;
  else body = <Dial mod={mod} m={index} act={can ? act : null} />;
  return (
    <section
      aria-label={`Module ${index + 1}: ${MODULE_NAME[mod.t]}${mod.done ? " (disarmed)" : ""}`}
      className="relative flex min-w-0 flex-col rounded-2xl border border-black/60 p-2 transition-colors duration-500"
      style={{
        background: mod.done ? "linear-gradient(180deg,#1d3a30,#15241f)" : "linear-gradient(180deg,#2b2f38,#1d2027)",
        boxShadow: "inset 0 2px 6px rgb(0 0 0 / .6), 0 1px 0 rgb(255 255 255 / .08)",
      }}
    >
      <header className="mb-1.5 flex items-center justify-between gap-1">
        <span className="truncate text-[10px] font-bold tracking-[0.14em] text-white/55 uppercase">
          <span aria-hidden>{MODULE_ICON[mod.t]} </span>
          {MODULE_NAME[mod.t]}
        </span>
        <span
          aria-hidden
          className={`size-3 shrink-0 rounded-full border border-black/60 ${mod.done ? "" : "df-blink"}`}
          style={mod.done ? { background: "#22c55e", boxShadow: "0 0 10px #22c55e" } : { background: "#ef4444", boxShadow: "0 0 6px #ef4444" }}
        />
      </header>
      <div className="relative flex flex-1 flex-col justify-center">{body}</div>
      {mod.done && (
        <span aria-hidden className="df-pop pointer-events-none absolute right-2 bottom-2 rotate-[-8deg] rounded border-2 border-emerald-400/80 px-1.5 text-[10px] font-black tracking-widest text-emerald-300/90">
          DISARMED
        </span>
      )}
    </section>
  );
}

/** Optimistic input that's dropped as soon as a newer view of this module arrives. */
function usePending<T>(mod: ModView) {
  const [p, setP] = useState<{ of: ModView; items: T[] }>({ of: mod, items: [] });
  const items = p.of === mod ? p.items : [];
  const add = (x: T) => setP((cur) => ({ of: mod, items: [...(cur.of === mod ? cur.items : []), x] }));
  return [items, add] as const;
}

const LETTER: Record<string, string> = { red: "R", blue: "B", yellow: "Y", white: "W", black: "K", green: "G" };

function Wires({ mod, m, act }: { mod: Extract<ModView, { t: "wires" }>; m: number; act: Act | null }) {
  const [pending, add] = usePending<number>(mod);
  return (
    <div className="flex flex-col" role="group" aria-label="Wires, numbered from the top">
      {mod.wires.map((c, i) => {
        const cut = mod.cut[i] || pending.includes(i);
        const sag = 5 + ((i * 7 + m * 3) % 9);
        const col = SWATCH[c];
        // Black wires get a pale rim so they read against the dark panel.
        const rim = c === "black" ? "#9ca3af" : "#000";
        const rimOp = c === "black" ? 0.6 : 0.45;
        return (
          <button
            key={i}
            type="button"
            disabled={!act || cut}
            onClick={() => {
              add(i);
              act?.({ type: "cut", m, w: i });
            }}
            aria-label={`Wire ${i + 1}, ${c}${cut ? ", cut" : ""}`}
            className="group relative h-10 w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-amber-300 enabled:hover:bg-white/5"
          >
            <svg viewBox="0 0 200 40" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
              <rect x={2} y={13} width={18} height={14} rx={3} fill="#9ca3af" stroke="#111" />
              <rect x={180} y={13} width={18} height={14} rx={3} fill="#9ca3af" stroke="#111" />
              {cut ? (
                <>
                  <path className="df-cut-l" d={`M20 20 C 50 ${20 + sag}, 70 ${22 + sag}, 88 ${26 + sag}`} stroke={rim} strokeOpacity={rimOp} strokeWidth={8} fill="none" strokeLinecap="round" />
                  <path d={`M20 20 C 50 ${20 + sag}, 70 ${22 + sag}, 88 ${26 + sag}`} stroke={col} strokeWidth={6} fill="none" strokeLinecap="round" />
                  <path d={`M112 ${26 + sag} C 130 ${22 + sag}, 150 ${20 + sag}, 180 20`} stroke={rim} strokeOpacity={rimOp} strokeWidth={8} fill="none" strokeLinecap="round" />
                  <path d={`M112 ${26 + sag} C 130 ${22 + sag}, 150 ${20 + sag}, 180 20`} stroke={col} strokeWidth={6} fill="none" strokeLinecap="round" />
                  <circle cx={88} cy={26 + sag} r={2} fill="#d4a373" />
                  <circle cx={112} cy={26 + sag} r={2} fill="#d4a373" />
                </>
              ) : (
                <>
                  <path d={`M20 20 C 60 ${20 + sag * 2}, 140 ${20 + sag * 2}, 180 20`} stroke={rim} strokeOpacity={rimOp} strokeWidth={8} fill="none" />
                  <path d={`M20 20 C 60 ${20 + sag * 2}, 140 ${20 + sag * 2}, 180 20`} stroke={col} strokeWidth={6} fill="none" />
                  <path d={`M20 18 C 60 ${18 + sag * 2}, 140 ${18 + sag * 2}, 180 18`} stroke="#fff" strokeOpacity={0.25} strokeWidth={1.5} fill="none" />
                </>
              )}
            </svg>
            <span aria-hidden className="absolute top-1/2 left-[5%] -translate-x-1/2 -translate-y-1/2 text-[9px] font-black text-zinc-900">
              {i + 1}
            </span>
            <span aria-hidden className="absolute top-1/2 right-[5%] translate-x-1/2 -translate-y-1/2 text-[8px] font-black text-zinc-900">
              {LETTER[c]}
            </span>
            {act && !cut && (
              <span aria-hidden className="absolute top-0 left-1/2 -translate-x-1/2 text-xs opacity-0 transition-opacity group-hover:opacity-90">
                ✂️
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function BigButton({
  mod,
  m,
  act,
  serverNow,
  remoteHeld,
}: {
  mod: Extract<ModView, { t: "button" }>;
  m: number;
  act: Act | null;
  serverNow: () => number;
  remoteHeld: boolean;
}) {
  const [heldAt, setHeldAt] = useState<number | null>(null);
  const [lastTap, setLastTap] = useState<{ of: ModView } | null>(null);
  const holding = heldAt !== null && !mod.done;
  const down = () => {
    if (!act || heldAt !== null) return;
    setHeldAt(serverNow());
    act({ type: "hold", m });
  };
  const up = () => {
    if (heldAt === null) return;
    const el = serverNow() - heldAt;
    setHeldAt(null);
    setLastTap({ of: mod });
    act?.({ type: "release", m, n: holdDigit(el) });
  };
  const lit = holding || remoteHeld;
  const face = SWATCH[mod.color];
  const dark = mod.color === "yellow" || mod.color === "white";
  const pressed = holding || remoteHeld || lastTap?.of === mod;
  return (
    <div className="flex items-center justify-center gap-2.5">
      <button
        type="button"
        disabled={!act}
        aria-label={`Big ${mod.color} button labelled ${mod.label}. Press and hold, or tap.`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          down();
        }}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={(e) => {
          if ((e.key === " " || e.key === "Enter") && !e.repeat) {
            e.preventDefault();
            down();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            up();
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
        className="relative grid aspect-square w-[min(100%,7.5rem)] touch-none place-items-center rounded-full outline-none select-none focus-visible:ring-4 focus-visible:ring-amber-300 disabled:cursor-default"
        style={{
          background: "radial-gradient(circle at 50% 60%, #111 60%, #333 72%)",
          padding: "9%",
        }}
      >
        <span
          className="grid size-full place-items-center rounded-full transition-transform duration-100"
          style={{
            background: `radial-gradient(circle at 35% 30%, color-mix(in oklab, ${face} 55%, white) 0%, ${face} 45%, color-mix(in oklab, ${face} 60%, black) 100%)`,
            boxShadow: pressed && holding ? `inset 0 3px 10px rgb(0 0 0 / .5)` : `0 6px 0 color-mix(in oklab, ${face} 45%, black), 0 9px 14px rgb(0 0 0 / .5)`,
            transform: holding || remoteHeld ? "translateY(5px)" : undefined,
          }}
        >
          <span className={`font-display text-[13px] font-black tracking-wider sm:text-sm ${dark ? "text-zinc-900" : "text-white"}`}>{mod.label}</span>
        </span>
      </button>
      <div className="flex flex-col items-center gap-1.5">
        <div
          aria-label={lit ? `Strip lit ${mod.strip}` : "Strip dark"}
          role="img"
          className="h-20 w-4 rounded-full border border-black/70 transition-[background,box-shadow] duration-150"
          style={lit ? { background: SWATCH[mod.strip], boxShadow: `0 0 14px ${SWATCH[mod.strip]}` } : { background: "#18181b" }}
        />
        {lit && <span className="text-[9px] font-bold text-white/70 uppercase">{mod.strip}</span>}
        {holding && heldAt !== null ? <Counter heldAt={heldAt} serverNow={serverNow} /> : <span className="h-7 w-7 rounded-md border border-black/60 bg-[#120708]" aria-hidden />}
      </div>
    </div>
  );
}

function Counter({ heldAt, serverNow }: { heldAt: number; serverNow: () => number }) {
  useTicker(60);
  const el = serverNow() - heldAt;
  const d = holdDigit(el);
  return (
    <span
      aria-live="off"
      aria-label={`Counter ${d}`}
      className="grid h-7 w-7 place-items-center rounded-md border border-black/60 bg-[#120708] font-mono text-lg font-black"
      style={{ color: el < TAP_MS ? "#7f1d1d" : "#ff3b3b", textShadow: "0 0 6px #ff2a2a" }}
    >
      {d}
    </span>
  );
}

function Keypad({ mod, m, act }: { mod: Extract<ModView, { t: "keypad" }>; m: number; act: Act | null }) {
  const [pending, add] = usePending<number>(mod);
  return (
    <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Glyph keys">
      {mod.glyphs.map((g, k) => {
        const on = mod.pressed[k] || pending.includes(k);
        return (
          <button
            key={k}
            type="button"
            disabled={!act || on}
            onClick={() => {
              add(k);
              act?.({ type: "key", m, k });
            }}
            aria-label={`Key with the ${GLYPHS[g].name} glyph${on ? ", pressed" : ""}`}
            className="relative flex h-14 flex-col items-center justify-center rounded-lg border border-black/70 outline-none focus-visible:ring-2 focus-visible:ring-amber-300 enabled:active:translate-y-0.5"
            style={{
              background: on ? "linear-gradient(#cfc8b4,#bdb59e)" : "linear-gradient(#f1ecdc,#d6cfba)",
              boxShadow: on ? "inset 0 2px 4px rgb(0 0 0 / .4)" : "0 3px 0 #6b6455, 0 4px 6px rgb(0 0 0 / .4)",
              transform: on ? "translateY(2px)" : undefined,
              transition: "transform .08s, box-shadow .08s",
            }}
          >
            <span
              aria-hidden
              className="absolute top-1 left-1/2 h-1 w-4 -translate-x-1/2 rounded-full"
              style={{ background: mod.pressed[k] ? "#22c55e" : on ? "#facc15" : "#3f3f46", boxShadow: mod.pressed[k] ? "0 0 6px #22c55e" : undefined }}
            />
            <Glyph g={g} className="mt-1 size-8 text-zinc-900" stroke={2} />
          </button>
        );
      })}
    </div>
  );
}

const FLASH_ON = 520;
const FLASH_OFF = 230;
const FLASH_PAUSE = 1500;

/** Which flash (index) is lit at time t of the loop, or -1. */
function flashAt(n: number, t: number) {
  const cycle = n * (FLASH_ON + FLASH_OFF) + FLASH_PAUSE;
  const x = t % cycle;
  const i = Math.floor(x / (FLASH_ON + FLASH_OFF));
  if (i >= n) return -1;
  return x - i * (FLASH_ON + FLASH_OFF) < FLASH_ON ? i : -1;
}

function Signal({ mod, m, act }: { mod: Extract<ModView, { t: "signal" }>; m: number; act: Act | null }) {
  const [t0] = useState(() => performance.now());
  const [now, setNow] = useState(0);
  const [tap, setTap] = useState<{ c: number; of: ModView } | null>(null);
  const [typed, add] = usePending<number>(mod);
  useEffect(() => {
    if (mod.done) return;
    const id = setInterval(() => setNow(performance.now() - t0), 60);
    return () => clearInterval(id);
  }, [mod.done, t0]);
  const n = mod.seq.length;
  const on = mod.done ? -1 : flashAt(n, now);
  const lamp = on >= 0 ? SWATCH[mod.seq[on]] : null;
  const progress = mod.progress + typed.length;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex w-full items-center justify-between gap-2">
        <span
          role="img"
          aria-label={mod.done ? "Lamp off" : `Lamp flashing ${mod.seq.join(", ")}`}
          className="size-10 shrink-0 rounded-full border-2 border-black/70 transition-[background,box-shadow] duration-75"
          style={lamp ? { background: lamp, boxShadow: `0 0 18px ${lamp}, inset 0 -3px 6px rgb(0 0 0 / .3)` } : { background: "radial-gradient(circle at 40% 35%, #52525b, #18181b)" }}
        />
        <div className="flex flex-col items-end gap-1">
          <span className="flex gap-1" aria-label={`Stage ${Math.min(mod.stage + 1, mod.stages)} of ${mod.stages}`} role="img">
            {Array.from({ length: mod.stages }, (_, i) => (
              <span key={i} className="h-1.5 w-3 rounded-full" style={{ background: i < mod.stage || mod.done ? "#22c55e" : i === mod.stage ? "#facc15" : "#3f3f46" }} />
            ))}
          </span>
          {!mod.done && (
            <span className="flex gap-0.5" aria-hidden>
              {Array.from({ length: mod.stage + 2 }, (_, i) => (
                <span key={i} className="size-1.5 rounded-full" style={{ background: i < progress ? "#e4e4e7" : "#3f3f46" }} />
              ))}
            </span>
          )}
        </div>
      </div>
      <div className="grid w-full grid-cols-2 gap-1.5" role="group" aria-label="Signal pads">
        {PAD_COLORS.map((c, i) => {
          const flashing = tap?.c === i && tap.of === mod;
          return (
            <button
              key={c}
              type="button"
              disabled={!act}
              aria-label={`${cap(c)} pad`}
              onClick={() => {
                setTap({ c: i, of: mod });
                add(i);
                act?.({ type: "pad", m, c: i });
              }}
              className="h-10 rounded-lg border border-black/70 text-[10px] font-black tracking-wider uppercase outline-none focus-visible:ring-2 focus-visible:ring-amber-300 enabled:active:scale-95"
              style={{
                background: `linear-gradient(180deg, color-mix(in oklab, ${SWATCH[c]} ${flashing ? 100 : 70}%, ${flashing ? "white" : "black"}), color-mix(in oklab, ${SWATCH[c]} 55%, black))`,
                color: c === "yellow" ? "#3f3a0b" : "rgb(255 255 255 / .85)",
                boxShadow: flashing ? `0 0 14px ${SWATCH[c]}` : "inset 0 1px 0 rgb(255 255 255 / .25)",
                transition: "transform .08s, box-shadow .2s",
              }}
            >
              {c}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Dial({ mod, m, act }: { mod: Extract<ModView, { t: "dial" }>; m: number; act: Act | null }) {
  const [local, setLocal] = useState(0);
  const [sent, add] = usePending<number>(mod);
  const checking = sent.length > 0;
  const pos = mod.done && mod.at !== null ? mod.at : local;
  const turn = (d: number) => setLocal((p) => (p + d + DIAL_STEPS) % DIAL_STEPS);
  const knob = "grid size-10 shrink-0 place-items-center rounded-full border border-black/70 bg-zinc-700 text-lg text-white/85 outline-none focus-visible:ring-2 focus-visible:ring-amber-300 enabled:active:scale-90";
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="rounded-md border border-black/70 bg-[#0b1a10] px-2 py-0.5 font-mono text-base font-black tracking-[0.25em] text-[#5dfc8d]" style={{ textShadow: "0 0 6px #22c55e" }} aria-label={`Code ${mod.code.split("").join(" ")}`}>
        {mod.code}
      </span>
      <svg viewBox="-50 -50 100 100" className="aspect-square w-[min(100%,6.75rem)]" role="img" aria-label={`Dial at ${pos + 1}`}>
        <circle r={48} fill="#18181b" stroke="#000" />
        {Array.from({ length: DIAL_STEPS }, (_, i) => {
          const a = (i / DIAL_STEPS) * Math.PI * 2 - Math.PI / 2;
          return (
            <text key={i} x={Math.cos(a) * 38} y={Math.sin(a) * 38 + 4.5} textAnchor="middle" fontSize={13} fontWeight={800} fill={i === pos ? "#facc15" : "#a1a1aa"} fontFamily="ui-monospace, monospace">
              {i + 1}
            </text>
          );
        })}
        <g style={{ transform: `rotate(${(pos / DIAL_STEPS) * 360}deg)`, transition: "transform .25s cubic-bezier(.2,1.3,.4,1)" }}>
          <circle r={23} fill="url(#df-knob)" stroke="#000" />
          <rect x={-2.5} y={-23} width={5} height={13} rx={2} fill="#facc15" />
        </g>
        <defs>
          <radialGradient id="df-knob" cx="40%" cy="35%">
            <stop offset="0%" stopColor="#a1a1aa" />
            <stop offset="100%" stopColor="#3f3f46" />
          </radialGradient>
        </defs>
      </svg>
      <div className="flex w-full items-center justify-between gap-1">
        <button type="button" disabled={!act} onClick={() => turn(-1)} aria-label="Turn the dial left" className={knob}>
          ↺
        </button>
        <span className="font-mono text-[10px] font-bold text-white/40" aria-hidden>
          TURN
        </span>
        <button type="button" disabled={!act} onClick={() => turn(1)} aria-label="Turn the dial right" className={knob}>
          ↻
        </button>
      </div>
      <button
        type="button"
        disabled={!act || checking}
        onClick={() => {
          add(pos);
          act?.({ type: "dial", m, pos });
        }}
        aria-label={`Set the dial at ${pos + 1}`}
        className="h-10 w-full rounded-lg border border-black/70 bg-gradient-to-b from-amber-400 to-amber-600 text-xs font-black tracking-widest whitespace-nowrap text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-white enabled:active:translate-y-0.5 disabled:opacity-60"
      >
        {checking ? "…" : `SET ${pos + 1}`}
      </button>
    </div>
  );
}

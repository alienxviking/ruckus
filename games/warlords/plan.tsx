"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { CASTLES, DRAGON_MAX, DRAGON_MIN, TROOPS, sum, type WlAction, type WlView } from "./shared";
import { Pts, type Who } from "./ui";
import { Avatar } from "@/components/Avatar";

const clamp = (v: number) => Math.max(0, Math.min(TROOPS, Math.round(v)));
const ZERO = () => Array.from({ length: CASTLES }, () => 0);

/** Split TROOPS proportionally to weights (largest remainder, sums exactly to TROOPS). */
function proportional(weights: number[]): number[] {
  const total = sum(weights) || 1;
  const raw = weights.map((w) => (w / total) * TROOPS);
  const out = raw.map(Math.floor);
  let left = TROOPS - sum(out);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out;
}

/** Press-and-hold auto-repeat for the +/- steppers (accelerates while held). */
function useHold() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => stop, [stop]);
  const start = useCallback(
    (fn: () => void) => {
      stop();
      fn();
      let delay = 380;
      const loop = () => {
        fn();
        delay = Math.max(35, delay * 0.78);
        timer.current = setTimeout(loop, delay);
      };
      timer.current = setTimeout(loop, delay);
    },
    [stop],
  );
  return { start, stop };
}

interface PlannerProps {
  view: WlView;
  who: Who;
  act: (a: WlAction) => void;
  accent: string;
}

/** The planning board for a participant. Keyed on the round by the parent. */
export function Planner({ view, who, act, accent }: PlannerProps) {
  const me = view.me!;
  const [alloc, setAlloc] = useState<number[]>(() => me.draft ?? ZERO());
  const locked = me.locked;
  const used = sum(alloc);
  const left = TROOPS - used;
  const over = left < 0;

  // Draft autosave (debounced). Untouched boards never send, so idle players get the even split.
  const sent = useRef(alloc.join());
  useEffect(() => {
    if (locked || over) return;
    const key = alloc.join();
    if (key === sent.current) return;
    const id = setTimeout(() => {
      sent.current = key;
      act({ type: "plan", alloc });
    }, 220);
    return () => clearTimeout(id);
  }, [alloc, locked, over, act]);

  const update = (fn: (a: number[]) => number[]) => {
    if (locked) return;
    setAlloc((a) => fn(a.slice()).map(clamp));
  };
  const setAt = (i: number, v: number) => update((a) => ((a[i] = v), a));
  const bump = (i: number, d: number) => update((a) => ((a[i] = a[i] + d), a));
  const allIn = (i: number) => update((a) => ((a[i] = TROOPS - (sum(a) - a[i])), a));

  const lock = (e?: FormEvent) => {
    e?.preventDefault();
    if (locked || over || used === 0) return;
    sent.current = alloc.join();
    act({ type: "lock", alloc });
  };

  const waiting = view.order.filter((_, seat) => !view.locked[seat] && who(seat).connected).length;
  const totalValue = sum(view.values);

  return (
    <form onSubmit={lock} className="flex flex-col gap-3" aria-label="Battle plan">
      {/* Troop counter + lock: sticky so it stays in reach while scrolling the castles on phones. */}
      <div
        className="card sticky top-2 z-10 flex items-center gap-3 p-3 backdrop-blur"
        style={{
          background: "color-mix(in oklab, var(--color-panel) 92%, transparent)",
          borderColor: over ? "#f87171" : locked ? accent : undefined,
        }}
      >
        <div className="min-w-0 flex-1" aria-live="polite">
          {locked ? (
            <>
              <div className="font-display text-lg leading-tight font-extrabold" style={{ color: accent }}>
                🔒 Locked in
              </div>
              <div className="truncate text-xs text-muted">
                {waiting > 0 ? `Waiting for ${waiting} more warlord${waiting === 1 ? "" : "s"}…` : "Marching out…"}
              </div>
            </>
          ) : (
            <>
              <div
                className={`font-display text-lg leading-tight font-extrabold tabular-nums ${over ? "text-red-400" : ""}`}
              >
                {over ? (
                  <>⚠ {-left} too many!</>
                ) : left === 0 ? (
                  <>All {TROOPS} deployed ✓</>
                ) : (
                  <>
                    🪖 {left} <span className="text-sm font-bold text-muted">troops left</span>
                  </>
                )}
              </div>
              <div className={`truncate text-xs ${over ? "text-red-300" : "text-muted"}`}>
                {over ? "Take some back to lock in" : used === 0 ? "Nothing deployed yet" : `${used} of ${TROOPS} deployed`}
              </div>
            </>
          )}
          <TroopBar alloc={alloc} over={over} accent={accent} />
        </div>
        {locked ? (
          // Distinct keys: the same DOM button must never flip between "button" and "submit"
          // mid-click (React re-renders inside the click, before the browser's default action).
          <button key="unlock" type="button" className="btn h-11 shrink-0 px-3 text-sm" onClick={() => act({ type: "unlock" })}>
            ✏️ Change
          </button>
        ) : (
          <button
            key="lock"
            type="submit"
            className="btn btn-primary h-11 shrink-0 px-4"
            disabled={over || used === 0}
            title={over ? "Too many troops" : used === 0 ? "Send some troops first" : undefined}
          >
            🔒 Lock in
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="text-sm text-muted">
          <b className="text-text">{totalValue} points</b> up for grabs
          <span className="hidden @3xl:inline">
            {" "}
            · 🐉 a dragon ({DRAGON_MIN}–{DRAGON_MAX}) guards one castle
          </span>
        </p>
        <div className="flex gap-1.5" role="group" aria-label="Quick plans">
          <Preset label="Even" disabled={locked} onClick={() => update(() => ZERO().map(() => TROOPS / CASTLES))} />
          <Preset label="By value" disabled={locked} onClick={() => update(() => proportional(view.values))} />
          <Preset
            label="🎲"
            name="Random split"
            disabled={locked}
            onClick={() => update(() => proportional(ZERO().map(() => (Math.random() < 0.3 ? 0 : Math.random() ** 2))))}
          />
          <Preset label="Clear" disabled={locked} onClick={() => update(() => ZERO())} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 @lg:grid-cols-3 @3xl:grid-cols-5">
        {view.values.map((value, i) => (
          <CastleCard
            key={i}
            i={i}
            name={view.names[i]}
            value={value}
            troops={alloc[i]}
            left={left}
            locked={locked}
            accent={accent}
            onSet={(v) => setAt(i, v)}
            onBump={(d) => bump(i, d)}
            onAllIn={() => allIn(i)}
          />
        ))}
        <DragonCard />
      </div>
    </form>
  );
}

function Preset({ label, name, disabled, onClick }: { label: string; name?: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" className="btn h-10 px-2.5 text-sm" disabled={disabled} onClick={onClick} aria-label={name} title={name}>
      {label}
    </button>
  );
}

/** Segmented bar of the whole army: one segment per castle. */
function TroopBar({ alloc, over, accent }: { alloc: number[]; over: boolean; accent: string }) {
  const total = Math.max(TROOPS, sum(alloc));
  return (
    <div className="mt-1.5 flex h-2 w-full gap-px overflow-hidden rounded-full bg-panel-2" aria-hidden>
      {alloc.map((v, i) =>
        v > 0 ? (
          <span
            key={i}
            className="h-full transition-[width] duration-200"
            style={{
              width: `${(v / total) * 100}%`,
              background: over ? "#f87171" : accent,
              opacity: i % 2 ? 0.7 : 1,
            }}
          />
        ) : null,
      )}
    </div>
  );
}

function DragonCard() {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-dashed p-3 text-center text-xs text-muted @3xl:hidden" style={{ borderColor: "#ff6b3d66" }}>
      <span aria-hidden className="text-3xl">
        🐉
      </span>
      <span>
        A dragon of <b className="text-text">{DRAGON_MIN}–{DRAGON_MAX}</b> hides in one castle. Beat it <i>and</i> everyone else.
      </span>
    </div>
  );
}

interface CastleCardProps {
  i: number;
  name: string;
  value: number;
  troops: number;
  left: number;
  locked: boolean;
  accent: string;
  onSet: (v: number) => void;
  onBump: (d: number) => void;
  onAllIn: () => void;
}

function CastleCard({ i, name, value, troops, left, locked, accent, onSet, onBump, onAllIn }: CastleCardProps) {
  const hold = useHold();
  const share = troops / TROOPS;

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const big = e.key === "PageUp" || e.key === "PageDown" || e.shiftKey;
    if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      onBump((e.key === "ArrowUp" || e.key === "PageUp" ? 1 : -1) * (big ? 10 : 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      onSet(0);
    } else if (e.key === "End") {
      e.preventDefault();
      onAllIn();
    }
  };

  const stepper = (d: number) => ({
    type: "button" as const,
    tabIndex: -1,
    disabled: locked || (d < 0 ? troops <= 0 : troops >= TROOPS),
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      hold.start(() => onBump(d));
    },
    onPointerUp: hold.stop,
    onPointerLeave: hold.stop,
    onPointerCancel: hold.stop,
    // Keyboard / assistive-tech activation (pointer clicks are handled on press).
    onClick: (e: { detail: number }) => {
      if (e.detail === 0) onBump(d);
    },
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
    className:
      "grid size-11 shrink-0 touch-manipulation place-items-center rounded-xl border border-line bg-panel-2 text-xl font-bold select-none hover:border-muted active:scale-95 disabled:opacity-30",
  });

  return (
    <div
      className="relative flex min-w-0 flex-col gap-1 rounded-2xl border p-2.5 transition-[background-color,border-color] duration-300"
      style={{
        borderColor: troops > 0 ? `color-mix(in oklab, ${accent} ${30 + share * 70}%, var(--color-line))` : "var(--color-line)",
        background: `color-mix(in oklab, ${accent} ${Math.round(share * 22)}%, var(--color-panel))`,
      }}
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className="flex min-w-0 items-center gap-1 text-xs font-semibold text-muted">
          <span aria-hidden className="text-base">
            🏰
          </span>
          <span className="truncate">{name}</span>
        </span>
        <Pts v={value} accent={accent} className="shrink-0 py-0.5 text-base" />
      </div>
      <div className="flex items-center justify-between gap-1">
        <button {...stepper(-1)} aria-label={`Fewer troops to ${name}`}>
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={TROOPS}
          step={1}
          value={troops}
          disabled={locked}
          aria-label={`Castle ${i + 1} troops`}
          title={`${name}, worth ${value} points`}
          aria-keyshortcuts="ArrowUp ArrowDown PageUp PageDown Home End"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => onSet(e.target.value === "" ? 0 : Number(e.target.value) || 0)}
          onKeyDown={onKey}
          className="wl-num w-full min-w-0 rounded-lg bg-transparent py-1 text-center font-display text-3xl font-extrabold tabular-nums outline-none focus-visible:bg-ink disabled:text-text"
        />
        <button {...stepper(1)} aria-label={`More troops to ${name}`}>
          +
        </button>
      </div>
      <input
        type="range"
        min={0}
        max={TROOPS}
        value={troops}
        disabled={locked}
        tabIndex={-1}
        aria-label={`Castle ${i + 1} slider`}
        onChange={(e) => onSet(Number(e.target.value))}
        className="wl-range"
        style={{ "--wl-c": accent, "--wl-p": `${troops}%` } as React.CSSProperties}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={locked || left <= 0}
        onClick={onAllIn}
        className="h-10 rounded-xl border border-dashed border-line text-xs font-semibold text-muted transition-colors hover:border-muted hover:text-text disabled:opacity-35"
        aria-label={`All in: remaining troops to ${name}`}
      >
        All in {left > 0 ? `(+${left})` : ""}
      </button>
    </div>
  );
}

/** Read-only castles for spectators. */
export function CastleRow({ view, accent }: { view: WlView; accent: string }) {
  return (
    <div className="grid grid-cols-2 gap-2 @lg:grid-cols-3 @3xl:grid-cols-5">
      {view.values.map((v, i) => (
        <div key={i} className="flex flex-col items-center gap-1 rounded-2xl border border-line bg-panel p-3 text-center">
          <span aria-hidden className="text-3xl">
            🏰
          </span>
          <span className="max-w-full truncate text-xs font-semibold text-muted">{view.names[i]}</span>
          <Pts v={v} accent={accent} className="py-0.5 text-lg" />
        </div>
      ))}
      <DragonCard />
    </div>
  );
}

/** Who has locked in (never what they planned). */
export function LockRow({ view, who, accent }: { view: WlView; who: Who; accent: string }) {
  const n = view.locked.filter(Boolean).length;
  return (
    <div className="flex flex-col gap-2">
      <div className="label">
        Locked in · {n}/{view.order.length}
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {view.order.map((id, seat) => {
          const p = who(seat);
          const on = view.locked[seat];
          return (
            <li
              key={id}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors duration-300 ${
                p.connected ? "" : "opacity-50"
              }`}
              style={{
                borderColor: on ? `${p.color}aa` : "var(--color-line)",
                background: on ? `${p.color}22` : "transparent",
              }}
            >
              <span aria-hidden><Avatar id={p.avatar} /></span>
              <span className="max-w-[7rem] truncate" style={{ color: p.color }}>
                {p.name}
              </span>
              {!p.connected ? (
                <span title="offline">📡</span>
              ) : on ? (
                <span key="on" className="wl-pop" style={{ color: accent }}>
                  ✓
                </span>
              ) : (
                <span aria-hidden title="planning">
                  ✍️
                </span>
              )}
              <span className="sr-only">{!p.connected ? "offline" : on ? "locked in" : "planning"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

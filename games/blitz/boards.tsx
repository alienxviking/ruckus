"use client";

// One board per microgame. Each renders both PLAY and RESULT for its puzzle.

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Player } from "@/shared/types";
import type { BlitzAction, BlitzView } from "./server";
import {
  ARROW_COLORS,
  CLOCK_MAX_OFF_MS,
  CLOCK_TARGET_MS,
  DIR_NAMES,
  INKS,
  MEMO_LEAD_MS,
  MEMO_ON_MS,
  MEMO_STEP_MS,
  TAP_BATCH_MS,
  exprValue,
  fmtSecs,
  type Pick,
  type Puzzle,
  type ResLine,
  type RoundResult,
} from "./shared";
import {
  ArrowIcon,
  ChoiceButton,
  ExprView,
  Face,
  GOLD,
  GREEN,
  MEDALS,
  ROSE,
  arrowOf,
  cssVars,
  digitOf,
  lookOf,
  personOf,
  useKeys,
} from "./ui";

type Pz<T extends Puzzle["t"]> = Extract<Puzzle, { t: T }>;

export interface BoardProps<P extends Puzzle = Puzzle> {
  pz: P;
  view: BlitzView;
  phase: "play" | "result";
  /** The microgame's colour. */
  color: string;
  /** My answer (PLAY: pending or confirmed; RESULT: from the results). */
  myPick: Pick | null;
  /** Can answer right now (player, PLAY, answers open, not answered yet). */
  canAnswer: boolean;
  answered: boolean;
  isPlayer: boolean;
  submit: (a: BlitzAction, pick: Pick | null) => void;
  act: (a: BlitzAction) => void;
  result: RoundResult | null;
  byId: Record<string, Player>;
  me: string;
  serverNow: () => number;
}

const KEY_HINTS = ["1", "2", "3", "4"];

function pickersOf(result: RoundResult | null, byId: Record<string, Player>, match: (p: Pick | null) => boolean): Player[] {
  if (!result) return [];
  return result.res.filter((l) => match(l.pick)).map((l) => personOf(byId, l.id));
}

function lineOf(result: RoundResult | null, id: string): ResLine | null {
  return result?.res.find((l) => l.id === id) ?? null;
}

const numPick = (p: Pick | null) => (typeof p === "number" ? p : null);

/** Four answer buttons in a 2x2 grid, keys 1-4. */
function Choices({
  props,
  items,
  labels,
  cols = "grid-cols-2",
  hints = KEY_HINTS,
  keyMap,
  className = "",
}: {
  props: BoardProps;
  items: ReactNode[];
  labels?: string[];
  cols?: string;
  hints?: string[];
  /** Extra keys -> index (e.g. arrows). */
  keyMap?: (e: KeyboardEvent) => number;
  className?: string;
}) {
  const { phase, myPick, canAnswer, result, byId, color, submit, view, me } = props;
  const answer = phase === "result" ? numPick(result?.answer ?? null) : null;
  const mine = numPick(myPick);
  const choose = (i: number) => {
    if (canAnswer) submit({ type: "pick", r: view.round, c: i }, i);
  };
  useKeys(canAnswer, me, (e) => {
    let i = digitOf(e);
    if (i < 0 && keyMap) i = keyMap(e);
    if (i < 0 || i >= items.length) return false;
    choose(i);
    return true;
  });
  return (
    <div role="group" aria-label="Answers" className={`grid gap-x-2.5 gap-y-4 pb-2 ${cols} ${className}`}>
      {items.map((item, i) => (
        <div key={i} className="blz-tile flex" style={cssVars({ "--i": i * 3 })}>
          <ChoiceButton
            index={i}
            look={lookOf(i, phase, mine, canAnswer, answer)}
            color={color}
            onPick={choose}
            hint={hints[i]}
            label={labels?.[i]}
            pickers={phase === "result" ? pickersOf(result, byId, (p) => p === i) : undefined}
          >
            {item}
          </ChoiceButton>
        </div>
      ))}
    </div>
  );
}

/** A big prompt line above a board. */
function Prompt({ children }: { children: ReactNode }) {
  return <p className="text-center font-display text-lg font-bold text-balance @md/stage:text-xl">{children}</p>;
}

// ---------- 1. odd one out / 9. find the pair (emoji grids) ----------

function EmojiGrid({
  props,
  cells,
  cols,
  selected,
  answers,
  onCell,
  label,
}: {
  props: BoardProps;
  cells: string[];
  cols: number;
  selected: number[];
  answers: number[];
  onCell: (i: number) => void;
  label: string;
}) {
  const { phase, canAnswer, color, answered } = props;
  const result = phase === "result";
  return (
    <div
      role="group"
      aria-label={label}
      className="mx-auto grid w-full gap-1.5"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        maxWidth: cols === 5 ? "min(100%, 24rem)" : "min(100%, 21rem)",
      }}
    >
      {cells.map((e, i) => {
        const isAns = result && answers.includes(i);
        const mine = selected.includes(i);
        const wrong = result && mine && !isAns;
        const ring = isAns ? GREEN : wrong ? ROSE : mine ? color : null;
        return (
          <button
            key={i}
            type="button"
            data-cell={i}
            disabled={!canAnswer}
            aria-pressed={mine}
            onClick={() => onCell(i)}
            className={`blz-tile relative grid aspect-square place-items-center rounded-xl border-2 transition-[transform,opacity,background-color] duration-150 ${
              canAnswer ? "cursor-pointer hover:scale-105 hover:bg-white/10 active:scale-95" : "cursor-default"
            } ${isAns ? "blz-pop" : ""}`}
            style={{
              ...cssVars({ "--i": i }),
              borderColor: ring ?? "transparent",
              background: ring ? ring + "26" : "var(--color-panel-2)",
            }}
          >
            {/* Dimming lives on the emoji: the tile's entrance animation owns the button's opacity. */}
            <span
              className="text-[clamp(1.45rem,7.5cqw,2.3rem)] leading-none transition-opacity duration-300 select-none"
              style={{ opacity: (result && !isAns && !wrong) || (answered && !result && !mine) ? 0.35 : 1 }}
            >
              {e}
            </span>
            {(isAns || wrong) && (
              <span
                aria-hidden
                className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full text-[11px] font-black text-ink"
                style={{ background: isAns ? GREEN : ROSE }}
              >
                {isAns ? "✓" : "✗"}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function OddBoard(props: BoardProps<Pz<"odd">>) {
  const { pz, phase, result, myPick, submit, view, canAnswer } = props;
  const mine = numPick(myPick);
  return (
    <div className="flex flex-col gap-3">
      <Prompt>{phase === "play" ? "Tap the odd one out!" : "There it was:"}</Prompt>
      <EmojiGrid
        props={props}
        cells={pz.cells}
        cols={5}
        selected={mine === null ? [] : [mine]}
        answers={phase === "result" && typeof result?.answer === "number" ? [result.answer] : []}
        onCell={(i) => canAnswer && submit({ type: "pick", r: view.round, c: i }, i)}
        label="Emoji grid"
      />
    </div>
  );
}

export function PairBoard(props: BoardProps<Pz<"pair">>) {
  const { pz, phase, result, myPick, submit, view, canAnswer } = props;
  const [first, setFirst] = useState<number | null>(null);
  const locked = Array.isArray(myPick) ? myPick : null;
  const selected = locked ?? (first === null ? [] : [first]);
  const onCell = (i: number) => {
    if (!canAnswer) return;
    if (first === null) return setFirst(i);
    if (first === i) return setFirst(null);
    submit({ type: "pair", r: view.round, a: first, b: i }, [Math.min(first, i), Math.max(first, i)]);
  };
  return (
    <div className="flex flex-col gap-3">
      <Prompt>
        {phase === "result"
          ? "The twins:"
          : locked
            ? "Locked in!"
            : first === null
              ? "Find the two that match"
              : "…and its twin?"}
      </Prompt>
      <EmojiGrid
        props={props}
        cells={pz.cells}
        cols={4}
        selected={selected}
        answers={phase === "result" && Array.isArray(result?.answer) ? result.answer : []}
        onCell={onCell}
        label="Emoji grid, find the pair"
      />
    </div>
  );
}

// ---------- 2. count flash ----------

function Field({ children, aspect = "16 / 10", label }: { children: ReactNode; aspect?: string; label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="relative mx-auto w-full max-w-[34rem] overflow-hidden rounded-2xl border border-line bg-ink/60"
      style={{ aspectRatio: aspect }}
    >
      {children}
    </div>
  );
}

/** A bar that drains to zero by server time `until` (measured once at mount). */
function Drain({ until, serverNow, color }: { until: number; serverNow: () => number; color: string }) {
  const [left] = useState(() => Math.max(0, until - serverNow()));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-2" aria-hidden>
      <div className="blz-drain h-full rounded-full" style={{ background: color, animationDuration: `${left}ms` }} />
    </div>
  );
}

export function CountBoard(props: BoardProps<Pz<"count">>) {
  const { pz, phase, color, view, serverNow } = props;
  const flashing = phase === "play" && pz.field !== null;
  const target = <span className="inline-block text-[1.3em] leading-none align-[-0.15em]">{pz.target}</span>;
  const n = pz.field?.filter(([e]) => e === pz.target).length ?? 0;
  return (
    <div className="flex flex-col gap-3">
      <Prompt>
        {flashing ? (
          <>Count the {target}!</>
        ) : phase === "play" ? (
          <>How many {target} were there?</>
        ) : (
          <>
            There were {n} {target}
          </>
        )}
      </Prompt>
      {pz.field ? (
        <>
          <Field label={flashing ? `A field of emoji. Count the ${pz.target}.` : `The field again: ${n} ${pz.target}`}>
            {pz.field.map(([e, x, y], i) => {
              const hit = e === pz.target;
              return (
                <span
                  key={i}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 leading-none select-none ${flashing ? "blz-pop" : ""}`}
                  style={{
                    left: `${x}%`,
                    top: `${y}%`,
                    fontSize: "clamp(1.4rem, 7cqw, 2.3rem)",
                    opacity: phase === "result" && !hit ? 0.2 : 1,
                    filter: phase === "result" && hit ? `drop-shadow(0 0 6px ${GREEN})` : undefined,
                    ...cssVars({ "--d": `${(i % 7) * 25}ms` }),
                  }}
                >
                  {e}
                </span>
              );
            })}
          </Field>
          {flashing && view.opensAt !== null && <Drain until={view.opensAt} serverNow={serverNow} color={color} />}
        </>
      ) : (
        <div
          className="blz-in mx-auto grid h-24 w-full max-w-[34rem] place-items-center rounded-2xl border border-dashed border-line bg-ink/40 text-4xl"
          aria-hidden
        >
          🙈
        </div>
      )}
      {pz.options && (
        <Choices
          props={props}
          items={pz.options.map((o) => (
            <span key={o} className="text-3xl tabular-nums">
              {o}
            </span>
          ))}
          labels={pz.options.map(String)}
        />
      )}
    </div>
  );
}

// ---------- 3. quick maths ----------

export function MathBoard(props: BoardProps<Pz<"math">>) {
  const { pz } = props;
  return (
    <div className="flex flex-col gap-4">
      <div
        className="blz-pop py-2 text-center font-display font-black tracking-tight tabular-nums"
        style={{ fontSize: "clamp(2.6rem, 13cqw, 4.6rem)" }}
      >
        {pz.text} <span className="text-muted">= ?</span>
      </div>
      <Choices
        props={props}
        items={pz.options.map((o) => (
          <span key={o} className="text-3xl tabular-nums">
            {o}
          </span>
        ))}
        labels={pz.options.map(String)}
      />
    </div>
  );
}

// ---------- 4. ink colour ----------

export function InkBoard(props: BoardProps<Pz<"ink">>) {
  const { pz, phase } = props;
  const ink = INKS[pz.ink];
  const word = INKS[pz.word];
  return (
    <div className="flex flex-col gap-4">
      <Prompt>{phase === "play" ? "Tap the colour of the INK" : `The ink was ${ink.name.toLowerCase()}`}</Prompt>
      <div
        className="blz-pop py-1 text-center font-display font-black tracking-wider"
        style={{
          fontSize: "clamp(3rem, 16cqw, 5.5rem)",
          color: ink.hex,
          textShadow: `0 4px 30px ${ink.hex}55`,
        }}
        aria-label={`The word ${word.name} in coloured ink`}
      >
        {word.name.toUpperCase()}
      </div>
      <Choices
        props={props}
        labels={pz.options.map((o) => INKS[o].name)}
        items={pz.options.map((o) => (
          <>
            <span aria-hidden className="size-4 shrink-0 rounded-full ring-2 ring-white/20" style={{ background: INKS[o].hex }} />
            <span className="text-xl">{INKS[o].name}</span>
          </>
        ))}
      />
    </div>
  );
}

// ---------- 5. stop the clock ----------

/** The running clock: updated per frame without React renders, fading out. */
function ClockFace({ phaseAt, fade, serverNow }: { phaseAt: number; fade: number; serverNow: () => number }) {
  const numRef = useRef<HTMLSpanElement>(null);
  const hintRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const ms = Math.max(0, serverNow() - phaseAt);
      const fadeFrom = fade - 500;
      const o = ms < fadeFrom ? 1 : Math.max(0, 1 - (ms - fadeFrom) / 500);
      if (numRef.current) {
        numRef.current.textContent = (ms / 1000).toFixed(2);
        numRef.current.style.opacity = String(o);
      }
      if (hintRef.current) hintRef.current.style.opacity = String(1 - o);
      if (o > 0 || ms < fade + 200) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phaseAt, fade, serverNow]);
  return (
    <div className="relative grid h-24 w-full place-items-center">
      <span ref={numRef} className="font-mono text-6xl font-black tabular-nums" aria-hidden>
        0.00
      </span>
      <span
        ref={hintRef}
        className="absolute inset-0 grid place-items-center text-center text-sm font-semibold text-muted"
        style={{ opacity: 0 }}
      >
        <span>
          <span aria-hidden className="blz-pulse mb-1 block text-4xl">
            🤫
          </span>
          keep counting in your head…
        </span>
      </span>
    </div>
  );
}

/** Players' stops on a number line around the target, zoomed to fit the scoring stops. */
function ClockLine({ result, byId, me }: { result: RoundResult; byId: Record<string, Player>; me: string }) {
  const stops = result.res.filter((l) => l.v !== null) as (ResLine & {
    v: number;
  })[];
  const within = stops.filter((l) => Math.abs(l.v - CLOCK_TARGET_MS) <= CLOCK_MAX_OFF_MS);
  // Zoom so close calls are readable: at least ±0.5s, at most the scoring cap.
  const span = Math.min(
    CLOCK_MAX_OFF_MS,
    Math.max(500, ...within.map((l) => Math.ceil((Math.abs(l.v - CLOCK_TARGET_MS) + 120) / 250) * 250)),
  );
  const lo = CLOCK_TARGET_MS - span;
  const hi = CLOCK_TARGET_MS + span;
  const marks = stops
    .map((l) => ({
      l,
      x: 4 + Math.min(1, Math.max(0, (l.v - lo) / (hi - lo))) * 92,
    }))
    .sort((a, b) => a.x - b.x);
  // Stack marks that would overlap.
  const levels: number[] = [];
  const placed = marks.map((m) => {
    let lvl = 0;
    while (levels[lvl] !== undefined && m.x - levels[lvl] < 13) lvl++;
    levels[lvl] = m.x;
    return { ...m, lvl };
  });
  const depth = Math.max(1, levels.length);
  return (
    <div className="px-2 pt-1 pb-7">
      <div className="relative" style={{ height: `${depth * 3 + 0.5}rem` }}>
        {placed.map(({ l, x, lvl }, i) => {
          const p = personOf(byId, l.id);
          const early = l.v < lo;
          const late = l.v > hi;
          return (
            <div
              key={l.id}
              className="blz-pop absolute flex -translate-x-1/2 flex-col items-center"
              style={{
                left: `${x}%`,
                bottom: `${lvl * 3}rem`,
                ...cssVars({ "--d": `${i * 80}ms` }),
              }}
            >
              <span className={`rounded-full ${l.id === me ? "ring-2 ring-white/80" : ""}`}>
                <Face player={p} size="md" />
              </span>
              <span
                className="mt-0.5 rounded px-1 font-mono text-[11px] font-bold whitespace-nowrap tabular-nums"
                style={{
                  color: l.ok ? "var(--color-text)" : "var(--color-muted)",
                  background: l.rank === 1 ? GOLD + "33" : undefined,
                }}
              >
                {early ? "◀ " : ""}
                {fmtSecs(l.v)}
                {late ? " ▶" : ""}
              </span>
            </div>
          );
        })}
      </div>
      <div className="relative mx-[4%] mt-1 h-2 rounded-full bg-panel-2">
        <div
          className="absolute -top-2 bottom-[-0.5rem] left-1/2 w-[3px] -translate-x-1/2 rounded-full"
          style={{ background: GOLD }}
        />
        <span className="absolute top-3.5 left-0 -translate-x-1/2 font-mono text-[11px] text-muted">{fmtSecs(lo)}</span>
        <span
          className="absolute top-3.5 left-1/2 -translate-x-1/2 font-mono text-xs font-black whitespace-nowrap"
          style={{ color: GOLD }}
        >
          🎯 {fmtSecs(CLOCK_TARGET_MS)}
        </span>
        <span className="absolute top-3.5 left-full -translate-x-1/2 font-mono text-[11px] text-muted">{fmtSecs(hi)}</span>
      </div>
    </div>
  );
}

export function ClockBoard(props: BoardProps<Pz<"clock">>) {
  const { pz, phase, canAnswer, answered, isPlayer, submit, view, serverNow, me, color, result, byId } = props;
  const stop = () => {
    if (canAnswer) submit({ type: "stop", r: view.round, t: serverNow() }, null);
  };
  useKeys(canAnswer, me, (e) => {
    if (e.repeat || (e.key !== " " && e.key !== "Enter")) return false;
    stop();
    return true;
  });
  if (phase === "result" && result) {
    const any = result.res.some((l) => l.v !== null);
    return (
      <div className="flex flex-col gap-2">
        <Prompt>{any ? "Closest to 5.00s wins" : "Nobody stopped the clock!"}</Prompt>
        <ClockLine result={result} byId={byId} me={me} />
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3">
      <Prompt>
        Stop at exactly <span style={{ color }}>{fmtSecs(pz.target)}</span>
      </Prompt>
      {answered ? (
        <div className="blz-pop grid h-24 place-items-center text-center">
          <span>
            <span aria-hidden className="block text-5xl">
              ✋
            </span>
            <span className="text-sm font-semibold text-muted">Stopped! Let&apos;s see how close…</span>
          </span>
        </div>
      ) : (
        <ClockFace phaseAt={view.phaseAt} fade={pz.fade} serverNow={serverNow} />
      )}
      {isPlayer && (
        <button
          type="button"
          data-stop
          disabled={!canAnswer}
          onClick={stop}
          aria-keyshortcuts="Space"
          className="relative h-20 w-full max-w-xs rounded-full border-2 font-display text-3xl font-black tracking-wider transition-transform active:scale-95 disabled:opacity-40"
          style={{
            borderColor: color,
            background: `radial-gradient(circle at 50% 30%, ${color}55, ${color}22)`,
          }}
        >
          ⏹ STOP
        </button>
      )}
      {isPlayer && canAnswer && <p className="hidden text-xs text-muted sm:block">Space or Enter stops it</p>}
    </div>
  );
}

// ---------- 6. bigger ----------

function valueText(v: number): string {
  return Number.isInteger(v) ? v.toLocaleString("en-US") : String(Math.round(v * 1000) / 1000);
}

export function BiggerBoard(props: BoardProps<Pz<"bigger">>) {
  const { pz, phase } = props;
  return (
    <div className="flex flex-col gap-3">
      <Prompt>{phase === "play" ? "Which is bigger?" : "The bigger one:"}</Prompt>
      <div className="relative">
        <Choices
          props={props}
          hints={["1", "2"]}
          keyMap={(e) => (e.key === "ArrowLeft" ? 0 : e.key === "ArrowRight" ? 1 : -1)}
          labels={pz.items.map((it) => (it.k === "frac" ? `${it.n}/${it.d}` : it.k === "pow" ? `${it.b}^${it.e}` : it.s))}
          items={pz.items.map((it, i) => (
            <span key={i} className="flex flex-col items-center gap-1 py-3">
              <span className="font-display font-black" style={{ fontSize: "clamp(2rem, 9cqw, 3.4rem)" }}>
                <ExprView e={it} />
              </span>
              {phase === "result" && <span className="font-mono text-sm text-muted">= {valueText(exprValue(it))}</span>}
            </span>
          ))}
          className="[&_button]:min-h-36"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute top-[calc(50%-0.5rem)] left-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-line bg-ink text-xs font-black text-muted"
        >
          VS
        </span>
      </div>
    </div>
  );
}

// ---------- 7. memory ----------

/** Which arrow of the sequence is on screen right now (-1 = gap), driven by the server clock. */
function useShowIndex(phaseAt: number, len: number, serverNow: () => number) {
  const [state, setState] = useState({ i: -1, on: false });
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const t = serverNow() - phaseAt - MEMO_LEAD_MS;
      const i = t < 0 ? -1 : Math.min(len - 1, Math.floor(t / MEMO_STEP_MS));
      const on = t >= 0 && t < len * MEMO_STEP_MS && t % MEMO_STEP_MS < MEMO_ON_MS;
      setState((s) => (s.i === i && s.on === on ? s : { i, on }));
      if (t < len * MEMO_STEP_MS) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phaseAt, len, serverNow]);
  return state;
}

function Slots({
  len,
  seq,
  compare,
  color,
  label,
}: {
  len: number;
  seq: number[];
  compare?: number[];
  color: string;
  label: string;
}) {
  return (
    <div
      className="flex items-center justify-center gap-1.5"
      aria-label={`${label}: ${seq.map((d) => DIR_NAMES[d]).join(", ") || "empty"}`}
    >
      {Array.from({ length: len }, (_, i) => {
        const d = seq[i];
        const right = compare ? compare[i] === d : null;
        const c = right === null ? color : right ? GREEN : ROSE;
        return (
          <span
            key={i}
            aria-hidden
            className={`grid size-11 place-items-center rounded-xl border-2 ${d !== undefined ? "blz-pop" : ""}`}
            style={{
              borderColor: d !== undefined ? c : "var(--color-line)",
              background: d !== undefined ? c + "22" : "transparent",
            }}
          >
            {d !== undefined && <ArrowIcon dir={d} color={c} className="size-6" />}
          </span>
        );
      })}
    </div>
  );
}

function MemoryShow({
  pz,
  view,
  serverNow,
  color,
}: {
  pz: Pz<"memory">;
  view: BlitzView;
  serverNow: () => number;
  color: string;
}) {
  const { i, on } = useShowIndex(view.phaseAt, pz.len, serverNow);
  const seq = pz.seq ?? [];
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="grid size-36 place-items-center rounded-3xl border-2"
        style={{ borderColor: color + "88", background: color + "14" }}
      >
        {on && i >= 0 && seq[i] !== undefined ? (
          <span key={i} className="blz-pop">
            <ArrowIcon dir={seq[i]} color={color} className="size-24" stroke={3} />
          </span>
        ) : (
          <span aria-hidden className="text-2xl text-muted">
            {i < 0 ? "👀" : ""}
          </span>
        )}
      </div>
      <div className="flex gap-1.5" aria-hidden>
        {Array.from({ length: pz.len }, (_, k) => (
          <span
            key={k}
            className="size-2.5 rounded-full transition-colors"
            style={{ background: k <= i ? color : "var(--color-line)" }}
          />
        ))}
      </div>
    </div>
  );
}

export function MemoryBoard(props: BoardProps<Pz<"memory">>) {
  const { pz, phase, canAnswer, answered, isPlayer, myPick, submit, view, serverNow, color, me, result } = props;
  const [entry, setEntry] = useState<number[]>([]);
  const showing = phase === "play" && pz.seq !== null;
  const inputOpen = phase === "play" && !showing && canAnswer;
  const push = (d: number) => {
    if (!inputOpen || entry.length >= pz.len) return;
    const next = [...entry, d];
    setEntry(next);
    if (next.length === pz.len) submit({ type: "seq", r: view.round, seq: next }, next);
  };
  const undo = () => inputOpen && setEntry((e) => e.slice(0, -1));
  useKeys(inputOpen, me, (e) => {
    if (e.key === "Backspace") {
      undo();
      return true;
    }
    const d = arrowOf(e);
    if (d < 0) return false;
    push(d);
    return true;
  });

  if (showing) {
    return (
      <div className="flex flex-col gap-3">
        <Prompt>Watch closely…</Prompt>
        <MemoryShow pz={pz} view={view} serverNow={serverNow} color={color} />
      </div>
    );
  }
  if (phase === "result") {
    const answer = Array.isArray(result?.answer) ? result.answer : [];
    const mine = Array.isArray(myPick) ? myPick : null;
    const others = result?.res.filter((l) => l.ok).length ?? 0;
    return (
      <div className="flex flex-col items-center gap-3">
        <Prompt>The sequence was</Prompt>
        <Slots len={answer.length} seq={answer} color={GREEN} label="Answer" />
        {mine && (
          <>
            <span className="label">You entered</span>
            <Slots len={answer.length} seq={mine} compare={answer} color={color} label="You entered" />
          </>
        )}
        <p className="text-sm text-muted">{others === 0 ? "Nobody got it all" : `${others} got it all right`}</p>
      </div>
    );
  }
  const shown = Array.isArray(myPick) ? myPick : entry;
  return (
    <div className="flex flex-col items-center gap-3">
      <Prompt>{answered ? "Locked in!" : "Now repeat it!"}</Prompt>
      <Slots len={pz.len} seq={shown} color={color} label="Your entry" />
      {isPlayer && (
        <div className="flex items-center gap-4">
          <div className="grid grid-cols-3 grid-rows-3 gap-1.5" role="group" aria-label="Arrow pad">
            {[
              { d: 0, cls: "col-start-2 row-start-1" },
              { d: 3, cls: "col-start-1 row-start-2" },
              { d: 1, cls: "col-start-3 row-start-2" },
              { d: 2, cls: "col-start-2 row-start-3" },
            ].map(({ d, cls }) => (
              <button
                key={d}
                type="button"
                data-dir={d}
                aria-label={DIR_NAMES[d]}
                aria-keyshortcuts={`Arrow${DIR_NAMES[d]}`}
                disabled={!inputOpen}
                onClick={() => push(d)}
                className={`${cls} grid size-14 place-items-center rounded-2xl border-2 transition-transform active:scale-90 disabled:opacity-40`}
                style={{ borderColor: color + "99", background: color + "1f" }}
              >
                <ArrowIcon dir={d} color={color} className="size-7" />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={undo}
            disabled={!inputOpen || entry.length === 0}
            className="btn min-h-11 px-3 text-sm"
            aria-keyshortcuts="Backspace"
          >
            ⌫ Undo
          </button>
        </div>
      )}
      {isPlayer && inputOpen && <p className="hidden text-xs text-muted sm:block">Arrow keys work too</p>}
    </div>
  );
}

// ---------- 8. tap frenzy ----------

function Race({
  ids,
  counts,
  byId,
  me,
  result,
  color,
}: {
  ids: string[];
  counts: Record<string, number>;
  byId: Record<string, Player>;
  me: string;
  result: RoundResult | null;
  color: string;
}) {
  const rows = ids.map((id) => ({ id, n: counts[id] ?? 0, line: lineOf(result, id) })).sort((a, b) => b.n - a.n);
  const max = Math.max(10, ...rows.map((r) => r.n));
  return (
    <ol className="flex w-full flex-col gap-1" aria-label="Tap race">
      {rows.map(({ id, n, line }) => {
        const p = personOf(byId, id);
        const medal = line?.rank && line.rank <= 3 ? MEDALS[line.rank - 1] : null;
        return (
          <li key={id} className="flex items-center gap-2 text-xs">
            <Face player={p} size="xs" />
            <span className={`w-14 shrink-0 truncate font-semibold ${id === me ? "text-text" : "text-muted"}`}>
              {id === me ? "You" : p.name}
            </span>
            <span className="relative h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-panel-2">
              <span
                className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out"
                style={{
                  width: `${(n / max) * 100}%`,
                  background: id === me ? color : p.color,
                }}
              />
            </span>
            <span className="w-7 shrink-0 text-right font-mono font-bold tabular-nums">{n}</span>
            {result && <span className="w-5 shrink-0 text-center">{medal ?? ""}</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function TapBoard(props: BoardProps<Pz<"tap">>) {
  const { phase, canAnswer, isPlayer, act, view, me, color, byId, result } = props;
  const [mine, setMine] = useState(0);
  const pending = useRef(0);
  const round = view.round;
  const active = canAnswer && phase === "play";

  // Taps go out in small batches (~5 messages a second).
  useEffect(() => {
    if (!active) return;
    const flush = () => {
      const n = Math.min(20, pending.current);
      if (n > 0) {
        pending.current -= n;
        act({ type: "taps", r: round, n });
      }
    };
    const id = setInterval(flush, TAP_BATCH_MS);
    return () => {
      clearInterval(id);
      flush();
    };
  }, [active, round, act]);

  const tap = () => {
    if (!active) return;
    pending.current += 1;
    setMine((n) => n + 1);
  };
  useKeys(active, me, (e) => {
    if (e.key !== " " || e.repeat) return false;
    tap();
    return true;
  });

  if (phase === "result" && result) {
    const counts = Object.fromEntries(result.res.map((l) => [l.id, l.v ?? 0]));
    return (
      <div className="flex flex-col gap-3">
        <Prompt>Fastest fingers</Prompt>
        <Race ids={view.ids} counts={counts} byId={byId} me={me} result={result} color={color} />
      </div>
    );
  }
  const counts = { ...(view.live ?? {}) };
  if (isPlayer) counts[me] = Math.max(counts[me] ?? 0, mine);
  return (
    <div className="flex flex-col items-center gap-4">
      <Prompt>{isPlayer ? "Tap! Tap! Tap!" : "Tap race!"}</Prompt>
      {isPlayer && (
        <button
          type="button"
          data-tap
          disabled={!active}
          onPointerDown={(e) => {
            if (e.button === 0) tap();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          aria-label="Tap"
          aria-keyshortcuts="Space"
          className="relative grid size-44 touch-manipulation place-items-center rounded-full border-4 font-display font-black select-none disabled:opacity-50"
          style={{
            borderColor: color,
            background: `radial-gradient(circle at 50% 35%, ${color}66, ${color}1a 70%)`,
            boxShadow: `0 0 40px -8px ${color}`,
          }}
        >
          <span key={mine} className={mine ? "blz-squish" : ""}>
            <span className="block text-6xl leading-none tabular-nums">{mine}</span>
            <span className="block text-sm tracking-widest text-muted">TAP!</span>
          </span>
          {mine > 0 && (
            <span
              key={`r${mine}`}
              aria-hidden
              className="blz-ring pointer-events-none absolute inset-0 rounded-full border-4"
              style={{ borderColor: color }}
            />
          )}
        </button>
      )}
      {isPlayer && active && <p className="hidden text-xs text-muted sm:block">Space works too (no holding!)</p>}
      {view.ids.length > 1 || !isPlayer ? (
        <Race ids={view.ids} counts={counts} byId={byId} me={me} result={null} color={color} />
      ) : null}
    </div>
  );
}

// ---------- 10. majority arrows ----------

export function ArrowsBoard(props: BoardProps<Pz<"arrows">>) {
  const { pz, phase, result } = props;
  const major = phase === "result" && typeof result?.answer === "number" ? result.answer : null;
  const counts = [0, 0, 0, 0];
  for (const [d] of pz.arrows) counts[d]++;
  return (
    <div className="flex flex-col gap-3">
      <Prompt>
        {phase === "play"
          ? "Which way do MOST arrows point?"
          : `Most went ${DIR_NAMES[major ?? 0].toLowerCase()}: ${counts[major ?? 0]} of 30`}
      </Prompt>
      <Field aspect="6 / 4" label="A field of arrows pointing in four directions">
        {pz.arrows.map(([d, x, y, c], i) => (
          <span
            key={i}
            className="absolute -translate-x-1/2 -translate-y-1/2 transition-opacity duration-300"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              opacity: major === null || d === major ? 1 : 0.15,
            }}
          >
            <ArrowIcon dir={d} color={ARROW_COLORS[c]} className="size-[clamp(1.2rem,5.5cqw,2rem)]" stroke={3.4} />
          </span>
        ))}
      </Field>
      <Choices
        props={props}
        cols="grid-cols-4"
        keyMap={(e) => arrowOf(e)}
        labels={DIR_NAMES.map((n) => n)}
        items={DIR_NAMES.map((name, d) => (
          <span key={d} className="flex flex-col items-center gap-0.5 pt-1">
            <ArrowIcon dir={d} className="size-7" />
            <span className="font-sans text-[11px] font-semibold text-muted">{phase === "result" ? `${counts[d]}×` : name}</span>
          </span>
        ))}
      />
    </div>
  );
}

// ---------- 11. anagram ----------

export function AnagramBoard(props: BoardProps<Pz<"anagram">>) {
  const { pz, phase, result, color } = props;
  const answer = phase === "result" && typeof result?.answer === "number" ? pz.options[result.answer] : null;
  const letters = (answer ?? pz.letters).split("");
  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex justify-center gap-1.5 py-1"
        aria-label={answer ? `The word was ${answer}` : `Letters: ${pz.letters.split("").join(" ")}`}
      >
        {letters.map((ch, i) => (
          // The tilt sits on a wrapper: the tile's pop animation owns its own transform.
          <span
            key={`${answer ? "a" : "s"}${i}`}
            aria-hidden
            style={{ transform: answer ? undefined : `rotate(${(i % 2 ? 1 : -1) * (3 + (i % 3))}deg)` }}
          >
            <span
              className="blz-pop grid place-items-center rounded-xl border-2 font-display font-black"
              style={{
                width: "clamp(2.4rem, 12cqw, 3.4rem)",
                height: "clamp(2.6rem, 13cqw, 3.7rem)",
                fontSize: "clamp(1.4rem, 7cqw, 2.1rem)",
                borderColor: answer ? GREEN : color + "aa",
                background: answer ? GREEN + "22" : color + "1c",
                ...cssVars({ "--d": `${i * 45}ms` }),
              }}
            >
              {ch}
            </span>
          </span>
        ))}
      </div>
      <Choices
        props={props}
        labels={pz.options}
        items={pz.options.map((w) => (
          <span key={w} className="text-xl tracking-[0.12em]">
            {w}
          </span>
        ))}
      />
    </div>
  );
}

// ---------- 12. fruit maths ----------

function Terms({ terms }: { terms: string[] }) {
  return (
    <>
      {terms.map((f, i) => (
        <span key={i} className="contents">
          {i > 0 && <span className="text-muted">+</span>}
          <span className="text-[1.25em] leading-none">{f}</span>
        </span>
      ))}
    </>
  );
}

export function FruitBoard(props: BoardProps<Pz<"fruit">>) {
  const { pz, phase, color } = props;
  const [l1, l2] = pz.lines;
  const x = l1.r / l1.l.length;
  const values: [string, number][] = [
    [l1.l[0], x],
    [l2.l[1], l2.r - x],
  ];
  return (
    <div className="flex flex-col gap-3">
      <div
        className="mx-auto flex flex-col items-center gap-1.5 font-display font-black"
        style={{ fontSize: "clamp(1.5rem, 7cqw, 2.2rem)" }}
      >
        {pz.lines.map((line, i) => (
          <div key={i} className="blz-slide flex items-center gap-2" style={cssVars({ "--d": `${i * 120}ms` })}>
            <Terms terms={line.l} />
            <span className="text-muted">=</span>
            <span className="tabular-nums">{line.r}</span>
          </div>
        ))}
        <div
          className="blz-slide mt-1 flex items-center gap-2 rounded-2xl border-2 px-4 py-1.5"
          style={{
            borderColor: color,
            background: color + "1c",
            ...cssVars({ "--d": "260ms" }),
          }}
        >
          <Terms terms={pz.ask} />
          <span className="text-muted">=</span>
          <span style={{ color }}>?</span>
        </div>
      </div>
      {phase === "result" && (
        <p className="blz-in text-center text-sm font-semibold text-muted">
          {values.map(([f, v]) => `${f} = ${v}`).join("   ·   ")}
        </p>
      )}
      <Choices
        props={props}
        labels={pz.options.map(String)}
        items={pz.options.map((o) => (
          <span key={o} className="text-3xl tabular-nums">
            {o}
          </span>
        ))}
      />
    </div>
  );
}

/** The right board for the puzzle. */
export function Board(props: BoardProps) {
  const pz = props.pz;
  switch (pz.t) {
    case "odd":
      return <OddBoard {...props} pz={pz} />;
    case "count":
      return <CountBoard {...props} pz={pz} />;
    case "math":
      return <MathBoard {...props} pz={pz} />;
    case "ink":
      return <InkBoard {...props} pz={pz} />;
    case "clock":
      return <ClockBoard {...props} pz={pz} />;
    case "bigger":
      return <BiggerBoard {...props} pz={pz} />;
    case "memory":
      return <MemoryBoard {...props} pz={pz} />;
    case "tap":
      return <TapBoard {...props} pz={pz} />;
    case "pair":
      return <PairBoard {...props} pz={pz} />;
    case "arrows":
      return <ArrowsBoard {...props} pz={pz} />;
    case "anagram":
      return <AnagramBoard {...props} pz={pz} />;
    case "fruit":
      return <FruitBoard {...props} pz={pz} />;
  }
}

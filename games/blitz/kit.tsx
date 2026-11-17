"use client";

// Shared building blocks for the microgame boards (boards.tsx, boards-more.tsx).

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { Player } from "@/shared/types";
import type { BlitzAction, BlitzView } from "./server";
import type { Pick, Puzzle, ResLine, RoundResult } from "./shared";
import { ChoiceButton, Face, GREEN, ROSE, cssVars, digitOf, lookOf, personOf, useKeys } from "./ui";

export type Pz<T extends Puzzle["t"]> = Extract<Puzzle, { t: T }>;

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

export const KEY_HINTS = ["1", "2", "3", "4"];

export function pickersOf(result: RoundResult | null, byId: Record<string, Player>, match: (p: Pick | null) => boolean): Player[] {
  if (!result) return [];
  return result.res.filter((l) => match(l.pick)).map((l) => personOf(byId, l.id));
}

export function lineOf(result: RoundResult | null, id: string): ResLine | null {
  return result?.res.find((l) => l.id === id) ?? null;
}

export const numPick = (p: Pick | null) => (typeof p === "number" ? p : null);

/** This round is a reverse round (tap a wrong answer). */
export const isReverse = (view: BlitzView) => view.micro?.twist === "reverse";

/** Answer buttons (2x2 by default), keys 1-4. Reverse rounds mark the real answer as the trap. */
export function Choices({
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
  const reverse = isReverse(view);
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
            look={lookOf(i, phase, mine, canAnswer, answer, reverse)}
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
export function Prompt({ children }: { children: ReactNode }) {
  return <p className="text-center font-display text-lg font-bold text-balance @md/stage:text-xl">{children}</p>;
}

/** A word or phrase picked out in the microgame's colour. */
export function Em({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span className="font-black" style={{ color }}>
      {children}
    </span>
  );
}

/** A square grid of tappable cells (emoji by default). */
export function CellGrid({
  props,
  cells,
  cols,
  selected,
  answers,
  onCell,
  label,
  maxWidth,
  render,
  tileBg,
  cellLabel,
  emojiSize = "clamp(1.45rem,7.5cqw,2.3rem)",
}: {
  props: BoardProps;
  cells: string[];
  cols: number;
  selected: number[];
  answers: number[];
  onCell: (i: number) => void;
  label: string;
  maxWidth?: string;
  /** Custom cell content (default: the cell's emoji). */
  render?: (i: number) => ReactNode;
  /** Custom tile background (default: panel, tinted when marked). */
  tileBg?: (i: number) => string;
  cellLabel?: (i: number) => string;
  emojiSize?: string;
}) {
  const { phase, canAnswer, color, answered } = props;
  const result = phase === "result";
  const width = maxWidth ?? (cols <= 4 ? "min(100%, 21rem)" : cols === 5 ? "min(100%, 24rem)" : "min(100%, 26rem)");
  return (
    <div
      role="group"
      aria-label={label}
      className="mx-auto grid w-full gap-1.5"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, maxWidth: width }}
    >
      {cells.map((e, i) => {
        const isAns = result && answers.includes(i);
        const mine = selected.includes(i);
        const wrong = result && mine && !isAns;
        const ring = isAns ? GREEN : wrong ? ROSE : mine ? color : null;
        const custom = tileBg?.(i);
        const style: CSSProperties = {
          ...cssVars({ "--i": i }),
          borderColor: ring ?? "transparent",
          background: custom ?? (ring ? ring + "26" : "var(--color-panel-2)"),
          boxShadow: custom && ring ? `0 0 0 2px ${ring}` : undefined,
        };
        return (
          <button
            key={i}
            type="button"
            data-cell={i}
            disabled={!canAnswer}
            aria-pressed={mine}
            aria-label={cellLabel?.(i)}
            onClick={() => onCell(i)}
            className={`blz-tile relative grid aspect-square place-items-center rounded-xl border-2 transition-[transform,opacity,background-color] duration-150 ${
              canAnswer ? "cursor-pointer hover:scale-105 hover:brightness-110 active:scale-95" : "cursor-default"
            } ${isAns ? "blz-pop" : ""}`}
            style={style}
          >
            {/* Dimming lives on the content: the tile's entrance animation owns the button's opacity. */}
            <span
              className="leading-none transition-opacity duration-300 select-none"
              style={{
                fontSize: emojiSize,
                opacity: (result && !isAns && !wrong) || (answered && !result && !mine) ? 0.35 : 1,
              }}
            >
              {render ? render(i) : e}
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

export function Field({ children, aspect = "16 / 10", label }: { children: ReactNode; aspect?: string; label: string }) {
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
export function Drain({ until, serverNow, color }: { until: number; serverNow: () => number; color: string }) {
  const [left] = useState(() => Math.max(0, until - serverNow()));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-2" aria-hidden>
      <div className="blz-drain h-full rounded-full" style={{ background: color, animationDuration: `${left}ms` }} />
    </div>
  );
}

/** Server ms since `from`, refreshed every animation frame while `active`. */
export function useElapsed(from: number, serverNow: () => number, active: boolean): number {
  const [t, setT] = useState(() => serverNow() - from);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const loop = () => {
      setT(serverNow() - from);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [from, serverNow, active]);
  return t;
}

/** Everyone's outcome in a list, best first: for reflex games scored per player. */
export function ResultList({
  result,
  byId,
  me,
  value,
  order,
}: {
  result: RoundResult;
  byId: Record<string, Player>;
  me: string;
  /** What to show for a line. */
  value: (l: ResLine) => ReactNode;
  /** Sort key (lower first). */
  order: (l: ResLine) => number;
}) {
  const rows = [...result.res].sort((a, b) => order(a) - order(b));
  return (
    <ol className="mx-auto flex w-full max-w-sm flex-col gap-1" aria-label="Everyone's result">
      {rows.map((l, i) => {
        const p = personOf(byId, l.id);
        return (
          <li
            key={l.id}
            className={`blz-slide flex items-center gap-2 rounded-lg px-2 py-1 text-sm ${l.id === me ? "bg-panel-2" : ""}`}
            style={cssVars({ "--d": `${i * 50}ms` })}
          >
            <Face player={p} size="sm" />
            <span className="min-w-0 flex-1 truncate font-semibold" style={{ color: p.color }}>
              {l.id === me ? "You" : p.name}
            </span>
            <span className="shrink-0 font-mono text-xs font-bold text-muted tabular-nums">{value(l)}</span>
            <span
              className="w-12 shrink-0 text-right font-mono text-xs font-black tabular-nums"
              style={{ color: l.pts > 0 ? GREEN : "var(--color-muted)" }}
            >
              {l.pts > 0 ? `+${l.pts}` : "0"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

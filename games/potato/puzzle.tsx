"use client";

// The holder's micro-puzzles. Every tap is graded locally the instant it lands
// (the puzzles are self-evident), so a right answer arms the throw with no
// round trip; the server grades it again with the same checker.

import type { CSSProperties, ReactNode } from "react";
import { DIR_GLYPHS, DIR_NAMES, INKS, PENALTY_MS, PUZZLE_META, type Puzzle } from "./shared";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

function Option({
  children,
  label,
  hint,
  onPick,
  className = "",
  style,
}: {
  children: ReactNode;
  label: string;
  hint?: string;
  onPick: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-keyshortcuts={hint}
      // Pointer-down fires on touch with no 300ms wait; click covers keyboard activation.
      onPointerDown={(e) => {
        if (e.button === 0) {
          e.preventDefault();
          onPick();
        }
      }}
      onClick={(e) => {
        if (e.detail === 0) onPick();
      }}
      className={`relative flex min-h-12 touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-line bg-panel-2 font-bold transition-[transform,background-color,border-color] duration-75 select-none hover:border-white/30 active:scale-95 active:bg-white/10 ${className}`}
      style={style}
    >
      {children}
      {hint && (
        <span aria-hidden className="pot-key absolute top-1 left-1 size-4 place-items-center rounded font-mono text-[9px] text-muted">
          {hint}
        </span>
      )}
    </button>
  );
}

function SumBoard({ pz, onAnswer }: { pz: Extract<Puzzle, { t: "sum" }>; onAnswer: (a: number) => void }) {
  const op = pz.op === "+" ? "+" : "−";
  return (
    <div className="flex flex-col gap-3">
      <div className="text-center font-display text-[2.6rem] leading-none font-black tracking-tight tabular-nums">
        {pz.a} {op} {pz.b} <span className="text-muted">=</span>
      </div>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Answers">
        {pz.opts.map((o, i) => (
          <Option key={i} label={`${o}`} hint={KEYS[i]} onPick={() => onAnswer(i)} className="h-14 text-2xl tabular-nums">
            {o}
          </Option>
        ))}
      </div>
      <span className="sr-only">
        {pz.a} {pz.op === "+" ? "plus" : "minus"} {pz.b}. The answer is one of {pz.opts.join(", ")}.
      </span>
    </div>
  );
}

function OddBoard({ pz, onAnswer }: { pz: Extract<Puzzle, { t: "odd" }>; onAnswer: (a: number) => void }) {
  const cell = "clamp(50px, 17cqw, 64px)";
  return (
    <div className="mx-auto grid grid-cols-3 gap-1.5" role="group" aria-label="Emoji grid" >
      {pz.cells.map((c, i) => (
        <Option
          key={i}
          label={`${i + 1}: ${c}`}
          hint={KEYS[i]}
          onPick={() => onAnswer(i)}
          className="leading-none"
          style={{ width: cell, height: cell, fontSize: "clamp(28px, 9.5cqw, 35px)" }}
        >
          {c}
        </Option>
      ))}
    </div>
  );
}

function ArrowBoard({
  pz,
  progress,
  onArrow,
}: {
  pz: Extract<Puzzle, { t: "arrows" }>;
  progress: number[];
  onArrow: (d: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex justify-center gap-2" aria-label={`Sequence: ${pz.seq.map((d) => DIR_NAMES[d]).join(", ")}`}>
        {pz.seq.map((d, i) => {
          const done = i < progress.length;
          return (
            <li
              key={i}
              aria-hidden
              className={`grid size-12 place-items-center rounded-xl border-2 font-display text-3xl font-black transition-colors duration-75 ${done ? "pot-in" : ""}`}
              style={{
                borderColor: done ? "#4ade80" : i === progress.length ? "#fb923c" : "var(--color-line)",
                background: done ? "#4ade8026" : "var(--color-ink)",
                color: done ? "#4ade80" : "var(--color-text)",
              }}
            >
              {DIR_GLYPHS[d]}
            </li>
          );
        })}
      </ol>
      <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Arrow pad">
        {[3, 0, 2, 1].map((d) => (
          <Option key={d} label={DIR_NAMES[d]} onPick={() => onArrow(d)} className="h-13 text-2xl">
            {DIR_GLYPHS[d]}
          </Option>
        ))}
      </div>
    </div>
  );
}

function InkBoard({ pz, onAnswer }: { pz: Extract<Puzzle, { t: "ink" }>; onAnswer: (a: number) => void }) {
  const ink = INKS[pz.ink];
  const word = INKS[pz.word];
  return (
    <div className="flex flex-col gap-3">
      <div
        className="text-center font-display text-[2.7rem] leading-none font-black tracking-wider"
        style={{ color: ink.hex, textShadow: `0 4px 26px ${ink.hex}55` }}
        aria-label={`The word ${word.name}, written in ${ink.name.toLowerCase()} ink`}
      >
        {word.name.toUpperCase()}
      </div>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Ink colours">
        {pz.opts.map((o, i) => (
          <Option key={i} label={INKS[o].name} hint={KEYS[i]} onPick={() => onAnswer(i)} className="h-12 px-1 text-sm">
            <span aria-hidden className="size-3 shrink-0 rounded-full ring-2 ring-white/25" style={{ background: INKS[o].hex }} />
            {INKS[o].name}
          </Option>
        ))}
      </div>
    </div>
  );
}

export function PuzzleCard({
  pz,
  n,
  progress,
  onAnswer,
  onArrow,
}: {
  pz: Puzzle;
  n: number;
  progress: number[];
  onAnswer: (a: number) => void;
  onArrow: (d: number) => void;
}) {
  const meta = PUZZLE_META[pz.t];
  return (
    <section
      key={n}
      aria-label={`Puzzle: ${meta.how}`}
      className="pot-in pointer-events-auto flex w-full flex-col gap-3 rounded-2xl border-2 p-3 shadow-2xl"
      style={{ borderColor: "#fb923c", background: "var(--color-panel)", boxShadow: "0 20px 50px -10px #000c, 0 0 0 4px #fb923c22" }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-black tracking-wide uppercase" style={{ color: "#fdba74" }}>
          <span aria-hidden>{meta.icon}</span>
          {meta.how}
        </span>
        <span aria-hidden className="pot-bob text-lg leading-none">
          🥔
        </span>
      </div>
      {pz.t === "sum" && <SumBoard pz={pz} onAnswer={onAnswer} />}
      {pz.t === "odd" && <OddBoard pz={pz} onAnswer={onAnswer} />}
      {pz.t === "arrows" && <ArrowBoard pz={pz} progress={progress} onArrow={onArrow} />}
      {pz.t === "ink" && <InkBoard pz={pz} onAnswer={onAnswer} />}
    </section>
  );
}

/** Shown for the 0.6 s penalty after a wrong answer. */
export function NopeCard({ k }: { k: number }) {
  return (
    <section
      key={k}
      role="status"
      className="pot-nope pointer-events-auto flex w-full max-w-[17rem] flex-col items-center gap-2 rounded-2xl border-2 px-4 py-4 text-center shadow-2xl"
      style={{ borderColor: "#f43f5e", background: "var(--color-panel)" }}
    >
      <span className="font-display text-3xl font-black" style={{ color: "#fb7185" }}>
        ✗ Nope!
      </span>
      <span className="text-xs font-semibold text-muted">New puzzle coming…</span>
      <span className="h-1.5 w-full overflow-hidden rounded-full bg-panel-2">
        <span className="pot-bar block h-full rounded-full" style={{ background: "#fb7185", animationDuration: `${PENALTY_MS}ms` }} />
      </span>
    </section>
  );
}

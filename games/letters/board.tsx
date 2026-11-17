"use client";

// The answer board: one card per category, one row per player. Live (with veto
// buttons) during review; read-only for the round recap on the final screen.

import type { CSSProperties } from "react";
import type { Player } from "@/shared/types";
import type { Cell, LiveCell } from "./shared";
import { playerOf } from "./ui";
import { Avatar } from "@/components/Avatar";

const isLive = (c: Cell | LiveCell): c is LiveCell => "need" in c;

export function Board({
  categories,
  rows,
  order,
  you,
  byId,
  letter,
  accent,
  onVeto,
}: {
  categories: string[];
  /** rows[category][player] */
  rows: (Cell | LiveCell)[][];
  order: string[];
  you: number;
  byId: Record<string, Player>;
  letter: string;
  accent: string;
  /** Present while vetoes are open and the viewer is playing. */
  onVeto?: (player: number, category: number) => void;
}) {
  const live = rows.some((row) => row.some(isLive));
  return (
    <div className="grid items-start gap-3 @2xl:grid-cols-2">
      {categories.map((category, ci) => (
        <section
          key={`${ci}-${category}`}
          aria-label={category}
          className="card animate-rise p-2 @sm:p-2.5"
          style={{ animationDelay: `${ci * 45}ms` }}
        >
          <h3 className="mb-1 flex items-start gap-2 px-1 pt-0.5 text-sm leading-snug font-bold">
            <span
              aria-hidden
              className="mt-px grid size-5 shrink-0 place-items-center rounded-md text-xs font-black text-ink"
              style={{ background: accent }}
            >
              {ci + 1}
            </span>
            {category}
          </h3>
          <ul className="flex flex-col gap-0.5">
            {(rows[ci] ?? []).map((cell, k) =>
              cell.status === "blank" ? null : (
                <AnswerRow
                  key={order[k] ?? k}
                  cell={cell}
                  player={playerOf(byId, order[k])}
                  isYou={k === you}
                  same={cell.same.map((j) => playerOf(byId, order[j]).name)}
                  letter={letter}
                  accent={accent}
                  live={live}
                  onVeto={onVeto ? () => onVeto(k, ci) : undefined}
                />
              ),
            )}
            <Blanks ids={(rows[ci] ?? []).flatMap((c, k) => (c.status === "blank" ? [k] : []))} order={order} you={you} byId={byId} />
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Players who left a category empty, folded into one line so big games stay scannable. */
function Blanks({
  ids,
  order,
  you,
  byId,
}: {
  ids: number[];
  order: string[];
  you: number;
  byId: Record<string, Player>;
}) {
  if (ids.length === 0) return null;
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1.5 py-1.5 text-xs text-muted">
      <span className="italic">No answer:</span>
      {ids.map((k) => {
        const p = playerOf(byId, order[k]);
        return (
          <span key={order[k] ?? k} className="inline-flex items-center gap-1 font-semibold" style={{ color: p.color }}>
            <span aria-hidden><Avatar id={p.avatar} /></span>
            {k === you ? "You" : p.name}
          </span>
        );
      })}
      <span className="sr-only">(0 points)</span>
    </li>
  );
}

function reasonFor(cell: Cell, letter: string, same: string[]): string {
  switch (cell.status) {
    case "unique":
      return "★ Unique";
    case "shared":
      return `Same as ${same.length > 2 ? `${same[0]} +${same.length - 1}` : same.join(" & ")}`;
    case "vetoed":
      return "Vetoed";
    case "blank":
      return "No answer";
    case "letter":
      return `Doesn't start with ${letter}`;
    case "short":
      return "Too short";
  }
}

function AnswerRow({
  cell,
  player,
  isYou,
  same,
  letter,
  accent,
  live,
  onVeto,
}: {
  cell: Cell | LiveCell;
  player: Player;
  isYou: boolean;
  same: string[];
  letter: string;
  accent: string;
  live: boolean;
  onVeto?: () => void;
}) {
  const scored = cell.status === "unique" || cell.status === "shared";
  const struck = cell.status === "vetoed" || cell.status === "letter" || cell.status === "short";
  const reason = reasonFor(cell, letter, same);
  const reasonTone =
    cell.status === "vetoed"
      ? "text-red-300"
      : cell.status === "letter" || cell.status === "short"
        ? "text-amber-300"
        : cell.status === "shared"
          ? "text-text/80"
          : cell.status === "blank"
            ? "text-muted"
            : "";
  return (
    <li
      className={`flex items-center gap-2 rounded-xl px-1.5 py-1.5 transition-colors duration-300 ${
        cell.status === "vetoed" ? "bg-red-500/[0.07]" : isYou ? "bg-panel-2/80" : ""
      }`}
    >
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-full text-base"
        style={{ background: `${player.color}22`, boxShadow: `inset 0 0 0 2px ${player.color}99` }}
      >
        <Avatar id={player.avatar} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`leading-snug font-semibold wrap-break-word transition-colors duration-300 ${scored ? "" : "text-muted"}`}>
          {cell.text ? (
            <span
              className={`lr-strike ${struck ? "lr-struck" : ""}`}
              style={cell.status === "vetoed" ? ({ "--lr-strike": "#f87171cc" } as CSSProperties) : undefined}
            >
              {cell.text}
            </span>
          ) : (
            <span className="font-normal italic">no answer</span>
          )}
        </p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs leading-tight">
          <span className="max-w-[9rem] truncate font-semibold" style={{ color: player.color }}>
            {isYou ? "You" : player.name}
          </span>
          <span aria-hidden className="text-muted">
            ·
          </span>
          <span className={reasonTone} style={cell.status === "unique" ? { color: accent } : undefined}>
            {reason}
          </span>
        </p>
      </div>
      <span
        key={cell.points}
        className={`lr-bump w-8 shrink-0 text-right font-mono text-sm font-bold tabular-nums ${
          cell.points ? "" : "text-muted/70"
        }`}
        style={cell.status === "unique" ? { color: accent } : undefined}
      >
        {cell.points ? `+${cell.points}` : "0"}
        <span className="sr-only"> points</span>
      </span>
      {live && <VetoSlot cell={cell as LiveCell} player={player} isYou={isYou} onVeto={onVeto} />}
    </li>
  );
}

function VetoSlot({
  cell,
  player,
  isYou,
  onVeto,
}: {
  cell: LiveCell;
  player: Player;
  isYou: boolean;
  onVeto?: () => void;
}) {
  const count = (
    <span key={cell.vetoes} className="animate-pop tabular-nums">
      {cell.vetoes}/{cell.need}
    </span>
  );
  if (onVeto && cell.canVeto) {
    const verb = cell.mine ? "Take back your veto on" : "Veto";
    return (
      <button
        type="button"
        aria-pressed={cell.mine}
        aria-label={`${verb} ${player.name}'s “${cell.text}” (${cell.vetoes} of ${cell.need} vetoes)`}
        title={cell.mine ? "Take back your veto" : "Veto this answer"}
        onClick={onVeto}
        className={`flex h-10 min-w-11 shrink-0 items-center justify-center gap-1 rounded-xl border px-2 text-sm font-bold transition-colors ${
          cell.mine
            ? "border-red-400/80 bg-red-500/20 text-red-100"
            : "border-line bg-panel-2 text-muted hover:border-red-400/50 hover:text-text"
        }`}
      >
        <span aria-hidden className={cell.mine ? "" : "opacity-70 grayscale"}>
          👎
        </span>
        {cell.vetoes > 0 && count}
      </button>
    );
  }
  if (cell.vetoes > 0) {
    return (
      <span className="flex h-10 min-w-11 shrink-0 items-center justify-center gap-1 rounded-xl border border-red-400/30 px-2 text-sm font-bold text-red-200/90">
        <span aria-hidden>👎</span>
        {count}
        <span className="sr-only"> vetoes{isYou ? " on your answer" : ""}</span>
      </span>
    );
  }
  return <span aria-hidden className="w-11 shrink-0" />;
}

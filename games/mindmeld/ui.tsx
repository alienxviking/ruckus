"use client";

// Presentational pieces for Mind Meld: word chips, flip cards, the sync meter,
// confetti and the scoped keyframes they use. No game logic lives here.

import type { CSSProperties } from "react";
import type { Player } from "@/shared/types";
import { RATINGS, rating, type RoundEntry, type RoundRecord } from "./shared";

export type Who = (id: string) => Player;

/** CSS custom properties are fine in inline styles; TS just needs a nudge. */
const vars = (v: Record<string, string>) => v as CSSProperties;

const CSS = `
.mm-card{perspective:900px}
.mm-inner{position:relative;height:100%;transform-style:preserve-3d;animation:mm-flip .6s cubic-bezier(.2,.75,.25,1) var(--mm-delay,0ms) both}
.mm-face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden}
.mm-back{transform:rotateY(180deg)}
@keyframes mm-flip{from{transform:rotateY(180deg)}to{transform:rotateY(0deg)}}
.mm-seg{transform-origin:left center;animation:mm-grow .28s ease-out var(--mm-delay,0ms) both}
@keyframes mm-grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.mm-appear{animation:mm-appear .35s ease-out var(--mm-delay,0ms) both}
@keyframes mm-appear{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.mm-meld{animation:mm-meld .6s cubic-bezier(.2,1.5,.4,1) var(--mm-delay,0ms) both}
@keyframes mm-meld{from{opacity:0;transform:scale(.3) rotate(-8deg)}to{opacity:1;transform:none}}
.mm-glow{animation:mm-glow 1.4s ease-in-out var(--mm-glow-delay,0ms) 2}
@keyframes mm-glow{0%,100%{filter:none}50%{filter:brightness(1.25) saturate(1.2)}}
.mm-float{animation:mm-float 2.6s ease-in-out infinite}
@keyframes mm-float{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-6px) rotate(3deg)}}
.mm-confetti i{position:absolute;top:-16px;display:block;animation:mm-fall var(--d,3s) linear var(--delay,0s) 2 both}
@keyframes mm-fall{from{transform:translate3d(0,0,0) rotate(0deg)}to{transform:translate3d(var(--x,0px),460px,0) rotate(var(--r,540deg))}}
@media (prefers-reduced-motion: reduce){
  .mm-inner,.mm-seg,.mm-appear,.mm-meld,.mm-glow,.mm-float{animation:none}
  .mm-confetti{display:none}
}
`;

/** Scoped keyframes; React hoists and de-duplicates this into <head>. */
export function MmStyles() {
  return (
    <style href="mindmeld-styles" precedence="default">
      {CSS}
    </style>
  );
}

/** One word in a history row or the clue, tinted with its writer's colour. */
const CHIP_SIZE = {
  lg: "px-3 py-1.5 font-display text-base @sm:text-lg",
  md: "px-2.5 py-1 font-display text-sm @sm:text-base",
  sm: "px-2 py-0.5 text-xs",
} as const;

export function WordChip({
  entry,
  player,
  size = "sm",
  plain,
}: {
  entry: RoundEntry;
  player: Player;
  size?: keyof typeof CHIP_SIZE;
  /** Hide the "×N" match badge (e.g. when the whole row melded). */
  plain?: boolean;
}) {
  const color = player.color;
  const blank = entry.word === null;
  return (
    <li
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border font-semibold ${CHIP_SIZE[size]} ${
        blank ? "border-dashed opacity-60" : ""
      }`}
      style={{ borderColor: color + "77", background: color + (blank ? "0d" : "1f") }}
      title={`${player.name}: ${entry.word ?? (entry.away ? "offline" : "no word")}`}
    >
      <span aria-hidden>{player.avatar}</span>
      <span className="sr-only">{player.name}: </span>
      {blank ? (
        <span className="text-muted">
          <span aria-hidden>—</span>
          <span className="sr-only">{entry.away ? "offline" : "no word"}</span>
        </span>
      ) : (
        <span className="min-w-0 break-words" style={{ color }}>
          {entry.word}
        </span>
      )}
      {entry.size >= 2 && !plain && (
        <span
          className="rounded-full bg-black/30 px-1.5 text-[0.7rem] leading-4 font-bold tabular-nums"
          style={{ color }}
        >
          <span aria-hidden>×{entry.size}</span>
          <span className="sr-only">(matched by {entry.size})</span>
        </span>
      )}
    </li>
  );
}

/** "2/4" sync pill for a round. */
export function SyncBadge({ record, accent }: { record: RoundRecord; accent: string }) {
  const hot = record.melded;
  return (
    <span
      className="shrink-0 rounded-full border px-2 py-0.5 text-xs font-bold whitespace-nowrap tabular-nums"
      style={{
        borderColor: hot ? accent : "var(--color-line)",
        background: hot ? accent + "33" : "var(--color-panel-2)",
        color: hot ? accent : "var(--color-text)",
      }}
    >
      {hot && <span aria-hidden>🧠 </span>}
      {record.sync}/{record.total}
      <span className="sr-only"> in sync</span>
    </span>
  );
}

/** Compact list of revealed rounds. */
export function Journey({
  rounds,
  who,
  accent,
  title,
}: {
  rounds: RoundRecord[];
  who: Who;
  accent: string;
  title: string;
}) {
  if (!rounds.length) return null;
  return (
    <section className="card animate-rise p-3" aria-label={title}>
      <h3 className="label mb-2">{title}</h3>
      <ol className="flex flex-col gap-1.5">
        {rounds.map((r) => (
          <li
            key={r.round}
            className="flex items-start gap-2 rounded-xl px-1.5 py-1"
            style={r.melded ? { background: accent + "1a" } : undefined}
          >
            <span className="w-7 shrink-0 pt-0.5 font-mono text-xs font-bold text-muted">R{r.round}</span>
            <ul className="flex min-w-0 flex-1 flex-wrap gap-1">
              {r.entries.map((e) => (
                <WordChip key={e.id} entry={e} player={who(e.id)} plain={r.melded} />
              ))}
            </ul>
            <SyncBadge record={r} accent={accent} />
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Timing of the reveal animation, shared by the cards and the meter. */
export function revealTiming(count: number) {
  const stagger = Math.min(160, Math.round(1500 / Math.max(1, count)));
  return { stagger, flipDone: (Math.max(1, count) - 1) * stagger + 650 };
}

// Card widths per column count (full class names so Tailwind can see them).
const CARD_W = "w-[calc((100%_-_0.5rem)/2)]";
const CARD_W_SM = { 2: "@sm:w-[calc((100%_-_0.5rem)/2)]", 3: "@sm:w-[calc((100%_-_1rem)/3)]" };
const CARD_W_XL = {
  2: "@2xl:w-[calc((100%_-_0.5rem)/2)]",
  3: "@2xl:w-[calc((100%_-_1rem)/3)]",
  4: "@2xl:w-[calc((100%_-_1.5rem)/4)]",
};

export interface CardLayout {
  /** Width + height classes for one card. */
  cls: string;
  /** Few players: bigger cards and words. */
  big: boolean;
}

/** Columns that keep rows even (3+3 beats 4+2), and bigger cards for small groups. */
export function cardLayout(count: number): CardLayout {
  const sm: 2 | 3 = count === 2 || count === 4 ? 2 : 3;
  const xl: 2 | 3 | 4 = count <= 2 ? 2 : count === 3 ? 3 : count === 4 ? 4 : [5, 6, 9].includes(count) ? 3 : 4;
  const height = count <= 4 ? "h-[92px] @sm:h-[108px]" : count <= 8 ? "h-[84px]" : "h-[74px]";
  return { cls: `${CARD_W} ${CARD_W_SM[sm]} ${CARD_W_XL[xl]} ${height}`, big: count <= 4 };
}

/**
 * Font size that fits a word on one card line (cqw = the card face's width).
 * Phrases may wrap onto two lines, so they're sized by their longest word or
 * half their length. ~0.68em is a wide-ish average glyph in the bold display face.
 */
function fitWord(word: string, maxRem: number): string {
  const longest = word.split(/[\s-]+/).reduce((m, w) => Math.max(m, w.length), 0);
  const chars = Math.max(1, longest, Math.ceil(word.length / 2));
  return `clamp(0.8rem, calc((100cqw - 1rem) / ${(0.68 * chars).toFixed(2)}), ${maxRem}rem)`;
}

/** A face-down card that flips to show one player's word. */
export function FlipCard({
  entry,
  player,
  delay,
  highlight,
  accent,
  layout,
}: {
  entry: RoundEntry;
  player: Player;
  delay: number;
  highlight: boolean;
  accent: string;
  layout: CardLayout;
}) {
  const color = player.color;
  return (
    <li className={`mm-card ${layout.cls}`} style={vars({ "--mm-delay": `${delay}ms` })}>
      <div className="mm-inner">
        <div
          className={`mm-face card @container flex flex-col px-2 pt-1.5 pb-2 ${highlight ? "mm-glow" : ""}`}
          style={{
            borderColor: highlight ? accent : color + "66",
            background: `linear-gradient(160deg, ${color}2e, transparent 70%), var(--color-panel)`,
            boxShadow: highlight ? `0 0 0 1px ${accent}, 0 0 22px ${accent}55` : undefined,
            ...vars({ "--mm-glow-delay": `${delay + 600}ms` }),
          }}
        >
          <span className="flex items-center justify-between gap-1 text-xs font-semibold">
            <span className="flex min-w-0 items-center gap-1" style={{ color }}>
              <span aria-hidden>{player.avatar}</span>
              <span className="truncate">{player.name}</span>
            </span>
            {entry.size >= 2 && (
              <span
                className="shrink-0 rounded-full px-1.5 text-[0.7rem] leading-4 font-bold tabular-nums"
                style={{ background: highlight ? accent : color + "33", color: highlight ? "#1a0f14" : color }}
              >
                <span aria-hidden>×{entry.size}</span>
                <span className="sr-only">(matched by {entry.size})</span>
              </span>
            )}
          </span>
          <span className="flex min-h-0 flex-1 items-center justify-center text-center">
            {entry.word === null ? (
              <span className="text-sm text-muted italic">{entry.away ? "offline" : "no word"}</span>
            ) : (
              <span
                className="max-w-full font-display leading-tight font-extrabold break-words"
                style={{ fontSize: fitWord(entry.word, layout.big ? 2 : 1.5) }}
              >
                {entry.word}
              </span>
            )}
          </span>
        </div>
        <div
          className="mm-face mm-back card grid place-items-center"
          aria-hidden
          style={{
            borderColor: color + "66",
            background: `repeating-linear-gradient(45deg, ${color}26 0 8px, ${color}10 8px 16px), var(--color-panel-2)`,
          }}
        >
          <span className="font-display text-3xl font-extrabold" style={{ color }}>
            ?
          </span>
        </div>
      </div>
    </li>
  );
}

function meterLine(r: RoundRecord, final: boolean): string {
  if (r.melded) return "Every word matches!";
  const close = r.total >= 3 && r.sync === r.total - 1;
  if (final) return close ? "So close... and that was the last round." : "That was the last round...";
  if (r.sync === 0) return "Nobody wrote a word. Any word goes next round!";
  if (close) return "So close! One mind wandered off.";
  if (r.sync >= 2) return "Getting warmer…";
  return "All different. Now find the link!";
}

/** "3 of 5 in sync" with segments that fill once the cards have flipped. */
export function SyncMeter({
  record,
  accent,
  delay,
  final,
}: {
  record: RoundRecord;
  accent: string;
  delay: number;
  /** No rounds left after this one. */
  final: boolean;
}) {
  const total = Math.max(1, record.total);
  const segDone = delay + total * 70;
  return (
    <div
      className="card p-3"
      style={record.melded ? { borderColor: accent, background: `linear-gradient(135deg, ${accent}26, transparent 70%), var(--color-panel)` } : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="label">Sync</span>
        <span
          className="mm-appear font-display text-lg font-bold tabular-nums"
          style={vars({ "--mm-delay": `${delay}ms` })}
        >
          {record.sync} of {record.total} in sync
        </span>
      </div>
      <div className="mt-2 flex gap-1" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className="h-3 flex-1 overflow-hidden rounded-full bg-panel-2">
            {i < record.sync && (
              <span
                className="mm-seg block h-full w-full rounded-full"
                style={{ background: accent, ...vars({ "--mm-delay": `${delay + i * 70}ms` }) }}
              />
            )}
          </span>
        ))}
      </div>
      {record.melded ? (
        <p
          className="mm-meld mt-3 text-center font-display text-3xl font-extrabold"
          style={{ color: accent, ...vars({ "--mm-delay": `${segDone + 100}ms` }) }}
        >
          🧠 Mind Meld!
        </p>
      ) : (
        <p className="mm-appear mt-2 text-center text-sm text-muted" style={vars({ "--mm-delay": `${segDone}ms` })}>
          {meterLine(record, final)}
        </p>
      )}
    </div>
  );
}

/** CSS-only confetti burst (hidden for reduced motion). Deterministic, no Math.random. */
export function Confetti({ colors }: { colors: string[] }) {
  const palette = colors.length ? colors : ["#e879f9"];
  return (
    <div className="mm-confetti pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {Array.from({ length: 40 }, (_, i) => {
        const round = i % 3 === 0;
        return (
          <i
            key={i}
            style={{
              left: `${(i * 37 + 11) % 100}%`,
              width: round ? 7 : 6,
              height: round ? 7 : 12,
              borderRadius: round ? "50%" : 2,
              background: palette[i % palette.length],
              ...vars({
                "--d": `${2.2 + ((i * 7) % 10) / 8}s`,
                "--delay": `${((i * 13) % 24) / 10}s`,
                "--x": `${((i * 29) % 80) - 40}px`,
                "--r": `${(i % 2 ? 1 : -1) * (360 + ((i * 53) % 360))}deg`,
              }),
            }}
          />
        );
      })}
    </div>
  );
}

/** The five success tiers with the earned one lit up. */
export function RatingLadder({ rounds, accent }: { rounds: number; accent: string }) {
  const earned = rating(rounds);
  return (
    <ol className="mt-4 flex flex-wrap justify-center gap-1.5" aria-label="Rating scale">
      {RATINGS.map((r) => {
        const on = r.label === earned;
        return (
          <li
            key={r.label}
            aria-current={on ? "true" : undefined}
            className={`rounded-full border px-2.5 py-1 text-xs ${on ? "font-bold" : "border-line text-muted"}`}
            style={on ? { borderColor: accent, color: accent, background: accent + "1f" } : undefined}
          >
            <span className="tabular-nums opacity-75">{r.rounds}</span> {r.label}
          </li>
        );
      })}
    </ol>
  );
}

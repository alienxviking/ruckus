"use client";

// Presentational pieces for Mind Meld: word chips, flip cards, the sync meter,
// confetti and the scoped keyframes they use. No game logic lives here.

import type { CSSProperties } from "react";
import type { Player } from "@/shared/types";
import { RATINGS, rating, type RoundEntry, type RoundRecord } from "./shared";
import { Avatar } from "@/components/Avatar";

export type Who = (id: string) => Player;

/** CSS custom properties are fine in inline styles; TS just needs a nudge. */
const vars = (v: Record<string, string>) => v as CSSProperties;
const ms = (n: number) => `${Math.round(n)}ms`;

// Motion language shared with the other Ruckus party games: entrances use
// cubic-bezier(.2,.8,.2,1) on transform + opacity; playful pops use the
// overshooting (.2,1.4,.4,1). Delays come from --mm-delay so the reveal can be
// paced from the server clock (negative delays resume a reveal mid-way).
const CSS = `
.mm-enter{animation:mm-enter .32s cubic-bezier(.2,.8,.2,1) both}
@keyframes mm-enter{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.mm-swap{animation:mm-swap .28s cubic-bezier(.2,.8,.2,1) both}
@keyframes mm-swap{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:none}}
.mm-lock{animation:mm-lock .42s cubic-bezier(.2,1.4,.4,1) both}
@keyframes mm-lock{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:none}}
.mm-card{perspective:900px;animation:mm-deal .34s cubic-bezier(.2,.8,.2,1) var(--mm-deal,0ms) both}
@keyframes mm-deal{from{opacity:0;transform:translateY(16px) scale(.94)}to{opacity:1;transform:none}}
.mm-inner{position:relative;height:100%;transform-style:preserve-3d;animation:mm-flip .62s cubic-bezier(.2,.8,.2,1) var(--mm-delay,0ms) both}
@keyframes mm-flip{0%{transform:rotateY(180deg)}45%{transform:rotateY(90deg) scale(1.06)}80%{transform:rotateY(-8deg)}100%{transform:none}}
.mm-face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden}
.mm-back{transform:rotateY(180deg)}
.mm-snap{animation:mm-snap .55s cubic-bezier(.2,1.4,.4,1) var(--mm-snap,0ms) both,mm-glow 1.4s ease-in-out calc(var(--mm-snap,0ms) + .5s) 2}
@keyframes mm-snap{0%{transform:none;box-shadow:none}45%{transform:scale(1.07)}100%{transform:none}}
@keyframes mm-glow{0%,100%{filter:none}50%{filter:brightness(1.25) saturate(1.2)}}
.mm-dim{animation:mm-dim .4s ease var(--mm-snap,0ms) both}
@keyframes mm-dim{from{opacity:1}to{opacity:.62}}
.mm-badge{animation:mm-badge .4s cubic-bezier(.2,1.4,.4,1) var(--mm-snap,0ms) both}
@keyframes mm-badge{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:none}}
.mm-seg{transform-origin:left center;animation:mm-grow .28s cubic-bezier(.2,.8,.2,1) var(--mm-delay,0ms) both}
@keyframes mm-grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.mm-appear{animation:mm-appear .35s cubic-bezier(.2,.8,.2,1) var(--mm-delay,0ms) both}
@keyframes mm-appear{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.mm-count{animation:mm-count .45s cubic-bezier(.2,1.4,.4,1) var(--mm-delay,0ms) both}
@keyframes mm-count{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}
.mm-out{animation:mm-out .18s ease var(--mm-delay,0ms) both}
@keyframes mm-out{from{opacity:1}to{opacity:0;visibility:hidden}}
.mm-meld{animation:mm-meld .6s cubic-bezier(.2,1.5,.4,1) var(--mm-delay,0ms) both}
@keyframes mm-meld{from{opacity:0;transform:scale(.3) rotate(-8deg)}to{opacity:1;transform:none}}
.mm-stamp{animation:mm-stamp .5s cubic-bezier(.2,1.4,.4,1) var(--mm-delay,0ms) both}
@keyframes mm-stamp{from{opacity:0;transform:scale(1.6)}to{opacity:1;transform:none}}
.mm-float{animation:mm-float 2.6s ease-in-out infinite}
@keyframes mm-float{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-6px) rotate(3deg)}}
.mm-confetti i{position:absolute;top:-16px;display:block;animation:mm-fall var(--d,3s) linear var(--delay,0s) 2 both}
@keyframes mm-fall{from{transform:translate3d(0,0,0) rotate(0deg)}to{transform:translate3d(var(--x,0px),460px,0) rotate(var(--r,540deg))}}
@keyframes mm-fade{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion: reduce){
  .mm-inner,.mm-seg,.mm-appear,.mm-count,.mm-meld,.mm-stamp,.mm-snap,.mm-badge,.mm-float,.mm-lock,.mm-swap{animation:none}
  .mm-enter,.mm-card{animation:mm-fade .2s ease both}
  .mm-dim{animation:none;opacity:.62}
  .mm-out,.mm-confetti{display:none}
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

/** "Asha", "Asha and Bo", "Asha, Bo and Chen". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// ---------- word chips ----------

/** One chip in a word row: a lone word, a group of matching words, or the blanks. */
export interface ChipItem {
  key: string;
  ids: string[];
  /** Shown spelling (the first writer's); null for blanks. */
  word: string | null;
  entries: RoundEntry[];
  /** Two or more matching words. */
  matched: boolean;
}

/** Matching groups first (biggest first), then lone words in seat order, then blanks. */
export function chipItems(r: RoundRecord): ChipItem[] {
  const groups = new Map<number, RoundEntry[]>();
  const singles: RoundEntry[] = [];
  const blanks: RoundEntry[] = [];
  for (const e of r.entries) {
    if (e.word === null) blanks.push(e);
    else if (e.group >= 0) groups.set(e.group, [...(groups.get(e.group) ?? []), e]);
    else singles.push(e);
  }
  const items: ChipItem[] = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([g, es]) => ({ key: `g${g}`, ids: es.map((e) => e.id), word: es[0].word, entries: es, matched: true }));
  for (const e of singles) items.push({ key: e.id, ids: [e.id], word: e.word, entries: [e], matched: false });
  if (blanks.length) items.push({ key: "blank", ids: blanks.map((e) => e.id), word: null, entries: blanks, matched: false });
  return items;
}

const CHIP_SIZE = {
  lg: { chip: "px-3 py-1.5 font-display text-base @sm:text-lg", av: "size-6 text-sm" },
  md: { chip: "px-2.5 py-1 font-display text-sm @sm:text-base", av: "size-5 text-xs" },
  sm: { chip: "px-2 py-0.5 text-xs", av: "size-[1.15rem] text-[0.65rem]" },
} as const;

/** Overlapping avatar bubbles for a group chip (up to 4, then "+N"). */
function Avatars({ ids, who, size }: { ids: string[]; who: Who; size: keyof typeof CHIP_SIZE }) {
  if (ids.length === 1) return <span aria-hidden><Avatar id={who(ids[0]).avatar} /></span>;
  const shown = ids.length > 4 ? ids.slice(0, 3) : ids;
  const extra = ids.length - shown.length;
  return (
    <span className="flex shrink-0 items-center" aria-hidden>
      {shown.map((id, i) => {
        const p = who(id);
        return (
          <span
            key={id}
            className={`grid place-items-center rounded-full leading-none ${CHIP_SIZE[size].av} ${i ? "-ml-1.5" : ""}`}
            style={{ background: `color-mix(in oklab, ${p.color} 30%, var(--color-panel))`, boxShadow: "0 0 0 1.5px var(--color-panel)" }}
          >
            <Avatar id={p.avatar} />
          </span>
        );
      })}
      {extra > 0 && (
        <span
          className={`-ml-1.5 grid place-items-center rounded-full bg-panel-2 font-sans font-bold leading-none text-muted ${CHIP_SIZE[size].av}`}
          style={{ boxShadow: "0 0 0 1.5px var(--color-panel)", fontSize: "0.6rem" }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

/** A word (or group of matching words) tinted with its writer's colour, or the accent for a group. */
export function WordChip({
  item,
  who,
  accent,
  size = "sm",
  plain,
}: {
  item: ChipItem;
  who: Who;
  accent: string;
  size?: keyof typeof CHIP_SIZE;
  /** Hide the "×N" match badge (e.g. when the whole row melded). */
  plain?: boolean;
}) {
  const solo = item.ids.length === 1;
  const color = solo ? who(item.ids[0]).color : accent;
  const blank = item.word === null;
  const names = item.ids.map((id) => who(id).name);
  const blankWhy = (e: RoundEntry) => (e.away ? "offline" : "no word");
  const title = blank
    ? item.entries.map((e) => `${who(e.id).name}: ${blankWhy(e)}`).join(", ")
    : item.entries.map((e) => `${who(e.id).name}: ${e.word}`).join(", ");
  return (
    <li
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border font-semibold ${CHIP_SIZE[size].chip} ${
        blank ? "border-dashed opacity-60" : ""
      }`}
      style={{ borderColor: color + (item.matched ? "aa" : "77"), background: color + (blank ? "0d" : item.matched ? "2b" : "1f") }}
      title={title}
    >
      <Avatars ids={item.ids} who={who} size={size} />
      <span className="sr-only">{joinNames(names)}: </span>
      {blank ? (
        <span className="text-muted">
          <span aria-hidden>—</span>
          <span className="sr-only">{item.entries.map(blankWhy).every((w) => w === "offline") ? "offline" : "no word"}</span>
        </span>
      ) : (
        <span className="min-w-0 break-words" style={{ color: solo ? color : "var(--color-text)" }}>
          {item.word}
        </span>
      )}
      {item.matched && !plain && (
        <span
          className="rounded-full px-1.5 text-[0.7rem] leading-4 font-bold tabular-nums"
          style={{ background: accent, color: "#1a0f14" }}
        >
          <span aria-hidden>×{item.ids.length}</span>
          <span className="sr-only">(matched by {item.ids.length})</span>
        </span>
      )}
    </li>
  );
}

/** A round's words as chips, matches first. */
export function WordRow({
  record,
  who,
  accent,
  size = "sm",
  className = "",
}: {
  record: RoundRecord;
  who: Who;
  accent: string;
  size?: keyof typeof CHIP_SIZE;
  className?: string;
}) {
  return (
    <ul className={`flex min-w-0 flex-wrap ${className}`}>
      {chipItems(record).map((item) => (
        <WordChip key={item.key} item={item} who={who} accent={accent} size={size} plain={record.melded} />
      ))}
    </ul>
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
    <section className="card mm-enter p-3" aria-label={title}>
      <h3 className="label mb-2">{title}</h3>
      <ol className="flex flex-col gap-1.5">
        {rounds.map((r) => (
          <li
            key={r.round}
            className="mm-appear flex items-start gap-2 rounded-xl px-1.5 py-1"
            style={r.melded ? { background: accent + "1a" } : undefined}
          >
            <span className="w-6 shrink-0 pt-0.5 font-mono text-xs font-bold text-muted">R{r.round}</span>
            <WordRow record={r} who={who} accent={accent} className="flex-1 gap-1" />
            <SyncBadge record={r} accent={accent} />
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------- reveal ----------

/** When the first card flips (after the face-down cards are dealt). */
const FIRST_FLIP = 450;
const FLIP_MS = 620;

/**
 * Reveal pacing in ms from the start of the reveal phase, shared by the cards
 * and the meter. Few players get slow, suspenseful flips; big groups keep the
 * whole sequence inside the 5s reveal (the verdict lands by ~3.3s at 12).
 */
export function revealTiming(count: number) {
  const n = Math.max(1, count);
  const stagger = n <= 1 ? 0 : Math.min(450, Math.round(1500 / (n - 1)));
  const deal = Math.min(40, Math.round(300 / n));
  const flipDone = FIRST_FLIP + (n - 1) * stagger + FLIP_MS;
  return { deal, stagger, first: FIRST_FLIP, flipDone };
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

/**
 * A face-down card that flips to show one player's word. Once every card is
 * up (`snap`), the biggest matching group lights up together and lone words
 * step back a little.
 */
export function FlipCard({
  entry,
  player,
  deal,
  flip,
  snap,
  highlight,
  dim,
  accent,
  layout,
}: {
  entry: RoundEntry;
  player: Player;
  /** Delays in ms (relative to now; negative = already under way). */
  deal: number;
  flip: number;
  snap: number;
  highlight: boolean;
  dim: boolean;
  accent: string;
  layout: CardLayout;
}) {
  const color = player.color;
  return (
    <li
      className={`mm-card ${layout.cls}`}
      style={vars({ "--mm-deal": ms(deal), "--mm-delay": ms(flip), "--mm-snap": ms(snap) })}
    >
      <div className="mm-inner">
        <div
          className={`mm-face card @container flex flex-col px-2 pt-1.5 pb-2 ${highlight ? "mm-snap" : dim ? "mm-dim" : ""}`}
          style={{
            borderColor: highlight ? accent : color + "66",
            background: `linear-gradient(160deg, ${highlight ? accent : color}2e, transparent 70%), var(--color-panel)`,
            boxShadow: highlight ? `0 0 0 1px ${accent}, 0 0 22px ${accent}55` : undefined,
          }}
        >
          <span className="flex items-center justify-between gap-1 text-xs font-semibold">
            <span className="flex min-w-0 items-center gap-1" style={{ color }}>
              <span aria-hidden><Avatar id={player.avatar} /></span>
              <span className="truncate">{player.name}</span>
            </span>
            {entry.size >= 2 && (
              <span
                className="mm-badge shrink-0 rounded-full px-1.5 text-[0.7rem] leading-4 font-bold tabular-nums"
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
          <span className="flex flex-col items-center gap-0.5">
            <span className="text-lg leading-none"><Avatar id={player.avatar} /></span>
            <span className="font-display text-2xl leading-none font-extrabold" style={{ color }}>
              ?
            </span>
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
  /** When every card is face up (ms from now; negative = already). */
  delay: number;
  /** No rounds left after this one. */
  final: boolean;
}) {
  const total = Math.max(1, record.total);
  const step = Math.min(70, Math.round(600 / total));
  const segDone = delay + total * step;
  // A single "match" is just one word: show it, but don't make it look like progress.
  const segColor = record.sync >= 2 ? accent : `color-mix(in oklab, ${accent} 40%, var(--color-panel-2))`;
  return (
    <div
      className="card p-3"
      style={record.melded ? { borderColor: accent, background: `linear-gradient(135deg, ${accent}26, transparent 70%), var(--color-panel)` } : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="label">Sync</span>
        <span className="grid justify-items-end font-display text-lg font-bold tabular-nums">
          <span className="mm-out text-base text-muted [grid-area:1/1]" style={vars({ "--mm-delay": ms(delay) })} aria-hidden>
            Revealing<span className="motion-safe:animate-pulse">…</span>
          </span>
          <span className="mm-count [grid-area:1/1]" style={vars({ "--mm-delay": ms(delay) })}>
            {record.sync} of {record.total} in sync
          </span>
        </span>
      </div>
      <div className="mt-2 flex gap-1" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className="h-3 flex-1 overflow-hidden rounded-full bg-panel-2">
            {i < record.sync && (
              <span
                className="mm-seg block h-full w-full rounded-full"
                style={{ background: segColor, ...vars({ "--mm-delay": ms(delay + i * step) }) }}
              />
            )}
          </span>
        ))}
      </div>
      {record.melded ? (
        <p
          className="mm-meld mt-3 text-center font-display text-3xl font-extrabold"
          style={{ color: accent, ...vars({ "--mm-delay": ms(segDone + 100) }) }}
        >
          🧠 Mind Meld!
        </p>
      ) : (
        <p className="mm-appear mt-2 text-center text-sm text-muted" style={vars({ "--mm-delay": ms(segDone) })}>
          {meterLine(record, final)}
        </p>
      )}
    </div>
  );
}

// ---------- the end ----------

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

/** Staggered entrance for the pieces of an end screen. */
export const stagger = (i: number, base = 120, gap = 110) => vars({ "--mm-delay": ms(base + i * gap) });

/** The five success tiers with the earned one lit up. */
export function RatingLadder({ rounds, accent, delay = 0 }: { rounds: number; accent: string; delay?: number }) {
  const earned = rating(rounds);
  return (
    <ol className="mt-4 flex flex-wrap justify-center gap-1.5" aria-label="Rating scale">
      {RATINGS.map((r, i) => {
        const on = r.label === earned;
        return (
          <li
            key={r.label}
            aria-current={on ? "true" : undefined}
            className={`rounded-full border px-2.5 py-1 text-xs ${on ? "mm-count font-bold" : "mm-appear border-line text-muted"}`}
            style={{
              ...(on ? { borderColor: accent, color: accent, background: accent + "1f" } : null),
              ...vars({ "--mm-delay": ms(delay + i * 60 + (on ? 200 : 0)) }),
            }}
          >
            <span className="tabular-nums opacity-75">{r.rounds}</span> {r.label}
          </li>
        );
      })}
    </ol>
  );
}

"use client";

// Playing cards drawn with plain HTML/CSS (no images, no emoji suits that render unevenly).

import type { CSSProperties } from "react";
import { SUIT_NAMES, SUITS, cardRank, cardSuit, cardValue, isRedSuit } from "./shared";

const SIZES = {
  sm: { w: 40, h: 56, rank: 13, pip: 18, corner: 11 },
  md: { w: 56, h: 78, rank: 16, pip: 26, corner: 12 },
  lg: { w: 76, h: 106, rank: 22, pip: 38, corner: 15 },
} as const;
export type CardSize = keyof typeof SIZES;

/** Spoken name, e.g. "Queen of hearts, worth 12". */
export function cardName(code: number): string {
  const r = cardRank(code);
  const word = r === "A" ? "Ace" : r === "J" ? "Jack" : r === "Q" ? "Queen" : r === "K" ? "King" : r;
  return `${word} of ${SUIT_NAMES[cardSuit(code)]}, worth ${cardValue(code)}`;
}

/** Short label, e.g. "Q♥". */
export const cardShort = (code: number) => `${cardRank(code)}${SUITS[cardSuit(code)]}`;

function Face({ code, size }: { code: number; size: CardSize }) {
  const z = SIZES[size];
  const color = isRedSuit(code) ? "#e11d48" : "#1e1b3a";
  const suit = SUITS[cardSuit(code)];
  const rank = cardRank(code);
  return (
    <div
      className="mk-face grid place-items-center overflow-hidden border border-black/10"
      style={{ background: "linear-gradient(160deg, #ffffff, #efeaff)", color, boxShadow: "0 6px 16px -8px rgb(0 0 0 / .6)" }}
    >
      <span
        className="absolute top-1 left-1.5 flex flex-col items-center leading-none font-extrabold"
        style={{ fontSize: z.corner }}
      >
        <span>{rank}</span>
        <span style={{ fontSize: z.corner - 1 }}>{suit}</span>
      </span>
      <span className="leading-none font-black" style={{ fontSize: z.rank + (rank.length > 1 ? -2 : 4) }}>
        {rank}
        <span className="block text-center leading-none" style={{ fontSize: z.pip * 0.6 }}>
          {suit}
        </span>
      </span>
    </div>
  );
}

function Back({ accent }: { accent: string }) {
  return (
    <div
      className="mk-face mk-back grid place-items-center border-2"
      style={{
        borderColor: `${accent}aa`,
        background: `repeating-linear-gradient(45deg, ${accent}55 0 6px, ${accent}22 6px 12px), #17142b`,
      }}
    >
      <span className="grid size-6 place-items-center rounded-full bg-ink/80 text-xs font-black" style={{ color: accent }}>
        ?
      </span>
    </div>
  );
}

/**
 * A card that can be face down (code = null) and turns over when its code arrives.
 * Keep the same element mounted across the flip so the transition plays.
 */
export function PlayingCard({
  code,
  size = "md",
  accent,
  className = "",
  style,
  label,
}: {
  code: number | null;
  size?: CardSize;
  accent: string;
  className?: string;
  style?: CSSProperties;
  label?: string;
}) {
  const z = SIZES[size];
  const up = code !== null;
  return (
    <div
      role="img"
      aria-label={label ?? (up ? cardName(code) : "Face-down card")}
      className={`mk-card relative shrink-0 rounded-[10px] ${className}`}
      style={{ width: z.w, height: z.h, ...style }}
    >
      <div className="mk-card-inner" style={{ transform: up ? "rotateY(0deg)" : "rotateY(180deg)" }}>
        {up ? <Face code={code} size={size} /> : <div className="mk-face" />}
        <Back accent={accent} />
      </div>
    </div>
  );
}

/** The value a card adds to the total, as a small pill under it. */
export function ValuePill({ code, muted }: { code: number | null; muted?: string }) {
  return (
    <span className="rounded-full bg-panel-2 px-1.5 py-px font-mono text-[11px] leading-4 font-bold text-text tabular-nums">
      {code === null ? (muted ?? "?") : `= ${cardValue(code)}`}
    </span>
  );
}

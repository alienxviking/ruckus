"use client";

import type { CSSProperties } from "react";

// Dice drawn with CSS (emoji dice render differently on every platform), the
// leather dice cup, and the game-local animations (prefixed "ld-").

export const DICE_CSS = `
.ld-die { transition: box-shadow .25s ease, opacity .35s ease, transform .25s cubic-bezier(.2,1.4,.4,1); }
.ld-tumble { animation: ld-tumble .55s cubic-bezier(.2,1.25,.4,1) both; }
@keyframes ld-tumble { from { opacity: 0; transform: translateY(-26px) rotate(-220deg) scale(.3); } }
.ld-flip { animation: ld-flip .45s cubic-bezier(.2,.9,.3,1) both; }
@keyframes ld-flip { from { opacity: .2; transform: rotateY(90deg) scale(.8); } }
.ld-lit { animation: ld-lit .4s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes ld-lit { 0% { transform: scale(1); } 45% { transform: scale(1.32) translateY(-3px); } 100% { transform: translateY(-2px); } }
.ld-lost { animation: ld-lost .7s cubic-bezier(.5,0,.7,.4) both; }
@keyframes ld-lost { 30% { transform: scale(1.25) rotate(-10deg); } 100% { opacity: .55; transform: scale(.8) rotate(28deg) translateY(2px); filter: grayscale(1); } }
.ld-cross { animation: ld-stamp-in .3s cubic-bezier(.2,1.5,.4,1) .35s both; }
@keyframes ld-stamp-in { from { opacity: 0; transform: scale(2.4); } }
.ld-gain { animation: ld-gain .6s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes ld-gain { from { opacity: 0; transform: scale(2.2) rotate(30deg); } }
.ld-wiggle { animation: ld-wiggle .22s ease-in-out infinite alternate; }
@keyframes ld-wiggle { from { transform: rotate(-9deg) translateY(1px); } to { transform: rotate(9deg) translateY(-1px); } }
.ld-shake { animation: ld-shake .16s ease-in-out infinite alternate; transform-origin: 50% 90%; }
@keyframes ld-shake { from { transform: translateX(-6px) rotate(-7deg); } to { transform: translateX(6px) rotate(7deg); } }
.ld-lift { animation: ld-lift .6s cubic-bezier(.4,0,.6,1) both; transform-origin: 50% 90%; }
@keyframes ld-lift { 0% { transform: none; opacity: 1; } 35% { transform: translateY(-12%) rotate(-6deg); opacity: 1; } 100% { transform: translateY(-120%) rotate(-16deg); opacity: 0; } }
.ld-glow { animation: ld-glow 1.6s ease-in-out infinite; }
@keyframes ld-glow { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
.ld-stamp { animation: ld-stamp .45s cubic-bezier(.2,1.5,.4,1) both; }
@keyframes ld-stamp { from { opacity: 0; transform: scale(2.6) rotate(-28deg); } to { transform: rotate(-12deg); } }
.ld-float { animation: ld-float 1.4s ease-out both; }
@keyframes ld-float { 0% { opacity: 0; transform: translateY(6px) scale(.6); } 20% { opacity: 1; transform: translateY(-4px) scale(1.15); } 100% { opacity: 0; transform: translateY(-26px); } }
.ld-thud { animation: ld-thud .45s cubic-bezier(.3,0,.3,1) both; }
@keyframes ld-thud { 20% { transform: translateX(-5px) rotate(-1deg); } 45% { transform: translateX(5px) rotate(1deg); } 70% { transform: translateX(-3px); } }
.ld-count { animation: ld-count .3s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes ld-count { from { transform: scale(1.6); opacity: .3; } }
.ld-in { animation: ld-in .35s cubic-bezier(.2,.8,.2,1) both; }
@keyframes ld-in { from { opacity: 0; transform: translateY(6px) scale(.97); } }
.ld-dot { display: inline-block; animation: ld-dot 1.2s ease-in-out infinite; }
@keyframes ld-dot { 0%, 70%, 100% { opacity: .25; } 35% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .ld-tumble, .ld-flip, .ld-lit, .ld-gain, .ld-stamp, .ld-count, .ld-in, .ld-cross { animation: ld-fade .2s ease both; }
  .ld-lost { animation: ld-fade-out .3s ease both; }
  .ld-wiggle, .ld-shake, .ld-glow, .ld-dot, .ld-thud { animation: none; }
  .ld-lift { animation: ld-gone .3s ease both; }
  @keyframes ld-gone { to { opacity: 0; } }
  .ld-float { animation: ld-fade .2s ease both; }
  @keyframes ld-fade { from { opacity: 0; } }
  @keyframes ld-fade-out { to { opacity: .5; } }
}
`;

/** Pip centres (percent of the die) for each face. */
const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[72, 28], [28, 72]],
  3: [[72, 28], [50, 50], [28, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
};

export const FACE_NAME = ["", "one", "two", "three", "four", "five", "six"];
export const FACE_PLURAL = ["", "ones", "twos", "threes", "fours", "fives", "sixes"];

export type DieTone = "plain" | "lit" | "hint" | "dim";

/**
 * One die. `value` null draws a face-down die in the owner's colour.
 * Decorative by default: give the surrounding group an accessible label.
 */
export function Die({
  value,
  size = 32,
  tone = "plain",
  color = "#94a3b8",
  accent = "#a3e635",
  className = "",
  style,
  label,
}: {
  value: number | null;
  size?: number;
  tone?: DieTone;
  color?: string;
  accent?: string;
  className?: string;
  style?: CSSProperties;
  label?: string;
}) {
  const radius = Math.round(size * 0.22);
  const a11y = label ? { role: "img" as const, "aria-label": label } : { "aria-hidden": true as const };
  if (value === null || !PIPS[value]) {
    return (
      <span
        {...a11y}
        className={`ld-die relative inline-grid shrink-0 place-items-center ${className}`}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          background: `linear-gradient(145deg, ${color}66, ${color}22)`,
          border: `1px solid ${color}88`,
          boxShadow: "inset 0 -2px 0 rgb(0 0 0 / .25)",
          ...style,
        }}
      >
        <span
          className="block rounded-[30%]"
          style={{ width: size * 0.42, height: size * 0.42, border: `1.5px solid ${color}aa`, opacity: 0.7 }}
        />
      </span>
    );
  }
  const pip = Math.max(3, Math.round(size * 0.19));
  const lit = tone === "lit";
  const hint = tone === "hint";
  return (
    <span
      {...a11y}
      className={`ld-die relative inline-block shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: lit ? "linear-gradient(145deg, #fbffe9, #e4f5c2)" : "linear-gradient(145deg, #fffdf6, #e6dfcc)",
        boxShadow: lit
          ? `0 0 0 2px ${accent}, 0 0 16px ${accent}aa, inset 0 -3px 0 rgb(0 0 0 / .12)`
          : hint
            ? `0 0 0 2px ${accent}99, inset 0 -3px 0 rgb(0 0 0 / .14)`
            : "inset 0 -3px 0 rgb(0 0 0 / .16), 0 1px 2px rgb(0 0 0 / .4)",
        opacity: tone === "dim" ? 0.32 : 1,
        transform: lit ? "translateY(-2px)" : undefined,
        ...style,
      }}
    >
      {PIPS[value].map(([x, y], i) => {
        // The wild one gets a big red pip, like classic dice.
        const d = value === 1 ? Math.round(size * 0.3) : pip;
        return (
          <span
            key={i}
            className="absolute rounded-full"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              width: d,
              height: d,
              marginLeft: -d / 2,
              marginTop: -d / 2,
              background: value === 1 ? "radial-gradient(circle at 35% 35%, #ff6b81, #d61f45)" : "radial-gradient(circle at 35% 35%, #4b4565, #17142b)",
            }}
          />
        );
      })}
    </span>
  );
}

/** The leather dice cup, mouth down, with a rim stripe in the owner's colour. */
export function Cup({ color, width = 118, className = "" }: { color: string; width?: number; className?: string }) {
  const height = Math.round(width * 0.78);
  return (
    <span aria-hidden className={`relative block ${className}`} style={{ width, height }}>
      <span
        className="absolute inset-0"
        style={{
          clipPath: "polygon(17% 0, 83% 0, 100% 100%, 0 100%)",
          background:
            "repeating-linear-gradient(90deg, transparent 0 11px, rgb(0 0 0 / .08) 11px 13px), linear-gradient(90deg, #4a2a18, #8a5636 30%, #b77a4a 48%, #7a4729 75%, #3f2314)",
          borderRadius: "14px 14px 4px 4px",
        }}
      />
      <span
        className="absolute inset-x-0 bottom-0"
        style={{
          height: Math.round(height * 0.18),
          background: `linear-gradient(180deg, ${color}, ${color}aa)`,
          borderRadius: 4,
          boxShadow: "0 3px 8px rgb(0 0 0 / .45)",
        }}
      />
      <span
        className="absolute"
        style={{
          left: "24%",
          right: "24%",
          top: Math.round(height * 0.12),
          height: 3,
          borderRadius: 3,
          background: "rgb(255 255 255 / .18)",
        }}
      />
    </span>
  );
}

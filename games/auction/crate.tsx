"use client";

// The big wooden crate (or the 🎁 gift box), its lid, and the reveal effects.

import type { CSSProperties } from "react";
import { STAMPS, WOODS, contents, kindOf, signed } from "./shared";
import { CURSE, GOLD, JUNK, kindColor } from "./ui";

export function CrateArt({ wood, stamp, gift, open }: { wood: number; stamp: number; gift: boolean; open: boolean }) {
  const [face, hi, edge] = WOODS[((wood % WOODS.length) + WOODS.length) % WOODS.length];
  const label = STAMPS[stamp] ?? "";
  return (
    <svg viewBox="0 0 200 170" className="block size-full overflow-visible" aria-hidden>
      <ellipse cx="100" cy="162" rx="80" ry="7" fill="#000" opacity=".35" />
      {/* The dark inside shows when the lid lifts. */}
      <rect x="24" y="54" width="152" height="16" rx="3" fill="#120c1c" />
      {gift ? (
        <g>
          <rect x="22" y="62" width="156" height="96" rx="6" fill="#e11d48" stroke="#881337" strokeWidth="3" />
          {[
            [44, 82],
            [64, 132],
            [140, 78],
            [156, 128],
            [130, 146],
            [46, 146],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="5" fill="#fff" opacity=".18" />
          ))}
          <rect x="91" y="62" width="18" height="96" fill={GOLD} stroke="#b45309" strokeWidth="2" />
          <g transform="rotate(-8 145 108)">
            <rect x="118" y="96" width="54" height="24" rx="5" fill="#fff7ed" stroke="#b45309" strokeWidth="2" />
            <text x="145" y="113" textAnchor="middle" fontSize="13" fontWeight="800" fill="#9a3412">
              ×2 | ×0
            </text>
          </g>
        </g>
      ) : (
        <g>
          <rect x="22" y="62" width="156" height="96" rx="5" fill={face} stroke={edge} strokeWidth="3" />
          {[78, 110, 142].map((y) => (
            <line key={y} x1="40" x2="160" y1={y} y2={y} stroke={hi} strokeWidth="1.5" strokeDasharray="14 9" opacity=".55" />
          ))}
          <line x1="22" x2="178" y1="94" y2="94" stroke={edge} strokeWidth="2.5" opacity=".75" />
          <line x1="22" x2="178" y1="126" y2="126" stroke={edge} strokeWidth="2.5" opacity=".75" />
          <rect x="22" y="62" width="17" height="96" rx="4" fill={edge} opacity=".4" />
          <rect x="161" y="62" width="17" height="96" rx="4" fill={edge} opacity=".4" />
          <polygon points="39,152 39,138 161,70 161,84" fill={hi} stroke={edge} strokeWidth="2" />
          {[
            [30, 70],
            [30, 110],
            [30, 150],
            [170, 70],
            [170, 110],
            [170, 150],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="2.4" fill={edge} />
          ))}
          {label && (
            <g transform="rotate(-8 100 112)" opacity=".82">
              <rect x="44" y="99" width="112" height="25" rx="4" fill="none" stroke="#7f1d1d" strokeWidth="2.5" />
              <text
                x="100"
                y="116.5"
                textAnchor="middle"
                fontSize="13"
                fontWeight="900"
                fill="#7f1d1d"
                letterSpacing="1"
                textLength={Math.min(100, label.length * 8.6)}
                lengthAdjust="spacingAndGlyphs"
              >
                {label}
              </text>
            </g>
          )}
        </g>
      )}
      <g className={`au-lid ${open ? "au-open" : ""}`}>
        {gift ? (
          <>
            <rect x="15" y="44" width="170" height="22" rx="6" fill="#f43f5e" stroke="#881337" strokeWidth="3" />
            <rect x="91" y="44" width="18" height="22" fill={GOLD} stroke="#b45309" strokeWidth="2" />
            <ellipse cx="84" cy="36" rx="16" ry="9" transform="rotate(-22 84 36)" fill={GOLD} stroke="#b45309" strokeWidth="2" />
            <ellipse cx="116" cy="36" rx="16" ry="9" transform="rotate(22 116 36)" fill={GOLD} stroke="#b45309" strokeWidth="2" />
            <circle cx="100" cy="41" r="7" fill="#f59e0b" stroke="#b45309" strokeWidth="2" />
          </>
        ) : (
          <>
            <rect x="15" y="44" width="170" height="22" rx="5" fill={hi} stroke={edge} strokeWidth="3" />
            <line x1="15" x2="185" y1="55" y2="55" stroke={edge} strokeWidth="1.5" opacity=".5" />
            <circle cx="26" cy="55" r="2.4" fill={edge} />
            <circle cx="174" cy="55" r="2.4" fill={edge} />
          </>
        )}
      </g>
    </svg>
  );
}

/** Coins and sparkles bursting out of a treasure crate. */
export function Burst({ color = GOLD, count = 14 }: { color?: string; count?: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {Array.from({ length: count }, (_, i) => {
        const glyph = i % 3 === 0 ? "🪙" : i % 3 === 1 ? "✨" : "";
        return (
          <span
            key={i}
            className="au-spark text-sm leading-none"
            style={
              {
                "--r": `${(360 / count) * i + (i % 2) * 9}deg`,
                "--d": `${-70 - (i % 4) * 14}px`,
                animationDelay: `${0.5 + (i % 5) * 0.04}s`,
              } as CSSProperties
            }
          >
            {glyph || <span className="block size-2 rounded-full" style={{ background: color }} />}
          </span>
        );
      })}
    </div>
  );
}

/** Purple-green smoke puffs for a cursed crate (or grey dust for junk). */
export function Smoke({ colors, count = 7 }: { colors: string[]; count?: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="au-smoke"
          style={
            {
              width: 34 + (i % 3) * 14,
              height: 34 + (i % 3) * 14,
              background: colors[i % colors.length],
              "--dx": `${(i - (count - 1) / 2) * 22}px`,
              animationDelay: `${0.45 + i * 0.09}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** Rotating light rays behind a treasure. */
export function Rays({ color }: { color: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-[-12%] grid place-items-center">
      <div
        className="au-rays size-full rounded-full opacity-60"
        style={{
          background: `repeating-conic-gradient(from 0deg, ${color}55 0deg 10deg, transparent 10deg 30deg)`,
          maskImage: "radial-gradient(circle, black 25%, transparent 68%)",
          WebkitMaskImage: "radial-gradient(circle, black 25%, transparent 68%)",
        }}
      />
    </div>
  );
}

/** What pops out of an opened crate: the item with its value tag beside it. */
export function Contents({ value }: { value: number }) {
  const c = contents(value);
  const color = kindColor(value);
  return (
    <div className="au-rise pointer-events-none absolute inset-x-0 -top-[6%] flex items-center justify-center gap-1">
      <span className="text-5xl leading-none drop-shadow-[0_6px_10px_rgba(0,0,0,.6)]">{c.emoji}</span>
      <span
        className="rounded-full border-2 px-1.5 py-0.5 font-display text-base leading-none font-extrabold tabular-nums shadow-lg"
        style={{ color, borderColor: color, background: "#0e0c1dee" }}
      >
        {signed(value)}
      </span>
    </div>
  );
}

/** Reveal effects drawn behind the crate (light rays for treasure). */
export function RevealBack({ value }: { value: number }) {
  const k = kindOf(value);
  if (k === "treasure") return <Rays color={GOLD} />;
  if (k !== "cursed") return null;
  return (
    <div
      aria-hidden
      className="au-glow pointer-events-none absolute inset-[-10%] rounded-full"
      style={{ background: `radial-gradient(circle, ${CURSE}66 0%, #84cc1622 40%, transparent 68%)` }}
    />
  );
}

/** Reveal effects drawn in front of the crate: coins for treasure, curse smoke, junk dust. */
export function RevealFront({ value }: { value: number }) {
  const k = kindOf(value);
  if (k === "treasure") return <Burst />;
  if (k === "cursed") return <Smoke colors={[`${CURSE}cc`, "#84cc16bb", "#7e22cedd"]} count={9} />;
  return <Smoke colors={[`${JUNK}99`, "#64748b99"]} count={4} />;
}

/** A big rubber stamp across the crate: SOLD! / NO SALE. */
export function Stamp({ text, color }: { text: string; color: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[9%] grid place-items-center">
      <span
        className="au-stamp rounded-lg border-[3px] px-2 py-0.5 font-display text-xl font-black tracking-wider whitespace-nowrap uppercase"
        style={{ color, borderColor: color, background: "#0e0c1dcc", textShadow: `0 0 12px ${color}66` }}
      >
        {text}
      </span>
    </div>
  );
}

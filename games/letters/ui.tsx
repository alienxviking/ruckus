"use client";

// Small client-only helpers shared by the Letter Rush screens.

import { useEffect, useState, type CSSProperties } from "react";
import type { Player } from "@/shared/types";
import { LETTERS } from "./shared";

/** Keyframes the global stylesheet doesn't have. Hoisted into <head> once via React 19 `precedence`. */
export const LETTERS_CSS = `
@keyframes lr-reel {
  from { transform: translateY(0); }
  to { transform: translateY(calc(var(--lr-steps) * -100% / (var(--lr-steps) + 1))); }
}
.lr-reel { animation: lr-reel 0.95s cubic-bezier(0.12, 0.8, 0.22, 1) both; }
@keyframes lr-bump {
  0% { transform: scale(1); }
  40% { transform: scale(1.18); }
  100% { transform: scale(1); }
}
.lr-bump { animation: lr-bump 0.35s ease-out both; }
@media (prefers-reduced-motion: reduce) {
  .lr-reel { animation: none; transform: translateY(calc(var(--lr-steps) * -100% / (var(--lr-steps) + 1))); }
  .lr-bump { animation: none; }
}
`;

/** Stand-in for a participant who has vanished from the room entirely. */
export function playerOf(byId: Record<string, Player>, id: string): Player {
  return byId[id] ?? { id, name: "Someone", color: "#94a3b8", avatar: "👤", connected: false };
}

/** Server time kept in state and refreshed every `ms`, so render never reads a clock. */
export function useNow(serverNow: () => number, ms = 500): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(id);
  }, [serverNow, ms]);
  return now;
}

/** "1:05", "0:42". */
export function clock(secs: number): string {
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

/** "Bo", "Bo and Chen", "3 players". */
export function waitList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.length} players`;
}

/** Decoy letters for the slot-machine reel, ending on the real one. Deterministic per letter. */
function reelFor(letter: string): string[] {
  const at = Math.max(0, (LETTERS as readonly string[]).indexOf(letter));
  const reel: string[] = Array.from({ length: 9 }, (_, j) => LETTERS[(at + 7 * (j + 1)) % LETTERS.length]);
  reel.push(letter);
  return reel;
}

/** The round's letter on a glossy tile. While `spin` is set it lands with a slot-machine roll. */
export function LetterTile({
  letter,
  spin,
  spinKey,
  accent,
  size = 56,
}: {
  letter: string;
  spin: boolean;
  spinKey: number;
  accent: string;
  size?: number;
}) {
  const reel = spin ? reelFor(letter) : [letter];
  const cell: CSSProperties = { width: size, height: size, fontSize: size * 0.64 };
  return (
    <div
      role="img"
      aria-label={`Letter ${letter}`}
      className="relative shrink-0 overflow-hidden rounded-2xl shadow-lg shadow-black/40 ring-1 ring-white/25 ring-inset"
      style={{ width: size, height: size, background: `linear-gradient(145deg, #fde68a, ${accent} 70%)` }}
    >
      <div
        key={spinKey}
        className={spin ? "lr-reel" : undefined}
        style={{ "--lr-steps": reel.length - 1 } as CSSProperties}
      >
        {reel.map((ch, i) => (
          <span
            key={i}
            aria-hidden
            className="grid place-items-center font-display leading-none font-black text-ink"
            style={cell}
          >
            {ch}
          </span>
        ))}
      </div>
    </div>
  );
}

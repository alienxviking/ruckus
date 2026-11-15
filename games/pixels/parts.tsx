"use client";

// Small presentational pieces for Canvas Clash: emblem art, board crops, colours.

import { PLAYER_COLORS, type Player } from "@/shared/types";
import { BLANK, COLORS, EMBLEM } from "./shared";

/** Dark text on light paint, light text on dark paint. */
export function inkOn(colour: number): string {
  return colour === 1 || colour === 7 || colour === 8 || colour === 3 ? "#ffffff" : "#26223f";
}

/**
 * A 5x5 picture from 25 colour digits. `digits` prints each cell's palette key
 * (so colour is never the only cue); `marks` flags cells with a cross.
 */
export function PixelArt({
  art,
  size,
  digits = false,
  marks,
  label,
  className = "",
}: {
  art: string;
  size: number | string;
  digits?: boolean;
  marks?: boolean[];
  label?: string;
  className?: string;
}) {
  const cells = Array.from({ length: EMBLEM * EMBLEM }, (_, i) => {
    const c = art.charCodeAt(i) - 48;
    return c >= 0 && c < COLORS.length ? c : 0;
  });
  return (
    <svg
      viewBox="0 0 50 50"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={`block shrink-0 rounded-[3px] ${className}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {cells.map((c, i) => (
        <rect key={i} x={(i % EMBLEM) * 10} y={Math.floor(i / EMBLEM) * 10} width={10} height={10} fill={c ? COLORS[c].hex : BLANK} />
      ))}
      {digits &&
        cells.map((c, i) =>
          c ? (
            <text
              key={`d${i}`}
              x={(i % EMBLEM) * 10 + 5}
              y={Math.floor(i / EMBLEM) * 10 + 7}
              fontSize={5.5}
              fontWeight={700}
              textAnchor="middle"
              fill={inkOn(c)}
              opacity={0.75}
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              {c}
            </text>
          ) : null,
        )}
      {marks?.map((m, i) =>
        m ? (
          <g key={`m${i}`} stroke="#ff2d55" strokeWidth={1.8} strokeLinecap="round">
            <line x1={(i % EMBLEM) * 10 + 2.5} y1={Math.floor(i / EMBLEM) * 10 + 2.5} x2={(i % EMBLEM) * 10 + 7.5} y2={Math.floor(i / EMBLEM) * 10 + 7.5} />
            <line x1={(i % EMBLEM) * 10 + 7.5} y1={Math.floor(i / EMBLEM) * 10 + 2.5} x2={(i % EMBLEM) * 10 + 2.5} y2={Math.floor(i / EMBLEM) * 10 + 7.5} />
          </g>
        ) : null,
      )}
    </svg>
  );
}

/** The 5x5 patch of `board` at (x, y), as 25 digits. */
export function cropBoard(board: string, w: number, x: number, y: number): string {
  let out = "";
  for (let j = 0; j < EMBLEM; j++) out += board.slice((y + j) * w + x, (y + j) * w + x + EMBLEM);
  return out.padEnd(EMBLEM * EMBLEM, "0");
}

/** A face-down emblem card (before the reveal). */
export function HiddenArt({ size }: { size: number }) {
  return (
    <span
      aria-label="Secret emblem"
      role="img"
      className="grid shrink-0 place-items-center rounded-[3px] border border-dashed border-line bg-panel-2 font-display font-black text-muted"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      ?
    </span>
  );
}

/**
 * One distinct colour per painter for flashes and boxes: if two players picked the
 * same colour, later ones get the first unused player colour.
 */
export function painterColors(ids: string[], byId: Record<string, Player>): string[] {
  const used = new Set<string>();
  return ids.map((id) => {
    let c = (byId[id]?.color ?? "#94a3b8").toLowerCase();
    if (used.has(c)) c = PLAYER_COLORS.find((p) => !used.has(p.toLowerCase()))?.toLowerCase() ?? c;
    used.add(c);
    return c;
  });
}

/** Stand-in for a participant who has left the room entirely. */
export function playerOr(byId: Record<string, Player>, id: string, i: number): Player {
  return byId[id] ?? { id, name: `Player ${i + 1}`, color: "#94a3b8", avatar: "🙂", connected: false };
}

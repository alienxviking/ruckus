"use client";

import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import { Note, PlayerChip, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import { PLAYER_COLORS, type Player } from "@/shared/types";
import {
  allLines,
  boxesBeside,
  distinctColors,
  ownerOf,
  sideCount,
  type DotsAction,
  type DotsView,
  type LineRef,
} from "./shared";
import { Avatar, SvgAvatar } from "@/components/Avatar";
import { feedback } from "@/lib/feedback";

// ---------- board geometry (SVG user units) ----------

const S = 100; // dot spacing
const P = 30; // padding around the outer dots
const LINE_W = 11;
const DOT_R = 8.5;
const INSET = 12; // claimed-box fill inset from its lines
const WARN = "#ffb020";
const MEDALS = ["🥇", "🥈", "🥉"];

const X = (c: number) => P + c * S;
const Y = (r: number) => P + r * S;
const keyOf = (l: LineRef) => `${l.o}${l.r}-${l.c}`;
const dotName = (r: number, c: number) => `${String.fromCharCode(65 + c)}${r + 1}`;

function ends(l: LineRef): [number, number, number, number] {
  return l.o === "h" ? [X(l.c), Y(l.r), X(l.c + 1), Y(l.r)] : [X(l.c), Y(l.r), X(l.c), Y(l.r + 1)];
}

/** Hit area: the diamond between a line's two dots and the centres of its boxes. Diamonds tile the board. */
function diamond(l: LineRef): string {
  const [x1, y1, x2, y2] = ends(l);
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return l.o === "h"
    ? `${x1},${y1} ${mx},${my - S / 2} ${x2},${y2} ${mx},${my + S / 2}`
    : `${x1},${y1} ${mx + S / 2},${my} ${x2},${y2} ${mx - S / 2},${my}`;
}

function lineLabel(l: LineRef, drawnBy: string | null): string {
  const to = l.o === "h" ? dotName(l.r, l.c + 1) : dotName(l.r + 1, l.c);
  return `Line ${dotName(l.r, l.c)} to ${to}${drawnBy ? `, drawn by ${drawnBy}` : ""}`;
}

const boxCentre = (b: number, cols: number): [number, number] => [
  X(b % cols) + S / 2,
  Y(Math.floor(b / cols)) + S / 2,
];

// ---------- keyboard navigation between lines ----------

const ARROWS: Record<string, [number, number]> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowUp: [0, -1],
};

const mid = (l: LineRef): [number, number] => (l.o === "h" ? [l.c + 0.5, l.r] : [l.c, l.r + 0.5]);

/** Nearest line in a direction: first within a 45° cone, else anywhere ahead. */
function nearest(from: LineRef, [dx, dy]: [number, number], options: LineRef[]): LineRef | null {
  const [fx, fy] = mid(from);
  for (const strict of [true, false]) {
    let best: LineRef | null = null;
    let bestScore = Infinity;
    for (const l of options) {
      const [x, y] = mid(l);
      const along = (x - fx) * dx + (y - fy) * dy;
      const across = Math.abs((x - fx) * dy - (y - fy) * dx);
      if (along <= 0 || (strict && across > along)) continue;
      const score = along * along + (strict ? 1 : 4) * across * across + across * 0.01;
      if (score < bestScore - 1e-9) {
        best = l;
        bestScore = score;
      }
    }
    if (best) return best;
  }
  return null;
}

// ---------- players & colours ----------

function seatPlayers(view: DotsView, byId: Record<string, Player>): Player[] {
  const raw = view.seats.map(
    (id, seat): Player =>
      byId[id] ?? {
        id,
        name: `Player ${seat + 1}`,
        color: PLAYER_COLORS[seat % PLAYER_COLORS.length],
        avatar: "🙂",
        connected: false,
      },
  );
  const colors = distinctColors(
    raw.map((p) => p.color),
    PLAYER_COLORS,
  );
  return raw.map((p, seat) => (colors[seat] === p.color ? p : { ...p, color: colors[seat] }));
}

// ---------- the game ----------

export default function DotsAndBoxes({
  view,
  byId,
  isPlayer,
  act,
  serverNow,
  accent,
}: GameClientProps<DotsView, DotsAction>) {
  const you = view && isPlayer ? view.you : -1;
  const myTurn = !!view && !view.over && you >= 0 && view.turn === you;
  // The move number of a line we drew that closed a box (-1 otherwise), so the cue fires once per box.
  const myBoxAt = view?.lastLine && you >= 0 && view.lastLine.seat === you && view.lastLine.claimed.length > 0 ? view.moves : -1;
  useEffect(() => {
    if (myTurn) feedback("turn");
  }, [myTurn]);
  useEffect(() => {
    if (myBoxAt >= 0) feedback("score");
  }, [myBoxAt]);

  if (!view) return <Note>Setting up the board…</Note>;

  const seats = seatPlayers(view, byId);
  const mover = view.turn >= 0 ? seats[view.turn] : undefined;
  const moverAway = !!mover && (!mover.connected || view.idle[view.turn]);
  const total = view.rows * view.cols;
  const left = view.boxes.filter((b) => b < 0).length;
  const iAmIdle = you >= 0 && !view.over && view.idle[you];

  const status = describe(view, seats, you, myTurn, moverAway);

  return (
    <div className="@container mx-auto w-full max-w-[920px]">
      <style href="ruckus-dots" precedence="default">
        {CSS}
      </style>
      <div className="flex flex-col gap-3">
        {!view.over && (
          <div aria-live="polite" aria-atomic="true">
            <StatusBanner key={`${view.moves}:${view.turn}`} accent={mover?.color ?? accent}>
              <div className="truncate">{status.main}</div>
              <div className="mt-0.5 truncate font-sans text-xs font-medium text-muted sm:text-sm">{status.sub}</div>
            </StatusBanner>
          </div>
        )}

        {view.closeAt !== null && !view.over && <CloseCountdown closeAt={view.closeAt} serverNow={serverNow} />}

        {iAmIdle && (
          <div
            className="card animate-rise flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
            style={{ borderColor: WARN + "99" }}
            role="alert"
          >
            <p className="min-w-0 flex-1 text-sm">
              <span aria-hidden>💤 </span>You missed a couple of moves, so yours are being played for you.
            </p>
            <button className="btn btn-primary min-h-10" onClick={() => act({ type: "back" })}>
              I&apos;m back
            </button>
          </div>
        )}

        <div className="flex flex-col gap-3 @3xl:flex-row @3xl:items-start">
          <aside className="flex min-w-0 flex-col gap-3 @3xl:order-2 @3xl:w-64 @3xl:shrink-0">
            {view.over ? (
              <Standings view={view} seats={seats} you={you} />
            ) : (
              <>
                <SeatList view={view} seats={seats} you={you} />
                <TurnClock
                  endsAt={view.endsAt}
                  turnMs={view.turnMs}
                  color={mover?.color ?? accent}
                  mine={myTurn}
                  away={moverAway}
                  left={left}
                  total={total}
                  serverNow={serverNow}
                />
              </>
            )}
          </aside>

          <div className="min-w-0 flex-1 @3xl:order-1">
            <div
              className="card p-2 transition-[border-color,box-shadow] duration-300 @sm:p-3"
              style={
                myTurn
                  ? { borderColor: seats[you].color, boxShadow: `4px 5px 0 color-mix(in oklab, ${seats[you].color} 45%, #000)` }
                  : undefined
              }
            >
              <Board
                view={view}
                seats={seats}
                you={you}
                myTurn={myTurn}
                onPlay={(l) => act({ type: "line", o: l.o, r: l.r, c: l.c })}
              />
            </div>
          </div>
        </div>

        {!isPlayer ? (
          <Note>👀 You&apos;re watching. The board updates live.</Note>
        ) : !view.over ? (
          <p className="text-center text-xs text-muted">
            {myTurn ? (
              <>
                Preview: <span className="font-semibold text-text">✨ closes a box</span> ·{" "}
                <span className="font-semibold" style={{ color: WARN }}>
                  ⚠ hands one over
                </span>
              </>
            ) : (
              "Close a box: score + go again · Avoid 3rd sides"
            )}
          </p>
        ) : null}

        {/* Keeps the board scrollable clear of the floating chat button on phones. */}
        <div aria-hidden className="h-12 @3xl:hidden" />
      </div>
    </div>
  );
}

function describe(
  view: DotsView,
  seats: Player[],
  you: number,
  myTurn: boolean,
  moverAway: boolean,
): { main: ReactNode; sub: string } {
  const last = view.lastLine;
  const by = last ? seats[last.seat] : undefined;
  const closed = last?.claimed.length ?? 0;
  const who = last && last.seat === you ? "You" : (by?.name ?? "Someone");
  const sameMover = !!last && last.seat === view.turn;

  const boxes = closed === 2 ? "two boxes" : "a box";
  let sub: string;
  if (last?.auto) sub = closed ? `⏩ ${by?.name ?? "Someone"}’s auto-move closed ${boxes}` : `⏩ Auto-move for ${by?.name ?? "someone"}`;
  else if (closed) sub = `🎉 ${who} closed ${boxes}${sameMover && !myTurn ? " and goes again" : ""}`;
  else if (myTurn) sub = view.moves === 0 ? "You go first: pick any gap between two dots" : "Pick a gap between two dots";
  else if (moverAway) sub = "A line will be drawn for them shortly";
  else if (view.moves === 0) sub = `${seats[view.turn]?.name ?? "Someone"} goes first`;
  else sub = `Waiting for ${seats[view.turn]?.name ?? "someone"} to draw a line…`;

  if (myTurn) {
    const again = !!last && last.seat === you && closed > 0;
    const main = again ? (closed === 2 ? "✨ Double box! Go again" : "✨ Box! Go again") : "Your move";
    return { main, sub };
  }
  const mover = seats[view.turn];
  if (!mover) return { main: "…", sub };
  return {
    main: (
      <>
        <span aria-hidden><Avatar id={mover.avatar} /> </span>
        <span style={{ color: mover.color }}>{mover.name}</span>
        {moverAway ? " is away" : "’s move"}
      </>
    ),
    sub,
  };
}

// ---------- side panel pieces ----------

function SeatList({ view, seats, you }: { view: DotsView; seats: Player[]; you: number }) {
  const n = seats.length;
  const cols = n === 3 ? "grid-cols-3" : n >= 4 ? "grid-cols-2 @lg:grid-cols-4" : "grid-cols-2";
  return (
    <ul className={`grid gap-2 ${cols} @3xl:grid-cols-1`} aria-label="Boxes per player">
      {seats.map((p, seat) => {
        const active = view.turn === seat;
        const caption = !p.connected
          ? "⚠ offline"
          : view.idle[seat]
            ? "💤 away"
            : active
              ? seat === you
                ? "▶ your move"
                : "▶ moving"
              : seat === you
                ? "you"
                : "";
        return (
          <li
            key={p.id}
            aria-current={active ? "true" : undefined}
            className={`flex min-w-0 flex-col gap-0.5 rounded-xl border-2 px-2.5 py-1.5 transition-[background-color,border-color,box-shadow,opacity] duration-300 @3xl:min-h-14 @3xl:flex-row @3xl:items-center @3xl:gap-2 @3xl:py-2 ${
              active ? "" : "border-line bg-panel"
            } ${p.connected ? "" : "opacity-60"}`}
            style={
              active
                ? { borderColor: p.color, background: `${p.color}1f`, boxShadow: `3px 4px 0 color-mix(in oklab, ${p.color} 45%, #000)` }
                : undefined
            }
          >
            <span className="flex min-w-0 items-center gap-1.5 @3xl:flex-1">
              <span aria-hidden className="text-lg leading-none">
                <Avatar id={p.avatar} />
              </span>
              <span className="min-w-0 @3xl:flex-1">
                <span className="block truncate text-sm font-semibold" style={{ color: p.color }}>
                  {p.name}
                </span>
                {caption && <span className="hidden truncate text-xs leading-tight text-muted @3xl:block">{caption}</span>}
              </span>
            </span>
            <span className="flex items-end justify-between gap-1 @3xl:block">
              <span className="truncate text-xs leading-tight text-muted @3xl:hidden">{caption || "\u00a0"}</span>
              <span key={view.scores[seat]} className="animate-pop font-mono text-xl leading-none font-bold tabular-nums">
                {view.scores[seat]}
                <span className="sr-only"> boxes</span>
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function TurnClock({
  endsAt,
  turnMs,
  color,
  mine,
  away,
  left,
  total,
  serverNow,
}: {
  endsAt: number | null;
  turnMs: number;
  color: string;
  mine: boolean;
  away: boolean;
  left: number;
  total: number;
  serverNow: () => number;
}) {
  const secs = useSecondsLeft(endsAt, serverNow);
  const urgent = mine && secs <= 5;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className={`font-semibold tabular-nums ${urgent ? "text-brand motion-safe:animate-pulse" : "text-muted"}`}>
          {away ? `⏩ auto-move in ${secs}s` : mine ? `⏱ ${secs}s to move` : `⏱ ${secs}s`}
        </span>
        <span className="text-muted tabular-nums">
          {left}/{total} boxes left
        </span>
      </div>
      <TimerBar endsAt={endsAt} total={turnMs} serverNow={serverNow} color={urgent ? "var(--color-brand)" : color} />
    </div>
  );
}

function CloseCountdown({ closeAt, serverNow }: { closeAt: number; serverNow: () => number }) {
  const secs = useSecondsLeft(closeAt, serverNow);
  return (
    <div className="card animate-rise px-4 py-2.5 text-center text-sm" style={{ borderColor: WARN + "99" }} role="status">
      <span aria-hidden>📡 </span>
      Not enough players connected. The game ends in <b className="tabular-nums">{secs}s</b> unless someone comes back.
    </div>
  );
}

function Standings({ view, seats, you }: { view: DotsView; seats: Player[]; you: number }) {
  const total = view.rows * view.cols;
  // Normally winners are simply the top scorers. After a forfeit they can trail on boxes,
  // so winners always rank first and everyone else ranks by boxes behind them.
  const won = (seat: number) => view.winners.includes(seat);
  const ahead = (a: number, b: number) =>
    (won(a) && !won(b)) || (won(a) === won(b) && view.scores[a] > view.scores[b]);
  const order = seats
    .map((_, seat) => seat)
    .sort((a, b) => (ahead(a, b) ? -1 : ahead(b, a) ? 1 : a - b));
  const rankOf = (seat: number) => 1 + order.filter((other) => ahead(other, seat)).length;
  return (
    <div className="card animate-rise p-3">
      <div className="label mb-2">Final standings</div>
      <ol className="flex flex-col gap-2.5">
        {order.map((seat) => {
          const p = seats[seat];
          const score = view.scores[seat];
          const rank = rankOf(seat);
          return (
            <li key={p.id} className="flex flex-col gap-1">
              <div className="flex min-w-0 items-center gap-2">
                <span aria-hidden className="w-7 shrink-0 text-center text-lg leading-none">
                  {MEDALS[rank - 1] ?? rank}
                </span>
                <span className="sr-only">Place {rank}:</span>
                <span className="flex min-w-0 [&>span]:max-w-full">
                  <PlayerChip player={p} size="sm" dim={!p.connected}>
                    {seat === you && <span className="text-muted">(you)</span>}
                  </PlayerChip>
                </span>
                {won(seat) && (
                  <span className="shrink-0 text-xs font-bold" style={{ color: p.color }}>
                    {view.winners.length > 1 ? "Tied" : "Winner"}
                  </span>
                )}
                <span className="ml-auto shrink-0 font-mono text-lg font-bold tabular-nums">
                  {score}
                  <span className="sr-only"> boxes</span>
                </span>
              </div>
              <div className="ml-9 h-1.5 overflow-hidden rounded-full bg-panel-2">
                <div className="dots-bar h-full rounded-full" style={{ width: `${(score / total) * 100}%`, background: p.color }} />
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs text-muted">
        {view.reason === "forfeit"
          ? "Ended early: not enough players stayed connected."
          : `All ${total} boxes claimed in ${view.moves} lines.`}
      </p>
    </div>
  );
}

// ---------- the board ----------

function Board({
  view,
  seats,
  you,
  myTurn,
  onPlay,
}: {
  view: DotsView;
  seats: Player[];
  you: number;
  myTurn: boolean;
  onPlay: (l: LineRef) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null); // keyboard focus only
  const [cursor, setCursor] = useState<string | null>(null); // roving tab stop

  const { rows, cols } = view;
  const W = cols * S + 2 * P;
  const H = rows * S + 2 * P;
  const lines = allLines(rows, cols);
  const byKey = new Map(lines.map((l) => [keyOf(l), l]));
  const owner = (l: LineRef) => ownerOf(view.h, view.v, l, rows, cols);
  const open = lines.filter((l) => owner(l) < 0);
  const isOpen = (k: string | null) => {
    const l = k === null ? undefined : byKey.get(k);
    return !!l && owner(l) < 0;
  };

  const interactive = you >= 0 && !view.over;
  const myColor = you >= 0 ? seats[you].color : "#fff";
  const previewKey = !myTurn ? null : isOpen(hover) ? hover : isOpen(focused) ? focused : null;
  const preview = previewKey ? byKey.get(previewKey)! : null;
  const previewBoxes = preview ? boxesBeside(preview, rows, cols) : [];
  const previewCloses = previewBoxes.some((b) => sideCount(view.h, view.v, b, cols) === 3);
  const focusLine = focused ? byKey.get(focused) : undefined;
  const tabStop = cursor && byKey.has(cursor) && (isOpen(cursor) || cursor === focused) ? cursor : open[0] ? keyOf(open[0]) : null;
  const last = view.lastLine;

  const onKey = (e: KeyboardEvent<SVGPolygonElement>, l: LineRef) => {
    const dir = ARROWS[e.key];
    let target: LineRef | null | undefined;
    if (dir) target = nearest(l, dir, open);
    else if (e.key === "Home") target = open[0];
    else if (e.key === "End") target = open[open.length - 1];
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (myTurn && owner(l) < 0) onPlay(l);
      return;
    } else return;
    e.preventDefault();
    if (target) e.currentTarget.ownerSVGElement?.querySelector<SVGElement>(`[data-line="${keyOf(target)}"]`)?.focus();
  };

  return (
    <svg
      data-board=""
      viewBox={`0 0 ${W} ${H}`}
      className="mx-auto block select-none"
      style={{
        width: `min(100%, 560px, calc(62vh * ${(W / H).toFixed(4)}))`,
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        WebkitTouchCallout: "none",
      }}
      role="group"
      aria-label={`Board, ${cols} by ${rows} boxes.${interactive ? " Arrow keys move between lines, Enter draws." : ""}`}
    >
      {/* claimed boxes */}
      {view.boxes.map((o, b) => {
        const p = seats[o];
        if (o < 0 || !p) return null;
        const [cx, cy] = boxCentre(b, cols);
        const dim = view.over && !view.winners.includes(o);
        return (
          <g key={b} className="dots-box" aria-hidden>
            <rect
              x={cx - S / 2 + INSET}
              y={cy - S / 2 + INSET}
              width={S - 2 * INSET}
              height={S - 2 * INSET}
              rx={14}
              fill={p.color}
              fillOpacity={dim ? 0.09 : 0.24}
              stroke={p.color}
              strokeOpacity={dim ? 0.2 : 0.55}
              strokeWidth={3}
              className="transition-[fill-opacity,stroke-opacity] duration-700"
            />
            <g className="dots-avatar">
              <SvgAvatar
                id={p.avatar}
                x={cx}
                y={cy}
                size={46}
                opacity={dim ? 0.4 : 1}
                className="transition-opacity duration-700"
              />
            </g>
          </g>
        );
      })}

      {/* open lines as faint dotted guides */}
      <path
        d={open.map((l) => {
          const [x1, y1, x2, y2] = ends(l);
          return `M${x1} ${y1}L${x2} ${y2}`;
        }).join("")}
        stroke="#4b437a"
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray="0.1 16.6"
        fill="none"
        aria-hidden
      />

      {/* hover / focus preview on your move, with what it would do */}
      {preview && (
        <g aria-hidden className="pointer-events-none">
          {previewBoxes.map((b) => {
            const n = sideCount(view.h, view.v, b, cols);
            // A third side only hands a box over if this line doesn't also close one (then you go again).
            if (n < 2 || view.boxes[b] >= 0 || (n === 2 && previewCloses)) return null;
            const [cx, cy] = boxCentre(b, cols);
            const closes = n === 3;
            return (
              <g key={b}>
                <rect
                  x={cx - S / 2 + INSET}
                  y={cy - S / 2 + INSET}
                  width={S - 2 * INSET}
                  height={S - 2 * INSET}
                  rx={14}
                  fill={closes ? myColor : WARN}
                  fillOpacity={closes ? 0.3 : 0.1}
                  stroke={closes ? myColor : WARN}
                  strokeOpacity={0.8}
                  strokeWidth={3}
                  strokeDasharray={closes ? undefined : "10 8"}
                />
                <text
                  x={cx}
                  y={cy + 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={closes ? 40 : 36}
                  fontWeight={800}
                  fill={closes ? myColor : WARN}
                >
                  {closes ? "✨" : "⚠"}
                </text>
              </g>
            );
          })}
          <line
            x1={ends(preview)[0]}
            y1={ends(preview)[1]}
            x2={ends(preview)[2]}
            y2={ends(preview)[3]}
            stroke={myColor}
            strokeOpacity={0.22}
            strokeWidth={28}
            strokeLinecap="round"
          />
          {/* hides the dotted guide underneath so the preview reads as one solid stroke */}
          <line
            x1={ends(preview)[0]}
            y1={ends(preview)[1]}
            x2={ends(preview)[2]}
            y2={ends(preview)[3]}
            stroke="var(--color-panel)"
            strokeWidth={LINE_W}
            strokeLinecap="round"
          />
          <line
            x1={ends(preview)[0]}
            y1={ends(preview)[1]}
            x2={ends(preview)[2]}
            y2={ends(preview)[3]}
            stroke={myColor}
            strokeWidth={LINE_W}
            strokeLinecap="round"
            className="dots-preview"
          />
        </g>
      )}

      {/* last line glow */}
      {last && !view.over && seats[last.seat] && (
        <line
          key={`glow-${last.n}`}
          x1={ends(last)[0]}
          y1={ends(last)[1]}
          x2={ends(last)[2]}
          y2={ends(last)[3]}
          stroke={seats[last.seat].color}
          strokeWidth={30}
          strokeLinecap="round"
          className="dots-glow pointer-events-none"
          aria-hidden
        />
      )}

      {/* drawn lines */}
      {lines.map((l) => {
        const o = owner(l);
        if (o < 0) return null;
        const [x1, y1, x2, y2] = ends(l);
        return (
          <line
            key={keyOf(l)}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={seats[o]?.color ?? "#fff"}
            strokeWidth={LINE_W}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="1 1"
            className="dots-draw"
            aria-hidden
          />
        );
      })}

      {/* dots */}
      <g aria-hidden fill="#f4f1ff">
        {Array.from({ length: (rows + 1) * (cols + 1) }, (_, i) => (
          <circle key={i} cx={X(i % (cols + 1))} cy={Y(Math.floor(i / (cols + 1)))} r={DOT_R} />
        ))}
      </g>

      {/* keyboard focus ring */}
      {interactive && focusLine && (
        <rect
          x={focusLine.o === "h" ? X(focusLine.c) - 16 : X(focusLine.c) - 18}
          y={focusLine.o === "h" ? Y(focusLine.r) - 18 : Y(focusLine.r) - 16}
          width={focusLine.o === "h" ? S + 32 : 36}
          height={focusLine.o === "h" ? 36 : S + 32}
          rx={18}
          fill="none"
          stroke="#f4f1ff"
          strokeWidth={3}
          strokeDasharray="9 7"
          className="pointer-events-none"
          aria-hidden
        />
      )}

      {/* claim celebration */}
      {last &&
        seats[last.seat] &&
        last.claimed.map((b) => {
          const [cx, cy] = boxCentre(b, cols);
          const color = seats[last.seat].color;
          return (
            <g key={`fx-${last.n}-${b}`} className="pointer-events-none" aria-hidden>
              <circle cx={cx} cy={cy} r={46} fill="none" stroke={color} strokeWidth={5} className="dots-ripple" />
              <text
                x={cx}
                y={cy - 22}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={34}
                fontWeight={800}
                fill={color}
                stroke="#0e0c1d"
                strokeWidth={7}
                paintOrder="stroke"
                className="dots-float"
              >
                +1
              </text>
            </g>
          );
        })}

      {/* hit areas (players only) */}
      {interactive &&
        lines.map((l) => {
          const k = keyOf(l);
          const o = owner(l);
          const playable = o < 0 && myTurn;
          return (
            <polygon
              key={k}
              data-line={k}
              points={diamond(l)}
              fill="transparent"
              role="button"
              tabIndex={k === tabStop ? 0 : -1}
              aria-label={lineLabel(l, o >= 0 ? (seats[o]?.name ?? "someone") : null)}
              aria-disabled={playable ? undefined : true}
              className={`outline-none ${playable ? "cursor-pointer" : ""}`}
              onPointerEnter={() => setHover(k)}
              onPointerDown={() => setHover(k)}
              onPointerLeave={() => setHover((h) => (h === k ? null : h))}
              onPointerCancel={() => setHover((h) => (h === k ? null : h))}
              onClick={() => {
                if (playable) onPlay(l);
              }}
              onFocus={(e) => {
                setCursor(k);
                setFocused(e.currentTarget.matches(":focus-visible") ? k : null);
              }}
              onBlur={() => setFocused((f) => (f === k ? null : f))}
              onKeyDown={(e) => onKey(e, l)}
            />
          );
        })}
    </svg>
  );
}

// Keyframes for the board (scoped by the dots- prefix, hoisted and de-duplicated by React).
const CSS = `
.dots-draw { animation: dots-draw .3s ease-out both; }
@keyframes dots-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
.dots-glow { animation: dots-glow 1.6s ease-in-out infinite; stroke-opacity: .3; }
@keyframes dots-glow { 0%, 100% { stroke-opacity: .12; } 50% { stroke-opacity: .42; } }
.dots-preview { animation: dots-breathe 1.1s ease-in-out infinite; stroke-opacity: .8; }
@keyframes dots-breathe { 0%, 100% { stroke-opacity: .62; } 50% { stroke-opacity: .95; } }
/* A claim plays in order: the closing line draws (.3s), the box fills, the avatar lands, the ripple and +1 fire. */
.dots-box { transform-box: fill-box; transform-origin: center; animation: dots-box .45s cubic-bezier(.2, 1.4, .4, 1) .16s both; }
@keyframes dots-box { from { transform: scale(.3); opacity: 0; } to { transform: none; opacity: 1; } }
.dots-avatar { transform-box: fill-box; transform-origin: center; animation: dots-avatar .5s cubic-bezier(.2, 1.6, .4, 1) .3s both; }
@keyframes dots-avatar { from { transform: scale(.2) rotate(-20deg); opacity: 0; } to { transform: none; opacity: 1; } }
.dots-ripple { transform-box: fill-box; transform-origin: center; animation: dots-ripple .75s ease-out .2s both; }
@keyframes dots-ripple { from { transform: scale(.35); opacity: .95; } to { transform: scale(1.55); opacity: 0; } }
.dots-float { transform-box: fill-box; transform-origin: center; animation: dots-float 1.2s ease-out .2s both; }
@keyframes dots-float {
  0% { transform: translateY(14px) scale(.5); opacity: 0; }
  18% { transform: translateY(0) scale(1.2); opacity: 1; }
  70% { opacity: 1; }
  100% { transform: translateY(-34px) scale(1); opacity: 0; }
}
.dots-bar { transform-origin: left; animation: dots-bar .9s cubic-bezier(.2, .8, .2, 1) both; }
@keyframes dots-bar { from { transform: scaleX(0); } }
@keyframes dots-fade { 0%, 70% { opacity: 1; } 100% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .dots-draw, .dots-glow, .dots-preview, .dots-box, .dots-avatar, .dots-bar { animation: none; }
  .dots-ripple { display: none; }
  .dots-float { animation: dots-fade 1.2s linear both; }
}
`;

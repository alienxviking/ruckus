"use client";

import { useEffect, type CSSProperties, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { Note, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import type { TttAction, TttView } from "./server";
import { Avatar } from "@/components/Avatar";
import { feedback } from "@/lib/feedback";

type Mark = 0 | 1;
const NAME = ["X", "O"];

// Game-local animations, prefixed so they can't clash. Strokes "draw in" by
// animating stroke-dashoffset on pathLength=1 shapes (paint only, no layout);
// everything else is transform/opacity.
const CSS = `
.ttt-draw { stroke-dasharray: 1 1; animation: ttt-draw .3s cubic-bezier(.65,0,.35,1) both; }
.ttt-grid { stroke-dasharray: 1 1; animation: ttt-draw .45s cubic-bezier(.65,0,.35,1) both; }
.ttt-sweep { stroke-dasharray: 1 1; animation: ttt-draw .42s cubic-bezier(.65,0,.35,1) .22s both; }
@keyframes ttt-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
.ttt-in { animation: ttt-in .35s cubic-bezier(.2,.8,.2,1) both; }
@keyframes ttt-in { from { opacity: 0; transform: scale(.95); } }
.ttt-pop { animation: ttt-pop .5s cubic-bezier(.2,1.5,.4,1) both; }
@keyframes ttt-pop { from { opacity: 0; transform: scale(1.8); } }
.ttt-crown { animation: ttt-crown .6s cubic-bezier(.2,1.5,.4,1) .25s both; }
@keyframes ttt-crown { from { opacity: 0; transform: translateY(10px) rotate(-25deg) scale(.4); } }
.ttt-glow { animation: ttt-glow 1.8s ease-in-out infinite; }
@keyframes ttt-glow { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
.ttt-dot { display: inline-block; animation: ttt-dot 1.2s ease-in-out infinite; }
@keyframes ttt-dot { 0%, 70%, 100% { opacity: .25; transform: none; } 35% { opacity: 1; transform: translateY(-2px); } }
.ttt-fade { transition: opacity .45s ease; }
@media (prefers-reduced-motion: reduce) {
  .ttt-draw, .ttt-grid, .ttt-sweep, .ttt-glow, .ttt-dot { animation: none; }
  .ttt-in, .ttt-pop, .ttt-crown { animation: ttt-fade-in .2s ease both; }
  @keyframes ttt-fade-in { from { opacity: 0; } }
}
`;

const EASE = "cubic-bezier(.2,.8,.2,1)";

/** Stand-in for a seat whose player left the room entirely. */
function seatPlayer(byId: Record<string, Player>, id: string, seat: number): Player {
  return byId[id] ?? { id, name: `Player ${NAME[seat]}`, color: seat ? "#ffb020" : "#ff5d73", avatar: "🙂", connected: false };
}

// ---------- marks ----------

/** An X or an O inside a 100x100 box. `draw` animates the strokes in like a pen. */
function MarkShape({ mark, color, draw = false, width = 11 }: { mark: Mark; color: string; draw?: boolean; width?: number }) {
  const common = {
    stroke: color,
    strokeWidth: width,
    strokeLinecap: "round" as const,
    fill: "none",
    pathLength: 1,
    className: draw ? "ttt-draw" : undefined,
  };
  return (
    <svg viewBox="0 0 100 100" className="size-full overflow-visible" aria-hidden>
      {mark === 0 ? (
        <>
          <line x1={24} y1={24} x2={76} y2={76} {...common} />
          <line x1={76} y1={24} x2={24} y2={76} {...common} style={draw ? { animationDelay: "0.14s" } : undefined} />
        </>
      ) : (
        <circle cx={50} cy={50} r={28} transform="rotate(-90 50 50)" {...common} />
      )}
    </svg>
  );
}

// ---------- the game ----------

export default function TicTacToe({ view, byId, act, serverNow }: GameClientProps<TttView, TttAction>) {
  const myTurn = !!view && view.you !== null && view.turn === view.you && !view.roundEnd && !view.over;

  // Keys 1-9 place a mark (reading order, matching the cell labels).
  useEffect(() => {
    if (!myTurn || !view) return;
    const board = view.board;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? "")) return;
      const cell = "123456789".indexOf(e.key);
      if (cell < 0 || board[cell] !== null) return;
      e.preventDefault();
      act({ type: "place", cell });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [myTurn, view, act]);

  // Chime once each time the move passes to us.
  useEffect(() => {
    if (myTurn) feedback("turn");
  }, [myTurn]);

  if (!view) return <Note>Drawing the grid…</Note>;

  const seats = [seatPlayer(byId, view.seats[0], 0), seatPlayer(byId, view.seats[1], 1)] as const;
  const end = view.roundEnd;
  const away = seats.find((p) => !p.connected);

  return (
    <div className="mx-auto flex w-full max-w-[30rem] flex-col gap-3 pb-14 sm:pb-2">
      <style href="ruckus-ttt" precedence="default">
        {CSS}
      </style>

      <div aria-live="polite" aria-atomic="true">
        <StatusBanner key={`${view.round}-${view.turn}-${end ? 1 : 0}-${view.over}`} accent={bannerColor(view, seats)}>
          <span className="block truncate">
            <Status view={view} seats={seats} myTurn={myTurn} />
          </span>
        </StatusBanner>
      </div>

      <div className="flex gap-2">
        {seats.map((p, seat) => (
          <PlayerCard key={p.id} view={view} player={p} seat={seat as Mark} />
        ))}
      </div>

      {view.forfeitAt !== null && !view.over && away && (
        <ForfeitNote away={away} stays={seats.find((p) => p !== away)} forfeitAt={view.forfeitAt} serverNow={serverNow} />
      )}

      <Board view={view} seats={seats} myTurn={myTurn} onPlace={(cell) => act({ type: "place", cell })} />

      {view.over ? (
        <Final view={view} seats={seats} />
      ) : (
        <RoundStrip view={view} seats={seats} serverNow={serverNow} />
      )}

      {view.you === null ? (
        <Note>👀 You&apos;re watching. First to {view.target} rounds wins.</Note>
      ) : myTurn ? (
        <p className="hidden text-center text-xs text-muted sm:block">Tip: keys 1–9 place a mark</p>
      ) : null}
    </div>
  );
}

function bannerColor(view: TttView, seats: readonly Player[]): string | undefined {
  if (view.over) return view.winner !== null ? seats[view.winner].color : undefined;
  if (view.roundEnd) return view.roundEnd.winner !== null ? seats[view.roundEnd.winner].color : undefined;
  return seats[view.turn].color;
}

function Who({ p }: { p: Player }) {
  return (
    <>
      <span aria-hidden><Avatar id={p.avatar} /> </span>
      <span style={{ color: p.color }}>{p.name}</span>
    </>
  );
}

function Status({ view, seats, myTurn }: { view: TttView; seats: readonly Player[]; myTurn: boolean }) {
  const you = view.you;
  if (view.over) {
    if (view.winner === null) return <>Match abandoned</>;
    if (view.forfeit) {
      const gone = seats[1 - view.winner];
      return <>{view.winner === you ? "You win" : <><Who p={seats[view.winner]} /> wins</>} — {gone.name} left</>;
    }
    return view.winner === you ? <>You win the match! 🏆</> : <><Who p={seats[view.winner]} /> wins the match! 🏆</>;
  }
  const end = view.roundEnd;
  if (end) {
    if (end.winner === null) return <>Round {view.round} is a draw 🤝</>;
    return end.winner === you ? (
      <>You take round {view.round}! 🎉</>
    ) : (
      <><Who p={seats[end.winner]} /> takes round {view.round}</>
    );
  }
  const mover = seats[view.turn];
  if (myTurn) {
    return (
      <>
        Your move{" "}
        <span className="inline-block size-[0.9em] align-[-0.1em]">
          <MarkShape mark={view.turn} color={mover.color} width={14} />
        </span>
      </>
    );
  }
  if (!mover.connected) return <>Waiting for <Who p={mover} /> to come back…</>;
  return <><Who p={mover} /> is thinking…</>;
}

// ---------- players ----------

function PlayerCard({ view, player: p, seat }: { view: TttView; player: Player; seat: Mark }) {
  const active = !view.over && !view.roundEnd && view.turn === seat;
  const won = view.over && view.winner === seat;
  const score = view.score[seat];
  const isYou = view.you === seat;
  const right = seat === 1;
  let caption: ReactNode;
  if (!p.connected) caption = "⚠ offline";
  else if (won) caption = "winner";
  else if (active)
    caption = isYou ? (
      "your move"
    ) : (
      <>
        thinking
        <span aria-hidden>
          <span className="ttt-dot">.</span>
          <span className="ttt-dot" style={{ animationDelay: ".15s" }}>.</span>
          <span className="ttt-dot" style={{ animationDelay: ".3s" }}>.</span>
        </span>
      </>
    );
  else caption = isYou ? "you" : " ";

  return (
    <div
      className={`relative flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl border px-2.5 py-2 ${right ? "flex-row-reverse text-right" : ""} ${
        p.connected ? "" : "opacity-60"
      }`}
      style={{
        borderColor: active || won ? p.color : "var(--color-line)",
        background: active || won ? `${p.color}17` : "var(--color-panel)",
        transition: `border-color .3s ${EASE}, background-color .3s ${EASE}, opacity .3s`,
      }}
      aria-current={active ? "true" : undefined}
    >
      {active && (
        <span
          aria-hidden
          className="ttt-glow pointer-events-none absolute -inset-px rounded-2xl"
          style={{ boxShadow: `0 0 0 1px ${p.color}, 3px 4px 0 color-mix(in oklab, ${p.color} 45%, #000)` }}
        />
      )}
      <span
        aria-hidden
        className="relative grid size-10 shrink-0 place-items-center rounded-xl text-2xl leading-none"
        style={{ background: `${p.color}22` }}
      >
        <Avatar id={p.avatar} />
        {won && <span className="ttt-crown absolute -top-3 text-lg">👑</span>}
        <span
          className={`absolute -bottom-1 grid size-5 place-items-center rounded-full border border-line bg-ink p-[3px] ${right ? "-left-1" : "-right-1"}`}
        >
          <MarkShape mark={seat} color={p.color} width={16} />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold" style={{ color: p.color }}>
          {p.name}
          <span className="sr-only"> plays {NAME[seat]}</span>
        </span>
        <span className="block truncate text-xs font-medium whitespace-pre text-muted">{caption}</span>
      </span>
      <span className={`flex shrink-0 flex-col gap-1 ${right ? "items-start" : "items-end"}`}>
        <span key={score} className={`font-display text-2xl leading-none font-extrabold tabular-nums ${score ? "ttt-pop" : ""}`}>
          {score}
          <span className="sr-only"> rounds won</span>
        </span>
        <span aria-hidden className={`flex gap-1 ${right ? "flex-row-reverse" : ""}`}>
          {Array.from({ length: view.target }, (_, i) => (
            <span
              key={i}
              className="size-1.5 rounded-full"
              style={{
                background: i < score ? p.color : "var(--color-line)",
                transition: `background-color .3s ${EASE}`,
              }}
            />
          ))}
        </span>
      </span>
    </div>
  );
}

function ForfeitNote({
  away,
  stays,
  forfeitAt,
  serverNow,
}: {
  away: Player;
  stays: Player | undefined;
  forfeitAt: number;
  serverNow: () => number;
}) {
  const secs = useSecondsLeft(forfeitAt, serverNow);
  return (
    <p role="status" className="card animate-rise border-amber-400/50 px-3 py-2 text-center text-sm">
      <span aria-hidden>📡 </span>
      <b style={{ color: away.color }}>{away.name}</b> disconnected.{" "}
      {stays?.connected ? (
        <>
          If they&apos;re not back in <b className="tabular-nums">{secs}s</b>, <b style={{ color: stays.color }}>{stays.name}</b> wins.
        </>
      ) : (
        <>
          The match ends in <b className="tabular-nums">{secs}s</b>.
        </>
      )}
    </p>
  );
}

// ---------- the board ----------

const centre = (i: number): [number, number] => [(i % 3) * 100 + 50, Math.floor(i / 3) * 100 + 50];

function Board({
  view,
  seats,
  myTurn,
  onPlace,
}: {
  view: TttView;
  seats: readonly Player[];
  myTurn: boolean;
  onPlace: (cell: number) => void;
}) {
  const end = view.roundEnd;
  const line = end?.line ?? null;
  const winColor = end && end.winner !== null ? seats[end.winner].color : null;
  const ghostColor = view.you !== null ? seats[view.you].color : "#fff";

  let sweep: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (line) {
    const [ax, ay] = centre(line[0]);
    const [bx, by] = centre(line[2]);
    const len = Math.hypot(bx - ax, by - ay);
    const ex = ((bx - ax) / len) * 34;
    const ey = ((by - ay) / len) * 34;
    sweep = { x1: ax - ex, y1: ay - ey, x2: bx + ex, y2: by + ey };
  }

  return (
    <div
      className="card relative mx-auto aspect-square w-full p-2 sm:p-3"
      style={{
        maxWidth: "min(100%, 60vh)",
        borderColor: myTurn ? seats[view.turn].color : undefined,
        boxShadow: myTurn ? `0 0 0 1px ${seats[view.turn].color}, 5px 6px 0 color-mix(in oklab, ${seats[view.turn].color} 40%, #000)` : undefined,
        transition: `border-color .3s ${EASE}, box-shadow .3s ${EASE}`,
      }}
    >
      {/* A fresh board (new key) every round: the grid redraws and the cells settle in. */}
      <div key={view.round} className="ttt-in relative size-full">
        <svg viewBox="0 0 300 300" className="pointer-events-none absolute inset-0 size-full" aria-hidden>
          {[
            [100, 10, 100, 290],
            [200, 10, 200, 290],
            [10, 100, 290, 100],
            [10, 200, 290, 200],
          ].map(([x1, y1, x2, y2], i) => (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#433b6e"
              strokeWidth={5}
              strokeLinecap="round"
              pathLength={1}
              className="ttt-grid"
              style={{ animationDelay: `${i * 70}ms` }}
            />
          ))}
        </svg>

        <div className="absolute inset-0 grid grid-cols-3 grid-rows-3" role="group" aria-label={`Board, round ${view.round}`}>
          {view.board.map((cell, i) => {
            const playable = myTurn && cell === null;
            const dim = cell !== null && !!end && (line ? !line.includes(i) : true);
            return (
              <button
                key={i}
                type="button"
                aria-label={`Cell ${i + 1}, ${cell === null ? "empty" : NAME[cell]}`}
                aria-keyshortcuts={playable ? String(i + 1) : undefined}
                disabled={!playable}
                onClick={() => onPlace(i)}
                className={`group relative m-1 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-text/70 sm:m-1.5 ${
                  playable ? "cursor-pointer hover:bg-white/[0.04] active:scale-95" : "cursor-default"
                }`}
                style={{ transition: `background-color .15s, transform .1s ${EASE}` }}
              >
                {cell !== null ? (
                  <span className={`ttt-fade absolute inset-[14%] block ${dim ? "opacity-30" : "opacity-100"}`}>
                    <MarkShape mark={cell} color={seats[cell].color} draw />
                  </span>
                ) : playable ? (
                  <span className="absolute inset-[14%] block opacity-0 transition-opacity duration-150 group-hover:opacity-25 group-focus-visible:opacity-25">
                    <MarkShape mark={view.you!} color={ghostColor} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {sweep && winColor && (
          <svg viewBox="0 0 300 300" className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
            <line {...sweep} stroke={winColor} strokeOpacity={0.25} strokeWidth={26} strokeLinecap="round" pathLength={1} className="ttt-sweep" />
            <line {...sweep} stroke={winColor} strokeWidth={9} strokeLinecap="round" pathLength={1} className="ttt-sweep" />
          </svg>
        )}
      </div>
    </div>
  );
}

// ---------- rounds ----------

function RoundChip({ winner, seats, big }: { winner: Mark | null; seats: readonly Player[]; big?: boolean }) {
  const p = winner === null ? null : seats[winner];
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full border ${big ? "size-8 p-1.5" : "size-6 p-1"}`}
      style={p ? { borderColor: `${p.color}99`, background: `${p.color}22` } : { borderColor: "var(--color-line)", borderStyle: "dashed" }}
    >
      {p ? <MarkShape mark={winner!} color={p.color} width={16} /> : <span className="text-xs leading-none font-bold text-muted">–</span>}
    </span>
  );
}

function History({ view, seats, big }: { view: TttView; seats: readonly Player[]; big?: boolean }) {
  return (
    <ol className="flex flex-wrap items-center justify-center gap-1.5" aria-label="Round results">
      {view.history.map((w, i) => (
        <li key={i} className={i === view.history.length - 1 && !big ? "animate-pop" : undefined}>
          <RoundChip winner={w} seats={seats} big={big} />
          <span className="sr-only">
            Round {i + 1}: {w === null ? "draw" : `${seats[w].name}`}
          </span>
        </li>
      ))}
    </ol>
  );
}

function RoundStrip({ view, seats, serverNow }: { view: TttView; seats: readonly Player[]; serverNow: () => number }) {
  const end = view.roundEnd;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-6 items-center justify-between gap-2 text-xs text-muted">
        <span className="shrink-0 font-semibold">
          Round {view.round} · first to {view.target}
        </span>
        <History view={view} seats={seats} />
      </div>
      {!end && !view.over && view.moveEndsAt > 0 && view.forfeitAt === null && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="shrink-0">Move timer</span>
          <div className="flex-1">
            <TimerBar endsAt={view.moveEndsAt} total={view.moveMs} serverNow={serverNow} color={seats[view.turn].color} />
          </div>
        </div>
      )}
      {end && (
        <div className="animate-rise flex items-center gap-2 text-xs text-muted">
          <span className="shrink-0">Next round</span>
          <div className="flex-1">
            <TimerBar
              endsAt={end.nextAt}
              total={view.pauseMs}
              serverNow={serverNow}
              color={end.winner !== null ? seats[end.winner].color : "var(--color-muted)"}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Final({ view, seats }: { view: TttView; seats: readonly Player[] }) {
  const w = view.winner;
  const p = w === null ? null : seats[w];
  return (
    <section className="card ttt-in flex flex-col items-center gap-3 p-4 text-center" aria-label="Match result" style={p ? ({ borderColor: `${p.color}80` } as CSSProperties) : undefined}>
      <span className="label">Match over</span>
      {p && w !== null ? (
        <div className="flex items-center gap-3">
          <span aria-hidden className="ttt-pop relative text-4xl leading-none">
            <Avatar id={p.avatar} />
            <span className="ttt-crown absolute -top-4 left-1/2 -ml-2.5 text-xl">👑</span>
          </span>
          <span className="text-left">
            <span className="block font-display text-xl font-extrabold" style={{ color: p.color }}>
              {p.name}
            </span>
            <span className="block text-sm text-muted">
              {view.forfeit ? (
                <>wins by forfeit · {seats[1 - w].name} left</>
              ) : (
                <>
                  wins{" "}
                  <b className="font-mono text-text tabular-nums">
                    {view.score[w]}–{view.score[1 - w]}
                  </b>
                </>
              )}
            </span>
          </span>
        </div>
      ) : (
        <p className="text-sm text-muted">Both players left before the match finished.</p>
      )}
      {view.history.length > 0 && (
        <>
          <History view={view} seats={seats} big />
          <span className="text-xs text-muted">
            {view.history.length} round{view.history.length === 1 ? "" : "s"} played
            {view.forfeit && w !== null ? ` · it was ${view.score[w]}–${view.score[1 - w]}` : ""}
          </span>
        </>
      )}
    </section>
  );
}

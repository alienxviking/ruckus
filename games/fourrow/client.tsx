"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { Note, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import type { FourAction, FourView, HoverEvent, Seat } from "./server";
import { COLS } from "./shared";
import { BOARD_CSS, Board, DiscSwatch, discPalette, type BoardPreview } from "./board";

type Props = GameClientProps<FourView, FourAction>;

export default function FourInARow(props: Props) {
  return (
    <>
      <style href="ruckus-fourrow" precedence="default">
        {BOARD_CSS}
      </style>
      {props.view ? <Match {...props} view={props.view} /> : <Note>Setting up the board…</Note>}
    </>
  );
}

const SEATS: Seat[] = [0, 1];
const otherSeat = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

function isHoverEvent(e: unknown): e is HoverEvent {
  if (typeof e !== "object" || e === null) return false;
  const h = e as Record<string, unknown>;
  return (
    h.type === "hover" &&
    (h.seat === 0 || h.seat === 1) &&
    typeof h.seq === "number" &&
    (h.col === null || (typeof h.col === "number" && Number.isInteger(h.col) && h.col >= 0 && h.col < COLS))
  );
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function fallbackPlayer(id: string, seat: Seat): Player {
  return { id, name: `Player ${seat + 1}`, color: seat === 0 ? "#ff5d73" : "#ffe14d", avatar: "🙂", connected: false };
}

function Match({ view, byId, isPlayer, act, serverNow, onEvent, accent }: Props & { view: FourView }) {
  const [hover, setHover] = useState<number | null>(null);
  const [remote, setRemote] = useState<HoverEvent | null>(null);

  const you = isPlayer ? view.you : null;
  const people = SEATS.map((seat) => byId[view.seats[seat]] ?? fallbackPlayer(view.seats[seat], seat)) as [
    Player,
    Player,
  ];
  const colors = discPalette(people[0].color, people[1].color);
  const name = (seat: Seat) => (seat === you ? "You" : people[seat].name);
  const playing = view.phase === "turn";
  const myTurn = playing && you !== null && view.turn === you;
  const away = (seat: Seat) => view.forfeitAt[seat] !== null;
  // Both players gone: the server freezes the turn (nobody is waiting) until someone returns.
  const frozen = playing && away(0) && away(1);
  const lastGame = view.results.length ? view.results[view.results.length - 1] : undefined;

  // Where the mover is pointing: our own hover, or the opponent's (relayed by the server).
  const hoverCol = myTurn && hover !== null && view.board[0][hover] === null ? hover : null;
  let preview: BoardPreview | null = null;
  if (myTurn && hoverCol !== null) {
    preview = { col: hoverCol, seat: you, mine: true };
  } else if (
    playing &&
    !myTurn &&
    !away(view.turn) &&
    remote &&
    remote.seq === view.seq &&
    remote.seat === view.turn &&
    remote.col !== null &&
    view.board[0][remote.col] === null
  ) {
    preview = { col: remote.col, seat: remote.seat, mine: false };
  }

  useEffect(
    () =>
      onEvent((e) => {
        if (isHoverEvent(e)) setRemote(e);
      }),
    [onEvent],
  );

  // Share where we're pointing so the opponent and spectators see our disc hover.
  useEffect(() => {
    if (myTurn) act({ type: "hover", col: hoverCol });
  }, [myTurn, hoverCol, act]);

  // Keys 1-7 drop straight into that column (ignored while typing, e.g. in chat).
  const board = view.board;
  useEffect(() => {
    if (!myTurn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (!/^[1-9]$/.test(e.key)) return;
      const col = Number(e.key) - 1;
      if (col >= COLS || board[0][col] !== null) return;
      e.preventDefault();
      act({ type: "drop", col });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [myTurn, board, act]);

  const onHover = (col: number | null) => setHover(col);
  const onDrop = (col: number) => {
    if (myTurn && view.board[0][col] === null) act({ type: "drop", col });
  };

  // ---------- words ----------
  const last = view.last;
  const lastMoveText = last
    ? last.auto
      ? `Time's up: ${last.seat === you ? "your" : `${people[last.seat].name}'s`} disc went in column ${last.col + 1}`
      : `${name(last.seat)} dropped in column ${last.col + 1}`
    : "";

  let headline: ReactNode;
  let sub: ReactNode;
  let said: string; // plain text for the screen-reader announcement
  let statusKey: string;
  // A disconnected player (other than the viewer) and their forfeit countdown.
  const gone = SEATS.find((seat) => seat !== you && away(seat) && !(playing && seat === view.turn));
  const goneNote =
    gone === undefined ? null : (
      <>
        {people[gone].name} is away · <ForfeitIn at={view.forfeitAt[gone]!} serverNow={serverNow} />
      </>
    );
  if (view.phase === "turn") {
    const mover = people[view.turn].name;
    statusKey = `turn-${view.seq}`;
    if (frozen) {
      headline = <>Both players are away</>;
      sub = (
        <>
          Paused until someone returns · <AbandonIn at={Math.max(view.forfeitAt[0]!, view.forfeitAt[1]!)} serverNow={serverNow} />
        </>
      );
      said = "Both players are away. The game is paused until someone returns.";
      statusKey = `frozen-${view.seq}`;
    } else if (myTurn) {
      headline = (
        <span className="inline-flex items-center gap-2">
          <DiscSwatch seat={view.turn} color={colors[view.turn]} size={22} /> Your move
        </span>
      );
      sub = goneNote ?? (
        <>
          <span className="[@media(pointer:fine)]:hidden">Tap a column to drop your disc</span>
          <span className="hidden [@media(pointer:fine)]:inline">Click a column or press 1–{COLS}</span>
        </>
      );
      said = "Your move.";
    } else if (away(view.turn)) {
      headline = <>{mover} is away</>;
      sub = (
        <>
          Auto-drop in <Seconds endsAt={view.endsAt} serverNow={serverNow} /> ·{" "}
          <ForfeitIn at={view.forfeitAt[view.turn]!} serverNow={serverNow} />
        </>
      );
      said = `${mover} is away.`;
    } else {
      headline = (
        <span className="inline-flex max-w-full items-center gap-2">
          <DiscSwatch seat={view.turn} color={colors[view.turn]} size={22} />
          <span className="truncate">{you === null ? `${mover}'s move` : `${mover} is thinking…`}</span>
        </span>
      );
      sub = goneNote ?? (you === null ? "Watching live" : "Wait for your turn");
      said = `${mover} to move.`;
    }
  } else if (view.phase === "between") {
    statusKey = `between-${view.game}`;
    if (lastGame === null || lastGame === undefined) said = "Draw! The board is full";
    else if (lastGame === you) said = `You win game ${view.game}!`;
    else said = `${people[lastGame].name} wins game ${view.game}`;
    headline = lastGame !== null && lastGame === you ? <>{said} 🎉</> : said;
    const next = otherSeat(view.starter);
    sub = (
      <>
        Game {view.game + 1} in <Seconds endsAt={view.endsAt} serverNow={serverNow} /> ·{" "}
        {gone !== undefined ? (
          <>{people[gone].name} is away</>
        ) : (
          <>
            {name(next)} {next === you ? "go" : "goes"} first
          </>
        )}
      </>
    );
  } else {
    statusKey = "over";
    const champ = view.champions?.length === 1 ? view.champions[0] : null;
    if (view.ending === "abandoned") said = "Match abandoned";
    else if (view.ending === "short") said = "Not enough players";
    else if (champ === null) said = "It's a tie!";
    else if (champ === you) said = "You win the match!";
    else said = `${people[champ].name} wins the match`;
    headline = champ !== null && champ === you ? <>{said} 🏆</> : said;
    const subText =
      view.ending === "forfeit" && view.quitter !== null
        ? `${people[view.quitter].name} left the game`
        : view.ending === "abandoned"
          ? "Both players left"
          : view.ending === "cap"
            ? `Stopped after ${view.maxGames} games`
            : `Final score ${Math.max(...view.score)}–${Math.min(...view.score)}`;
    sub = subText;
    said = `Match over. ${said}. ${subText}.`;
  }
  const announce = view.phase === "turn" && lastMoveText ? `${lastMoveText}. ${said}` : said;

  const discCount = view.board.reduce((n, row) => n + row.filter((d) => d !== null).length, 0);
  const boardLabel =
    `Board for game ${view.game} with ${discCount} discs. ${people[0].name} plays ring discs, ` +
    `${people[1].name} plays star discs.` +
    (lastMoveText ? ` ${lastMoveText}.` : "");

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announce}
      </p>

      <StatusBanner accent={myTurn ? colors[view.turn] : accent} key={statusKey}>
        <div className="truncate">{headline}</div>
        <div className="mt-0.5 truncate font-sans text-xs font-normal text-muted sm:text-sm">{sub}</div>
      </StatusBanner>

      {you === null && (
        <p className="mx-auto flex w-fit max-w-full items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted">
          <span aria-hidden>👀</span>
          <span className="truncate">
            Spectating · {people[0].name} vs {people[1].name}
          </span>
        </p>
      )}

      {view.phase === "over" ? (
        <Standings view={view} people={people} colors={colors} you={you} />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {SEATS.map((seat) => (
            <SeatCard
              key={seat}
              seat={seat}
              player={people[seat]}
              color={colors[seat]}
              score={view.score[seat]}
              target={view.target}
              isYou={seat === you}
              active={playing && view.turn === seat}
              away={away(seat)}
              gameWinner={view.phase === "between" && lastGame === seat ? view.game : null}
            />
          ))}
        </div>
      )}

      {/* Fixed-height timer row so the board never jumps */}
      {view.phase !== "over" && (
        <div className="flex h-4 items-center gap-2">
          {frozen ? (
            <>
              <div className="h-2 flex-1 rounded-full bg-panel-2" aria-hidden />
              <span className="w-8 text-right text-xs text-muted" aria-hidden>
                ⏸
              </span>
            </>
          ) : view.phase === "turn" ? (
            <>
              <div className="flex-1">
                <TimerBar endsAt={view.endsAt} total={view.timerMs} serverNow={serverNow} color={colors[view.turn]} />
              </div>
              <Seconds endsAt={view.endsAt} serverNow={serverNow} urgent={myTurn} className="w-8 text-right text-xs" />
            </>
          ) : (
            <div className="flex-1 opacity-60">
              <TimerBar endsAt={view.endsAt} total={view.timerMs} serverNow={serverNow} color="var(--color-muted)" />
            </div>
          )}
        </div>
      )}

      <Board
        board={view.board}
        game={view.game}
        colors={colors}
        last={last}
        win={view.phase === "turn" ? null : view.win}
        preview={preview}
        glow={playing ? colors[view.turn] : null}
        compact={view.phase === "over"}
        buttons={you !== null && view.phase !== "over"}
        canDrop={myTurn}
        onHover={onHover}
        onDrop={onDrop}
        label={boardLabel}
      />

      <div className="flex flex-col items-center gap-2 text-xs text-muted">
        {view.phase === "turn" && (
          <p className="flex min-h-4 items-center gap-1.5 text-center" aria-hidden>
            {last ? (
              <>
                <DiscSwatch seat={last.seat} color={colors[last.seat]} size={12} />
                {lastMoveText}
              </>
            ) : (
              <>
                {name(view.turn)} {view.turn === you ? "start" : "starts"} game {view.game}
              </>
            )}
          </p>
        )}
        {view.phase !== "over" && <GameHistory view={view} people={people} colors={colors} you={you} />}
        <p className="text-center">
          First to {view.target} wins · draws don&apos;t count · max {view.maxGames} games
        </p>
      </div>
    </div>
  );
}

function Seconds({
  endsAt,
  serverNow,
  urgent,
  className = "",
}: {
  endsAt: number;
  serverNow: () => number;
  urgent?: boolean;
  className?: string;
}) {
  const s = useSecondsLeft(endsAt, serverNow);
  const hot = urgent && s <= 5;
  return (
    <span className={`font-mono tabular-nums ${hot ? "fr-urgent font-bold text-brand" : ""} ${className}`}>{s}s</span>
  );
}

function ForfeitIn({ at, serverNow }: { at: number; serverNow: () => number }) {
  const s = useSecondsLeft(at, serverNow);
  return <>forfeits in {s}s</>;
}

function AbandonIn({ at, serverNow }: { at: number; serverNow: () => number }) {
  const s = useSecondsLeft(at, serverNow);
  return <>ends in {s}s</>;
}

function SeatCard({
  seat,
  player,
  color,
  score,
  target,
  isYou,
  active,
  away,
  gameWinner,
}: {
  seat: Seat;
  player: Player;
  color: string;
  score: number;
  target: number;
  isYou: boolean;
  active: boolean;
  /** Disconnected (the banner shows the forfeit countdown). */
  away: boolean;
  /** Game number this seat just won (shown during the pause), or null. */
  gameWinner: number | null;
}) {
  const mirror = seat === 1;
  const lit = active || gameWinner !== null;
  return (
    <div
      className={`card relative flex min-w-0 items-center gap-2 px-2.5 py-2 transition-[border-color,box-shadow,opacity] duration-300 sm:gap-3 sm:px-3 ${
        mirror ? "flex-row-reverse text-right" : ""
      } ${away ? "opacity-60" : ""} ${isYou ? "bg-panel-2" : ""}`}
      style={lit ? { borderColor: color, boxShadow: `0 0 0 1px ${color}66, 0 8px 26px -14px ${color}` } : undefined}
    >
      {isYou && (
        <span
          className={`absolute -top-2 rounded-full border border-line bg-ink px-1.5 text-[9px] leading-[14px] font-bold tracking-wider text-muted uppercase ${
            mirror ? "right-3" : "left-3"
          }`}
        >
          you
        </span>
      )}
      <div key={lit ? "lit" : "idle"} className={lit ? "fr-swap" : undefined}>
        <DiscSwatch seat={seat} color={color} size={28} />
      </div>
      <div className="min-w-0 flex-1">
        <div className={`flex min-w-0 items-center gap-1 ${mirror ? "flex-row-reverse" : ""}`}>
          <span aria-hidden>{player.avatar}</span>
          <span className="truncate text-sm font-semibold" style={{ color: player.color }}>
            {player.name}
          </span>
        </div>
        <div className="truncate text-[11px] leading-4 text-muted">
          {away ? (
            <>
              <span aria-hidden>📴 </span>away
            </>
          ) : active ? (
            <span className="font-semibold" style={{ color }}>
              {isYou ? "your move" : "to move"}
            </span>
          ) : gameWinner !== null ? (
            <span className="font-semibold" style={{ color }}>
              won game {gameWinner}
            </span>
          ) : (
            "waiting"
          )}
        </div>
      </div>
      <div className="flex flex-col items-center" aria-label={`${score} of ${target} wins`}>
        <span key={score} className="animate-pop font-mono text-2xl leading-7 font-bold tabular-nums">
          {score}
        </span>
        <span className="flex gap-0.5" aria-hidden>
          {Array.from({ length: target }, (_, i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: i < score ? color : "var(--color-line)" }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

function GameHistory({
  view,
  people,
  colors,
  you,
}: {
  view: FourView;
  people: [Player, Player];
  colors: [string, string];
  you: Seat | null;
}) {
  const total = view.phase === "over" ? view.results.length : Math.max(view.results.length, view.game);
  return (
    <ol className="flex flex-wrap items-center justify-center gap-1.5" aria-label="Games so far">
      {Array.from({ length: total }, (_, i) => {
        const done = i < view.results.length;
        const winner = done ? view.results[i] : null;
        return (
          <li
            key={i}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
              done ? "border-line bg-panel" : "border-dashed border-line"
            }`}
          >
            <span className="font-semibold text-text/80">G{i + 1}</span>
            {!done ? (
              <span>now</span>
            ) : winner === null ? (
              <span>draw</span>
            ) : (
              <>
                <DiscSwatch seat={winner} color={colors[winner]} size={11} />
                <span className="max-w-[6rem] truncate">{winner === you ? "you" : people[winner].name}</span>
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Standings({
  view,
  people,
  colors,
  you,
}: {
  view: FourView;
  people: [Player, Player];
  colors: [string, string];
  you: Seat | null;
}) {
  const champs = view.champions ?? [];
  const isChamp = (seat: Seat) => (champs.includes(seat) ? 1 : 0);
  // Winners first (a forfeit can crown the player with fewer wins), then by wins.
  const order = [...SEATS].sort((a, b) => isChamp(b) - isChamp(a) || view.score[b] - view.score[a] || a - b);
  const record = (seat: Seat) => {
    const w = view.results.filter((r) => r === seat).length;
    const l = view.results.filter((r) => r !== null && r !== seat).length;
    const d = view.results.filter((r) => r === null).length;
    return `${w}W · ${l}L${d ? ` · ${d}D` : ""}`;
  };
  return (
    <section className="card animate-rise p-3" aria-label="Final standings">
      <div className="label mb-2">Final standings</div>
      <ol className="space-y-1.5">
        {order.map((seat, i) => {
          const champ = isChamp(seat) === 1;
          return (
            <li
              key={seat}
              className="flex items-center gap-2 rounded-xl px-2 py-1.5"
              style={
                champ ? { background: `${colors[seat]}1c`, boxShadow: `inset 0 0 0 1px ${colors[seat]}55` } : undefined
              }
            >
              <span className="w-5 shrink-0 text-center text-sm font-bold text-muted">
                {champ ? <span aria-label="Winner">🏆</span> : i + 1}
              </span>
              <DiscSwatch seat={seat} color={colors[seat]} size={22} />
              <span aria-hidden>{people[seat].avatar}</span>
              <span className="min-w-0 flex-1 truncate font-semibold" style={{ color: people[seat].color }}>
                {people[seat].name}
                {seat === you && <span className="ml-1 text-xs font-normal text-muted">(you)</span>}
              </span>
              {view.results.length > 0 && (
                <span className="hidden shrink-0 text-xs text-muted min-[380px]:inline">{record(seat)}</span>
              )}
              <span className="w-8 shrink-0 text-right font-mono text-xl font-bold tabular-nums">
                {view.score[seat]}
              </span>
            </li>
          );
        })}
      </ol>
      {view.results.length > 0 && (
        <div className="mt-3 border-t border-line pt-2.5">
          <GameHistory view={view} people={people} colors={colors} you={you} />
        </div>
      )}
    </section>
  );
}

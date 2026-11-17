"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { Note, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import { Avatar } from "@/components/Avatar";
import { feedback, sfx } from "@/lib/feedback";
import type { FlipAction, FlipView, Seat } from "./server";
import { TURN_MS, cellName, countDiscs, legalMoves, otherSeat, parseBoard } from "./shared";
import { BOARD_CSS, Board, DiscSwatch, discPalette } from "./board";

type Props = GameClientProps<FlipView, FlipAction>;

export default function Flip(props: Props) {
  return (
    <>
      <style href="ruckus-flip" precedence="default">
        {BOARD_CSS}
      </style>
      {props.view ? <Match {...props} view={props.view} /> : <Note>Setting up the board…</Note>}
    </>
  );
}

const SEATS: Seat[] = [0, 1];

function fallbackPlayer(id: string, seat: Seat): Player {
  return { id, name: `Player ${seat + 1}`, color: seat === 0 ? "#f472b6" : "#38bdf8", avatar: "🙂", connected: false };
}

function Match({ view, byId, isPlayer, act, serverNow, accent }: Props & { view: FlipView }) {
  const [sent, setSent] = useState<number | null>(null); // seq our move was sent at
  const you = isPlayer ? view.you : null;
  const people = SEATS.map((seat) => byId[view.seats[seat]] ?? fallbackPlayer(view.seats[seat], seat)) as [Player, Player];
  const colors = discPalette(people[0].color, people[1].color);
  const name = (seat: Seat) => (seat === you ? "You" : people[seat].name);
  const board = useMemo(() => parseBoard(view.board), [view.board]);
  const counts = countDiscs(board);
  const playing = view.phase === "turn";
  const myTurn = playing && you !== null && view.turn === you;
  const away = (seat: Seat) => view.forfeitAt[seat] !== null;
  const frozen = playing && away(0) && away(1);
  const waiting = myTurn && sent === view.seq;
  const canPlay = myTurn && !waiting;
  const legal = useMemo(
    () => (myTurn ? legalMoves(board, view.size, view.turn) : []),
    [myTurn, board, view.size, view.turn],
  );
  const lastResult = view.results.length ? view.results[view.results.length - 1] : undefined;
  const lastFinal = view.finals.length ? view.finals[view.finals.length - 1] : null;

  // ----- sound cues -----
  useEffect(() => {
    if (myTurn) feedback("turn");
  }, [myTurn]);

  const seen = useRef(view.seq);
  const { seq, last, pass, phase } = view;
  useEffect(() => {
    if (seq === seen.current) return;
    seen.current = seq;
    if (!last) return;
    sfx("pop");
    if (last.flips.length >= 5) setTimeout(() => sfx("score"), 260);
    if (pass !== null) setTimeout(() => sfx("bump"), 520);
  }, [seq, last, pass]);

  useEffect(() => {
    if (phase === "between") sfx(lastResult === you && you !== null ? "score" : "end");
  }, [phase, lastResult, you]);

  useEffect(() => {
    if (sent === null) return;
    const id = setTimeout(() => setSent(null), 1500);
    return () => clearTimeout(id);
  }, [sent]);

  const onPlay = (cell: number) => {
    if (!canPlay) return;
    if (cell < 0) {
      sfx("error");
      return;
    }
    setSent(view.seq);
    act({ type: "place", cell });
  };

  // ----- words -----
  const lastText = last
    ? last.auto
      ? `Time's up: ${last.seat === you ? "you" : people[last.seat].name} auto-played ${cellName(last.cell, view.size)} (+${last.flips.length})`
      : `${name(last.seat)} played ${cellName(last.cell, view.size)} · flipped ${last.flips.length}`
    : "";
  const passText = pass !== null ? `${pass === you ? "You have" : `${people[pass].name} has`} no move — pass` : "";

  let headline: ReactNode;
  let sub: ReactNode;
  let said: string;
  let statusKey: string;
  const gone = SEATS.find((seat) => seat !== you && away(seat) && !(playing && seat === view.turn));
  const goneNote =
    gone === undefined ? null : (
      <>
        {people[gone].name} is away · <Countdown at={view.forfeitAt[gone]!} serverNow={serverNow} prefix="forfeits in " />
      </>
    );

  if (view.phase === "turn") {
    const mover = people[view.turn].name;
    statusKey = `turn-${view.seq}-${view.game}`;
    if (frozen) {
      headline = <>Both players are away</>;
      sub = (
        <>
          Paused until someone returns ·{" "}
          <Countdown at={Math.max(view.forfeitAt[0]!, view.forfeitAt[1]!)} serverNow={serverNow} prefix="ends in " />
        </>
      );
      said = "Both players are away. The game is paused.";
    } else if (myTurn) {
      headline = (
        <span className="inline-flex items-center gap-2">
          <DiscSwatch seat={view.turn} color={colors[view.turn]} size={22} />
          {pass !== null && pass !== you ? "They're stuck — go again!" : "Your move"}
        </span>
      );
      sub =
        goneNote ??
        (pass !== null && pass !== you ? (
          `${people[pass].name} has no legal move`
        ) : view.hints ? (
          <>
            Tap a glowing dot · {legal.length} {legal.length === 1 ? "move" : "moves"}
          </>
        ) : (
          "Trap a line of their discs between yours"
        ));
      said = pass !== null && pass !== you ? "Your opponent has no move. Go again." : "Your move.";
    } else if (away(view.turn)) {
      headline = <>{mover} is away</>;
      sub = (
        <>
          Auto-move in <Seconds endsAt={view.endsAt} serverNow={serverNow} /> ·{" "}
          <Countdown at={view.forfeitAt[view.turn]!} serverNow={serverNow} prefix="forfeits in " />
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
      sub = goneNote ?? (you !== null && pass === you ? "You have no legal move — passing" : you === null ? "Watching live" : "Wait for your turn");
      said = `${mover} to move.`;
    }
  } else if (view.phase === "between") {
    statusKey = `between-${view.game}`;
    const f = lastFinal ?? counts;
    if (lastResult === null || lastResult === undefined) said = `Game ${view.game} is a draw, ${f[0]}–${f[1]}`;
    else if (lastResult === you) said = `You win game ${view.game}, ${f[you]}–${f[otherSeat(you)]}!`;
    else said = `${people[lastResult].name} wins game ${view.game}, ${f[lastResult]}–${f[otherSeat(lastResult)]}`;
    headline = lastResult !== null && lastResult === you ? <>{said} 🎉</> : said;
    const next = otherSeat(view.starter);
    sub = (
      <>
        Game {view.game + 1} in <Seconds endsAt={view.endsAt} serverNow={serverNow} /> · {name(next)}{" "}
        {next === you ? "go" : "goes"} first
      </>
    );
  } else {
    statusKey = "over";
    const champ = view.champions?.length === 1 ? view.champions[0] : null;
    if (view.ending === "abandoned") said = "Game abandoned";
    else if (view.ending === "short") said = "Not enough players";
    else if (champ === null) said = "It's a draw!";
    else if (champ === you) said = view.target > 1 ? "You win the match!" : "You win!";
    else said = `${people[champ].name} wins${view.target > 1 ? " the match" : ""}`;
    headline = champ !== null && champ === you ? <>{said} 🏆</> : said;
    const f = lastFinal ?? counts;
    const subText =
      view.ending === "forfeit" && view.quitter !== null
        ? `${people[view.quitter].name} left the game`
        : view.ending === "abandoned"
          ? "Both players left"
          : view.target > 1
            ? `Games ${Math.max(...view.score)}–${Math.min(...view.score)}${view.ending === "cap" ? ` after ${view.maxGames}` : ""}`
            : `Final board ${Math.max(f[0], f[1])}–${Math.min(f[0], f[1])}`;
    sub = subText;
    said = `${said}. ${subText}.`;
  }

  const total = view.size * view.size;
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {playing && lastText ? `${lastText}. ${passText ? passText + ". " : ""}${said}` : said}
      </p>

      <StatusBanner accent={myTurn ? colors[view.turn] : accent}>
        <div key={statusKey} className="fl-status">
          <div className="truncate">{headline}</div>
          <div className="mt-0.5 truncate font-sans text-xs font-normal text-muted sm:text-sm">{sub}</div>
        </div>
      </StatusBanner>

      {you === null && (
        <p className="mx-auto flex w-fit max-w-full items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted">
          <span aria-hidden>👀</span>
          <span className="truncate">
            Spectating · {people[0].name} vs {people[1].name}
          </span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        {SEATS.map((seat) => (
          <SeatCard
            key={seat}
            seat={seat}
            player={people[seat]}
            color={colors[seat]}
            discs={counts[seat]}
            wins={view.score[seat]}
            target={view.target}
            isYou={seat === you}
            active={playing && view.turn === seat}
            passed={playing && pass === seat}
            away={away(seat)}
            champ={view.phase === "over" && (view.champions ?? []).length === 1 && view.champions![0] === seat}
          />
        ))}
      </div>

      {/* Tug-of-war bar: share of the board each colour holds. */}
      <div className="-mt-1 flex h-1 overflow-hidden rounded-full bg-panel-2" aria-hidden>
        <div className="fl-bar" style={{ flexGrow: counts[0], flexBasis: 0, background: colors[0] }} />
        <div className="fl-bar" style={{ flexGrow: total - counts[0] - counts[1], flexBasis: 0 }} />
        <div className="fl-bar" style={{ flexGrow: counts[1], flexBasis: 0, background: colors[1] }} />
      </div>

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
        board={board}
        size={view.size}
        game={view.game}
        seq={view.seq}
        colors={colors}
        last={view.last}
        mover={playing ? view.turn : null}
        legal={legal}
        showHints={view.hints}
        canPlay={canPlay}
        glow={playing && !frozen ? colors[view.turn] : view.phase === "over" ? accent : null}
        dimLoser={view.phase === "turn" || lastResult === undefined || lastResult === null ? null : otherSeat(lastResult)}
        onPlay={onPlay}
        label={`Board ${view.size} by ${view.size}. ${people[0].name} ${counts[0]} ring discs, ${people[1].name} ${counts[1]} diamond discs.`}
      />

      <div className="flex flex-col items-center gap-2 text-xs text-muted">
        {view.phase === "turn" && (
          <p className="flex min-h-4 flex-wrap items-center justify-center gap-x-1.5 text-center" aria-hidden>
            {last ? (
              <>
                <DiscSwatch seat={last.seat} color={colors[last.seat]} size={12} />
                {lastText}
                {passText && <span className="font-semibold text-text"> · {passText}</span>}
              </>
            ) : (
              <>
                {name(view.turn)} {view.turn === you ? "start" : "starts"}
                {view.target > 1 ? ` game ${view.game}` : ""}
              </>
            )}
          </p>
        )}
        {view.target > 1 && <GameHistory view={view} people={people} colors={colors} you={you} />}
        <p className="text-center">
          Most discs wins · {TURN_MS / 1000}s per move
          {view.target > 1 ? ` · first to ${view.target} games` : ""}
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
  return <span className={`font-mono tabular-nums ${hot ? "fl-urgent font-bold text-brand" : ""} ${className}`}>{s}s</span>;
}

function Countdown({ at, serverNow, prefix }: { at: number; serverNow: () => number; prefix: string }) {
  const s = useSecondsLeft(at, serverNow);
  return (
    <>
      {prefix}
      {s}s
    </>
  );
}

function SeatCard({
  seat,
  player,
  color,
  discs,
  wins,
  target,
  isYou,
  active,
  passed,
  away,
  champ,
}: {
  seat: Seat;
  player: Player;
  color: string;
  discs: number;
  wins: number;
  target: number;
  isYou: boolean;
  active: boolean;
  passed: boolean;
  away: boolean;
  champ: boolean;
}) {
  const mirror = seat === 1;
  const lit = active || champ;
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
      <DiscSwatch seat={seat} color={color} size={26} />
      <div className="min-w-0 flex-1">
        <div className={`flex min-w-0 items-center gap-1 ${mirror ? "flex-row-reverse" : ""}`}>
          <span aria-hidden>
            <Avatar id={player.avatar} />
          </span>
          <span className="truncate text-sm font-semibold" style={{ color: player.color }}>
            {player.name}
          </span>
        </div>
        <div className="truncate text-[11px] leading-4 text-muted">
          {away ? (
            <>
              <span aria-hidden>📴 </span>away
            </>
          ) : champ ? (
            <span className="font-semibold" style={{ color }}>
              winner
            </span>
          ) : active ? (
            <span className="font-semibold" style={{ color }}>
              {isYou ? "your move" : "to move"}
            </span>
          ) : passed ? (
            "no move · pass"
          ) : (
            "waiting"
          )}
        </div>
      </div>
      <div className="flex flex-col items-center" aria-label={`${discs} discs`}>
        <span key={discs} className="animate-pop font-mono text-2xl leading-7 font-bold tabular-nums">
          {discs}
        </span>
        {target > 1 ? (
          <span className="flex gap-0.5" aria-label={`${wins} of ${target} game wins`}>
            {Array.from({ length: target }, (_, i) => (
              <span key={i} className="h-1.5 w-1.5 rounded-full" style={{ background: i < wins ? color : "var(--color-line)" }} />
            ))}
          </span>
        ) : (
          <span className="text-[9px] leading-3 tracking-wider text-muted uppercase">discs</span>
        )}
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
  view: FlipView;
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
        const f = view.finals[i];
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
              <span>draw {f ? `${f[0]}–${f[1]}` : ""}</span>
            ) : (
              <>
                <DiscSwatch seat={winner} color={colors[winner]} size={11} />
                <span className="max-w-[6rem] truncate">{winner === you ? "you" : people[winner].name}</span>
                {f && <span className="font-mono">{`${f[winner]}–${f[otherSeat(winner)]}`}</span>}
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}

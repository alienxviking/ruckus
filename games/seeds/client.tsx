"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { Note, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import { Avatar } from "@/components/Avatar";
import { feedback, sfx } from "@/lib/feedback";
import type { SeedsAction, SeedsView } from "./server";
import { HOP_MS, SETTLE_MS, STORE, legalPits, pitIndex, sow, type Seat } from "./shared";
import { BOARD_CSS, Board, SIDE, SideSwatch, type BoardProps, type Hint } from "./board";

type Props = GameClientProps<SeedsView, SeedsAction>;

export default function Seeds(props: Props) {
  return (
    <>
      <style href="ruckus-seeds" precedence="default">
        {BOARD_CSS}
      </style>
      {props.view ? <Match {...props} view={props.view} /> : <Note>Filling the pits…</Note>}
    </>
  );
}

const SEATS: Seat[] = [0, 1];

function fallbackPlayer(id: string, seat: Seat): Player {
  return { id, name: `Player ${seat + 1}`, color: SIDE[seat], avatar: "🙂", connected: false };
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

type Replay = Pick<BoardProps, "board" | "hand" | "flash" | "landed" | "callout"> & { busy: boolean };

/**
 * Replays the latest move seed by seed: the hand hops slot to slot, then any
 * capture flies to the store, then an end-of-game sweep. Joining mid-game (or a
 * fresh game) just shows the board as it is.
 */
function useReplay(view: SeedsView, you: Seat | null): Replay {
  const idle = (): Replay => ({ board: view.board, hand: null, flash: [], landed: null, callout: null, busy: false });
  const [rep, setRep] = useState<Replay & { seq: number; game: number }>(() => ({ ...idle(), seq: view.seq, game: view.game }));
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const { seq, game } = view;
  const latest = useRef(view);
  useEffect(() => {
    latest.current = view;
  });

  useEffect(() => {
    const { last, board } = latest.current;
    const clear = () => {
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    };
    // Same move as last time (just a timer/presence update), or a new game: no replay.
    if (seq === rep.seq && game === rep.game) return;
    clear();
    if (!last || seq !== rep.seq + 1 || game !== rep.game) {
      // A new game, or we missed moves (reconnect): just snap to the board.
      setRep({ board, hand: null, flash: [], landed: null, callout: null, busy: false, seq, game });
      return;
    }
    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    const mover = last.seat;
    const startSlot = pitIndex(mover, last.pit);
    const b = last.from.slice();
    b[startSlot] = 0;
    setRep({ board: b.slice(), hand: { slot: startSlot, n: last.path.length, seat: mover }, flash: [], landed: null, callout: null, busy: true, seq, game });
    sfx("pop");
    last.path.forEach((slot, k) => {
      at((k + 1) * HOP_MS, () => {
        b[slot] += 1;
        const left = last.path.length - k - 1;
        setRep((r) => ({ ...r, board: b.slice(), landed: slot, hand: left > 0 ? { slot, n: left, seat: mover } : null }));
        if (k % 2 === 0 || left === 0) sfx("bump");
      });
    });
    let t = last.path.length * HOP_MS + 150;
    let key = seq * 10;
    const mine = mover === you;
    if (last.capture) {
      const cap = last.capture;
      at(t, () => {
        setRep((r) => ({ ...r, flash: [cap.pit, cap.from], landed: null, callout: { slot: cap.from, text: `Capture +${cap.n}`, key: key++, color: SIDE[mover] } }));
        if (mine) feedback("score");
        else sfx("hit");
      });
      t += 500;
      at(t, () => {
        b[cap.pit] = 0;
        b[cap.from] = 0;
        b[STORE[mover]] += cap.n;
        setRep((r) => ({ ...r, board: b.slice(), flash: [STORE[mover]], landed: STORE[mover] }));
      });
    }
    if (last.extra) {
      at(t, () => {
        setRep((r) => ({ ...r, callout: { slot: STORE[mover], text: "Extra turn!", key: key++, color: SIDE[mover] }, flash: [STORE[mover]] }));
        if (mine) feedback("score");
        else sfx("pop");
      });
    }
    if (last.sweep) {
      const sweep = last.sweep;
      at(t + 200, () => {
        setRep((r) => ({
          ...r,
          board,
          flash: [STORE[0], STORE[1]],
          landed: null,
          callout: { slot: STORE[sweep[0] >= sweep[1] ? 0 : 1], text: "Rows swept!", key: key++, color: "#fff" },
        }));
        sfx("go");
      });
      t += 700;
    }
    at(t + SETTLE_MS - 150, () => setRep((r) => ({ ...r, board, hand: null, landed: null, busy: false })));
    return clear;
    // rep is read only to compare with the previous move; re-running on its change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq, game, you]);

  useEffect(
    () => () => {
      for (const t of timers.current) clearTimeout(t);
    },
    [],
  );

  // Between replays, always show the latest board.
  return rep.busy ? rep : { ...rep, board: view.board };
}

function Match({ view, byId, isPlayer, act, serverNow, accent }: Props & { view: SeedsView }) {
  const you = isPlayer ? view.you : null;
  const bottom: Seat = you ?? 0;
  const people = SEATS.map((seat) => byId[view.seats[seat]] ?? fallbackPlayer(view.seats[seat], seat)) as [Player, Player];
  const name = (seat: Seat) => (seat === you ? "You" : people[seat].name);
  const rep = useReplay(view, you);
  const [hover, setHover] = useState<number | null>(null);
  const [sent, setSent] = useState<number | null>(null);

  const playing = view.phase === "turn";
  const myTurn = playing && you !== null && view.turn === you;
  const away = (seat: Seat) => view.forfeitAt[seat] !== null;
  const frozen = playing && away(0) && away(1);
  const waiting = sent === view.seq;
  const canSow = myTurn && !rep.busy && !waiting;
  const legal = canSow ? legalPits(view.board, you) : [];

  // Chime when the move passes to us (after the replay finishes).
  const ready = myTurn && !rep.busy;
  useEffect(() => {
    if (ready) feedback("turn");
  }, [ready]);

  // Result cues: the room shows the final screen; we mark each finished game.
  const results = view.results.length;
  const lastWinner = results ? view.results[results - 1].winner : undefined;
  const settled = !rep.busy;
  const cued = useRef(results);
  useEffect(() => {
    if (!settled || results <= cued.current) return;
    cued.current = results;
    if (you === null) return;
    if (lastWinner === you) feedback("win");
    else feedback("end");
  }, [results, settled, lastWinner, you]);

  useEffect(() => {
    if (sent === null) return;
    const id = setTimeout(() => setSent(null), 1500);
    return () => clearTimeout(id);
  }, [sent]);

  const doSow = (n: number) => {
    if (!canSow || you === null) return;
    if (!legal.includes(n)) {
      sfx("error");
      return;
    }
    setSent(view.seq);
    setHover(null);
    act({ type: "sow", pit: n });
  };

  // Keys 1-6 sow that pit on your row (left to right).
  const keyRef = useRef(doSow);
  useEffect(() => {
    keyRef.current = doSow;
  });
  useEffect(() => {
    if (!canSow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (!/^[1-6]$/.test(e.key)) return;
      e.preventDefault();
      keyRef.current(Number(e.key) - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSow]);

  // Hover preview: where the last seed lands and what it does.
  let hint: Hint | null = null;
  if (canSow && hover !== null && legal.includes(hover)) {
    const r = sow(view.board, you, hover);
    const end = r.path[r.path.length - 1];
    hint = { slot: end, label: r.extra ? "Extra turn" : r.capture ? `Capture ${r.capture.n}` : null };
  }

  // ---------- words ----------
  const last = view.last;
  const lastText = last
    ? `${last.auto ? (last.seat === you ? "Time's up: your" : `Time's up: ${people[last.seat].name}'s`) : name(last.seat) === "You" ? "You sowed" : `${people[last.seat].name} sowed`}${
        last.auto ? ` pit ${last.pit + 1} was sown` : ` pit ${last.pit + 1}`
      }${last.capture ? ` · captured ${last.capture.n}` : ""}${last.extra ? " · extra turn" : ""}`
    : "";

  const gone = SEATS.find((seat) => seat !== you && away(seat) && !(playing && seat === view.turn));
  let headline: ReactNode;
  let sub: ReactNode;
  let statusKey: string;
  // Pause notices and forfeit / auto-sow countdowns get the loud amber sub-line.
  const alert = view.phase === "turn" && !rep.busy && (frozen || (myTurn ? gone !== undefined : away(view.turn)));
  if (view.phase === "turn") {
    statusKey = `turn-${view.seq}-${rep.busy}`;
    const mover = people[view.turn].name;
    const again = last?.extra && last.seat === view.turn;
    if (rep.busy) {
      headline = (
        <span className="inline-flex items-center gap-2">
          <SideSwatch seat={last?.seat ?? view.turn} size={18} /> Sowing…
        </span>
      );
      sub = lastText;
    } else if (frozen) {
      headline = "Both players are away";
      sub = "Paused until someone returns";
    } else if (myTurn) {
      headline = (
        <span className="inline-flex items-center gap-2">
          <SideSwatch seat={view.turn} size={20} /> {again ? "Extra turn! Go again" : "Your move"}
        </span>
      );
      sub = gone !== undefined ? (
        <>
          {people[gone].name} is away · <Countdown at={view.forfeitAt[gone]!} serverNow={serverNow} prefix="forfeits in " />
        </>
      ) : (
        <>
          <span className="[@media(pointer:fine)]:hidden">Tap a glowing pit to sow it</span>
          <span className="hidden [@media(pointer:fine)]:inline">Click a glowing pit or press 1–6</span>
        </>
      );
    } else if (away(view.turn)) {
      headline = `${mover} is away`;
      sub = (
        <>
          Auto-sow in <Countdown at={view.endsAt} serverNow={serverNow} /> ·{" "}
          <Countdown at={view.forfeitAt[view.turn]!} serverNow={serverNow} prefix="forfeits in " />
        </>
      );
    } else {
      headline = (
        <span className="inline-flex max-w-full items-center gap-2">
          <SideSwatch seat={view.turn} size={20} />
          <span className="truncate">
            {you === null ? `${mover}'s move` : again ? `${mover} goes again…` : `${mover} is thinking…`}
          </span>
        </span>
      );
      sub = you === null ? "Watching live" : "Wait for your turn";
    }
  } else if (view.phase === "between") {
    statusKey = `between-${view.game}-${rep.busy}`;
    const r = view.results[view.results.length - 1];
    if (rep.busy) {
      headline = "Last seeds falling…";
      sub = lastText;
    } else {
      headline =
        !r || r.winner === null ? `Game ${view.game} is a draw` : r.winner === you ? `You win game ${view.game}! 🎉` : `${people[r.winner].name} wins game ${view.game}`;
      sub = (
        <>
          {r ? `${Math.max(...r.stores)}–${Math.min(...r.stores)} · ` : ""}Game {view.game + 1} in <Countdown at={view.endsAt} serverNow={serverNow} />
        </>
      );
    }
  } else {
    statusKey = `over-${rep.busy}`;
    const champ = view.champions?.length === 1 ? view.champions[0] : null;
    if (rep.busy) {
      headline = "Last seeds falling…";
      sub = lastText;
    } else {
      headline =
        view.ending === "abandoned"
          ? "Match abandoned"
          : view.ending === "short"
            ? "Not enough players"
            : champ === null
              ? "It's a draw!"
              : champ === you
                ? "You win! 🏆"
                : `${people[champ].name} wins`;
      const r = view.results[view.results.length - 1];
      sub =
        view.ending === "forfeit" && view.quitter !== null
          ? `${people[view.quitter].name} left the game`
          : view.ending === "abandoned"
            ? "Both players left"
            : view.target > 1
              ? `Games ${view.score[0]}–${view.score[1]}`
              : r
                ? `Final stores ${Math.max(...r.stores)}–${Math.min(...r.stores)}`
                : "";
    }
  }

  const boardLabel =
    `Seeds board. Your row is the bottom one and your store is on the right. ` +
    `Stores: ${people[0].name} ${view.board[STORE[0]]}, ${people[1].name} ${view.board[STORE[1]]}.` +
    (lastText ? ` ${lastText}.` : "");

  const topSeat: Seat = bottom === 0 ? 1 : 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {lastText}
      </p>

      <StatusBanner accent={myTurn && !rep.busy ? SIDE[view.turn] : accent}>
        <div key={statusKey} className="sd-status">
          <div className="truncate">{headline}</div>
          <div className={`mt-0.5 truncate font-sans ${alert ? "text-sm font-bold text-[#fbbf24]" : "text-xs font-normal text-muted sm:text-sm"}`}>{sub}</div>
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

      <SeatCard
        seat={topSeat}
        player={people[topSeat]}
        store={rep.board[STORE[topSeat]]}
        view={view}
        isYou={topSeat === you}
        active={playing && view.turn === topSeat}
        away={away(topSeat)}
      />

      <div className="flex h-3 items-center gap-2">
        {view.phase === "turn" && !frozen ? (
          <>
            <div className="flex-1">
              <TimerBar endsAt={view.endsAt} total={view.timerMs} serverNow={serverNow} color={SIDE[view.turn]} />
            </div>
            <Countdown at={view.endsAt} serverNow={serverNow} urgent={myTurn} max={view.timerMs / 1000} className="w-8 text-right text-xs" />
          </>
        ) : view.phase === "between" ? (
          <div className="flex-1 opacity-60">
            <TimerBar endsAt={view.endsAt} total={view.timerMs} serverNow={serverNow} color="var(--color-muted)" />
          </div>
        ) : (
          <div className="h-2 flex-1 rounded-full bg-panel-2" aria-hidden />
        )}
      </div>

      <Board
        board={rep.board}
        bottom={bottom}
        legal={legal}
        onSow={doSow}
        onHover={setHover}
        hint={hint}
        hand={rep.hand}
        flash={rep.flash}
        landed={rep.landed}
        callout={rep.callout}
        lastStart={!rep.busy && last && view.phase === "turn" ? pitIndex(last.seat, last.pit) : null}
        label={boardLabel}
      />

      <SeatCard
        seat={bottom}
        player={people[bottom]}
        store={rep.board[STORE[bottom]]}
        view={view}
        isYou={bottom === you}
        active={playing && view.turn === bottom}
        away={away(bottom)}
      />

      <div className="flex flex-col items-center gap-1.5 text-center text-xs text-muted">
        {!rep.busy && lastText && view.phase === "turn" && <p className="truncate">{lastText}</p>}
        {view.target > 1 && (
          <ol className="flex flex-wrap justify-center gap-1.5" aria-label="Games so far">
            {view.results.map((r, i) => (
              <li key={i} className="flex items-center gap-1 rounded-full border border-line bg-panel px-2 py-0.5 text-xs">
                <span className="font-semibold text-text/80">G{i + 1}</span>
                {r.winner === null ? "draw" : <SideSwatch seat={r.winner} size={10} />}
                <span className="font-mono">
                  {r.stores[0]}–{r.stores[1]}
                </span>
              </li>
            ))}
          </ol>
        )}
        <p>
          {view.seeds} seeds per pit · {view.target > 1 ? `first to ${view.target} games` : "single game"} · last seed in your store = go again
        </p>
      </div>
    </div>
  );
}

function Countdown({
  at,
  serverNow,
  prefix = "",
  urgent,
  max = Infinity,
  className = "",
}: {
  at: number;
  serverNow: () => number;
  prefix?: string;
  /** The clock starts after the last move's replay: never show more than the full turn. */
  max?: number;
  urgent?: boolean;
  className?: string;
}) {
  const s = Math.min(max, useSecondsLeft(at, serverNow));
  return (
    <span className={`font-mono tabular-nums ${urgent && s <= 5 ? "sd-urgent font-bold text-brand" : ""} ${className}`}>
      {prefix}
      {s}s
    </span>
  );
}

function SeatCard({
  seat,
  player,
  store,
  view,
  isYou,
  active,
  away,
}: {
  seat: Seat;
  player: Player;
  store: number;
  view: SeedsView;
  isYou: boolean;
  active: boolean;
  away: boolean;
}) {
  const color = SIDE[seat];
  const champ = view.phase === "over" && view.champions?.includes(seat) && view.champions.length === 1;
  const lit = active || champ;
  return (
    <div
      className={`card relative flex min-w-0 items-center gap-2.5 px-3 py-2 transition-[border-color,box-shadow,opacity] duration-300 ${
        away ? "opacity-60" : ""
      } ${isYou ? "bg-panel-2" : ""}`}
      style={lit ? { borderColor: color, boxShadow: `0 0 0 1px ${color}66, 0 8px 26px -14px ${color}` } : undefined}
    >
      <SideSwatch seat={seat} size={22} />
      <span aria-hidden>
        <Avatar id={player.avatar} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-semibold" style={{ color: player.color }}>
            {player.name}
          </span>
          {isYou && player.name !== "You" && (
            <span className="rounded-full border border-line bg-ink px-1.5 text-xs leading-4 font-bold text-muted">
              you
            </span>
          )}
          {champ && <span aria-label="Winner">🏆</span>}
        </div>
        <div className="truncate text-xs leading-4 text-muted">
          {away ? (
            <>
              <span aria-hidden>📴 </span>away
            </>
          ) : active ? (
            <span className="font-semibold" style={{ color }}>
              {isYou ? "your move" : "to move"}
            </span>
          ) : view.phase === "over" ? (
            champ ? (
              <span className="font-semibold" style={{ color }}>
                winner
              </span>
            ) : (
              "final"
            )
          ) : (
            "waiting"
          )}
        </div>
      </div>
      {view.target > 1 && (
        <span className="flex gap-0.5" aria-label={`${view.score[seat]} of ${view.target} game wins`}>
          {Array.from({ length: view.target }, (_, i) => (
            <span key={i} className="h-2 w-2 rounded-full" style={{ background: i < view.score[seat] ? color : "var(--color-line)" }} />
          ))}
        </span>
      )}
      <div className="flex flex-col items-end leading-none" aria-label={`${store} seeds in store`}>
        <span key={store} className="animate-pop font-mono text-2xl font-bold tabular-nums" style={{ color }}>
          {store}
        </span>
        <span className="text-xs text-muted">store</span>
      </div>
    </div>
  );
}

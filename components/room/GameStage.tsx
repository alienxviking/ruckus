"use client";

import { CATALOG_BY_ID } from "@/games/catalog";
import { GAME_CLIENTS } from "@/games/client-registry";
import { MAX_PAUSES, type Player, type RoomView, type Wish } from "@/shared/types";
import { Avatar } from "../Avatar";
import { Pause } from "lucide-react";
import type { useRoom } from "@/lib/useRoom";
import { useSecondsLeft } from "../game-ui";
import { QuickPlaySwitch } from "./Lobby";
import { HowToPlay, markRulesSeen } from "./HowToPlay";
import { GameBadge } from "../GameBadge";
import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PauseOverlay } from "./PauseOverlay";
import { ResultPodium } from "./ResultPodium";
import { GameStart } from "./GameStart";
import { reportError, setReportGame } from "@/lib/report-error";
import { markPlayed } from "@/lib/my-games";
import dynamic from "next/dynamic";

// The animated confirm dialog is fetched on first hover/focus of "End game".
const loadConfirmDialog = () => import("./ConfirmDialog");
const ConfirmDialog = dynamic(loadConfirmDialog, { ssr: false });

export function GameStage({
  room,
  view,
  me,
  isHost,
  byId,
  r,
  headerExtra,
}: {
  room: RoomView;
  view: unknown;
  me: string;
  isHost: boolean;
  byId: Record<string, Player>;
  r: ReturnType<typeof useRoom>;
  /** Extra controls on the right of the game header (the phone chat toggle). */
  headerExtra?: ReactNode;
}) {
  const meta = CATALOG_BY_ID[room.gameId];
  const GameClient = GAME_CLIENTS[room.gameId];
  // Stable across chat lines and pings, so the (memoised) game client only re-renders when
  // its own inputs change.
  const players = useMemo(() => room.participants.map((id) => byId[id]).filter(Boolean), [room.participants, byId]);
  const isPlayer = room.participants.includes(me);
  const [confirming, setConfirming] = useState(false);
  const [confirmMounted, setConfirmMounted] = useState(false);

  // The game clock: server time minus the time spent paused, standing still during a pause.
  // Games get it as `serverNow`, so their countdowns freeze and pick up where they were.
  const pauseRef = useRef({ pause: room.pause, pausedMs: room.pausedMs });
  useLayoutEffect(() => {
    pauseRef.current = { pause: room.pause, pausedMs: room.pausedMs };
  }, [room.pause, room.pausedMs]);
  const { serverNow, act, send } = r;
  const gameNow = useCallback(() => {
    const { pause, pausedMs } = pauseRef.current;
    return (pause ? pause.at : serverNow()) - pausedMs;
  }, [serverNow]);
  // Moves made while frozen would be dropped by the server anyway.
  const gameAct = useCallback((a: unknown) => {
    if (!pauseRef.current.pause) act(a);
  }, [act]);

  // Reading the rules mid-game pauses it for everyone (a few times per game, each up to 45 s).
  const live = isPlayer && !room.result;
  const pausesLeft = MAX_PAUSES - (room.pauseUses[me] ?? 0);
  const iPaused = !!room.pause?.by.includes(me);
  // Just you vs practice bots: pause whenever and for as long as you like.
  const solo = isPlayer && room.participants.every((id) => id === me || byId[id]?.bot);
  const holding = useRef(false);
  const onRulesOpen = (open: boolean) => {
    // Already paused (the Pause button): reading the rules shouldn't un-pause on close.
    if (open && live && (solo || pausesLeft > 0) && !iPaused) {
      holding.current = true;
      send({ t: "pause", on: true });
    } else if (!open && holding.current) {
      holding.current = false;
      send({ t: "pause", on: false });
    }
  };
  const rulesNote = !live
    ? undefined
    : solo
      ? "The game is paused while you read."
      : iPaused || (pausesLeft > 0 && !room.pause)
      ? "The game is paused for everyone while you read."
      : room.pause
        ? "The game is paused."
        : "You've used your pauses for this game, so it keeps going while you read.";

  // Solo vs bots: leaving the tab (or locking the phone) pauses, so the bots don't win while you're away.
  const pauseNow = solo && live;
  useEffect(() => {
    if (!pauseNow) return;
    const onHide = () => {
      if (document.hidden && !pauseRef.current.pause) send({ t: "pause", on: true });
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [pauseNow, send]);

  useEffect(() => {
    setReportGame(room.gameId);
    if (isPlayer) markPlayed(room.gameId);
    return () => setReportGame(null);
  }, [room.gameId, isPlayer]);

  // Finishing a game counts as having learnt it (no more glowing rules button).
  const finished = !!room.result;
  useEffect(() => {
    if (finished) markRulesSeen(room.gameId);
  }, [finished, room.gameId]);

  return (
    <div data-paused={room.pause ? "" : undefined} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="flex min-w-0 items-center gap-2.5 font-display text-xl font-bold tracking-tight">
          {meta && <GameBadge id={meta.id} accent={meta.accent} size="sm" sheen />}
          <span className="truncate">{meta?.name}</span>
          {!isPlayer && (
            <span className="label rounded-sm border border-line px-1.5 py-0.5 text-[10px]">watching</span>
          )}
        </h1>
        <div className="flex shrink-0 items-center gap-2">
          <HowToPlay gameId={room.gameId} compact onOpenChange={onRulesOpen} note={rulesNote} />
          {solo && live && !room.pause && (
            <button className="btn min-h-10 px-3 py-1.5 text-sm" onClick={() => send({ t: "pause", on: true })} aria-label="Pause the game" title="Pause">
              <Pause aria-hidden className="size-4" strokeWidth={2.4} />
              <span className="hidden sm:inline">Pause</span>
            </button>
          )}
          {isHost && !room.result && (
            <button
              className="btn min-h-10 px-3 py-1.5 text-sm"
              onPointerEnter={loadConfirmDialog}
              onFocus={loadConfirmDialog}
              onClick={() => {
                setConfirmMounted(true);
                setConfirming(true);
              }}
            >
              End game
            </button>
          )}
          {confirmMounted && (
            <ConfirmDialog
              open={confirming}
              onOpenChange={setConfirming}
              title="End this game?"
              description="Everyone goes back to the lobby and this round's progress is lost."
              confirmLabel="End game"
              onConfirm={() => r.send({ t: "lobby" })}
            />
          )}
          {headerExtra}
        </div>
      </div>

      {room.result && <ResultBanner room={room} byId={byId} me={me} isHost={isHost} r={r} accent={meta?.accent} />}
      {room.result && (room.next || (isHost && room.autoNext)) && <UpNext room={room} isHost={isHost} r={r} />}
      {!isPlayer && !room.result && <SpectatorNote full={!!meta && room.participants.length >= meta.maxPlayers} max={meta?.maxPlayers} />}

      <div className="relative min-h-[60vh]">
        {!room.result && <GameStart key={`start-${room.gameSeq}`} seq={room.gameSeq} />}
        {room.pause && !room.result && (
          <PauseOverlay pause={room.pause} byId={byId} me={me} isHost={isHost} solo={solo} serverNow={serverNow} send={send} />
        )}
        {GameClient ? (
          <GameErrorBoundary key={room.gameSeq} game={room.gameId}>
            <GameClient
              view={view}
              me={me}
              players={players}
              byId={byId}
              isPlayer={isPlayer}
              isHost={isHost}
              act={gameAct}
              serverNow={gameNow}
              rtt={r.ping.get}
              onEvent={r.onEvent}
              accent={meta?.accent ?? "#c6f432"}
            />
          </GameErrorBoundary>
        ) : (
          <p className="text-muted">Unknown game.</p>
        )}
      </div>
    </div>
  );
}

function ResultBanner({
  room,
  byId,
  me,
  isHost,
  r,
  accent,
}: {
  room: RoomView;
  byId: Record<string, Player>;
  me: string;
  isHost: boolean;
  r: ReturnType<typeof useRoom>;
  accent?: string;
}) {
  const a = accent ?? "#c6f432";
  const wishes = room.wishes ?? {};
  const who = (w: Wish) => Object.keys(wishes).filter((id) => wishes[id] === w && byId[id]).map((id) => byId[id]);
  const mine = wishes[me] as Wish | undefined;
  const hostName = room.hostId ? byId[room.hostId]?.name : undefined;
  return (
    <ResultPodium room={room} byId={byId} me={me} accent={a}>
      {isHost ? (
        <>
          <button className="stk-btn px-5 py-2.5 text-lg" onClick={() => r.send({ t: "start" })}>
            Play again
            <Voters players={who("again")} />
          </button>
          <button className="btn font-bold" onClick={() => r.send({ t: "start", surprise: true })} title="A random game that fits everyone here">
            <span aria-hidden>🎲</span> Surprise us
            <Voters players={who("new")} />
          </button>
          <button className="btn" onClick={() => r.send({ t: "lobby" })}>
            Pick another
          </button>
          {!room.autoNext && (
            <div className="w-36">
              <QuickPlaySwitch compact on={room.autoNext} onChange={(on) => r.send({ t: "auto", on })} />
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center gap-1.5 md:items-start">
          <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label="What should we play next?">
            <WishButton on={mine === "again"} onClick={() => r.send({ t: "wish", w: mine === "again" ? null : "again" })} voters={who("again")}>
              <span aria-hidden>🔁</span> Again!
            </WishButton>
            <WishButton on={mine === "new"} onClick={() => r.send({ t: "wish", w: mine === "new" ? null : "new" })} voters={who("new")}>
              <span aria-hidden>🎲</span> Something new
            </WishButton>
          </div>
          <span className="text-xs font-semibold text-muted">
            {mine ? `Voted! ${hostName ?? "The host"} sees it and picks.` : `Vote for what's next: ${hostName ?? "the host"} picks.`}
          </span>
        </div>
      )}
    </ResultPodium>
  );
}

/** Who voted for this option, as a little stack of avatars. */
function Voters({ players }: { players: Player[] }) {
  if (!players.length) return null;
  const names = players.map((p) => p.name).join(", ");
  return (
    <span className="animate-pop ml-1 inline-flex items-center rounded-full bg-ink/40 py-0.5 pr-1.5 pl-0.5 text-xs font-bold" title={`Want this: ${names}`}>
      <span className="flex -space-x-1.5">
        {players.slice(0, 3).map((p) => (
          <span key={p.id} className="grid size-5 place-items-center rounded-full bg-panel-2 ring-2 ring-panel">
            <Avatar id={p.avatar} size="0.95rem" />
          </span>
        ))}
      </span>
      <span className="ml-1 tabular-nums">{players.length}</span>
      <span className="sr-only"> want this: {names}</span>
    </span>
  );
}

function WishButton({ on, onClick, voters, children }: { on: boolean; onClick: () => void; voters: Player[]; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`btn min-h-11 font-bold ${on ? "btn-primary" : ""}`}>
      {children}
      <Voters players={voters} />
    </button>
  );
}

/** Quick play's countdown to the next game, with host controls. */
function UpNext({ room, isHost, r }: { room: RoomView; isHost: boolean; r: ReturnType<typeof useRoom> }) {
  const next = room.next ? CATALOG_BY_ID[room.next.gameId] : undefined;
  const secs = useSecondsLeft(room.next?.at, r.serverNow);
  return (
    <div className="card animate-rise flex flex-wrap items-center gap-3 px-4 py-3">
      {next ? (
        <>
          <GameBadge key={next.id} id={next.id} accent={next.accent} size="sm" className="animate-pop" />
          <div className="min-w-0 flex-1">
            <div className="label">Up next</div>
            <div className="truncate font-display font-bold">
              {next.name}{" "}
              <span className="font-mono text-sm font-medium text-muted">
                in <span className="text-brand-2">{secs}s</span>
              </span>
            </div>
          </div>
          {isHost && (
            <div className="flex gap-2">
              <button className="btn btn-primary px-3 py-1.5 text-sm" onClick={() => r.send({ t: "start", gameId: next.id })}>
                Start now
              </button>
              <button className="btn px-3 py-1.5 text-sm" onClick={() => r.send({ t: "auto", on: false })}>
                Stop
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="flex-1 text-sm text-muted">No game fits this group size for quick play.</div>
      )}
    </div>
  );
}

/** For people watching: why they're not playing, and that they're in next time. */
function SpectatorNote({ full, max }: { full: boolean; max?: number }) {
  return (
    <div className="card animate-rise flex items-center gap-3 border-brand-2/30 px-4 py-2.5 text-sm">
      <span aria-hidden className="relative flex size-2 shrink-0">
        <span className="absolute inset-0 rounded-full bg-brand-2 motion-safe:animate-ping" />
        <span className="relative size-2 rounded-full bg-brand-2" />
      </span>
      <span className="text-muted">
        {full ? (
          <>
            This game is full ({max} max). <b className="text-text">You get a seat in the next one.</b>
          </>
        ) : (
          <>
            You joined mid-game. <b className="text-text">You&apos;re in from the next round.</b> Enjoy the show!
          </>
        )}
      </span>
    </div>
  );
}

class GameErrorBoundary extends Component<{ children: ReactNode; game: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    reportError(error, { game: this.props.game });
  }
  render() {
    if (this.state.error) {
      return (
        <div className="card p-6 text-center">
          <p className="font-semibold">This game hit a snag on your screen.</p>
          <button className="btn mt-3" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

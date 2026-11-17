"use client";

import { CATALOG_BY_ID } from "@/games/catalog";
import { GAME_CLIENTS } from "@/games/client-registry";
import { MAX_PAUSES, type Player, type RoomView } from "@/shared/types";
import type { useRoom } from "@/lib/useRoom";
import { Trophy } from "lucide-react";
import { PlayerChip, useSecondsLeft } from "../game-ui";
import { QuickPlaySwitch } from "./Lobby";
import { HowToPlay, markRulesSeen } from "./HowToPlay";
import { GameBadge } from "../GameBadge";
import { Magnetic } from "../Magnetic";
import { Confetti } from "../Confetti";
import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ReactionBar, ReactionLayer } from "./Reactions";
import { PauseOverlay } from "./PauseOverlay";
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
  const holding = useRef(false);
  const onRulesOpen = (open: boolean) => {
    if (open && live && pausesLeft > 0) {
      holding.current = true;
      send({ t: "pause", on: true });
    } else if (!open && holding.current) {
      holding.current = false;
      send({ t: "pause", on: false });
    }
  };
  const rulesNote = !live
    ? undefined
    : iPaused || (pausesLeft > 0 && !room.pause)
      ? "The game is paused for everyone while you read."
      : room.pause
        ? "The game is paused."
        : "You've used your pauses for this game, so it keeps going while you read.";

  // Finishing a game counts as having learnt it (no more glowing rules button).
  const finished = !!room.result;
  useEffect(() => {
    if (finished) markRulesSeen(room.gameId);
  }, [finished, room.gameId]);

  return (
    <div className="flex flex-col gap-3">
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
          {isHost && !room.result && (
            <button
              className="btn px-3 py-1.5 text-sm"
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

      <ReactionBar send={send} />
      {room.result && <ResultBanner room={room} byId={byId} me={me} isHost={isHost} r={r} accent={meta?.accent} />}
      {room.result && (room.next || (isHost && room.autoNext)) && <UpNext room={room} isHost={isHost} r={r} />}
      {!isPlayer && !room.result && <SpectatorNote full={!!meta && room.participants.length >= meta.maxPlayers} max={meta?.maxPlayers} />}

      <ReactionLayer onReact={r.onReact} byId={byId} />
      <div className="relative min-h-[60vh]">
        {room.pause && !room.result && (
          <PauseOverlay pause={room.pause} byId={byId} me={me} isHost={isHost} serverNow={serverNow} send={send} />
        )}
        {GameClient ? (
          <GameErrorBoundary key={room.gameSeq}>
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
  const result = room.result!;
  const a = accent ?? "#c6f432";
  const iWon = result.winners.includes(me);
  return (
    <div
      role="status"
      className="card result-banner relative flex flex-col items-center gap-4 p-4 text-center sm:flex-row sm:justify-between sm:p-5 sm:text-left"
      style={{
        borderColor: a + "aa",
        background: `radial-gradient(90% 140% at 0% 0%, ${a}2a, transparent 60%), var(--color-panel)`,
        boxShadow: `0 0 0 1px ${a}33, 0 20px 50px -24px ${a}`,
      }}
    >
      <span aria-hidden className="banner-sweep" />
      {result.winners.length > 0 && <Confetti pieces={iWon ? 40 : 22} />}
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center">
        <span
          aria-hidden
          className="game-badge animate-trophy size-14 rounded-xl"
          style={{ "--accent": "var(--color-brand-2)" } as React.CSSProperties}
          data-sheen="true"
        >
          <Trophy className="glyph" strokeWidth={1.75} />
        </span>
        <div>
          <div className={`label mb-1 ${iWon ? "text-brand-2" : ""}`}>{iWon ? "You won!" : "Game over"}</div>
          <div className="font-display text-xl font-bold tracking-tight sm:text-2xl">{result.headline}</div>
          {result.winners.length > 0 && (
            <div className="mt-2 flex flex-wrap justify-center gap-1.5 sm:justify-start">
              {result.winners.map((id) => (
                <PlayerChip key={id} player={byId[id]} size="sm" />
              ))}
            </div>
          )}
        </div>
      </div>
      {isHost ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Magnetic>
            <button className="btn btn-primary" onClick={() => r.send({ t: "start" })}>
              Play again
            </button>
          </Magnetic>
          <button className="btn" onClick={() => r.send({ t: "lobby" })}>
            Pick another
          </button>
          {!room.autoNext && (
            <div className="w-36">
              <QuickPlaySwitch compact on={room.autoNext} onChange={(on) => r.send({ t: "auto", on })} />
            </div>
          )}
        </div>
      ) : (
        <span className="font-mono text-xs text-muted">Waiting for the host…</span>
      )}
    </div>
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

class GameErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
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

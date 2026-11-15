"use client";

import type { GameClientProps } from "@/shared/client-game";
import { Note, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import type { WlAction, WlView } from "./server";
import { CASTLES, TROOPS } from "./shared";
import { Battle } from "./battle";
import { CastleRow, LockRow, Planner } from "./plan";
import { Final, WarRecords } from "./records";
import { Pts, WlStyles, joinNames, type Who } from "./ui";

type Props = GameClientProps<WlView, WlAction>;

export default function Warlords(props: Props) {
  if (!props.view) return <Note>Raising the banners…</Note>;
  return <Game {...props} view={props.view} />;
}

function Game({ view, players, byId, isPlayer, act, serverNow, accent }: Props & { view: WlView }) {
  const who: Who = (seat) => {
    const id = view.order[seat];
    return (
      byId[id] ??
      players.find((p) => p.id === id) ?? { id, name: "Someone", color: "#a39dc8", avatar: "🙂", connected: false }
    );
  };
  const r = view.reveal;
  const summary = !!r && r.step > CASTLES;
  const me = view.me?.seat ?? -1;
  const bannerKey = `${view.phase}-${view.round}-${r?.step ?? 0}-${view.me?.locked ?? false}`;

  return (
    <div className="@container mx-auto flex w-full max-w-4xl flex-col gap-3 pb-20 sm:pb-2">
      <WlStyles />
      <RoundTrack view={view} accent={accent} />

      {view.phase !== "final" && (
        <div aria-live="polite" aria-atomic="true">
          <StatusBanner key={bannerKey} accent={accent}>
            <span className="block truncate">
              <Status view={view} who={who} accent={accent} />
            </span>
          </StatusBanner>
        </div>
      )}

      {view.phase === "plan" && <PlanTimer view={view} serverNow={serverNow} accent={accent} />}
      {summary && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="shrink-0">{view.round >= view.rounds ? "Final standings" : `Round ${view.round + 1}`} in</span>
          <div className="flex-1">
            <TimerBar endsAt={view.endsAt} total={view.phaseMs} serverNow={serverNow} color={accent} />
          </div>
        </div>
      )}

      {view.awayEndsAt !== null && view.phase !== "final" && <AwayNote endsAt={view.awayEndsAt} serverNow={serverNow} />}

      {/* One keyed wrapper per phase + round: it animates in on a phase change only. */}
      <div key={`${view.phase}-${view.round}`} className="wl-in flex flex-col gap-3">
        {view.phase === "plan" && (
          <>
            {view.me ? <Planner key={view.round} view={view} who={who} act={act} accent={accent} /> : <CastleRow view={view} accent={accent} />}
            <LockRow view={view} who={who} accent={accent} />
            <WarRecords history={view.history} who={who} me={me} accent={accent} />
          </>
        )}
        {view.phase === "reveal" && <Battle view={view} who={who} accent={accent} />}
        {view.phase === "final" && <Final view={view} who={who} accent={accent} />}
      </div>

      {!isPlayer && (
        <Note>
          👀 You&apos;re watching. Each warlord splits {TROOPS} troops over {CASTLES} castles; the biggest army takes each one.
        </Note>
      )}
    </div>
  );
}

/** "Round 2 of 5" with pips, plus the viewer's score. */
function RoundTrack({ view, accent }: { view: WlView; accent: string }) {
  const done = view.phase === "final" ? view.rounds : view.round - 1;
  const myScore = view.me ? view.scores[view.me.seat] : null;
  return (
    <div className="flex items-center justify-between gap-3 px-1 text-xs text-muted">
      <span className="flex items-center gap-2">
        <span className="font-semibold">{view.phase === "final" ? "All rounds fought" : `Round ${view.round} of ${view.rounds}`}</span>
        <span className="flex gap-1" aria-hidden>
          {Array.from({ length: view.rounds }, (_, i) => (
            <span
              key={i}
              className="h-1.5 w-4 rounded-full transition-colors duration-300"
              style={{ background: i < done ? accent : i === view.round - 1 && view.phase !== "final" ? `${accent}77` : "var(--color-line)" }}
            />
          ))}
        </span>
      </span>
      {myScore !== null && (
        <span>
          You: <b className="font-mono text-text tabular-nums">{myScore}</b> pts
        </span>
      )}
    </div>
  );
}

function Status({ view, who, accent }: { view: WlView; who: Who; accent: string }) {
  const r = view.reveal;
  const meSeat = view.me?.seat ?? -1;
  if (view.phase === "plan") {
    if (!view.me) return <>Warlords are planning 🤔</>;
    if (!view.me.locked) return <>Deploy your {TROOPS} troops ⚔️</>;
    const waiting = view.order.flatMap((_, seat) => (!view.locked[seat] && who(seat).connected ? [seat] : []));
    if (!waiting.length) return <>Locked in ✓ Marching out…</>;
    if (waiting.length === 1) {
      const p = who(waiting[0]);
      return (
        <>
          Locked in ✓ Waiting on <span style={{ color: p.color }}>{p.name}</span>
        </>
      );
    }
    return <>Locked in ✓ Waiting on {waiting.length} others</>;
  }
  if (!r) return null;
  if (r.step === 0) return <>⚔️ To battle!</>;
  if (r.step <= CASTLES) {
    const i = r.step - 1;
    // No dragon here: the banner must not spoil it before the battle card's reveal beat.
    return (
      <>
        ⚔️ Battle for {view.names[i]} <Pts v={view.values[i]} accent={accent} className="align-middle text-base" />
      </>
    );
  }
  const g = r.gained ?? [];
  const best = Math.max(0, ...g);
  if (best === 0) return <>Round {view.round}: the dragon feasts 🐉</>;
  const tops = g.flatMap((v, seat) => (v === best ? [seat] : []));
  const label = tops.length === 1 && tops[0] === meSeat ? "You" : joinNames(tops.map((s) => who(s).name));
  return (
    <>
      Round {view.round}: <span style={{ color: tops.length === 1 ? who(tops[0]).color : undefined }}>{label}</span> +{best} 🏆
    </>
  );
}

function PlanTimer({ view, serverNow, accent }: { view: WlView; serverNow: () => number; accent: string }) {
  const secs = useSecondsLeft(view.endsAt, serverNow);
  const low = secs <= 5;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">
        <TimerBar endsAt={view.endsAt} total={view.phaseMs} serverNow={serverNow} color={low ? "#f87171" : accent} />
      </div>
      <span className={`w-8 text-right font-mono text-xs font-bold tabular-nums ${low ? "text-red-400" : "text-muted"}`} aria-label={`${secs} seconds left`}>
        {secs}s
      </span>
    </div>
  );
}

function AwayNote({ endsAt, serverNow }: { endsAt: number; serverNow: () => number }) {
  const secs = useSecondsLeft(endsAt, serverNow);
  return (
    <p role="status" className="card animate-rise border-amber-400/50 px-3 py-2 text-center text-sm">
      📡 Too few warlords online. The game ends in <b className="tabular-nums">{secs}s</b> unless someone returns.
    </p>
  );
}

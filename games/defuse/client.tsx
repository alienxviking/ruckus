"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { Note, PlayerChip, StatusBanner, TimerBar } from "@/components/game-ui";
import type { BombRec, DefuseAction, DefuseView } from "./server";
import { MODULE_ICON, MODULE_NAME, type DefuseEvent, type Msg } from "./shared";
import { Bomb } from "./bomb";
import { Manual } from "./manual";
import { Talk } from "./talk";
import { Clock, Name, StrikeLeds, Styles, fmtClock } from "./ui";
import { feedback, sfx } from "@/lib/feedback";

type Props = GameClientProps<DefuseView, DefuseAction>;

export default function Defuse(props: Props) {
  if (!props.view) return <Note>Wiring up the bomb…</Note>;
  return <Game {...props} view={props.view} />;
}

function parse(raw: unknown): DefuseEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (e.k === "say" && e.m && typeof e.m === "object" && typeof (e.m as Msg).i === "number") return e as DefuseEvent;
  if (e.k === "hold" && typeof e.m === "number" && typeof e.on === "boolean") return e as DefuseEvent;
  if (e.k === "strike" && typeof e.m === "number") return e as DefuseEvent;
  return null;
}

function Game({ view, me, byId, isPlayer, act, serverNow, onEvent, accent }: Props & { view: DefuseView }) {
  const [extra, setExtra] = useState<Msg[]>([]);
  const [held, setHeld] = useState<{ no: number; on: Record<number, boolean> }>({ no: -1, on: {} });
  const [readied, setReadied] = useState(-1);
  const bombNo = view.bombNo;
  const amDefuser = view.defuser === me;
  useEffect(
    () =>
      onEvent((raw) => {
        const e = parse(raw);
        if (!e) return;
        if (e.k === "say") setExtra((x) => (x.some((m) => m.i === e.m.i) ? x : [...x, e.m].slice(-40)));
        else if (e.k === "hold") setHeld((h) => ({ no: bombNo, on: { ...(h.no === bombNo ? h.on : {}), [e.m]: e.on } }));
        else if (e.k === "strike") {
          // A wrong move: the defuser feels it, the squad hears it.
          if (amDefuser) feedback("hit");
          else sfx("error");
        }
      }),
    [onEvent, bombNo, amDefuser],
  );
  // Cues: you're up as defuser, each module solved, and the bomb's fate.
  const briefMine = view.phase === "brief" && amDefuser;
  const solvedCount = view.phase === "live" ? view.checklist.filter((c) => c.done).length : 0;
  const resultKey = view.phase === "result" ? `${bombNo}-${view.outcome}` : "";
  useEffect(() => {
    if (briefMine) feedback("turn");
  }, [briefMine]);
  useEffect(() => {
    if (solvedCount > 0) feedback("score");
  }, [solvedCount, bombNo]);
  useEffect(() => {
    if (!resultKey) return;
    if (resultKey.endsWith("defused")) sfx("score");
    else feedback("out");
  }, [resultKey]);
  const remoteHeld = held.no === bombNo && view.phase === "live" ? held.on : {};
  const who = (id: string): Player | undefined => byId[id];
  const defuser = who(view.defuser);
  const live = view.phase === "live";
  const types = view.checklist.map((c) => c.t);
  const isMeReady = view.ready.includes(me) || readied === bombNo;

  const bomb = view.bomb && (
    <Bomb
      edge={view.bomb.edge}
      mods={view.bomb.mods}
      strikes={view.strikes}
      live={live}
      explodeAt={view.explodeAt}
      rate={view.rate}
      left={view.left}
      outcome={view.outcome}
      act={live && view.role === "defuser" ? act : null}
      serverNow={serverNow}
      remoteHeld={remoteHeld}
    />
  );
  const manual = view.page && (
    <Manual
      page={view.page}
      types={types}
      experts={view.experts}
      title={
        <>
          Manual · bomb {bombNo + 1}
        </>
      }
    />
  );
  const talk = view.chat && <Talk chat={view.chat} extra={extra} me={me} byId={byId} act={act} defuser={view.defuser} />;

  let main: ReactNode;
  if (view.phase === "over") main = <Final view={view} who={who} bomb={bomb} />;
  else if (view.role === "expert" && !view.bomb) main = manual;
  else main = (
    <div className="flex flex-col gap-3">
      {bomb}
      {view.phase === "result" && manual && <details className="card p-2 text-sm"><summary className="cursor-pointer px-1 py-1 font-semibold">Your manual pages</summary><div className="mt-2">{manual}</div></details>}
    </div>
  );

  return (
    <div className="@container mx-auto flex w-full max-w-4xl flex-col gap-3">
      <Styles />
      <div aria-live="polite" aria-atomic="true">
        <StatusBanner key={`${view.phase}-${bombNo}`} accent={view.outcome === "defused" ? "#22c55e" : accent}>
          <Banner view={view} me={me} defuser={defuser} />
        </StatusBanner>
      </div>

      <Hud view={view} who={who} serverNow={serverNow} showClock={view.role !== "defuser" && view.phase !== "over"} />

      {view.phase === "brief" && (
        <Brief view={view} me={me} who={who} ready={isMeReady} isPlayer={isPlayer} serverNow={serverNow} accent={accent} onReady={() => {
          setReadied(bombNo);
          act({ type: "ready" });
        }} />
      )}
      {view.phase === "result" && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="shrink-0">Next bomb</span>
          <div className="flex-1">
            <TimerBar endsAt={view.endsAt} total={view.resultMs} serverNow={serverNow} color={accent} />
          </div>
        </div>
      )}

      <div className={`grid gap-3 ${talk ? "@3xl:grid-cols-[minmax(0,1fr)_18rem]" : ""}`}>
        <div className="min-w-0">{main}</div>
        {talk && <div className="min-w-0 @3xl:sticky @3xl:top-3 @3xl:self-start">{talk}</div>}
      </div>

      {!isPlayer && <Note>👀 You&apos;re watching the bomb. Only the squad sees the manual and the quick talk.</Note>}
      <div aria-hidden className="h-4" />
    </div>
  );
}

function Banner({ view, me, defuser }: { view: DefuseView; me: string; defuser: Player | undefined }) {
  const n = view.bombNo + 1;
  const mine = view.defuser === me;
  if (view.phase === "over") {
    const d = view.history.filter((h) => h.outcome === "defused").length;
    if (view.abandoned) return <>Squad disbanded · {d}/{view.bombs} defused</>;
    return d >= 2 ? <>🎖️ Squad wins! {d}/{view.bombs} bombs defused</> : <>💥 Squad lost · {d}/{view.bombs} defused</>;
  }
  if (view.phase === "result")
    return view.outcome === "defused" ? (
      <>✅ Bomb {n} defused with {fmtClock(view.left)} left!</>
    ) : (
      <>💥 Bomb {n} blew up{view.strikes >= 3 ? " (3 strikes)" : ""}!</>
    );
  if (view.phase === "brief")
    return mine ? (
      <>💣 Bomb {n}/{view.bombs}: you&apos;re the defuser!</>
    ) : (
      <>
        Bomb {n}/{view.bombs}: <Name p={defuser} /> defuses
      </>
    );
  if (view.role === "defuser") return <>Describe the bomb. Your squad has the manual!</>;
  if (view.role === "expert") return <>Talk <Name p={defuser} /> through it, fast!</>;
  return (
    <>
      <Name p={defuser} /> is defusing…
    </>
  );
}

function Pips({ history, current, total }: { history: BombRec[]; current: number; total: number }) {
  return (
    <span className="flex items-center gap-1" aria-label={`Bomb ${current + 1} of ${total}`}>
      {Array.from({ length: total }, (_, i) => {
        const h = history[i];
        return (
          <span
            key={i}
            className={`grid size-6 place-items-center rounded-full border text-xs ${i === current && !h ? "border-red-400 bg-red-500/20" : "border-line bg-panel-2"}`}
            title={h ? (h.outcome === "defused" ? "Defused" : "Exploded") : i === current ? "Now" : "Later"}
          >
            {h ? (h.outcome === "defused" ? "✅" : "💥") : i === current ? "💣" : <span className="text-muted">·</span>}
          </span>
        );
      })}
    </span>
  );
}

function Hud({ view, who, serverNow, showClock }: { view: DefuseView; who: (id: string) => Player | undefined; serverNow: () => number; showClock: boolean }) {
  return (
    <div className="card flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2">
      <div className="flex items-center gap-2">
        <Pips history={view.history} current={view.bombNo} total={view.bombs} />
        {view.phase !== "over" && <PlayerChip player={who(view.defuser)} size="sm">💣</PlayerChip>}
      </div>
      {showClock && (
        <div className="flex items-center gap-2">
          <Clock live={view.phase === "live"} explodeAt={view.explodeAt} rate={view.rate} left={view.left} serverNow={serverNow} size="sm" />
          <StrikeLeds strikes={view.strikes} />
        </div>
      )}
      {view.phase !== "over" && (
        <ul className="flex w-full flex-wrap gap-1 @md:w-auto" aria-label="Modules on this bomb">
          {view.checklist.map((c, i) => (
            <li
              key={i}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors ${c.done ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300" : "border-line text-muted"}`}
            >
              <span aria-hidden>{c.done ? "✓" : MODULE_ICON[c.t]}</span>
              {MODULE_NAME[c.t]}
              <span className="sr-only">{c.done ? " disarmed" : " armed"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Brief({
  view,
  me,
  who,
  ready,
  isPlayer,
  serverNow,
  accent,
  onReady,
}: {
  view: DefuseView;
  me: string;
  who: (id: string) => Player | undefined;
  ready: boolean;
  isPlayer: boolean;
  serverNow: () => number;
  accent: string;
  onReady: () => void;
}) {
  const mine = view.defuser === me;
  return (
    <div className="card df-in flex flex-col gap-2.5 p-3" style={{ borderColor: accent + "55" }}>
      <p className="text-sm leading-snug">
        {mine ? (
          <>
            <b>Only you can see the bomb.</b> Describe it out loud or in quick talk: serial, batteries, lamps, then each module. Your squad holds the manual; do what they say. 3:00 on the clock, 3 strikes and it blows (each strike speeds it up).
          </>
        ) : isPlayer ? (
          <>
            <b>You can&apos;t see the bomb.</b> You hold torn pages of the manual. Ask <Name p={who(view.defuser)} /> what&apos;s on it, pool your pages with the other experts, and call the moves.
          </>
        ) : (
          <>The squad is getting ready. You&apos;ll see the bomb; they won&apos;t.</>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {isPlayer && (
          <button type="button" className={`btn ${ready ? "" : "btn-primary df-ready"} min-h-11`} disabled={ready} onClick={onReady}>
            {ready ? "Ready ✓" : mine ? "Arm it, I'm ready" : "I'm ready"}
          </button>
        )}
        <ul className="flex flex-wrap gap-1" aria-label="Ready players">
          {view.order.map((id) => (
            <li key={id} className={view.ready.includes(id) ? "" : "opacity-45"}>
              <PlayerChip player={who(id)} size="sm">
                {view.ready.includes(id) ? "✓" : ""}
              </PlayerChip>
            </li>
          ))}
        </ul>
      </div>
      <TimerBar endsAt={view.endsAt} total={view.briefMs} serverNow={serverNow} color={accent} />
    </div>
  );
}

function Final({ view, who, bomb }: { view: DefuseView; who: (id: string) => Player | undefined; bomb: ReactNode }) {
  const d = view.history.filter((h) => h.outcome === "defused").length;
  return (
    <div className="flex flex-col gap-3">
      <section className="card df-in flex flex-col gap-3 p-4" aria-label="Final result">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="label">Team score</div>
            <div className="df-pop font-display text-4xl font-black tabular-nums">{view.team}</div>
          </div>
          <div className="text-right text-sm text-muted">
            {d}/{view.bombs} defused · {d >= 2 && !view.abandoned ? "everyone wins 🎖️" : "nobody wins this time"}
          </div>
        </div>
        <ol className="flex flex-col gap-1.5">
          {view.history.map((h) => (
            <li key={h.no} className="flex flex-wrap items-center gap-2 rounded-xl bg-panel-2 px-2.5 py-2 text-sm">
              <span className="text-lg" aria-hidden>
                {h.outcome === "defused" ? "✅" : "💥"}
              </span>
              <span className="font-semibold">Bomb {h.no + 1}</span>
              <PlayerChip player={who(h.defuser)} size="sm" />
              <span className="text-xs text-muted">
                {h.solved}/{h.mods} modules · {h.strikes} strike{h.strikes === 1 ? "" : "s"}
                {h.outcome === "defused" ? ` · ${fmtClock(h.left)} left` : ""}
              </span>
              <span className="ml-auto font-mono font-bold tabular-nums">+{h.points}</span>
            </li>
          ))}
        </ol>
        <p className="text-xs text-muted">100 points per defused bomb, plus a point for every second left on its clock.</p>
      </section>
      {bomb && (
        <div>
          <div className="label mb-1.5">The last bomb</div>
          {bomb}
        </div>
      )}
    </div>
  );
}

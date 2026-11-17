"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { TEAMS } from "@/shared/teams";
import { Avatar } from "@/components/Avatar";
import { Note, useSecondsLeft } from "@/components/game-ui";
import { feedback, sfx } from "@/lib/feedback";
import { isSnap, type PuckAction, type PuckView } from "./shared";
import { Table, type TableData } from "./table";

type Props = GameClientProps<PuckView, PuckAction>;

const CSS = `
.pk-stage { aspect-ratio: 628 / 1132; max-width: min(100%, calc((100svh - 275px) * 0.555)); min-width: min(100%, 260px); }
.pk-go { animation: pk-go .8s cubic-bezier(.2,1.4,.4,1) both; }
@keyframes pk-go { 0% { opacity: 0; transform: scale(.4); } 25% { opacity: 1; transform: scale(1.12); } 70% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(1.3); } }
.pk-bump { animation: pk-bump .5s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes pk-bump { 0% { transform: scale(1.6); } 100% { transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .pk-go, .pk-bump { animation: none; } }
`;

function subscribeReducedMotion(cb: () => void) {
  const m = window.matchMedia("(prefers-reduced-motion: reduce)");
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

function isView(v: unknown): v is PuckView {
  if (!v || typeof v !== "object") return false;
  const x = v as Partial<PuckView>;
  return Array.isArray(x.ids) && Array.isArray(x.team) && Array.isArray(x.score) && isSnap(x.snap);
}

export default function Puck(props: Props) {
  if (!isView(props.view)) {
    return (
      <div className="card grid min-h-[40vh] place-items-center p-6">
        <Note>Waxing the table…</Note>
      </div>
    );
  }
  return <Game {...props} view={props.view} />;
}

const teamColors: [string, string] = [TEAMS[0].color, TEAMS[1].color];

function Game({ view, me, byId, isPlayer, act, serverNow, rtt, onEvent }: Omit<Props, "view"> & { view: PuckView }) {
  const reduced = useReducedMotion();
  const secs = useSecondsLeft(view.endsAt, serverNow);
  const abandonSecs = useSecondsLeft(view.abandonAt, serverNow);
  const { phase, ids } = view;
  const mySlot = isPlayer ? ids.indexOf(me) : -1;
  const myTeam = mySlot >= 0 ? view.team[mySlot] : -1;
  const names = ids.map((id) => byId[id]?.name ?? "Someone");
  const avatars = ids.map((id) => byId[id]?.avatar ?? "🙂");
  const offline = ids.map((id) => byId[id]?.connected === false);
  // Your side on the left (Red for spectators).
  const left = myTeam === 1 ? 1 : 0;
  const right = 1 - left;

  // Countdown ticks and the "go" cue.
  const live = phase === "live";
  useEffect(() => {
    if (phase === "set" && secs > 0 && secs <= 3) sfx("tick");
  }, [phase, secs]);
  const was = useRef(phase);
  useEffect(() => {
    const prev = was.current;
    was.current = phase;
    if (prev === "set" && phase === "live") {
      if (mySlot >= 0) feedback("go");
      else sfx("go");
    }
  }, [phase, mySlot]);

  const last = view.log[view.log.length - 1];
  const teamLabel = (t: number) => (myTeam === t ? "You" : view.ids.filter((_, i) => view.team[i] === t).length > 1 ? `${TEAMS[t].name} team` : (names[view.team.indexOf(t)] ?? TEAMS[t].name));
  let status: ReactNode;
  if (view.abandonAt && phase !== "final") {
    status = `⏳ A side has left the table · it forfeits in ${abandonSecs}s unless someone returns`;
  } else if (phase === "set") {
    const handed = view.handed;
    const who = view.snap.p[1] >= 500 ? 0 : 1;
    status =
      handed !== null
        ? `⏱ Too long in one half! ${TEAMS[handed].name} gets the puck`
        : view.log.length === 0
          ? `Faceoff · first to ${view.target} · ${myTeam === who ? "your puck" : `${TEAMS[who].name}'s puck`}`
          : `Faceoff · ${myTeam === who ? "your puck" : `${TEAMS[who].name}'s puck`}`;
  } else if (phase === "goal" && last) {
    const scorer = last.slot >= 0 ? names[last.slot] : null;
    status = scorer ? `🚨 ${scorer} scores for ${TEAMS[last.team].name}!` : `🙈 Own goal! A point for ${TEAMS[last.team].name}`;
  } else if (phase === "live") {
    const gp = view.score.map((s) => view.target - s);
    status = gp[0] === 1 || gp[1] === 1 ? "🔥 Match point!" : `Smash it in · first to ${view.target}`;
  } else {
    const c = view.champions;
    status = c === null || c < 0 ? "Match over" : `🏆 ${myTeam === c ? "You win!" : `${teamLabel(c)} ${teamLabel(c) === "You" ? "win" : "wins"}!`}`;
  }

  const data: TableData = { view, mySlot, teamColors, names, avatars, offline, reduced };
  const label = `Air hockey table. ${TEAMS[0].name} ${view.score[0]}, ${TEAMS[1].name} ${view.score[1]}. First to ${view.target}.${mySlot >= 0 ? ` You play for ${TEAMS[myTeam].name}, defending the bottom goal.` : ""}`;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-2">
      <style href="ruckus-puck" precedence="default">
        {CSS}
      </style>
      <ScoreBar view={view} left={left} right={right} byId={byId} me={me} />
      <div className="truncate text-center font-display text-sm font-bold sm:text-base" aria-live="polite">
        {status}
      </div>
      <Table
        data={data}
        act={act}
        onEvent={onEvent}
        rtt={rtt}
        label={label}
        hint={
          mySlot >= 0 ? (
            <>
              <span className="hidden pointer-fine:inline">Move the mouse over the table: your paddle follows it. Smash the puck into the far goal.</span>
              <span className="pointer-fine:hidden">Drag anywhere on your half: your paddle rides just above your finger.</span>
              {view.zone[mySlot] !== "all" && <> You play {view.zone[mySlot] === "fwd" ? "forward (front lane)" : "goalie (back lane)"}.</>}
            </>
          ) : (
            "👀 You're watching. Red defends the bottom goal."
          )
        }
      >
        <Overlay view={view} secs={secs} myTeam={myTeam} names={names} live={live} />
      </Table>
      {phase === "final" && <Final view={view} byId={byId} me={me} />}
      {phase !== "final" && view.log.length > 0 && <GoalLog view={view} names={names} />}
    </div>
  );
}

function TeamChips({ view, team, byId, align }: { view: PuckView; team: number; byId: Record<string, Player>; align: "left" | "right" }) {
  const members = view.ids.filter((_, i) => view.team[i] === team);
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 ${align === "right" ? "items-end" : "items-start"}`}>
      {members.map((id) => {
        const p = byId[id];
        return (
          <span key={id} className={`flex max-w-full items-center gap-1 text-xs font-semibold sm:text-sm ${p?.connected === false ? "opacity-40" : ""}`}>
            {align === "right" && <span className="truncate">{p?.name ?? "Someone"}</span>}
            <span aria-hidden className="shrink-0">
              <Avatar id={p?.avatar ?? "🙂"} />
            </span>
            {align === "left" && <span className="truncate">{p?.name ?? "Someone"}</span>}
          </span>
        );
      })}
    </div>
  );
}

function ScoreBar({ view, left, right, byId, me }: { view: PuckView; left: number; right: number; byId: Record<string, Player>; me: string }) {
  const mine = view.ids.indexOf(me);
  const myTeam = mine >= 0 ? view.team[mine] : -1;
  const side = (t: number) => (
    <div
      className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-2.5 py-1.5"
      style={{ borderColor: TEAMS[t].color + "66", background: `linear-gradient(180deg, ${TEAMS[t].color}26, ${TEAMS[t].color}08)`, flexDirection: t === left ? "row" : "row-reverse" }}
    >
      <TeamChips view={view} team={t} byId={byId} align={t === left ? "left" : "right"} />
      <div className="flex-1" />
      <div className="flex flex-col items-center leading-none">
        <span key={view.score[t]} className="pk-bump font-display text-3xl font-black tabular-nums sm:text-4xl" style={{ color: TEAMS[t].color }}>
          {view.score[t]}
        </span>
        <span className="text-[10px] font-bold tracking-wide text-muted uppercase">{myTeam === t ? "you" : TEAMS[t].name}</span>
      </div>
    </div>
  );
  return (
    <div className="flex items-stretch gap-2">
      {side(left)}
      <div className="flex shrink-0 flex-col items-center justify-center text-[10px] font-bold text-muted uppercase">
        <span>to</span>
        <span className="font-display text-base text-text">{view.target}</span>
      </div>
      {side(right)}
    </div>
  );
}

function Overlay({ view, secs, myTeam, names, live }: { view: PuckView; secs: number; myTeam: number; names: string[]; live: boolean }) {
  if (view.phase === "set") {
    return (
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="flex flex-col items-center gap-1">
          {view.log.length === 0 && view.handed === null && myTeam >= 0 && (
            <span className="rounded-full px-3 py-0.5 text-xs font-bold tracking-wide text-white uppercase" style={{ background: TEAMS[myTeam].color + "cc" }}>
              You&apos;re {TEAMS[myTeam].name} · defend the bottom goal
            </span>
          )}
          <span key={secs} className="animate-pop font-display text-6xl font-black text-white drop-shadow-[0_4px_14px_rgba(15,23,42,0.85)] sm:text-7xl">
            {Math.max(1, secs)}
          </span>
        </div>
      </div>
    );
  }
  if (view.phase === "final") {
    const c = view.champions;
    const won = c !== null && c >= 0;
    return (
      <div className="pointer-events-none absolute inset-0 grid place-items-center bg-ink/40">
        <div className="card animate-pop flex max-w-[85%] flex-col items-center px-5 py-4 text-center" style={{ borderColor: won ? TEAMS[c].color : undefined }}>
          <span className="text-4xl" aria-hidden>
            {won && myTeam === c ? "🏆" : won && myTeam >= 0 ? "😤" : "🏒"}
          </span>
          <span className="font-display text-2xl font-black" style={{ color: won ? TEAMS[c].color : undefined }}>
            {won ? (myTeam === c ? "You win!" : myTeam >= 0 ? "So close!" : `${TEAMS[c].name} wins!`) : "No winner"}
          </span>
          <span className="font-mono text-lg font-bold tabular-nums">
            <span style={{ color: TEAMS[0].color }}>{view.score[0]}</span>
            <span className="text-muted"> – </span>
            <span style={{ color: TEAMS[1].color }}>{view.score[1]}</span>
          </span>
          {won && <span className="text-xs text-muted">{names.filter((_, i) => view.team[i] === c).join(" & ")}</span>}
        </div>
      </div>
    );
  }
  if (live) return <LiveFlash key={view.snap.n} />;
  return null;
}

/** "GO!" for a moment after each faceoff. */
function LiveFlash() {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <span className="pk-go font-display text-6xl font-black text-white opacity-0 drop-shadow-[0_4px_14px_rgba(15,23,42,0.85)]">GO!</span>
    </div>
  );
}

function GoalLog({ view, names }: { view: PuckView; names: string[] }) {
  const recent = view.log.slice(-4).reverse();
  return (
    <ul className="flex flex-wrap justify-center gap-1.5 text-xs">
      {recent.map((g, i) => (
        <li key={view.log.length - i} className="rounded-full border px-2 py-0.5" style={{ borderColor: TEAMS[g.team].color + "66", color: TEAMS[g.team].color }}>
          🚨 {g.slot >= 0 ? names[g.slot] : "own goal"}
        </li>
      ))}
    </ul>
  );
}

function Final({ view, byId, me }: { view: PuckView; byId: Record<string, Player>; me: string }) {
  const order = view.ids.map((id, i) => ({ id, i })).sort((a, b) => view.goals[b.i] - view.goals[a.i]);
  return (
    <div className="card p-3">
      <div className="label mb-2">Goals</div>
      <ol className="space-y-1">
        {order.map(({ id, i }) => {
          const p = byId[id];
          const t = view.team[i];
          return (
            <li key={id} className={`flex items-center justify-between gap-2 rounded-md px-2 py-1 ${id === me ? "bg-panel-2" : ""}`}>
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: TEAMS[t].color }} />
                <Avatar id={p?.avatar ?? "🙂"} />
                <span className="truncate font-semibold">{p?.name ?? "Someone"}</span>
                {view.champions === t && <span aria-label="winner">🏆</span>}
              </span>
              <span className="font-mono font-bold tabular-nums">{view.goals[i]}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

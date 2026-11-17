"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { TEAMS } from "@/shared/teams";
import { Note, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import { Avatar } from "@/components/Avatar";
import { feedback, sfx } from "@/lib/feedback";
import type { FeedItem, FlagAction, FlagView } from "./server";
import { COUNTDOWN_MS, FLAG_DROPPED, OVERTIME_MS, SCORED_MS, ST_OUT, isSnap } from "./shared";
import { Field, type FieldData } from "./field";

type Props = GameClientProps<FlagView, FlagAction>;

const CSS = `
.fr-stage { aspect-ratio: 5 / 3; max-width: min(100%, calc((100svh - 340px) * 5 / 3)); margin: 0 auto; }
@container (max-width: 639px) { .fr-stage { aspect-ratio: 3 / 5; max-width: min(100%, calc((100svh - 322px) * 0.6)); } }
.fr-big { animation: fr-big 1.1s cubic-bezier(.2,1.5,.4,1) both; }
@keyframes fr-big { 0% { opacity: 0; transform: scale(.3) rotate(-6deg); } 30% { opacity: 1; transform: scale(1.12) rotate(2deg); } 50% { transform: scale(1) rotate(0); } 100% { opacity: 1; transform: scale(1); } }
.fr-alarm { animation: fr-alarm .7s ease-in-out infinite; }
@keyframes fr-alarm { 50% { opacity: .55; transform: scale(.98); } }
.fr-bump { animation: fr-bump .5s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes fr-bump { 0% { transform: scale(1.6); } 100% { transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .fr-big, .fr-alarm, .fr-bump { animation: none; } }
`;

const TEAM_EMOJI = ["🔴", "🔵"];

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

function useServerClock(serverNow: () => number, ms: number) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(id);
  }, [serverNow, ms]);
  return now;
}

function isView(v: unknown): v is FlagView {
  if (!v || typeof v !== "object") return false;
  const x = v as Partial<FlagView>;
  return Array.isArray(x.ids) && Array.isArray(x.team) && Array.isArray(x.score) && isSnap(x.snap);
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function FlagRaid(props: Props) {
  if (!isView(props.view)) {
    return (
      <div className="card grid min-h-[40vh] place-items-center p-6">
        <Note>Planting the flags…</Note>
      </div>
    );
  }
  return <Game {...props} view={props.view} />;
}

function Game({ view, me, players, byId, isPlayer, act, serverNow, onEvent, accent }: Omit<Props, "view"> & { view: FlagView }) {
  const reduced = useReducedMotion();
  const now = useServerClock(serverNow, 250);
  const secs = useSecondsLeft(view.endsAt, serverNow);
  const { phase, ids, snap } = view;
  const mySlot = isPlayer ? ids.indexOf(me) : -1;
  const myTeam = mySlot >= 0 ? view.team[mySlot] : -1;
  const teamColors: [string, string] = [TEAMS[0].color, TEAMS[1].color];
  const teamNames: [string, string] = [TEAMS[0].name, TEAMS[1].name];
  const names = ids.map((id) => byId[id]?.name ?? "Someone");
  const avatars = ids.map((id) => byId[id]?.avatar ?? "🙂");
  const name = (slot: number) => (slot === mySlot ? "You" : (names[slot] ?? "Someone"));
  const canSteer = mySlot >= 0 && (phase === "play" || phase === "scored");

  // Countdown ticks and "go".
  useEffect(() => {
    if (phase === "countdown" && secs > 0 && secs <= 3) sfx("tick");
  }, [phase, secs]);
  const lastPhase = useRef(phase);
  useEffect(() => {
    const was = lastPhase.current;
    lastPhase.current = phase;
    if (was === "countdown" && phase === "play") {
      if (mySlot >= 0) feedback("go");
      else sfx("go");
    }
  }, [phase, mySlot]);

  // ----- what's going on -----
  const g = snap.g;
  const meOut = mySlot >= 0 && Number(snap.s[mySlot] ?? 0) === ST_OUT;
  const myCarry = mySlot >= 0 && g[1 - myTeam]?.[0] === mySlot;
  const ownFlag = myTeam >= 0 ? g[myTeam] : null;
  const ownCarrier = ownFlag && ownFlag[0] >= 0 ? ownFlag[0] : -1;
  const mateCarrier = myTeam >= 0 && g[1 - myTeam][0] >= 0 && g[1 - myTeam][0] !== mySlot ? g[1 - myTeam][0] : -1;
  const lead = view.score[0] === view.score[1] ? -1 : view.score[0] > view.score[1] ? 0 : 1;
  const winner = view.winTeam;
  let head: ReactNode;
  let sub: ReactNode;
  let alarm = false;
  /** The sub line matters right now (shown even on small phones). */
  let urgent = false;
  if (phase === "countdown") {
    head = myTeam >= 0 ? (
      <>
        You&apos;re on <span style={{ color: teamColors[myTeam] }}>{teamNames[myTeam]}</span>! Get set…
      </>
    ) : (
      `${teamNames[0]} vs ${teamNames[1]}: get set…`
    );
    sub = myTeam >= 0 ? `Your base is at your end of the field. Steal the ${teamNames[1 - myTeam]} flag and bring it home!` : `First to ${view.capsNeeded} captures`;
  } else if (phase === "play") {
    if (mySlot < 0) {
      head = "🚩 Raid on!";
      sub = `First team to ${view.capsNeeded} captures wins`;
    } else if (meOut) {
      head = "💫 Tagged! Respawning at base…";
      sub = myCarry ? "You dropped the flag" : "Your teammates are still in it";
    } else if (myCarry) {
      head = "🏃 GOT IT! RUN HOME!";
      sub = "Get into your base circle. Don't get touched on their side!";
    } else if (ownCarrier >= 0) {
      head = `🚨 FLAG TAKEN! Tag ${name(ownCarrier)}!`;
      sub = "Catch them before they cross the middle line";
      alarm = true;
    } else if (ownFlag && ownFlag[0] === FLAG_DROPPED) {
      head = "⚠️ Your flag's down: touch it!";
      sub = "Touch it to send it home before they grab it again";
      alarm = true;
    } else if (mateCarrier >= 0) {
      head = `🔥 ${name(mateCarrier)} has it! Cover them!`;
      sub = "Block the chasers on your side";
    } else {
      head = `🚩 Grab the ${teamNames[1 - myTeam]} flag!`;
      sub = "On their side you can be tagged. On yours, you do the tagging.";
    }
    if (view.overtime) {
      sub = "⏱ OVERTIME: the next capture wins!";
      urgent = true;
    }
  } else if (phase === "scored") {
    const cap = view.lastCap;
    head = cap ? (
      <>
        🎉 <span style={{ color: teamColors[cap.team] }}>{teamNames[cap.team]}</span> scores!
      </>
    ) : (
      "🎉 Capture!"
    );
    sub = cap ? `${name(cap.slot)} brought the flag home · line-up in ${secs}s` : `Line-up in ${secs}s`;
  } else {
    head =
      winner === null || winner < 0 ? (
        "🤝 It's a draw!"
      ) : (
        <>
          🏆 <span style={{ color: teamColors[winner] }}>{teamNames[winner]}</span> wins{myTeam === winner ? ": that's you!" : "!"}
        </>
      );
    sub = view.how === "forfeit" ? "The other team left the field" : `Final score ${view.score[0]}–${view.score[1]}`;
  }
  const abandonIn = view.abandonAt ? Math.max(0, Math.ceil((view.abandonAt - now) / 1000)) : null;
  if (abandonIn !== null && phase !== "final") {
    sub = `⏳ A whole team dropped out · the match ends in ${abandonIn}s unless someone returns`;
    urgent = true;
  }

  // ----- clock -----
  const clockMs = phase === "play" && view.clockEndsAt ? view.clockEndsAt - now : view.clockLeft;
  let timerEnds = 0;
  let timerTotal = 0;
  let timerColor = accent;
  if (phase === "countdown") {
    timerEnds = view.endsAt;
    timerTotal = view.n > 1 ? 2_200 : COUNTDOWN_MS;
  } else if (phase === "scored") {
    timerEnds = view.endsAt;
    timerTotal = SCORED_MS;
    timerColor = view.lastCap ? teamColors[view.lastCap.team] : accent;
  } else if (phase === "play") {
    timerEnds = view.clockEndsAt;
    timerTotal = view.overtime ? OVERTIME_MS : view.timeLimit;
    if (view.overtime || clockMs < 30_000) timerColor = "#f87171";
  }

  const data: FieldData = { view, mySlot, myTeam, teamColors, teamNames, names, avatars, reduced };
  const label =
    `Flag Raid field. ${teamNames[0]} ${view.score[0]}, ${teamNames[1]} ${view.score[1]}.` +
    (myTeam >= 0 ? ` You're on ${teamNames[myTeam]}.` : "");

  return (
    <div className="@container mx-auto flex w-full max-w-4xl flex-col gap-2.5">
      <style href="ruckus-flags" precedence="default">
        {CSS}
      </style>
      <StatusBanner accent={alarm ? "#ff3b3b" : myTeam >= 0 ? teamColors[myTeam] : accent}>
        <div className={`truncate ${alarm ? "fr-alarm text-red-300" : ""}`} aria-live="polite">
          {head}
        </div>
        <div className={`truncate font-sans text-sm font-normal text-muted ${urgent || phase !== "play" ? "" : "hidden @md:block"}`}>{sub || " "}</div>
      </StatusBanner>

      <div className="flex items-stretch gap-2">
        <TeamScore team={0} score={view.score[0]} color={teamColors[0]} name={teamNames[0]} mine={myTeam === 0} leading={lead === 0} />
        <div className="flex min-w-[4.5rem] flex-col items-center justify-center rounded-xl border border-line bg-panel px-2 py-1 text-center">
          <span className={`font-mono text-lg font-bold tabular-nums ${view.overtime || (phase === "play" && clockMs < 30_000) ? "text-red-400" : ""}`}>
            {view.overtime ? "OT " : ""}
            {mmss(clockMs)}
          </span>
          <span className="text-[10px] tracking-wide text-muted uppercase">first to {view.capsNeeded}</span>
        </div>
        <TeamScore team={1} score={view.score[1]} color={teamColors[1]} name={teamNames[1]} mine={myTeam === 1} leading={lead === 1} />
      </div>
      <TimerBar endsAt={timerEnds} total={timerTotal} serverNow={serverNow} color={timerColor} />

      <Field
        data={data}
        act={act}
        onEvent={onEvent}
        canSteer={canSteer}
        label={label}
        hint={
          isPlayer ? (
            <>
              <span className="hidden pointer-fine:inline">
                Run with <Kbd>WASD</Kbd> or the arrow keys (or click and drag). Dashed ring = you&apos;re on enemy ground and can be tagged.
              </span>
              <span className="pointer-fine:hidden">Drag anywhere on the field to run. Dashed ring = you can be tagged there.</span>
            </>
          ) : null
        }
      >
        <Overlay view={view} secs={secs} myTeam={myTeam} teamColors={teamColors} teamNames={teamNames} name={name} />
      </Field>

      {!isPlayer && <Note>👀 You&apos;re spectating. Cheer for your favourite team!</Note>}

      <div className="grid grid-cols-2 gap-2">
        {[0, 1].map((team) => (
          <Roster key={team} team={team} view={view} byId={byId} mySlot={mySlot} color={teamColors[team]} teamName={teamNames[team]} winner={phase === "final" && winner === team} />
        ))}
      </div>
      {phase !== "final" && <Feed feed={view.feed} name={name} teamColors={teamColors} teamNames={teamNames} team={view.team} />}
      {phase === "final" && <Mvp view={view} byId={byId} teamColors={teamColors} players={players} />}
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-panel-2 px-1 py-px font-mono text-[11px] text-text">{children}</kbd>;
}

function TeamScore({ team, score, color, name, mine, leading }: { team: number; score: number; color: string; name: string; mine: boolean; leading: boolean }) {
  return (
    <div
      className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-2.5 py-1 @md:px-3 @md:py-1.5 ${team === 1 ? "flex-row-reverse text-right" : ""}`}
      style={{ borderColor: color + (leading ? "cc" : "55"), background: `linear-gradient(${team === 0 ? 90 : 270}deg, ${color}38, ${color}08)` }}
    >
      <span key={score} className="fr-bump font-display text-3xl leading-none font-black tabular-nums @md:text-4xl" style={{ color }}>
        {score}
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-display text-sm font-bold" style={{ color }}>
          {TEAM_EMOJI[team]} {name}
        </span>
        {mine && <span className="block text-[10px] font-semibold tracking-wide text-muted uppercase">your team</span>}
      </span>
    </div>
  );
}

function Overlay({
  view,
  secs,
  myTeam,
  teamColors,
  teamNames,
  name,
}: {
  view: FlagView;
  secs: number;
  myTeam: number;
  teamColors: [string, string];
  teamNames: [string, string];
  name: (slot: number) => string;
}) {
  if (view.phase === "countdown") {
    return (
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="flex flex-col items-center gap-1">
          {myTeam >= 0 && (
            <span className="rounded-full px-3 py-0.5 text-xs font-black tracking-wide text-ink uppercase" style={{ background: teamColors[myTeam] }}>
              You&apos;re {teamNames[myTeam]}
            </span>
          )}
          <span key={secs} className="animate-pop font-display text-7xl font-black text-white drop-shadow-[0_4px_14px_rgba(0,0,0,0.8)]">
            {Math.max(1, secs)}
          </span>
        </div>
      </div>
    );
  }
  if (view.phase === "scored" && view.lastCap) {
    const c = teamColors[view.lastCap.team];
    return (
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="fr-big flex flex-col items-center text-center">
          <span className="font-display text-5xl font-black tracking-tight drop-shadow-[0_4px_18px_rgba(0,0,0,0.9)] @md:text-7xl" style={{ color: c }}>
            {teamNames[view.lastCap.team].toUpperCase()} SCORES!
          </span>
          <span className="mt-1 rounded-full bg-ink/75 px-3 py-1 text-sm font-semibold text-white">
            🚩 {name(view.lastCap.slot)} · {view.score[0]}–{view.score[1]}
          </span>
        </div>
      </div>
    );
  }
  if (view.phase === "final") {
    const w = view.winTeam;
    return (
      <div className="pointer-events-none absolute inset-0 grid place-items-center bg-ink/40">
        <div className="fr-big flex flex-col items-center text-center">
          <span className="text-5xl">{w === null || w < 0 ? "🤝" : "🏆"}</span>
          <span className="font-display text-5xl font-black tracking-tight drop-shadow-[0_4px_18px_rgba(0,0,0,0.9)] @md:text-7xl" style={{ color: w !== null && w >= 0 ? teamColors[w] : "#fff" }}>
            {w === null || w < 0 ? "DRAW!" : `${teamNames[w].toUpperCase()} WINS!`}
          </span>
          <span className="mt-1 font-mono text-2xl font-bold text-white">
            {view.score[0]} – {view.score[1]}
          </span>
        </div>
      </div>
    );
  }
  return null;
}

function Roster({
  team,
  view,
  byId,
  mySlot,
  color,
  teamName,
  winner,
}: {
  team: number;
  view: FlagView;
  byId: Record<string, Player>;
  mySlot: number;
  color: string;
  teamName: string;
  winner: boolean;
}) {
  const slots = view.ids.map((_, i) => i).filter((i) => view.team[i] === team);
  const carrying = (slot: number) => view.snap.g[1 - team]?.[0] === slot;
  return (
    <div className="card min-w-0 p-2" style={{ borderColor: color + (winner ? "" : "44"), boxShadow: winner ? `0 0 24px -6px ${color}` : undefined }}>
      <div className="mb-1.5 flex items-center justify-between gap-1 px-1">
        <span className="truncate font-display text-sm font-bold" style={{ color }}>
          {winner ? "🏆 " : ""}
          {teamName}
        </span>
        <span className="shrink-0 text-[10px] text-muted">🚩 caps · ✋ tags</span>
      </div>
      <ul className="space-y-1">
        {slots.map((slot) => {
          const p = byId[view.ids[slot]];
          const out = Number(view.snap.s[slot] ?? 0) === ST_OUT;
          return (
            <li
              key={slot}
              className={`flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-sm ${slot === mySlot ? "bg-panel-2" : ""} ${p?.connected === false ? "opacity-45" : ""}`}
            >
              <span aria-hidden className={out && view.phase === "play" ? "opacity-40 grayscale" : ""}>
                <Avatar id={p?.avatar ?? "🙂"} />
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold" style={{ color: slot === mySlot ? "#fff" : color }}>
                {p?.name ?? "Someone"}
                {carrying(slot) && view.phase === "play" ? " 🚩" : ""}
              </span>
              <span className="shrink-0 font-mono text-xs text-muted tabular-nums">
                {view.caps[slot]}·{view.tags[slot]}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Feed({
  feed,
  name,
  teamColors,
  teamNames,
  team,
}: {
  feed: FeedItem[];
  name: (slot: number) => string;
  teamColors: [string, string];
  teamNames: [string, string];
  team: number[];
}) {
  if (!feed.length) return null;
  const items = feed.slice(-4).reverse();
  return (
    <ul className="card space-y-0.5 p-2 text-xs">
      {items.map((f, i) => {
        const c = (slot: number) => ({ color: teamColors[team[slot] ?? 0] });
        let body: ReactNode;
        if (f.k === "tag")
          body = (
            <>
              <b style={c(f.b)}>{name(f.b)}</b> tagged <b style={c(f.a)}>{name(f.a)}</b> ✋
            </>
          );
        else if (f.k === "grab")
          body = (
            <>
              <b style={c(f.a)}>{name(f.a)}</b> grabbed the <span style={{ color: teamColors[f.team] }}>{teamNames[f.team]}</span> flag 🚩
            </>
          );
        else if (f.k === "cap")
          body = (
            <>
              <b style={c(f.a)}>{name(f.a)}</b> scored for <span style={{ color: teamColors[f.team] }}>{teamNames[f.team]}</span> 🎉
            </>
          );
        else if (f.k === "ret")
          body =
            f.b >= 0 ? (
              <>
                <b style={c(f.b)}>{name(f.b)}</b> saved the <span style={{ color: teamColors[f.team] }}>{teamNames[f.team]}</span> flag ↩
              </>
            ) : (
              <>
                The <span style={{ color: teamColors[f.team] }}>{teamNames[f.team]}</span> flag went home ↩
              </>
            );
        else
          body = (
            <>
              The <span style={{ color: teamColors[f.team] }}>{teamNames[f.team]}</span> flag was dropped
            </>
          );
        return (
          <li key={`${f.at}-${i}`} className={`truncate ${i === 0 ? "text-text" : "text-muted"}`}>
            {body}
          </li>
        );
      })}
    </ul>
  );
}

function Mvp({ view, byId, teamColors, players }: { view: FlagView; byId: Record<string, Player>; teamColors: [string, string]; players: Player[] }) {
  const slots = view.ids.map((_, i) => i);
  const pick = (score: (i: number) => number) => {
    let best = -1;
    let bv = 0;
    for (const i of slots) if (score(i) > bv) [best, bv] = [i, score(i)];
    return best >= 0 ? { slot: best, v: bv } : null;
  };
  const awards = [
    { icon: "🚩", label: "Top raider", a: pick((i) => view.caps[i]), unit: "caps" },
    { icon: "✋", label: "Top tagger", a: pick((i) => view.tags[i]), unit: "tags" },
    { icon: "↩", label: "Flag saver", a: pick((i) => view.returns[i]), unit: "saves" },
  ].filter((x) => x.a);
  if (!awards.length || !players.length) return null;
  return (
    <div className="card grid gap-1.5 p-3 sm:grid-cols-3">
      {awards.map((x) => {
        const p = byId[view.ids[x.a!.slot]];
        return (
          <div key={x.label} className="flex items-center gap-2 rounded-lg bg-panel-2 px-2 py-1.5">
            <span className="text-xl">{x.icon}</span>
            <span className="min-w-0 leading-tight">
              <span className="block text-[10px] tracking-wide text-muted uppercase">{x.label}</span>
              <span className="block truncate text-sm font-bold" style={{ color: teamColors[view.team[x.a!.slot] ?? 0] }}>
                <Avatar id={p?.avatar ?? "🙂"} /> {p?.name ?? "Someone"} · {x.a!.v} {x.unit}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

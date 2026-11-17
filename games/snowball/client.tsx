"use client";

import { useMemo, useState, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import { PLAYER_COLORS, type Player } from "@/shared/types";
import { TEAMS } from "@/shared/teams";
import { Note, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import type { OutRec, SnowAction, SnowView } from "./server";
import {
  AMMO_PILE,
  COUNTDOWN_MS,
  FIELDS,
  POWER_INFO,
  ROUND_CAP_MS,
  ROUND_OVER_MS,
  SUDDEN_MS,
  isSnap,
} from "./shared";
import { Arena, type ArenaData } from "./arena";
import { Avatar } from "@/components/Avatar";
import { feedback, sfx } from "@/lib/feedback";

type Props = GameClientProps<SnowView, SnowAction>;

// Game-local styles and animations, prefixed so they can't clash with other games.
const CSS = `
.sb-stage { aspect-ratio: 25 / 16; max-width: min(100%, 98vh); }
@container (max-width: 559px) { .sb-stage { aspect-ratio: 16 / 25; max-width: min(100%, 46vh); } }
.sb-go { animation: sb-go .9s cubic-bezier(.2,1.4,.4,1) both; }
@keyframes sb-go { 0% { opacity: 0; transform: scale(.4); } 25% { opacity: 1; transform: scale(1.1); } 70% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(1.25); } }
.sb-banner { animation: sb-banner 2.2s ease both; }
@keyframes sb-banner { 0% { opacity: 0; transform: translateY(-8px) scale(.9); } 12% { opacity: 1; transform: none; } 80% { opacity: 1; } 100% { opacity: 0; } }
.sb-late { animation: sb-late 3.2s ease .35s both; }
@keyframes sb-late { 0% { opacity: 0; transform: scale(.7); } 12% { opacity: 1; transform: scale(1.04); } 18% { transform: scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translateY(-6px); } }
.sb-shake { animation: sb-shake .35s ease both; }
@keyframes sb-shake { 20% { transform: translateX(-4px); } 40% { transform: translateX(4px); } 60% { transform: translateX(-3px); } 80% { transform: translateX(2px); } }
.sb-pulse { animation: sb-pulse 1s ease-in-out infinite; }
@keyframes sb-pulse { 50% { opacity: .55; } }
@media (prefers-reduced-motion: reduce) {
  .sb-go, .sb-banner, .sb-late { animation: sb-fade .3s ease both; }
  .sb-shake, .sb-pulse { animation: none; }
  @keyframes sb-fade { from { opacity: 0; } }
}
`;

const MEDALS = ["🥇", "🥈", "🥉"];

// ---------- colours (no two kids may look alike) ----------

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function oklab(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = toLinear(((n >> 16) & 255) / 255);
  const g = toLinear(((n >> 8) & 255) / 255);
  const b = toLinear((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function colorDistance(a: string, b: string) {
  const [x, y] = [oklab(a), oklab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
const PALETTE = PLAYER_COLORS.map((c) => c.toLowerCase());
/** White coats vanish in the snow: anything too light is swapped too. */
const SNOW = "#eef5fc";

function displayColors(key: string): string[] {
  const used: string[] = [];
  return key.split("\n").map((raw) => {
    let c = raw.toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(c) || colorDistance(c, SNOW) < 0.12 || used.some((u) => colorDistance(u, c) < 0.12)) {
      let best = -1;
      for (const p of PALETTE) {
        if (used.includes(p) || colorDistance(p, SNOW) < 0.12) continue;
        const d = Math.min(Infinity, ...used.map((u) => colorDistance(u, p)));
        if (d > best) [best, c] = [d, p];
      }
    }
    used.push(c);
    return c;
  });
}

// ---------- small hooks ----------

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

/** Server time, refreshed every `ms` (kept in state so rendering stays pure). */
function useServerClock(serverNow: () => number, ms: number) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(id);
  }, [serverNow, ms]);
  return now;
}

function isView(v: unknown): v is SnowView {
  if (!v || typeof v !== "object") return false;
  const x = v as Partial<SnowView>;
  return Array.isArray(x.ids) && Array.isArray(x.wins) && Array.isArray(x.outs) && isSnap(x.snap);
}

// ---------- component ----------

/** "Red 2 · Blue 1" style count of kids still standing per team. */
function teamStanding(team: number[], outSet: Set<number>, countdown: boolean) {
  return TEAMS.map((t, i) => `${t.name} ${team.filter((x, slot) => x === i && (countdown || !outSet.has(slot))).length}`).join(" · ");
}

export default function SnowballShowdown(props: Props) {
  // Also guards against a stale view from another game arriving before ours.
  if (!isView(props.view)) {
    return (
      <div className="card grid min-h-[40vh] place-items-center p-6">
        <Note>Packing snowballs…</Note>
      </div>
    );
  }
  return <Game {...props} view={props.view} />;
}

function Game({ view, me, players, byId, isPlayer, act, serverNow, onEvent, accent }: Omit<Props, "view"> & { view: SnowView }) {
  const reduced = useReducedMotion();
  const now = useServerClock(serverNow, 250);
  const secs = useSecondsLeft(view.endsAt, serverNow);
  const { phase, round, ids } = view;
  const field = FIELDS[view.field] ?? FIELDS[0];

  const colorKey = ids.map((id) => byId[id]?.color ?? "").join("\n");
  const teams = view.teams;
  const teamKey = teams ? teams.map((t) => t.join(",")).join("|") : "";
  /** Team per slot (-1 in solo mode). */
  const team = useMemo(
    () => ids.map((id) => (teamKey ? teamKey.split("|").findIndex((t) => t.split(",").includes(id)) : -1)),
    [ids, teamKey],
  );
  const solo = useMemo(() => displayColors(colorKey), [colorKey]);
  // Red vs Blue: every coat (and snowball, and name) is in its team's colour, so friend and foe
  // are obvious at a glance.
  const colors = useMemo(() => (teamKey ? team.map((t, i) => TEAMS[t]?.color ?? solo[i]) : solo), [teamKey, team, solo]);
  const names = ids.map((id) => byId[id]?.name ?? "Someone");
  const avatars = ids.map((id) => byId[id]?.avatar ?? "🙂");
  const offline = ids.map((id) => byId[id]?.connected === false);
  const mySlot = isPlayer ? ids.indexOf(me) : -1;
  const myTeam = mySlot >= 0 ? team[mySlot] : -1;
  const outSet = new Set(view.outs.map((o) => o.s));
  const standing = ids.length - (phase === "countdown" ? 0 : outSet.size);
  const imAlive = mySlot >= 0 && (phase === "countdown" || !outSet.has(mySlot));
  const canSteer = mySlot >= 0 && imAlive && (phase === "fight" || phase === "roundOver");
  const canThrow = mySlot >= 0 && imAlive && phase === "fight";
  const fightMs = phase === "fight" && view.fightAt ? Math.max(0, now - view.fightAt) : 0;
  const abandonIn = view.abandonAt ? Math.max(0, Math.ceil((view.abandonAt - now) / 1000)) : null;
  const name = (id: string | null | undefined) => (id ? (byId[id]?.name ?? "Someone") : "Someone");

  // Countdown ticks for the last three seconds, then "go" (a buzz too if you're playing).
  useEffect(() => {
    if (phase === "countdown" && secs > 0 && secs <= 3) sfx("tick");
  }, [phase, secs]);
  const lastPhase = useRef(phase);
  useEffect(() => {
    const was = lastPhase.current;
    lastPhase.current = phase;
    if (was === "countdown" && phase === "fight") {
      if (mySlot >= 0) feedback("go");
      else sfx("go");
    }
  }, [phase, mySlot]);

  // ----- status copy -----
  const winner = view.lastWinner;
  let head: ReactNode;
  let sub: ReactNode;
  const left = teams ? teamStanding(team, outSet, phase === "countdown") + " standing" : `${standing} still standing`;
  if (phase === "countdown") {
    head = `Round ${round} · ${field.name}`;
    sub = teams
      ? myTeam >= 0
        ? `You're on ${TEAMS[myTeam].name} (white ring). No friendly fire!`
        : `${TEAMS[0].name} vs ${TEAMS[1].name}`
      : mySlot >= 0
        ? "You're the one with the white ring. Find cover!"
        : `${ids.length} kids about to get snowy`;
  } else if (phase === "fight") {
    if (mySlot >= 0 && !imAlive) {
      head = "💫 You got snowed!";
      sub = `${left} · you're back next round`;
    } else {
      head = view.sudden ? "🌨️ Blizzard! One hit and you're out" : "❄️ Snowball fight!";
      sub = left + (fightMs < 12_000 && !view.sudden ? ` · grab ${POWER_INFO.big.icon} ${POWER_INFO.triple.icon} power-ups and ❄ piles` : "");
    }
  } else if (phase === "roundOver") {
    head = teams
      ? view.lastTeam !== null
        ? `🏆 ${TEAMS[view.lastTeam].name} team takes round ${round}!`
        : "🤝 Draw: nobody left standing"
      : winner
        ? `🏆 ${winner === me ? "You take" : `${name(winner)} takes`} round ${round}!`
        : "🤝 Draw: nobody left standing";
    sub = `Next round in ${secs}s · first to ${view.winsNeeded} wins`;
  } else {
    head = teams && view.champTeam !== null ? `🏁 ${TEAMS[view.champTeam].name} team wins!` : "🏁 Match over";
    sub = teams ? `${TEAMS[0].name} ${view.teamWins[0]} – ${view.teamWins[1]} ${TEAMS[1].name} · final standings below` : "Final standings below";
  }
  if (abandonIn !== null && phase !== "final") {
    const gone = players.filter((p) => !p.connected).map((p) => p.name);
    sub = `⏳ ${gone.length ? gone.join(", ") : "Players"} dropped out · the match ends in ${abandonIn}s unless someone returns`;
  }

  // ----- timer row -----
  let timerEnds = 0;
  let timerTotal = 0;
  let timerColor = accent;
  let clock: string;
  if (phase === "countdown") {
    timerEnds = view.endsAt;
    timerTotal = COUNTDOWN_MS;
    clock = `starts in ${secs}`;
  } else if (phase === "fight") {
    if (!view.sudden) {
      timerEnds = view.fightAt + SUDDEN_MS;
      timerTotal = SUDDEN_MS;
      clock = `blizzard in ${Math.max(1, Math.ceil((SUDDEN_MS - fightMs) / 1000))}s`;
    } else {
      timerEnds = view.fightAt + ROUND_CAP_MS;
      timerTotal = ROUND_CAP_MS - SUDDEN_MS;
      timerColor = "#f87171";
      clock = `draw in ${Math.max(0, Math.ceil((ROUND_CAP_MS - fightMs) / 1000))}s`;
    }
  } else if (phase === "roundOver") {
    timerEnds = view.endsAt;
    timerTotal = ROUND_OVER_MS;
    clock = `next round in ${secs}`;
  } else {
    clock = `${view.history.length} round${view.history.length === 1 ? "" : "s"} played`;
  }

  const wonTeam = phase === "final" ? view.champTeam : view.lastTeam;
  const ring = view.sudden && phase === "fight"
    ? "#f87171"
    : phase === "countdown" && mySlot >= 0
      ? colors[mySlot]
      : (phase === "roundOver" || phase === "final") && teams && wonTeam !== null
        ? TEAMS[wonTeam].color
        : (phase === "roundOver" || phase === "final") && winner
          ? (colors[ids.indexOf(winner)] ?? accent)
          : accent + "88";

  const data: ArenaData = { view, mySlot, colors, names, avatars, reduced, accent, offline, team };
  const label =
    `Snowy field "${field.name}", round ${round}. ${standing} of ${ids.length} kids standing.` +
    (mySlot >= 0 ? (imAlive ? " You're still in." : " You're out this round.") : "");

  return (
    <div className="@container mx-auto flex w-full max-w-4xl flex-col gap-3">
      <style href="ruckus-snowball" precedence="default">
        {CSS}
      </style>
      <StatusBanner accent={accent}>
        <div className="truncate" aria-live="polite" title={typeof head === "string" ? head : undefined}>
          {head}
        </div>
        <div className="truncate font-sans text-sm font-normal text-muted">{sub || " "}</div>
      </StatusBanner>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="truncate font-semibold">
            Round {round}
            <span className="font-normal text-muted">
              {" "}
              of {view.maxRounds} max · first to {view.winsNeeded}
            </span>
          </span>
          <span className={`shrink-0 tabular-nums ${view.sudden && phase === "fight" ? "sb-pulse font-bold text-red-400" : "text-muted"}`}>
            {view.sudden && phase === "fight" ? "🌨️" : "⏱"} {clock}
          </span>
        </div>
        <TimerBar endsAt={timerEnds} total={timerTotal} serverNow={serverNow} color={timerColor} />
      </div>

      <Arena
        data={data}
        act={act}
        onEvent={onEvent}
        canSteer={canSteer}
        canThrow={canThrow}
        label={label}
        ringColor={ring}
        hint={
          <>
            <span className="hidden pointer-fine:inline">
              Walk with <Kbd>WASD</Kbd>, aim with the mouse and click to throw (<Kbd>Space</Kbd> too). Long throws arc
              over walls. Walk over ❄ piles for {AMMO_PILE} snowballs.
            </span>
            <span className="pointer-fine:hidden">
              Left thumb walks. Right thumb: drag to aim (farther = longer throw), let go to throw, or tap to throw at
              the nearest kid.
            </span>
          </>
        }
      >
        <Overlay view={view} me={me} secs={secs} fightMs={fightMs} byId={byId} colors={colors} team={team} />
      </Arena>

      {!isPlayer && <Note>👀 You&apos;re spectating. Every snowball is thrown by a real player.</Note>}

      {phase !== "final" && teams && <TeamScore view={view} players={players} me={me} team={team} outSet={outSet} />}
      {phase !== "final" && !teams && <ScoreRow view={view} players={players} me={me} colors={colors} outSet={outSet} />}
      {phase !== "final" && <Feed outs={view.outs} ids={ids} byId={byId} colors={colors} />}
      {phase === "final" && teams && <TeamResult view={view} me={me} />}
      {phase === "final" && <FinalStandings view={view} byId={byId} me={me} colors={colors} />}
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-panel-2 px-1 py-px font-mono text-[11px] text-text">{children}</kbd>;
}

function Overlay({
  view,
  me,
  secs,
  fightMs,
  byId,
  colors,
  team,
}: {
  view: SnowView;
  me: string;
  secs: number;
  fightMs: number;
  byId: Record<string, Player>;
  colors: string[];
  team: number[];
}) {
  if (view.phase === "countdown") {
    const mine = view.ids.indexOf(me);
    const myTeam = mine >= 0 ? team[mine] : -1;
    return (
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="flex flex-col items-center">
          {view.teams && <TeamIntro view={view} me={me} myTeam={myTeam} byId={byId} />}
          <span className="rounded-full bg-ink/70 px-3 py-0.5 text-xs font-semibold tracking-wide text-white uppercase">
            Round {view.round} · {(FIELDS[view.field] ?? FIELDS[0]).name}
          </span>
          <span
            key={secs}
            className="animate-pop font-display text-6xl font-black text-white drop-shadow-[0_4px_14px_rgba(15,23,42,0.75)] @2xl:text-8xl"
          >
            {Math.max(1, secs)}
          </span>
        </div>
      </div>
    );
  }
  if (view.phase === "fight") {
    if (fightMs < 900) {
      return (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="sb-go font-display text-6xl font-black text-white drop-shadow-[0_4px_14px_rgba(15,23,42,0.75)] @2xl:text-8xl">
            THROW!
          </span>
        </div>
      );
    }
    if (view.sudden && fightMs < SUDDEN_MS + 2200) {
      return (
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
          <span className="sb-banner rounded-full bg-sky-600/90 px-4 py-1 font-display text-sm font-black tracking-wide text-white shadow-lg shadow-black/40 @xl:text-lg">
            🌨️ BLIZZARD · one hit and you&apos;re out
          </span>
        </div>
      );
    }
    return null;
  }
  if (view.phase === "roundOver" && view.teams) {
    const t = view.lastTeam;
    const color = t !== null ? TEAMS[t].color : undefined;
    const mine = view.ids.indexOf(me);
    return (
      <div className="pointer-events-none absolute inset-x-0 top-[9%] grid place-items-center">
        <div
          className="sb-late card flex max-w-[85%] flex-col items-center px-4 py-2.5 text-center shadow-xl shadow-black/40 @xl:px-6 @xl:py-4"
          style={{ borderColor: color, background: "color-mix(in oklab, var(--color-panel) 90%, transparent)" }}
        >
          <span className="max-w-full truncate font-display text-lg font-extrabold @xl:text-3xl" style={{ color }}>
            {t !== null ? `${TEAMS[t].name} team${mine >= 0 && team[mine] === t ? " (you!)" : ""}` : "Draw"}
          </span>
          <span className="text-xs text-muted @xl:text-sm">
            {t !== null ? `last team standing · round ${view.round}` : "nobody left standing"}
          </span>
          <span className="mt-1 font-mono text-sm font-bold tabular-nums">
            <span style={{ color: TEAMS[0].color }}>{view.teamWins[0]}</span>
            <span className="text-muted"> – </span>
            <span style={{ color: TEAMS[1].color }}>{view.teamWins[1]}</span>
          </span>
        </div>
      </div>
    );
  }
  if (view.phase === "roundOver") {
    const w = view.lastWinner;
    const p = w ? byId[w] : undefined;
    const color = w ? colors[view.ids.indexOf(w)] : undefined;
    return (
      <div className="pointer-events-none absolute inset-x-0 top-[9%] grid place-items-center">
        <div
          className="sb-late card flex max-w-[85%] flex-col items-center px-4 py-2.5 text-center shadow-xl shadow-black/40 @xl:px-6 @xl:py-4"
          style={{ borderColor: color, background: "color-mix(in oklab, var(--color-panel) 90%, transparent)" }}
        >
          <span className="text-3xl @xl:text-5xl" aria-hidden>
            <Avatar id={p ? p.avatar : "🤝"} />
          </span>
          <span className="max-w-full truncate font-display text-lg font-extrabold @xl:text-3xl" style={{ color }}>
            {w ? (w === me ? "You!" : (p?.name ?? "Someone")) : "Draw"}
          </span>
          <span className="text-xs text-muted @xl:text-sm">
            {w ? `last one standing · round ${view.round}` : "nobody left standing"}
          </span>
        </div>
      </div>
    );
  }
  return null;
}

/** Countdown card: which team you're on and who's with you. */
function TeamIntro({ view, me, myTeam, byId }: { view: SnowView; me: string; myTeam: number; byId: Record<string, Player> }) {
  const teams = view.teams;
  if (!teams) return null;
  if (myTeam < 0) {
    return (
      <span className="mb-2 rounded-full bg-ink/75 px-4 py-1 font-display text-lg font-black text-white">
        <span style={{ color: TEAMS[0].color }}>{TEAMS[0].name}</span> vs <span style={{ color: TEAMS[1].color }}>{TEAMS[1].name}</span>
      </span>
    );
  }
  const t = TEAMS[myTeam];
  const mates = teams[myTeam].filter((id) => id !== me).map((id) => byId[id]?.name ?? "Someone");
  return (
    <div
      className="mb-2 flex max-w-[90%] flex-col items-center rounded-2xl border-2 bg-ink/80 px-4 py-1.5 text-center shadow-lg shadow-black/40"
      style={{ borderColor: t.color }}
    >
      <span className="font-display text-xl font-black whitespace-nowrap @xl:text-3xl" style={{ color: t.color }}>
        You&apos;re on {t.name}
      </span>
      <span className="max-w-full truncate text-xs text-white/85 @xl:text-sm">
        {mates.length ? `with ${mates.join(", ")}` : "on your own: good luck!"}
      </span>
    </div>
  );
}

/** Team mode scoreboard: each team's round wins, then its kids. */
function TeamScore({
  view,
  players,
  me,
  team,
  outSet,
}: {
  view: SnowView;
  players: Player[];
  me: string;
  team: number[];
  outSet: Set<number>;
}) {
  return (
    <div className="grid grid-cols-2 gap-2" aria-label="Teams">
      {TEAMS.map((t, ti) => (
        <section
          key={t.name}
          className="flex min-w-0 flex-col gap-1.5 rounded-xl border px-2 py-1.5"
          style={{ borderColor: t.color + "88", background: t.color + "14" }}
          aria-label={`${t.name} team, ${view.teamWins[ti]} round wins`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-display font-black" style={{ color: t.color }}>
              {t.name}
            </span>
            <span className="flex items-center gap-1.5">
              <Pips wins={view.teamWins[ti]} color={t.color} need={view.winsNeeded} />
              <span className="font-mono font-bold tabular-nums">{view.teamWins[ti]}</span>
            </span>
          </div>
          <ul className="flex flex-wrap gap-1">
            {view.ids.map((id, slot) => {
              if (team[slot] !== ti) return null;
              const p = players.find((x) => x.id === id);
              const on = view.phase === "countdown" || !outSet.has(slot);
              const offline = p?.connected === false;
              const hits = view.hits[slot] ?? 0;
              return (
                <li
                  key={id}
                  className={`flex min-h-8 max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-sm ${on ? "" : "opacity-55"} ${id === me ? "ring-2 ring-white/60" : ""}`}
                  style={{ borderColor: t.color + "88" }}
                >
                  <span aria-hidden><Avatar id={p?.avatar ?? "🙂"} /></span>
                  <span className="max-w-[6.5rem] truncate font-semibold">{p?.name ?? "Someone"}</span>
                  {id === me && <span className="text-[10px] font-bold tracking-wide text-text/80 uppercase">you</span>}
                  <span className="font-mono text-xs text-muted tabular-nums" aria-hidden>
                    {offline ? "🔌" : on ? "⛄" : "💫"}
                    {hits > 0 ? ` 🎯${hits}` : ""}
                  </span>
                  <span className="sr-only">, {offline ? "offline" : on ? "standing" : "snowed out"}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Team mode: the big "Red team wins!" card above the standings. */
function TeamResult({ view, me }: { view: SnowView; me: string }) {
  const t = view.champTeam;
  const color = t !== null ? TEAMS[t].color : undefined;
  const mine = view.teams ? view.teams.findIndex((ids) => ids.includes(me)) : -1;
  return (
    <section
      className="card animate-rise flex flex-col items-center gap-1 px-4 py-3 text-center"
      style={color ? { borderColor: color, background: `linear-gradient(180deg, ${color}26, transparent 80%), var(--color-panel)` } : undefined}
      aria-label="Team result"
    >
      <span className="font-display text-2xl font-black @xl:text-4xl" style={{ color }}>
        {t !== null ? `${TEAMS[t].name} team wins!` : "It's a draw!"}
      </span>
      <span className="font-mono text-lg font-bold tabular-nums">
        <span style={{ color: TEAMS[0].color }}>{TEAMS[0].name} {view.teamWins[0]}</span>
        <span className="text-muted"> – </span>
        <span style={{ color: TEAMS[1].color }}>{view.teamWins[1]} {TEAMS[1].name}</span>
      </span>
      {mine >= 0 && t !== null && <span className="text-sm text-muted">{mine === t ? "🎉 Your team won!" : "Your team will get them next time."}</span>}
    </section>
  );
}

function Pips({ wins, color, need }: { wins: number; color: string; need: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-hidden>
      {Array.from({ length: Math.max(need, wins) }, (_, i) => (
        <span
          key={i}
          className={`size-2 rounded-full border ${i < wins ? "animate-pop" : ""}`}
          style={{ borderColor: color, background: i < wins ? color : "transparent" }}
        />
      ))}
    </span>
  );
}

function ScoreRow({
  view,
  players,
  me,
  colors,
  outSet,
}: {
  view: SnowView;
  players: Player[];
  me: string;
  colors: string[];
  outSet: Set<number>;
}) {
  return (
    <ul className="flex flex-wrap justify-center gap-1.5" aria-label="Players">
      {view.ids.map((id, slot) => {
        const p = players.find((x) => x.id === id);
        const color = colors[slot] ?? "#94a3b8";
        const wins = view.wins[slot] ?? 0;
        const hits = view.hits[slot] ?? 0;
        const on = view.phase === "countdown" || !outSet.has(slot);
        const offline = p?.connected === false;
        const state = offline ? "offline" : on ? "standing" : "snowed out";
        return (
          <li
            key={id}
            className={`flex min-h-9 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm transition-opacity ${on ? "" : "opacity-55"} ${id === me ? "ring-2 ring-white/60" : ""}`}
            style={{ borderColor: color + "88", background: color + "1c" }}
          >
            <span aria-hidden><Avatar id={p?.avatar ?? "🙂"} /></span>
            <span className="max-w-[7.5rem] truncate font-semibold" style={{ color }}>
              {p?.name ?? "Someone"}
            </span>
            {id === me && <span className="text-[10px] font-bold tracking-wide text-text/80 uppercase">you</span>}
            <Pips wins={wins} color={color} need={view.winsNeeded} />
            <span className="font-mono text-xs text-muted tabular-nums" aria-hidden>
              {offline ? "🔌" : on ? "⛄" : "💫"}
              {hits > 0 ? ` 🎯${hits}` : ""}
            </span>
            <span className="sr-only">
              , {wins} round win{wins === 1 ? "" : "s"}, {hits} hit{hits === 1 ? "" : "s"}, {state}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Feed({ outs, ids, byId, colors }: { outs: OutRec[]; ids: string[]; byId: Record<string, Player>; colors: string[] }) {
  const who = (slot: number) => <b style={{ color: colors[slot] }}>{byId[ids[slot]]?.name ?? "someone"}</b>;
  return (
    <ol className="flex min-h-14 flex-col items-center gap-0.5 text-sm" aria-label="Knockouts this round" aria-live="polite">
      {outs
        .slice(-3)
        .reverse()
        .map((o, i) => (
          <li key={`${o.s}-${o.at}`} className={`animate-rise max-w-full truncate ${i > 0 ? "text-muted opacity-70" : ""}`}>
            {o.by >= 0 ? (
              <>
                ❄️ {who(o.by)} snowed {who(o.s)} out
              </>
            ) : (
              <>💫 {who(o.s)} is out</>
            )}
          </li>
        ))}
    </ol>
  );
}

function FinalStandings({ view, byId, me, colors }: { view: SnowView; byId: Record<string, Player>; me: string; colors: string[] }) {
  const champs = view.champions ?? [];
  const slots = view.ids.map((_, i) => i);
  const champ = (s: number) => (champs.includes(view.ids[s]) ? 1 : 0);
  const wins = (s: number) => view.wins[s] ?? 0;
  const kos = (s: number) => view.kos[s] ?? 0;
  const hits = (s: number) => view.hits[s] ?? 0;
  const order = slots.slice().sort((a, b) => champ(b) - champ(a) || wins(b) - wins(a) || kos(b) - kos(a) || hits(b) - hits(a));
  const topHits = Math.max(0, ...slots.map(hits));
  const aces = slots.filter((s) => hits(s) === topHits && topHits > 0);
  return (
    <div className="grid gap-3 @xl:grid-cols-[3fr_2fr]">
      <section className="card p-3" aria-label="Final standings">
        <div className="label mb-2">Final standings</div>
        <ol className="space-y-1.5">
          {order.map((slot, i) => {
            const id = view.ids[slot];
            const p = byId[id];
            const color = colors[slot] ?? "#94a3b8";
            const isChamp = champ(slot) === 1;
            const rank = isChamp ? 1 : 1 + order.filter((o) => champ(o) > 0 || wins(o) > wins(slot)).length;
            return (
              <li
                key={id}
                className="animate-rise flex min-h-11 items-center gap-2 rounded-xl border px-2 py-1.5"
                style={{
                  animationDelay: `${120 + i * 70}ms`,
                  borderColor: isChamp ? color : "transparent",
                  background: isChamp ? color + "22" : "var(--color-panel-2)",
                  boxShadow: isChamp ? `0 0 18px ${color}33` : undefined,
                }}
              >
                <span className="w-7 shrink-0 text-center text-lg leading-none" aria-hidden>
                  {rank <= 3 && (isChamp || wins(slot) > 0) ? MEDALS[rank - 1] : <span className="text-sm text-muted">{rank}</span>}
                </span>
                <span className="sr-only">Place {rank}:</span>
                <span className="relative shrink-0 text-xl leading-none" aria-hidden>
                  <Avatar id={p?.avatar ?? "🙂"} />
                  {isChamp && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-sm motion-safe:animate-bounce">👑</span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-semibold" style={{ color }}>
                      {p?.name ?? "Someone"}
                    </span>
                    {id === me && <span className="shrink-0 text-[10px] font-bold tracking-wide text-muted uppercase">you</span>}
                  </span>
                  <span className="block text-xs text-muted tabular-nums">
                    🎯 {hits(slot)} hit{hits(slot) === 1 ? "" : "s"} · ❄️ {kos(slot)} knockout{kos(slot) === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Pips wins={wins(slot)} color={color} need={view.winsNeeded} />
                  <span className="w-5 text-right font-mono text-lg font-bold tabular-nums">{wins(slot)}</span>
                  <span className="sr-only"> round win{wins(slot) === 1 ? "" : "s"}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </section>
      <section className="card flex animate-rise flex-col gap-3 p-3" style={{ animationDelay: "260ms" }} aria-label="Rounds">
        <div>
          <div className="label mb-2">Rounds</div>
          <ol className="space-y-1 text-sm">
            {view.history.map((r, i) => {
              const slot = r.winner ? view.ids.indexOf(r.winner) : -1;
              const firstOut = r.order.length ? r.order[0] : -1;
              return (
                <li key={i} className="flex min-w-0 items-baseline gap-2">
                  <span className="w-7 shrink-0 font-mono text-xs text-muted">R{i + 1}</span>
                  <span className="min-w-0 break-words">
                    {r.team !== undefined ? (
                      r.team >= 0 ? (
                        <b style={{ color: TEAMS[r.team]?.color }}>{TEAMS[r.team]?.name ?? "?"} team</b>
                      ) : (
                        "🤝 Draw"
                      )
                    ) : r.winner ? (
                      <>
                        <span aria-hidden><Avatar id={byId[r.winner]?.avatar ?? "🏆"} /></span>{" "}
                        <b style={{ color: colors[slot] }}>{byId[r.winner]?.name ?? "Someone"}</b>
                      </>
                    ) : (
                      "🤝 Draw"
                    )}
                    {firstOut >= 0 && view.ids.length > 2 && (
                      <span className="text-muted"> · 💫 {byId[view.ids[firstOut]]?.name ?? "someone"} out first</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
        {aces.length > 0 && (
          <div className="rounded-lg bg-panel-2 px-3 py-2 text-sm">
            <span className="label">Sharpshooter</span>
            <div className="mt-0.5 truncate">
              🎯{" "}
              {aces.map((s, i) => (
                <span key={s}>
                  {i > 0 && ", "}
                  <b style={{ color: colors[s] }}>{byId[view.ids[s]]?.name ?? "Someone"}</b>
                </span>
              ))}{" "}
              <span className="text-muted">
                · {topHits} hit{topHits === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

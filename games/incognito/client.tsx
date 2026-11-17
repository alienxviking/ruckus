"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import { PLAYER_COLORS, type Player } from "@/shared/types";
import { Note, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import type { IncAction, IncView, RoundRec, SnipeRec } from "./server";
import {
  DARTS,
  DART_MS,
  EXPOSE_MS,
  INTRO_MS,
  LANDMARKS,
  NPC_COUNT,
  PARKS,
  PLAY_MS,
  PTS_ALL_LIT,
  PTS_MOST_LIT,
  PTS_SNIPE,
  PTS_SURVIVOR,
  ROUND_OVER_MS,
  SNIPE_CD_MS,
  countBits,
  isSnap,
} from "./shared";
import { ParkView, type ParkData } from "./park";
import { Avatar } from "@/components/Avatar";

type Props = GameClientProps<IncView, IncAction>;

// Game-local styles and animations, prefixed so they can't clash with other games.
const CSS = `
.inc-stage { aspect-ratio: 10 / 7; max-width: min(100%, 88vh); }
@container (max-width: 559px) { .inc-stage { aspect-ratio: 7 / 10; max-width: min(100%, 43vh); } }
.inc-card { animation: inc-card 4.2s ease .2s both; }
@keyframes inc-card { 0% { opacity: 0; transform: scale(.7); } 9% { opacity: 1; transform: scale(1.04); } 14% { transform: scale(1); } 82% { opacity: 1; } 100% { opacity: 0; } }
.inc-count { animation: inc-count .9s ease both; }
@keyframes inc-count { 0% { opacity: 0; transform: scale(.4); } 35% { opacity: 1; transform: scale(1.12); } 100% { opacity: 1; transform: scale(1); } }
.inc-toast { animation: inc-toast 2.2s ease both; }
@keyframes inc-toast { 0% { opacity: 0; transform: translateY(6px); } 10% { opacity: 1; transform: none; } 80% { opacity: 1; } 100% { opacity: 0; } }
.inc-lit { animation: inc-lit .6s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes inc-lit { 0% { transform: scale(.6); } 60% { transform: scale(1.25); } 100% { transform: scale(1); } }
.inc-flash { animation: inc-flash .26s steps(2) infinite; }
@keyframes inc-flash { 50% { opacity: .55; } }
@media (prefers-reduced-motion: reduce) {
  .inc-count, .inc-lit { animation: inc-fade .3s ease both; }
  .inc-card { animation: inc-card-calm 4.2s linear both; }
  @keyframes inc-card-calm { 0%, 90% { opacity: 1; } 100% { opacity: 0; } }
  .inc-flash { animation: none; }
  @keyframes inc-fade { from { opacity: 0; } }
}
`;

const MEDALS = ["🥇", "🥈", "🥉"];

// ---------- colours (no two players may look alike: the exposed flash names you by colour) ----------

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
/** Tan is the crowd's coat colour, so players never wear it. */
const COAT_TAN = "#c49a5c";

function displayColors(key: string): string[] {
  const used: string[] = [];
  return key.split("\n").map((raw) => {
    let c = raw.toLowerCase();
    const clash = (x: string) => colorDistance(COAT_TAN, x) < 0.1 || used.some((u) => colorDistance(u, x) < 0.12);
    if (!/^#[0-9a-f]{6}$/.test(c) || clash(c)) {
      let best = -1;
      for (const p of PALETTE) {
        if (used.includes(p)) continue;
        const d = Math.min(colorDistance(COAT_TAN, p) * 1.5, ...used.map((u) => colorDistance(u, p)));
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

function isView(v: unknown): v is IncView {
  if (!v || typeof v !== "object") return false;
  const x = v as Partial<IncView>;
  return Array.isArray(x.ids) && Array.isArray(x.scores) && Array.isArray(x.snipes) && isSnap(x.snap);
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// ---------- component ----------

export default function Incognito(props: Props) {
  // Also guards against a stale view from another game arriving before ours.
  if (!isView(props.view)) {
    return (
      <div className="card grid min-h-[40vh] place-items-center p-6">
        <Note>Opening the park gates…</Note>
      </div>
    );
  }
  return <Game {...props} view={props.view} />;
}

interface Ctl {
  want: [number, number, number];
  sent: string;
  sentAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

function Game({ view, me, players, byId, isPlayer, act, serverNow, onEvent, accent }: Omit<Props, "view"> & { view: IncView }) {
  const reduced = useReducedMotion();
  const now = useServerClock(serverNow, 250);
  const secs = useSecondsLeft(view.endsAt, serverNow);
  const { phase, round, ids } = view;
  const park = PARKS[view.park] ?? PARKS[0];

  const colorKey = ids.map((id) => byId[id]?.color ?? "").join("\n");
  const colors = useMemo(() => displayColors(colorKey), [colorKey]);
  const names = ids.map((id) => byId[id]?.name ?? "Someone");
  const avatars = ids.map((id) => byId[id]?.avatar ?? "🙂");
  const name = (slot: number) => (slot === mySlot ? "You" : (names[slot] ?? "Someone"));
  const mySlot = isPlayer ? ids.indexOf(me) : -1;

  // ----- private news from the server: landmarks you lit, refused darts -----
  const [litEv, setLitEv] = useState({ n: 0, m: 0 });
  const [fired, setFired] = useState({ n: 0, c: 0 });
  const [reloading, setReloading] = useState(false);
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const [litPop, setLitPop] = useState({ l: -1, key: 0 });
  const onServerEvent = useEffectEvent((e: unknown) => {
    if (!e || typeof e !== "object") return;
    const ev = e as { k?: unknown; n?: unknown; l?: unknown; m?: unknown; w?: unknown; why?: unknown };
    if (ev.k === "lit" && typeof ev.m === "number" && typeof ev.n === "number" && typeof ev.l === "number") {
      setLitEv({ n: ev.n, m: ev.m });
      setLitPop((p) => ({ l: ev.l as number, key: p.key + 1 }));
    } else if (ev.k === "no" && typeof ev.why === "string") {
      setToast((t) => ({ text: ev.why as string, key: (t?.key ?? 0) + 1 }));
      setFired((f) => ({ ...f, c: Math.max(0, f.c - 1) }));
    }
  });
  useEffect(() => onEvent((e) => onServerEvent(e)), [onEvent]);

  const lit = view.lit | (litEv.n === round ? litEv.m : 0);
  const litCount = countBits(lit);
  const out = mySlot >= 0 && view.snipes.some((r) => r.hit === mySlot);
  const myDarts = mySlot >= 0 ? Math.min(view.darts[mySlot] ?? 0, DARTS - (fired.n === round ? fired.c : 0)) : 0;
  const steer = mySlot >= 0 && !out && (phase === "intro" || phase === "play");
  const armed = steer && phase === "play" && myDarts > 0 && !reloading;
  const outSet = new Set(view.snipes.flatMap((r) => (r.hit >= 0 ? [r.hit] : [])));
  const humansLeft = ids.length - outSet.size;
  const lastMiss = [...view.snipes].reverse().find((r) => r.hit < 0);
  const exposedNow = lastMiss && now - lastMiss.at > 0 && now - lastMiss.at < DART_MS + EXPOSE_MS + 300 ? lastMiss : null;

  // ----- steering: on change, at most every 50ms, re-sent now and then while held -----
  const ctl = useRef<Ctl>({ want: [0, 0, 0], sent: "0,0,0", sentAt: 0, timer: null });
  const flush = (force = false) => {
    const c = ctl.current;
    if (c.timer) clearTimeout(c.timer);
    c.timer = null;
    const [x, y, s] = c.want;
    const key = `${x},${y},${s}`;
    if (!force && key === c.sent) return;
    c.sent = key;
    c.sentAt = performance.now();
    act({ type: "in", x, y, s: s ? 1 : 0 });
  };
  const onSteer = (x: number, y: number, sprint: boolean) => {
    const c = ctl.current;
    c.want = [x, y, sprint ? 1 : 0];
    if (mySlot < 0) return;
    const since = performance.now() - c.sentAt;
    if (since >= 50) flush();
    else if (!c.timer) c.timer = setTimeout(() => flush(), 50 - since);
  };
  const onResend = useEffectEvent(() => {
    const [x, y] = ctl.current.want;
    if (steer && (x !== 0 || y !== 0)) flush(true);
  });
  useEffect(() => {
    const id = setInterval(() => onResend(), 1000);
    const c = ctl.current;
    return () => {
      clearInterval(id);
      if (c.timer) clearTimeout(c.timer);
    };
  }, []);
  // A key held across a round change: tell the server again (it reset everyone's input).
  useEffect(() => onResend(), [round, phase]);

  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
  }, []);
  const onFire = (w: number) => {
    if (!armed) return;
    act({ type: "snipe", w });
    setFired((f) => (f.n === round ? { n: round, c: f.c + 1 } : { n: round, c: 1 }));
    setReloading(true);
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => setReloading(false), SNIPE_CD_MS);
  };

  // ----- status copy -----
  let head: ReactNode;
  let sub: ReactNode;
  const result = view.result;
  if (phase === "intro") {
    head = `🥸 Round ${round} · Blend in!`;
    sub =
      mySlot >= 0
        ? "Find your dashed ring · walk like a bot"
        : `${view.count} walkers in ${park.name} · ${ids.length} of them are human`;
  } else if (phase === "play") {
    if (mySlot >= 0 && out) {
      const by = view.snipes.find((r) => r.hit === mySlot)?.by ?? -1;
      head = `💀 ${by >= 0 ? `${names[by]} sniped you!` : "You're out!"}`;
      sub = "You're out this round · the humans are ringed for you";
    } else if (mySlot >= 0) {
      head = exposedNow && exposedNow.by === mySlot ? "😳 Exposed! Lose them!" : "🥸 Stay incognito";
      sub =
        litCount === 0 && myDarts === DARTS
          ? "Light all 5 landmarks · snipe the humans"
          : `${humansLeft - 1} other human${humansLeft - 1 === 1 ? "" : "s"} still hiding`;
    } else {
      head = "👀 Spot the humans";
      sub = `${humansLeft} human${humansLeft === 1 ? "" : "s"} hiding among ${NPC_COUNT} bots`;
    }
  } else if (phase === "roundOver" && result) {
    head = roundHeadline(result, name);
    sub = `Round ${round + 1} in ${secs}s · there they were!`;
  } else {
    head = "🏁 Game over";
    sub = "Final standings below";
  }
  if (view.abandonAt && phase !== "final") {
    const gone = players.filter((p) => !p.connected).map((p) => p.name);
    sub = `⏳ ${gone.length ? gone.join(", ") : "Players"} dropped out · the game ends in ${Math.max(0, Math.ceil((view.abandonAt - now) / 1000))}s unless someone returns`;
  }

  // ----- timer row -----
  let timerEnds = 0;
  let timerTotal = 0;
  let clock = "";
  if (phase === "intro") {
    timerEnds = view.endsAt;
    timerTotal = INTRO_MS;
    clock = `darts unlock in ${secs}s`;
  } else if (phase === "play") {
    timerEnds = view.endsAt;
    timerTotal = PLAY_MS;
    clock = `${mmss(secs)} left`;
  } else if (phase === "roundOver") {
    timerEnds = view.endsAt;
    timerTotal = ROUND_OVER_MS;
    clock = `next round in ${secs}s`;
  } else clock = `${view.history.length} rounds played`;
  const hurry = phase === "play" && secs <= 15;

  const ring =
    exposedNow && exposedNow.by === mySlot
      ? (colors[mySlot] ?? accent)
      : phase === "roundOver" && result?.winners.length
        ? (colors[result.winners[0]] ?? accent)
        : hurry
          ? "#fb923c"
          : accent + "77";

  const data: ParkData = { view, mySlot, colors, names, avatars, reduced, steer, armed, lit, accent };
  const label =
    `${park.name}, round ${round}. ${view.count} identical walkers, ${humansLeft} of them human.` +
    (mySlot >= 0 ? (out ? " You were sniped this round." : ` You've lit ${litCount} of 5 landmarks.`) : "");

  return (
    <div className="@container mx-auto flex w-full max-w-4xl flex-col gap-3">
      <style href="ruckus-incognito" precedence="default">
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
              of {view.rounds} · {park.name}
            </span>
          </span>
          <span className={`shrink-0 tabular-nums ${hurry ? "font-bold text-orange-300" : "text-muted"}`}>⏱ {clock}</span>
        </div>
        <TimerBar endsAt={timerEnds} total={timerTotal} serverNow={serverNow} color={hurry ? "#fb923c" : accent} />
      </div>

      {mySlot >= 0 && phase !== "final" && (
        <Hud lit={lit} litPop={litPop} darts={myDarts} out={out} reloading={reloading} color={colors[mySlot] ?? accent} />
      )}

      <ParkView
        data={data}
        onEvent={onEvent}
        onSteer={onSteer}
        onFire={onFire}
        controls={
          steer
            ? {
                show: true,
                hint: (
                  <>
                    <span className="hidden pointer-fine:inline">
                      Walk with <Kbd>WASD</Kbd>/arrows (<Kbd>Shift</Kbd> sprints, suspiciously). Click a walker to
                      throw a dart.
                    </span>
                    <span className="pointer-fine:hidden">
                      Drag to walk. Tap a walker to aim, tap again (or THROW) to snipe.
                    </span>
                  </>
                ),
              }
            : null
        }
        label={label}
        ringColor={ring}
      >
        <Overlay view={view} now={now} secs={secs} name={name} colors={colors} avatars={avatars} toast={toast} />
      </ParkView>

      {!isPlayer && <Note>👀 You&apos;re spectating. Every walker looks the same to you too: can you spot the humans?</Note>}

      {phase !== "final" && <ScoreRow view={view} players={players} me={me} colors={colors} outSet={outSet} />}
      {phase !== "final" && <Feed snipes={view.snipes} name={name} colors={colors} mySlot={mySlot} />}
      {phase === "final" && <FinalStandings view={view} byId={byId} me={me} colors={colors} />}
    </div>
  );
}

function roundHeadline(r: RoundRec, name: (slot: number) => string): string {
  const who = r.winners.map(name);
  const list = who.length <= 1 ? who.join("") : `${who.slice(0, -1).join(", ")} & ${who[who.length - 1]}`;
  if (r.how === "all") return `🏆 ${list} lit all 5 landmarks!`;
  if (r.how === "last") return who.length ? `🕵️ ${list} ${who[0] === "You" ? "are" : "is"} the last human standing!` : "🎯 Everyone got sniped!";
  if (r.how === "time") return who.length ? `⏰ Time! ${list} lit the most` : "⏰ Time! Nobody lit a landmark";
  return "🏁 The round was cut short";
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-panel-2 px-1 py-px font-mono text-[11px] text-text">{children}</kbd>;
}

function Hud({
  lit,
  litPop,
  darts,
  out,
  reloading,
  color,
}: {
  lit: number;
  litPop: { l: number; key: number };
  darts: number;
  out: boolean;
  reloading: boolean;
  color: string;
}) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 ${out ? "opacity-50" : ""}`}>
      <ul className="flex items-center gap-1" aria-label={`Your landmarks: ${countBits(lit)} of 5 lit`}>
        {LANDMARKS.map((l, i) => {
          const on = (lit >> i) & 1;
          return (
            <li
              key={`${i}-${on && litPop.l === i ? litPop.key : 0}`}
              className={`relative grid size-9 place-items-center rounded-full border text-lg ${on ? "inc-lit" : ""}`}
              style={
                on
                  ? { borderColor: color, background: color + "33", boxShadow: `0 0 12px ${color}55` }
                  : { borderColor: "var(--color-line)", background: "var(--color-panel-2)", filter: "grayscale(0.6)", opacity: 0.7 }
              }
              title={`${l.name}${on ? " (lit)" : ""}`}
            >
              <span aria-hidden>{l.icon}</span>
              <span className="sr-only">
                {l.name} {on ? "lit" : "not lit"}
              </span>
              {on ? (
                <span className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full text-[9px] font-black text-ink" style={{ background: color }} aria-hidden>
                  ✓
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-1.5 text-sm" aria-label={`${darts} darts left`}>
        <span className="text-xs text-muted">{reloading ? "reloading…" : "darts"}</span>
        {Array.from({ length: DARTS }, (_, i) => (
          <span key={i} className={`text-lg transition-all ${i < darts ? "" : "scale-75 opacity-25 grayscale"}`} aria-hidden>
            🎯
          </span>
        ))}
      </div>
    </div>
  );
}

function Overlay({
  view,
  now,
  secs,
  name,
  colors,
  avatars,
  toast,
}: {
  view: IncView;
  now: number;
  secs: number;
  name: (slot: number) => string;
  colors: string[];
  avatars: string[];
  toast: { text: string; key: number } | null;
}) {
  let body: ReactNode = null;
  if (view.phase === "intro") {
    body = (
      <div className="pointer-events-none absolute inset-x-0 top-[38%] flex flex-col items-center">
        <span className="rounded-full bg-ink/70 px-3 py-0.5 text-xs font-semibold tracking-wide text-muted uppercase">
          Round {view.round} · find your ring
        </span>
        <span key={secs} className="inc-count font-display text-6xl font-black text-white drop-shadow-[0_4px_14px_rgba(0,0,0,0.7)] @2xl:text-7xl">
          {Math.max(1, secs)}
        </span>
      </div>
    );
  } else if (view.phase === "play" && view.playAt && now - view.playAt < 1_600) {
    body = (
      <div className="pointer-events-none absolute inset-x-0 top-[40%] flex justify-center">
        <span className="inc-count rounded-full bg-ink/75 px-4 py-1.5 font-display text-2xl font-black text-white shadow-lg @2xl:text-3xl">
          🎯 Darts unlocked!
        </span>
      </div>
    );
  } else if (view.phase === "roundOver" && view.result) {
    const r = view.result;
    const gained = r.pts.map((p, slot) => ({ p, slot })).filter((x) => x.p > 0).sort((a, b) => b.p - a.p);
    const lead = r.winners[0] ?? gained[0]?.slot ?? -1;
    const color = lead >= 0 ? colors[lead] : undefined;
    body = (
      <div className="pointer-events-none absolute inset-x-0 top-2 grid place-items-center">
        <div
          className="inc-card card flex max-w-[92%] flex-col items-center gap-1 px-3 py-2 text-center shadow-xl shadow-black/40 @xl:px-5 @xl:py-3"
          style={{ borderColor: color, background: "color-mix(in oklab, var(--color-panel) 88%, transparent)" }}
        >
          <span className="text-xs font-bold tracking-wide text-muted uppercase">Round {r.round} · unmasked!</span>
          {gained.length ? (
            <ul className="flex flex-wrap justify-center gap-x-3 gap-y-0.5 text-sm">
              {gained.map(({ p, slot }) => (
                <li key={slot} className="font-semibold whitespace-nowrap">
                  <span aria-hidden><Avatar id={avatars[slot]} /></span> <span style={{ color: colors[slot] }}>{name(slot)}</span>{" "}
                  <span className="font-mono text-emerald-300">+{p}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-sm text-muted">No points this round</span>
          )}
        </div>
      </div>
    );
  }
  return (
    <>
      {body}
      {toast && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <span key={toast.key} className="inc-toast rounded-full bg-ink/85 px-3 py-1 text-sm font-semibold text-white shadow-lg" role="status">
            {toast.text}
          </span>
        </div>
      )}
    </>
  );
}

function ScoreRow({ view, players, me, colors, outSet }: { view: IncView; players: Player[]; me: string; colors: string[]; outSet: Set<number> }) {
  const showRound = view.phase === "roundOver";
  return (
    <ul className="flex flex-wrap justify-center gap-1.5" aria-label="Players">
      {view.ids.map((id, slot) => {
        const p = players.find((x) => x.id === id);
        const color = colors[slot] ?? "#94a3b8";
        const out = outSet.has(slot);
        const offline = p?.connected === false;
        const darts = view.darts[slot] ?? 0;
        const gained = view.roundPts[slot] ?? 0;
        return (
          <li
            key={id}
            className={`flex min-h-9 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm transition-opacity ${out ? "opacity-55" : ""} ${id === me ? "ring-2 ring-white/60" : ""}`}
            style={{ borderColor: color + "88", background: color + "1c" }}
          >
            <span aria-hidden><Avatar id={p?.avatar ?? "🙂"} /></span>
            <span className="max-w-[7rem] truncate font-semibold" style={{ color }}>
              {p?.name ?? "Someone"}
            </span>
            {id === me && <span className="text-[10px] font-bold tracking-wide text-text/80 uppercase">you</span>}
            <span className="font-mono font-bold tabular-nums">{view.scores[slot] ?? 0}</span>
            {showRound && gained > 0 && <span className="animate-pop font-mono text-xs font-bold text-emerald-300">+{gained}</span>}
            <span className="text-xs text-muted tabular-nums" aria-hidden>
              {offline ? "🔌" : out ? "💀" : "🥸"} 🎯{darts}
            </span>
            <span className="sr-only">
              , {view.scores[slot] ?? 0} points, {darts} darts left, {offline ? "offline" : out ? "sniped this round" : "still hiding"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Feed({
  snipes,
  name,
  colors,
  mySlot,
}: {
  snipes: SnipeRec[];
  name: (slot: number) => string;
  colors: string[];
  mySlot: number;
}) {
  const who = (slot: number) => <b style={{ color: colors[slot] }}>{name(slot)}</b>;
  return (
    <ol className="flex min-h-14 flex-col items-center gap-0.5 text-sm" aria-label="Darts this round" aria-live="polite">
      {snipes.length === 0 && <li className="text-muted">No darts thrown yet. Watch for anyone who walks a little too… human.</li>}
      {snipes
        .slice(-3)
        .reverse()
        .map((r, i) => (
          <li key={`${r.at}-${r.w}`} className={`animate-rise max-w-full truncate ${i > 0 ? "text-muted opacity-70" : ""}`}>
            {r.hit >= 0 ? (
              <>
                🎯 {who(r.by)} sniped {who(r.hit)}! <span className="font-mono text-emerald-300">+{PTS_SNIPE}</span>
              </>
            ) : (
              <>
                🤷 {who(r.by)} darted a bot and gave {r.by === mySlot ? "yourself" : "themselves"} away
              </>
            )}
          </li>
        ))}
    </ol>
  );
}

function FinalStandings({ view, byId, me, colors }: { view: IncView; byId: Record<string, Player>; me: string; colors: string[] }) {
  const champs = view.champions ?? [];
  const slots = view.ids.map((_, i) => i);
  const score = (s: number) => view.scores[s] ?? 0;
  const order = slots.slice().sort((a, b) => score(b) - score(a));
  const sum = (f: (r: RoundRec, s: number) => number) => (s: number) => view.history.reduce((t, r) => t + f(r, s), 0);
  const hits = sum((r, s) => r.hits[s] ?? 0);
  const misses = sum((r, s) => r.misses[s] ?? 0);
  const lamps = sum((r, s) => countBits(r.lit[s] ?? 0));
  const caught = sum((r, s) => (r.out.includes(s) ? 1 : 0));
  const award = (title: string, emoji: string, f: (s: number) => number, blurb: (v: number) => string, low = false) => {
    const vals = slots.map(f);
    const best = low ? Math.min(...vals) : Math.max(...vals);
    if (!low && best <= 0) return null;
    const who = slots.filter((s) => vals[s] === best);
    if (low && who.length === slots.length) return null;
    return { title, emoji, who, text: blurb(best) };
  };
  const awards = [
    award("Sharpshooter", "🎯", hits, (v) => `${v} human${v === 1 ? "" : "s"} sniped`),
    award("Lamplighter", "✨", lamps, (v) => `${v} landmark${v === 1 ? "" : "s"} lit`),
    award("Master of disguise", "🥸", caught, () => "sniped the fewest times", true),
    award("Trigger-happy", "🤷", misses, (v) => `${v} bot${v === 1 ? "" : "s"} darted`),
  ].filter((a): a is NonNullable<typeof a> => a !== null);
  return (
    <div className="grid gap-3 @xl:grid-cols-[3fr_2fr]">
      <section className="card p-3" aria-label="Final standings">
        <div className="label mb-2">Final standings</div>
        <ol className="space-y-1.5">
          {order.map((slot, i) => {
            const id = view.ids[slot];
            const p = byId[id];
            const color = colors[slot] ?? "#94a3b8";
            const isChamp = champs.includes(id);
            const rank = 1 + order.filter((o) => score(o) > score(slot)).length;
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
                  {rank <= 3 && score(slot) > 0 ? MEDALS[rank - 1] : <span className="text-sm text-muted">{rank}</span>}
                </span>
                <span className="sr-only">Place {rank}:</span>
                <span className="relative shrink-0 text-xl leading-none" aria-hidden>
                  <Avatar id={p?.avatar ?? "🙂"} />
                  {isChamp && <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-sm motion-safe:animate-bounce">👑</span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-semibold" style={{ color }}>
                      {p?.name ?? "Someone"}
                    </span>
                    {id === me && <span className="shrink-0 text-[10px] font-bold tracking-wide text-muted uppercase">you</span>}
                  </span>
                  <span className="flex flex-wrap gap-x-2 text-xs text-muted tabular-nums">
                    {view.history.map((r) => (
                      <span key={r.round}>
                        R{r.round} {r.pts[slot] ? <b className="text-emerald-300">+{r.pts[slot]}</b> : "0"}
                        {r.out.includes(slot) ? " 💀" : ""}
                      </span>
                    ))}
                  </span>
                </span>
                <span className="w-8 shrink-0 text-right font-mono text-lg font-bold tabular-nums">{score(slot)}</span>
                <span className="sr-only"> points</span>
              </li>
            );
          })}
        </ol>
      </section>
      <section className="card flex animate-rise flex-col gap-2 p-3" style={{ animationDelay: "260ms" }} aria-label="Awards">
        <div className="label">Awards</div>
        {awards.length === 0 && <p className="text-sm text-muted">The bots win this one. Nobody did anything suspicious… or useful.</p>}
        {awards.map((a) => (
          <div key={a.title} className="rounded-lg bg-panel-2 px-3 py-2 text-sm">
            <span className="label">
              {a.emoji} {a.title}
            </span>
            <div className="mt-0.5 truncate">
              {a.who.map((s, i) => (
                <span key={s}>
                  {i > 0 && ", "}
                  <b style={{ color: colors[s] }}>{byId[view.ids[s]]?.name ?? "Someone"}</b>
                </span>
              ))}{" "}
              <span className="text-muted">· {a.text}</span>
            </div>
          </div>
        ))}
        <p className="mt-auto text-xs text-muted">
          Scoring: lit all 5 +{PTS_ALL_LIT} · sniped a human +{PTS_SNIPE} · last one hiding +{PTS_SURVIVOR} · most landmarks at
          the bell +{PTS_MOST_LIT}
        </p>
      </section>
    </div>
  );
}

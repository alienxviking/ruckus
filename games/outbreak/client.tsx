"use client";

import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { Note, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import type { FeedRec, OBAction, OBView, RoundRec } from "./server";
import {
  F_CURE,
  F_FLASH,
  F_STUN,
  INTRO_MS,
  PLAY_MS,
  PTS_BITE,
  PTS_CURE,
  PTS_SURVIVE,
  PTS_WIPEOUT,
  ROUND_OVER_MS,
  decodeFlags,
  isSnap,
  mapOf,
} from "./shared";
import { ArenaView, type ArenaData, type UseButton } from "./arena";
import { Avatar } from "@/components/Avatar";

type Props = GameClientProps<OBView, OBAction>;

// Game-local styles and animations, prefixed so they can't clash with other games.
const CSS = `
.ob-stage { aspect-ratio: 10 / 7; max-width: min(100%, 88vh); }
@container (max-width: 559px) { .ob-stage { aspect-ratio: 7 / 10; max-width: min(100%, 46vh); } }
.ob-cd { right: 0; transform-origin: left; animation: ob-cd linear forwards; }
@keyframes ob-cd { from { transform: scaleX(1); } to { transform: scaleX(0); } }
.ob-card { animation: ob-card 5.6s ease .2s both; }
@keyframes ob-card { 0% { opacity: 0; transform: scale(.7); } 8% { opacity: 1; transform: scale(1.05); } 13% { transform: scale(1); } 85% { opacity: 1; } 100% { opacity: 0; } }
.ob-count { animation: ob-count .9s ease both; }
@keyframes ob-count { 0% { opacity: 0; transform: scale(.4); } 35% { opacity: 1; transform: scale(1.12); } 100% { opacity: 1; transform: scale(1); } }
.ob-wake { animation: ob-wake 1.6s ease both; }
@keyframes ob-wake { 0% { opacity: 0; transform: scale(.5) rotate(-6deg); } 20% { opacity: 1; transform: scale(1.1) rotate(2deg); } 30% { transform: scale(1) rotate(0); } 80% { opacity: 1; } 100% { opacity: 0; } }
.ob-shamble { display: inline-block; animation: ob-shamble 1.4s ease-in-out infinite; }
@keyframes ob-shamble { 0%, 100% { transform: rotate(-8deg); } 50% { transform: rotate(8deg) translateY(-1px); } }
@media (prefers-reduced-motion: reduce) {
  .ob-count, .ob-wake { animation: ob-fade .3s ease both; }
  .ob-card { animation: ob-card-calm 5.6s linear both; }
  @keyframes ob-card-calm { 0%, 90% { opacity: 1; } 100% { opacity: 0; } }
  .ob-shamble { animation: none; }
  @keyframes ob-fade { from { opacity: 0; } }
}
`;

const MEDALS = ["🥇", "🥈", "🥉"];

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

function isView(v: unknown): v is OBView {
  if (!v || typeof v !== "object") return false;
  const x = v as Partial<OBView>;
  return Array.isArray(x.ids) && Array.isArray(x.scores) && Array.isArray(x.zombies) && Array.isArray(x.items) && isSnap(x.snap);
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---------- component ----------

export default function Outbreak(props: Props) {
  // Also guards against a stale view from another game arriving before ours.
  if (!isView(props.view)) {
    return (
      <div className="card grid min-h-[40vh] place-items-center p-6">
        <Note>Sealing the quarantine zone…</Note>
      </div>
    );
  }
  return <Game {...props} view={props.view} />;
}

interface Ctl {
  want: [number, number];
  sent: string;
  sentAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

function Game({ view, me, players, byId, isPlayer, act, serverNow, onEvent, accent }: Omit<Props, "view"> & { view: OBView }) {
  const reduced = useReducedMotion();
  const now = useServerClock(serverNow, 250);
  const secs = useSecondsLeft(view.endsAt, serverNow);
  const { phase, round, ids } = view;
  const map = mapOf(view.map);

  const colors = ids.map((id) => byId[id]?.color ?? "#94a3b8");
  const names = ids.map((id) => byId[id]?.name ?? "Someone");
  const avatars = ids.map((id) => byId[id]?.avatar ?? "🙂");
  const mySlot = isPlayer ? ids.indexOf(me) : -1;
  const name = (slot: number) => (slot === mySlot ? "You" : (names[slot] ?? "Someone"));

  const zset = new Set(view.zombies);
  const flags = decodeFlags(view.snap.f);
  const myFlags = mySlot >= 0 ? (flags[mySlot] ?? 0) : 0;
  const amZombie = mySlot >= 0 && zset.has(mySlot);
  const amOriginal = mySlot >= 0 && view.originals.includes(mySlot);
  const survivorsLeft = ids.length - view.zombies.length;
  const steer = mySlot >= 0 && (phase === "intro" || phase === "play");

  // ----- steering: on change, at most every 50ms, re-sent now and then while held -----
  const ctl = useRef<Ctl>({ want: [0, 0], sent: "0,0", sentAt: 0, timer: null });
  const flush = (force = false) => {
    const c = ctl.current;
    if (c.timer) clearTimeout(c.timer);
    c.timer = null;
    const [x, y] = c.want;
    const key = `${x},${y}`;
    if (!force && key === c.sent) return;
    c.sent = key;
    c.sentAt = performance.now();
    act({ type: "in", x, y });
  };
  const onSteer = (x: number, y: number) => {
    const c = ctl.current;
    c.want = [x, y];
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

  const onUse = () => {
    if (mySlot >= 0) act({ type: "use" });
  };
  const use: UseButton | null =
    mySlot >= 0 && phase === "play"
      ? amZombie
        ? { kind: "lunge", enabled: !(myFlags & F_STUN) }
        : { kind: "flash", enabled: (myFlags & F_FLASH) !== 0 }
      : null;

  // ----- status copy -----
  let head: ReactNode;
  let sub: ReactNode;
  const result = view.result;
  if (phase === "intro") {
    if (amZombie) {
      head = amOriginal ? "☣️ You're Patient Zero!" : "🧟 You're a zombie!";
      sub = `You wake in ${secs}s · catch everyone you can`;
    } else if (mySlot >= 0) {
      head = `🏃 Run! The zombie${view.originals.length > 1 ? "s wake" : " wakes"} in ${secs}s`;
      sub = "Grab 💉 and 🔦 · striped doors are survivors-only";
    } else {
      head = `🧪 Round ${round} · ${map.name}`;
      sub = `${plural(view.originals.length, "patient zero")} vs ${plural(survivorsLeft, "survivor")}`;
    }
  } else if (phase === "play") {
    if (amZombie) {
      head = myFlags & F_STUN ? "😵 Stunned!" : "🧟 Hunt them down!";
      sub = `${plural(survivorsLeft, "survivor")} left · +${PTS_BITE} per bite${amOriginal ? " · ☣️ no cure" : ""}`;
    } else if (mySlot >= 0) {
      head =
        myFlags & F_CURE
          ? "💉 Tag a zombie to cure them!"
          : survivorsLeft === 1
            ? "😱 You're the last survivor!"
            : "🏃 Stay alive!";
      sub = `${survivorsLeft > 1 ? `${plural(survivorsLeft - 1, "other survivor")} · ` : ""}+${PTS_SURVIVE} if you're human at the bell`;
    } else {
      head = `🧟 ${view.zombies.length} zombie${view.zombies.length === 1 ? "" : "s"} vs ${plural(survivorsLeft, "survivor")}`;
      sub = map.name;
    }
  } else if (phase === "roundOver" && result) {
    head = roundHeadline(result, name);
    sub = `Round ${round + 1} in ${secs}s`;
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
    clock = `zombies wake in ${secs}s`;
  } else if (phase === "play") {
    timerEnds = view.endsAt;
    timerTotal = PLAY_MS;
    clock = `${mmss(secs)} left`;
  } else if (phase === "roundOver") {
    timerEnds = view.endsAt;
    timerTotal = ROUND_OVER_MS;
    clock = `next round in ${secs}s`;
  } else clock = `${view.history.length} rounds played`;
  const hurry = phase === "play" && secs <= 10;
  const ring = amZombie ? "#84cc16" : hurry ? "#fb923c" : accent + "77";

  const data: ArenaData = { view, mySlot, colors, names, avatars, reduced, steer, accent };
  const label =
    `${map.name}, round ${round}. ${view.zombies.length} zombies, ${survivorsLeft} survivors.` +
    (mySlot >= 0 ? (amZombie ? " You are a zombie." : " You are a survivor.") : "");
  const hint =
    mySlot >= 0 && steer ? (
      <>
        <span className="hidden pointer-fine:inline">
          Move with <Kbd>WASD</Kbd>/arrows · <Kbd>Space</Kbd> {amZombie ? "lunges" : "uses a 🔦 flash"}.
        </span>
        <span className="pointer-fine:hidden">Drag anywhere on the map to run.</span>{" "}
        {amZombie ? "You're too big for the striped doors." : "Striped doors: survivors only. 💉 cures a zombie you touch."}
      </>
    ) : null;

  return (
    <div className="@container mx-auto flex w-full max-w-4xl flex-col gap-3">
      <style href="ruckus-outbreak" precedence="default">
        {CSS}
      </style>
      <StatusBanner accent={amZombie ? "#84cc16" : accent}>
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
              of {view.rounds} · {map.name}
            </span>
          </span>
          <span className={`shrink-0 tabular-nums ${hurry ? "font-bold text-orange-300" : "text-muted"}`}>⏱ {clock}</span>
        </div>
        <TimerBar endsAt={timerEnds} total={timerTotal} serverNow={serverNow} color={hurry ? "#fb923c" : accent} />
      </div>

      <ArenaView data={data} onEvent={onEvent} onSteer={onSteer} onUse={onUse} use={use} hint={hint} label={label} ringColor={ring}>
        <Overlay view={view} now={now} secs={secs} mySlot={mySlot} name={name} colors={colors} avatars={avatars} />
      </ArenaView>

      {!isPlayer && <Note>👀 You&apos;re spectating. Cheer for the survivors… or the horde.</Note>}

      {phase !== "final" && <ScoreRow view={view} players={players} me={me} colors={colors} flags={flags} />}
      {phase !== "final" && <Feed feed={view.feed} name={name} colors={colors} />}
      {phase === "final" && <FinalStandings view={view} byId={byId} me={me} colors={colors} />}
    </div>
  );
}

function roundHeadline(r: RoundRec, name: (slot: number) => string): string {
  if (r.how === "all") return `🧟 Total infection in ${Math.max(1, Math.round(r.ms / 1000))}s!`;
  if (r.how === "quit") return "🏁 The round was cut short";
  const who = r.survivors.map(name);
  if (!who.length) return "🧟 Nobody made it";
  if (who.length <= 3) {
    const list = who.length === 1 ? who[0] : `${who.slice(0, -1).join(", ")} & ${who[who.length - 1]}`;
    return `⏰ ${list} made it out alive!`;
  }
  return `⏰ ${who.length} survivors made it out alive!`;
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-panel-2 px-1 py-px font-mono text-[11px] text-text">{children}</kbd>;
}

function Overlay({
  view,
  now,
  secs,
  mySlot,
  name,
  colors,
  avatars,
}: {
  view: OBView;
  now: number;
  secs: number;
  mySlot: number;
  name: (slot: number) => string;
  colors: string[];
  avatars: string[];
}) {
  if (view.phase === "intro") {
    const zombie = mySlot >= 0 && view.zombies.includes(mySlot);
    return (
      <div className="pointer-events-none absolute inset-x-0 top-3 flex flex-col items-center gap-1 px-3 text-center">
        <span className="rounded-full bg-ink/75 px-3 py-0.5 text-xs font-bold tracking-wide text-white uppercase">
          {mySlot < 0 ? "Zombies wake in" : zombie ? "You wake in" : "Run! Zombies wake in"}
        </span>
        <span key={secs} className="ob-count font-display text-5xl font-black text-white drop-shadow-[0_4px_14px_rgba(0,0,0,0.8)] @2xl:text-6xl">
          {Math.max(1, secs)}
        </span>
        <span className="rounded-full bg-ink/75 px-3 py-1 text-sm font-semibold text-white">
          {view.originals.map((s, i) => (
            <span key={s}>
              {i > 0 && " & "}
              <span aria-hidden>☣️</span> <span style={{ color: colors[s] }}>{name(s)}</span>
            </span>
          ))}{" "}
          {view.originals.length > 1 ? "are patient zeros" : view.originals[0] === mySlot ? "are patient zero" : "is patient zero"}
        </span>
      </div>
    );
  }
  if (view.phase === "play" && view.playAt && now - view.playAt < 1_600) {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
        <span className="ob-wake rounded-full bg-ink/80 px-4 py-1.5 font-display text-2xl font-black text-lime-300 shadow-lg @2xl:text-3xl">
          🧟 They&apos;re awake!
        </span>
      </div>
    );
  }
  if (view.phase === "roundOver" && view.result) {
    const r = view.result;
    const gained = r.pts
      .map((p, slot) => ({ p, slot }))
      .filter((x) => x.p > 0)
      .sort((a, b) => b.p - a.p);
    return (
      <div className="pointer-events-none absolute inset-x-0 top-2 grid place-items-center">
        <div
          className="ob-card card flex max-w-[92%] flex-col items-center gap-1 px-3 py-2 text-center shadow-xl shadow-black/40 @xl:px-5 @xl:py-3"
          style={{ borderColor: r.how === "all" ? "#84cc16" : "#fbbf24", background: "color-mix(in oklab, var(--color-panel) 88%, transparent)" }}
        >
          <span className="text-xs font-bold tracking-wide text-muted uppercase">
            Round {r.round} · {r.how === "all" ? "the horde wins" : `${r.survivors.length} survived`}
          </span>
          {gained.length ? (
            <ul className="flex flex-wrap justify-center gap-x-3 gap-y-0.5 text-sm">
              {gained.slice(0, 8).map(({ p, slot }) => (
                <li key={slot} className="font-semibold whitespace-nowrap">
                  <span aria-hidden>{r.survivors.includes(slot) ? "🏃" : "🧟"}</span>{" "}
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
  return null;
}

function ScoreRow({ view, players, me, colors, flags }: { view: OBView; players: Player[]; me: string; colors: string[]; flags: number[] }) {
  const showRound = view.phase === "roundOver";
  const zset = new Set(view.zombies);
  return (
    <ul className="flex flex-wrap justify-center gap-1.5" aria-label="Players">
      {view.ids.map((id, slot) => {
        const p = players.find((x) => x.id === id);
        const color = colors[slot] ?? "#94a3b8";
        const zombie = zset.has(slot);
        const original = view.originals.includes(slot);
        const offline = p?.connected === false;
        const fl = flags[slot] ?? 0;
        const gained = view.roundPts[slot] ?? 0;
        return (
          <li
            key={id}
            className={`flex min-h-9 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm transition-colors ${id === me ? "ring-2 ring-white/60" : ""}`}
            style={{
              borderColor: zombie ? "#84cc16aa" : color + "88",
              background: zombie ? "#84cc1622" : color + "1c",
            }}
          >
            <span aria-hidden className={zombie ? "ob-shamble" : undefined}>
              <Avatar id={zombie ? "🧟" : (p?.avatar ?? "🙂")} />
            </span>
            <span className="max-w-[7rem] truncate font-semibold" style={{ color }}>
              {p?.name ?? "Someone"}
            </span>
            {id === me && <span className="text-[10px] font-bold tracking-wide text-text/80 uppercase">you</span>}
            <span className="font-mono font-bold tabular-nums">{view.scores[slot] ?? 0}</span>
            {showRound && gained > 0 && <span className="animate-pop font-mono text-xs font-bold text-emerald-300">+{gained}</span>}
            <span className="text-xs" aria-hidden>
              {offline ? "🔌" : ""}
              {original ? "☣️" : ""}
              {!zombie && fl & F_CURE ? "💉" : ""}
              {!zombie && fl & F_FLASH ? "🔦" : ""}
            </span>
            <span className="sr-only">
              , {view.scores[slot] ?? 0} points, {zombie ? (original ? "patient zero" : "zombie") : "survivor"}
              {offline ? ", offline" : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Feed({ feed, name, colors }: { feed: FeedRec[]; name: (slot: number) => string; colors: string[] }) {
  const who = (slot: number) => <b style={{ color: colors[slot] }}>{name(slot)}</b>;
  return (
    <ol className="flex min-h-14 flex-col items-center gap-0.5 text-sm" aria-label="What happened this round" aria-live="polite">
      {feed.length === 0 && <li className="text-muted">No bites yet. Keep moving.</li>}
      {feed
        .slice(-3)
        .reverse()
        .map((r, i) => (
          <li key={`${r.at}-${r.k}-${r.a}`} className={`animate-rise max-w-full truncate ${i > 0 ? "text-muted opacity-70" : ""}`}>
            {r.k === 0 ? (
              <>
                🧟 {who(r.b)} bit {who(r.a)}! <span className="font-mono text-emerald-300">+{PTS_BITE}</span>
              </>
            ) : r.k === 1 ? (
              <>
                💉 {who(r.b)} cured {who(r.a)}! <span className="font-mono text-emerald-300">+{PTS_CURE}</span>
              </>
            ) : (
              <>
                🔦 {who(r.a)} flashed {r.b ? plural(r.b, "zombie") : "… nobody"}
              </>
            )}
          </li>
        ))}
    </ol>
  );
}

function FinalStandings({ view, byId, me, colors }: { view: OBView; byId: Record<string, Player>; me: string; colors: string[] }) {
  const champs = view.champions ?? [];
  const slots = view.ids.map((_, i) => i);
  const score = (s: number) => view.scores[s] ?? 0;
  const order = slots.slice().sort((a, b) => score(b) - score(a));
  const sum = (f: (r: RoundRec, s: number) => number) => (s: number) => view.history.reduce((t, r) => t + f(r, s), 0);
  const bites = sum((r, s) => r.bites[s] ?? 0);
  const cures = sum((r, s) => r.cures[s] ?? 0);
  const lived = sum((r, s) => (r.how === "time" && r.survivors.includes(s) ? 1 : 0));
  const award = (title: string, emoji: string, f: (s: number) => number, blurb: (v: number) => string) => {
    const vals = slots.map(f);
    const best = Math.max(...vals);
    if (best <= 0) return null;
    return { title, emoji, who: slots.filter((s) => vals[s] === best), text: blurb(best) };
  };
  const awards = [
    award("Top biter", "🧟", bites, (v) => plural(v, "bite")),
    award("Field medic", "💉", cures, (v) => plural(v, "cure")),
    award("Hard to kill", "🏃", lived, (v) => `survived ${plural(v, "round")}`),
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
                  animationDelay: `${120 + i * 60}ms`,
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
                        R{r.round} {r.originals.includes(slot) ? "☣️" : r.survivors.includes(slot) ? "🏃" : "🧟"}
                        {r.pts[slot] ? <b className="text-emerald-300">+{r.pts[slot]}</b> : "0"}
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
        {awards.length === 0 && <p className="text-sm text-muted">A quiet apocalypse. Nobody bit, cured or survived.</p>}
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
          Scoring: human at the bell +{PTS_SURVIVE} · each bite +{PTS_BITE} · each cure +{PTS_CURE} · patient zero wipes
          everyone out +{PTS_WIPEOUT}
        </p>
      </section>
    </div>
  );
}

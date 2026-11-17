"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import { PLAYER_COLORS, type Player } from "@/shared/types";
import { Note, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import type { FallRec, LavaAction, LavaView } from "./server";
import {
  COLLAPSE_EVERY_MS,
  COLLAPSE_START_MS,
  COUNTDOWN_MS,
  MAX_ROUNDS,
  POWER_INFO,
  POWER_KINDS,
  ROUND_OVER_MS,
  WINS_NEEDED,
  isSnap,
} from "./shared";
import { Arena, type ArenaData, type InputState } from "./arena";
import { LavaPredictor } from "./predict";
import { Avatar } from "@/components/Avatar";

/** Stick changes go out at once; only a burst of them (a thumb sweeping the stick) is spaced out. */
const SEND_BURST = 3;
const SEND_RATE = 20;

type Props = GameClientProps<LavaView, LavaAction>;

const CSS = `
.lava-go { animation: lava-go .9s cubic-bezier(.2,1.4,.4,1) both; }
@keyframes lava-go { 0% { opacity: 0; transform: scale(.4); } 25% { opacity: 1; transform: scale(1.1); } 70% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(1.25); } }
.lava-banner { animation: lava-banner 1.8s ease both; }
@keyframes lava-banner { 0% { opacity: 0; transform: translateY(-8px) scale(.9); } 12% { opacity: 1; transform: none; } 80% { opacity: 1; } 100% { opacity: 0; } }
.lava-late { animation: lava-late .45s cubic-bezier(.2,1.4,.4,1) .35s both; }
@keyframes lava-late { from { opacity: 0; transform: scale(.7); } }
.lava-jump { position: relative; overflow: hidden; isolation: isolate; }
.lava-jump-fill { position: absolute; inset: 0; z-index: -1; transform-origin: left; transform: scaleX(var(--lava-cd, 0)); background: rgba(28, 8, 4, .62); }
.lava-jump[data-ready="1"]:not(:disabled) { box-shadow: 0 0 0 2px var(--lava-accent), 0 0 22px color-mix(in oklab, var(--lava-accent) 45%, transparent); }
.lava-jump:active:not(:disabled) { transform: scale(.96); }
.lava-pulse { animation: lava-pulse 1s ease-in-out infinite; }
@keyframes lava-pulse { 50% { opacity: .55; } }
@media (prefers-reduced-motion: reduce) {
  .lava-go, .lava-banner, .lava-late { animation: lava-fade .3s ease both; }
  .lava-pulse { animation: none; }
  @keyframes lava-fade { from { opacity: 0; } }
}
`;

const KEY_DIR: Record<string, "up" | "down" | "left" | "right"> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
};
const MEDALS = ["🥇", "🥈", "🥉"];

// ---------- colours: no look-alike players on the board ----------

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

function displayColors(key: string): string[] {
  const used: string[] = [];
  return key.split("\n").map((raw) => {
    let c = raw.toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(c) || used.some((u) => colorDistance(u, c) < 0.12)) {
      let best = -1;
      for (const p of PALETTE) {
        if (used.includes(p)) continue;
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

function useServerClock(serverNow: () => number, ms: number) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(id);
  }, [serverNow, ms]);
  return now;
}

function isTyping(t: EventTarget | null) {
  return (
    t instanceof HTMLElement &&
    (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")
  );
}

function isButton(t: EventTarget | null) {
  return (
    t instanceof HTMLElement && (t.tagName === "BUTTON" || t.tagName === "A" || t.getAttribute("role") === "button")
  );
}

function isView(v: unknown): v is LavaView {
  if (!v || typeof v !== "object") return false;
  const x = v as Partial<LavaView>;
  return (
    Array.isArray(x.ids) &&
    Array.isArray(x.wins) &&
    typeof x.board === "string" &&
    typeof x.R === "number" &&
    isSnap(x.snap)
  );
}

// ---------- component ----------

export default function FloorIsLava(props: Props) {
  if (!isView(props.view)) {
    return (
      <div className="card grid min-h-[40vh] place-items-center p-6">
        <Note>Heating up the lava…</Note>
      </div>
    );
  }
  return <Game {...props} view={props.view} />;
}

interface Ctl {
  keys: Set<string>;
  stick: [number, number] | null;
  sent: [number, number];
  tokens: number;
  tokensAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

function Game({
  view,
  me,
  players,
  byId,
  isPlayer,
  act,
  serverNow,
  rtt,
  onEvent,
  accent,
}: Omit<Props, "view"> & { view: LavaView }) {
  const reduced = useReducedMotion();
  const now = useServerClock(serverNow, 250);
  const secs = useSecondsLeft(view.endsAt, serverNow);
  const { phase, round, ids, R } = view;

  const colorKey = ids.map((id) => byId[id]?.color ?? "").join("\n");
  const colors = useMemo(() => displayColors(colorKey), [colorKey]);
  const names = ids.map((id) => byId[id]?.name ?? "Someone");
  const avatars = ids.map((id) => byId[id]?.avatar ?? "🙂");
  const mySlot = isPlayer ? ids.indexOf(me) : -1;
  const standing = new Set(view.snap.p.map((p) => p[0]));
  const aliveCount = phase === "countdown" ? ids.length : standing.size;
  const imAlive = mySlot >= 0 && (phase === "countdown" || standing.has(mySlot));
  const canInput = mySlot >= 0 && phase !== "final";
  const canJump = mySlot >= 0 && imAlive && phase === "fight";
  const fightMs = phase === "fight" && view.fightAt ? Math.max(0, now - view.fightAt) : 0;
  const collapsing = phase === "fight" && fightMs >= COLLAPSE_START_MS;
  const abandonIn = view.abandonAt ? Math.max(0, Math.ceil((view.abandonAt - now) / 1000)) : null;
  const name = (id: string | null | undefined) => (id ? (byId[id]?.name ?? "Someone") : "Someone");

  // ----- input: keys + touch stick, sent the moment they change (bursts spaced to 20/s) -----
  const input = useRef<InputState>({ x: 0, y: 0 });
  const ctl = useRef<Ctl>({ keys: new Set(), stick: null, sent: [0, 0], tokens: SEND_BURST, tokensAt: 0, timer: null });
  const [jumps, setJumps] = useState(0);
  const [pred] = useState(() => new LavaPredictor());
  useEffect(() => pred.attachRtt(rtt), [pred, rtt]);

  const budget = () => {
    const c = ctl.current;
    const t = performance.now();
    c.tokens = Math.min(SEND_BURST, c.tokens + ((t - c.tokensAt) * SEND_RATE) / 1000);
    c.tokensAt = t;
    return c.tokens >= 1 ? 0 : ((1 - c.tokens) * 1000) / SEND_RATE;
  };
  const sendInput = (force = false) => {
    const c = ctl.current;
    if (c.timer) clearTimeout(c.timer);
    c.timer = null;
    const x = Math.round(input.current.x * 100);
    const y = Math.round(input.current.y * 100);
    if (!force && x === c.sent[0] && y === c.sent[1]) return;
    budget();
    c.tokens = Math.max(0, c.tokens - 1);
    c.sent = [x, y];
    const s = pred.recordInput(x, y, performance.now());
    // Stamped with the moment it should take effect on the server (predict.ts).
    act({ type: "input", x, y, s, at: pred.stamp(s) });
  };
  const refreshInput = () => {
    const c = ctl.current;
    let x = 0;
    let y = 0;
    if (c.stick) [x, y] = c.stick;
    else {
      if (c.keys.has("left")) x -= 1;
      if (c.keys.has("right")) x += 1;
      if (c.keys.has("up")) y -= 1;
      if (c.keys.has("down")) y += 1;
      const m = Math.hypot(x, y);
      if (m > 1) [x, y] = [x / m, y / m];
    }
    input.current.x = x;
    input.current.y = y;
    if (!canInput) return;
    const wait = budget();
    if (wait <= 0) sendInput();
    else if (!c.timer) c.timer = setTimeout(() => sendInput(), Math.ceil(wait));
  };
  const jump = () => {
    if (!canJump) return;
    if (pred.jumpLeft(performance.now()) > 50) return;
    // Make sure the server has the stick you're holding before the jump that uses it.
    const c = ctl.current;
    if (Math.round(input.current.x * 100) !== c.sent[0] || Math.round(input.current.y * 100) !== c.sent[1]) sendInput(true);
    const js = pred.recordJump(performance.now());
    act({ type: "jump", s: js, at: pred.stamp(js) });
    setJumps((n) => n + 1);
  };
  const onStick = (x: number, y: number) => {
    ctl.current.stick = x === 0 && y === 0 ? null : [x, y];
    refreshInput();
  };

  const onKey = useEffectEvent((e: KeyboardEvent, down: boolean) => {
    const c = ctl.current;
    const dir = KEY_DIR[e.code] ?? KEY_DIR[e.key];
    if (!down) {
      if (dir && c.keys.delete(dir)) refreshInput();
      return;
    }
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || !canInput) return;
    if (dir) {
      e.preventDefault();
      if (!c.keys.has(dir)) {
        c.keys.add(dir);
        refreshInput();
      }
    } else if (e.key === "Shift" || ((e.code === "Space" || e.key === " ") && !isButton(e.target))) {
      e.preventDefault();
      if (!e.repeat) jump();
    }
  });
  const onResend = useEffectEvent(() => {
    if (canInput && (input.current.x !== 0 || input.current.y !== 0)) sendInput(true);
  });
  useEffect(() => {
    const id = setInterval(() => onResend(), 1000);
    return () => clearInterval(id);
  }, []);
  const onLetGo = useEffectEvent(() => {
    const c = ctl.current;
    c.keys.clear();
    c.stick = null;
    refreshInput();
  });
  useEffect(() => {
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    const blur = () => onLetGo();
    const vis = () => {
      if (document.hidden) onLetGo();
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", vis);
    const c = ctl.current;
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", vis);
      if (c.timer) clearTimeout(c.timer);
    };
  }, []);

  // ----- status copy -----
  const winner = view.lastWinner;
  const ringsLeft = collapsing ? Math.max(0, R - Math.floor((fightMs - COLLAPSE_START_MS) / COLLAPSE_EVERY_MS)) : R + 1;
  let head: ReactNode;
  let sub: ReactNode;
  if (phase === "countdown") {
    head = `Round ${round} · Get ready!`;
    sub = mySlot >= 0 ? "Every tile you leave crumbles. Keep moving!" : `${ids.length} players about to run for their lives`;
  } else if (phase === "fight") {
    if (mySlot >= 0 && !imAlive) {
      head = "🔥 You melted!";
      sub = `${aliveCount} still standing · you're back next round`;
    } else {
      head = collapsing ? "🔥 The edges are crumbling!" : "🌋 The floor is lava!";
      sub =
        `${aliveCount} still standing` +
        (collapsing ? " · head for the middle" : fightMs < 8_000 ? " · grab 🧱 🪽 💥 power-ups" : " · jump the gaps");
    }
  } else if (phase === "roundOver") {
    head = winner
      ? `🏆 ${winner === me ? "You take" : `${name(winner)} takes`} round ${round}!`
      : "🤝 Draw: the last ones melted together";
    sub = `Next round in ${secs}s · first to ${WINS_NEEDED} wins`;
  } else {
    head = "🏁 Match over";
    sub = "Final standings below";
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
    if (!collapsing) {
      timerEnds = view.fightAt + COLLAPSE_START_MS;
      timerTotal = COLLAPSE_START_MS;
      clock = `edges crumble in ${Math.max(1, Math.ceil((COLLAPSE_START_MS - fightMs) / 1000))}s`;
    } else if (ringsLeft > 0) {
      const k = Math.floor((fightMs - COLLAPSE_START_MS) / COLLAPSE_EVERY_MS) + 1;
      timerEnds = view.fightAt + COLLAPSE_START_MS + k * COLLAPSE_EVERY_MS;
      timerTotal = COLLAPSE_EVERY_MS;
      timerColor = "#f87171";
      clock = ringsLeft <= 1 ? "last tile next!" : `${ringsLeft} ring${ringsLeft === 1 ? "" : "s"} left`;
    } else {
      timerColor = "#f87171";
      clock = "nothing left!";
    }
  } else if (phase === "roundOver") {
    timerEnds = view.endsAt;
    timerTotal = ROUND_OVER_MS;
    clock = `next round in ${secs}`;
  } else {
    clock = `${view.history.length} round${view.history.length === 1 ? "" : "s"} played`;
  }

  const ring = collapsing
    ? "#f87171"
    : phase === "countdown" && mySlot >= 0
      ? colors[mySlot]
      : (phase === "roundOver" || phase === "final") && winner
        ? (colors[ids.indexOf(winner)] ?? accent)
        : accent + "88";

  const data: ArenaData = { view, mySlot, colors, names, avatars, reduced, steerable: canInput, accent };
  const label =
    `Lava arena, round ${round}. ${aliveCount} of ${ids.length} players still standing.` +
    (mySlot >= 0 ? (imAlive ? " You're still standing." : " You fell into the lava this round.") : "");

  return (
    <div className="@container mx-auto flex w-full max-w-4xl flex-col gap-3">
      <style href="ruckus-lava" precedence="default">
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
              of {MAX_ROUNDS} max · first to {WINS_NEEDED}
            </span>
          </span>
          <span
            className={`shrink-0 tabular-nums ${collapsing ? "lava-pulse font-bold text-red-400" : "text-muted"}`}
          >
            {collapsing ? "🔥" : "⏱"} {clock}
          </span>
        </div>
        <TimerBar endsAt={timerEnds} total={timerTotal} serverNow={serverNow} color={timerColor} />
      </div>

      <Arena
        data={data}
        input={input}
        pred={mySlot >= 0 ? pred : null}
        onEvent={onEvent}
        onStick={onStick}
        onJump={jump}
        controls={
          mySlot >= 0 && phase !== "final"
            ? {
                enabled: canJump,
                presses: jumps,
                hint: (
                  <>
                    <span className="hidden pointer-fine:inline">
                      Run with <Kbd>WASD</Kbd> or the arrows, jump with <Kbd>Space</Kbd>. A jump clears one missing tile.
                    </span>
                    <span className="pointer-fine:hidden">
                      Hold the left half of the arena to run. Tap the right half or JUMP to hop a gap.
                    </span>
                  </>
                ),
              }
            : null
        }
        label={label}
        ringColor={ring}
      >
        <Overlay view={view} me={me} secs={secs} fightMs={fightMs} byId={byId} colors={colors} />
      </Arena>

      {phase !== "final" && <Legend />}
      {!isPlayer && <Note>👀 You&apos;re spectating. Players are steered by their owners.</Note>}

      {phase !== "final" && <ScoreRow view={view} players={players} me={me} colors={colors} standing={standing} />}
      {phase !== "final" && <Feed falls={view.falls} ids={ids} byId={byId} colors={colors} />}
      {phase === "final" && <FinalStandings view={view} byId={byId} me={me} colors={colors} />}
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-panel-2 px-1 py-px font-mono text-[11px] text-text">{children}</kbd>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted" aria-label="Power-ups">
      {POWER_KINDS.map((k) => (
        <li key={k} className="flex items-center gap-1">
          <span aria-hidden>{POWER_INFO[k].icon}</span>
          <b className="font-semibold" style={{ color: POWER_INFO[k].color }}>
            {POWER_INFO[k].label}
          </b>
          <span>{POWER_INFO[k].blurb}</span>
        </li>
      ))}
    </ul>
  );
}

function Overlay({
  view,
  me,
  secs,
  fightMs,
  byId,
  colors,
}: {
  view: LavaView;
  me: string;
  secs: number;
  fightMs: number;
  byId: Record<string, Player>;
  colors: string[];
}) {
  if (view.phase === "countdown") {
    return (
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="flex flex-col items-center">
          <span className="rounded-full bg-ink/70 px-3 py-0.5 text-xs font-semibold tracking-wide text-muted uppercase">
            Round {view.round}
          </span>
          <span
            key={secs}
            className="animate-pop font-display text-6xl font-black text-white drop-shadow-[0_4px_14px_rgba(0,0,0,0.7)] @2xl:text-8xl"
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
          <span className="lava-go font-display text-6xl font-black text-white drop-shadow-[0_4px_14px_rgba(0,0,0,0.7)] @2xl:text-8xl">
            RUN!
          </span>
        </div>
      );
    }
    if (fightMs >= COLLAPSE_START_MS && fightMs < COLLAPSE_START_MS + 1800) {
      return (
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
          <span className="lava-banner rounded-full bg-red-500/90 px-4 py-1 font-display text-sm font-black tracking-wide text-white shadow-lg shadow-black/40 @xl:text-lg">
            🔥 THE EDGES ARE CRUMBLING
          </span>
        </div>
      );
    }
    return null;
  }
  if (view.phase === "roundOver") {
    const w = view.lastWinner;
    const p = w ? byId[w] : undefined;
    const color = w ? colors[view.ids.indexOf(w)] : undefined;
    return (
      <div className="pointer-events-none absolute inset-x-0 top-[9%] grid place-items-center">
        <div
          className="lava-late card flex max-w-[85%] flex-col items-center px-4 py-2.5 text-center shadow-xl shadow-black/40 @xl:px-6 @xl:py-4"
          style={{ borderColor: color, background: "color-mix(in oklab, var(--color-panel) 88%, transparent)" }}
        >
          <span className="text-3xl @xl:text-5xl" aria-hidden>
            <Avatar id={p ? p.avatar : "🤝"} />
          </span>
          <span className="max-w-full truncate font-display text-lg font-extrabold @xl:text-3xl" style={{ color }}>
            {w ? (w === me ? "You!" : (p?.name ?? "Someone")) : "Draw"}
          </span>
          <span className="text-xs text-muted @xl:text-sm">
            {w ? `last one standing · round ${view.round}` : "the last ones melted together"}
          </span>
        </div>
      </div>
    );
  }
  return null;
}

function Pips({ wins, color }: { wins: number; color: string }) {
  return (
    <span className="flex items-center gap-0.5" aria-hidden>
      {Array.from({ length: Math.max(WINS_NEEDED, wins) }, (_, i) => (
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
  standing,
}: {
  view: LavaView;
  players: Player[];
  me: string;
  colors: string[];
  standing: Set<number>;
}) {
  return (
    <ul className="flex flex-wrap justify-center gap-1.5" aria-label="Players">
      {view.ids.map((id, slot) => {
        const p = players.find((x) => x.id === id);
        const color = colors[slot] ?? "#94a3b8";
        const wins = view.wins[slot] ?? 0;
        const kos = view.kos[slot] ?? 0;
        const on = view.phase === "countdown" || standing.has(slot);
        const offline = p?.connected === false;
        const state = offline ? "offline" : on ? "still standing" : "melted";
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
            <Pips wins={wins} color={color} />
            <span className="font-mono text-xs text-muted tabular-nums" aria-hidden>
              {offline ? "🔌" : on ? "🏃" : "🔥"}
              {kos > 0 ? ` 💥${kos}` : ""}
            </span>
            <span className="sr-only">
              , {wins} round win{wins === 1 ? "" : "s"}, {kos} knockout{kos === 1 ? "" : "s"}, {state}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Feed({
  falls,
  ids,
  byId,
  colors,
}: {
  falls: FallRec[];
  ids: string[];
  byId: Record<string, Player>;
  colors: string[];
}) {
  const who = (slot: number) => <b style={{ color: colors[slot] }}>{byId[ids[slot]]?.name ?? "someone"}</b>;
  return (
    <ol className="flex min-h-14 flex-col items-center gap-0.5 text-sm" aria-label="Falls this round" aria-live="polite">
      {falls
        .slice(-3)
        .reverse()
        .map((f, i) => (
          <li
            key={`${f.s}-${f.at}`}
            className={`animate-rise max-w-full truncate ${i > 0 ? "text-muted opacity-70" : ""}`}
          >
            {f.by >= 0 ? (
              <>
                💥 {who(f.by)} bumped {who(f.s)} into the lava
              </>
            ) : (
              <>🔥 {who(f.s)} fell into the lava</>
            )}
          </li>
        ))}
    </ol>
  );
}

function FinalStandings({
  view,
  byId,
  me,
  colors,
}: {
  view: LavaView;
  byId: Record<string, Player>;
  me: string;
  colors: string[];
}) {
  const champs = view.champions ?? [];
  const slots = view.ids.map((_, i) => i);
  const champ = (s: number) => (champs.includes(view.ids[s]) ? 1 : 0);
  const wins = (s: number) => view.wins[s] ?? 0;
  const kos = (s: number) => view.kos[s] ?? 0;
  const order = slots.slice().sort((a, b) => champ(b) - champ(a) || wins(b) - wins(a) || kos(b) - kos(a));
  const topKo = Math.max(0, ...slots.map(kos));
  const bullies = slots.filter((s) => kos(s) === topKo && topKo > 0);
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
                  {rank <= 3 && (isChamp || wins(slot) > 0) ? (
                    MEDALS[rank - 1]
                  ) : (
                    <span className="text-sm text-muted">{rank}</span>
                  )}
                </span>
                <span className="sr-only">Place {rank}:</span>
                <span className="relative shrink-0 text-xl leading-none" aria-hidden>
                  <Avatar id={p?.avatar ?? "🙂"} />
                  {isChamp && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-sm motion-safe:animate-bounce">
                      👑
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-semibold" style={{ color }}>
                      {p?.name ?? "Someone"}
                    </span>
                    {id === me && (
                      <span className="shrink-0 text-[10px] font-bold tracking-wide text-muted uppercase">you</span>
                    )}
                  </span>
                  <span className="block text-xs text-muted tabular-nums">
                    💥 {kos(slot)} bump-out{kos(slot) === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Pips wins={wins(slot)} color={color} />
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
                    {r.winner ? (
                      <>
                        <span aria-hidden><Avatar id={byId[r.winner]?.avatar ?? "🏆"} /></span>{" "}
                        <b style={{ color: colors[slot] }}>{byId[r.winner]?.name ?? "Someone"}</b>
                      </>
                    ) : (
                      "🤝 Draw"
                    )}
                    {firstOut >= 0 && view.ids.length > 2 && (
                      <span className="text-muted"> · 🔥 {byId[view.ids[firstOut]]?.name ?? "someone"} melted first</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
        {bullies.length > 0 && (
          <div className="rounded-lg bg-panel-2 px-3 py-2 text-sm">
            <span className="label">Biggest bully</span>
            <div className="mt-0.5 truncate">
              💥{" "}
              {bullies.map((s, i) => (
                <span key={s}>
                  {i > 0 && ", "}
                  <b style={{ color: colors[s] }}>{byId[view.ids[s]]?.name ?? "Someone"}</b>
                </span>
              ))}{" "}
              <span className="text-muted">
                · {topKo} bump-out{topKo === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

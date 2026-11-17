"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import { PLAYER_COLORS, type Player } from "@/shared/types";
import { Note, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import type { FeedItem, RoundResult, SnakeAction, SnakeDelta, SnakeView } from "./server";
import {
  COUNTDOWN_MS,
  MAX_ROUNDS,
  OPPOSITE,
  REJOIN_MS,
  ROUND_MS,
  ROUND_OVER_MS,
  START_LEN,
  WINS_NEEDED,
  type Dir,
  type RoundReason,
} from "./shared";
import { Arena } from "./arena";
import { SnakePredictor } from "./predict";
import { hear, isSnakeEvent, nothingHeard, rebuild, type Heard } from "./delta";
import { Avatar } from "@/components/Avatar";
import { feedback, sfx } from "@/lib/feedback";

type Props = GameClientProps<SnakeView, SnakeAction>;

const KEYS = new Map<string, Dir>([
  ["ArrowUp", "up"],
  ["ArrowDown", "down"],
  ["ArrowLeft", "left"],
  ["ArrowRight", "right"],
  ["w", "up"],
  ["W", "up"],
  ["a", "left"],
  ["A", "left"],
  ["s", "down"],
  ["S", "down"],
  ["d", "right"],
  ["D", "right"],
  ["KeyW", "up"],
  ["KeyA", "left"],
  ["KeyS", "down"],
  ["KeyD", "right"],
]);

const PHASE_MS = { countdown: COUNTDOWN_MS, play: ROUND_MS, roundOver: ROUND_OVER_MS, final: 0 } as const;
/** Match format from the view (host settings), with the classic defaults for older views. */
const roundMsOf = (v: SnakeView) => v.roundMs || ROUND_MS;
const winsNeededOf = (v: SnakeView) => v.winsNeeded || WINS_NEEDED;
const maxRoundsOf = (v: SnakeView) => v.maxRounds || MAX_ROUNDS;
const PALETTE = PLAYER_COLORS.map((c) => c.toLowerCase());

const REASON: Record<RoundReason, string> = {
  last: "Last snake standing",
  time: "Longest snake at the buzzer",
  crash: "Everyone crashed at once",
  tie: "Tied for longest at the buzzer",
};

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
/** sRGB hex -> OKLab, for judging how alike two snake colours look. */
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

/**
 * Snake colours: each player's own colour, unless it looks too much like a snake that joined
 * earlier; then the palette colour that stands out most from those already taken.
 */
function assignColors(key: string): Record<string, string> {
  const out: Record<string, string> = {};
  const used: string[] = [];
  for (const row of key.split("\n")) {
    if (!row) continue;
    const [id, raw = ""] = row.split("\t");
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
    out[id] = c;
  }
  return out;
}

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

function isTyping(t: EventTarget | null) {
  return (
    t instanceof HTMLElement &&
    (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")
  );
}

export default function SnakeBrawl(props: Props) {
  const { view, onEvent, act, me } = props;
  // Full views come on phase changes and every few seconds; each step in between is a tiny
  // delta event. The view shown is the newest full view with every delta since replayed.
  const [heard, setHeard] = useState<Heard>(nothingHeard);
  useEffect(
    () =>
      onEvent((e) => {
        if (isSnakeEvent(e)) setHeard((h) => hear(h, e));
      }),
    [onEvent],
  );
  // Also guards against a stale view from another game arriving before ours.
  const base = view && Array.isArray(view.snakes) ? view : null;
  const live = useMemo(() => rebuild(base, heard, me), [base, heard, me]);
  // A step went missing (say, before we subscribed): ask for a full view, and keep asking.
  const gap = live.gap;
  useEffect(() => {
    if (!gap) return;
    const first = setTimeout(() => act({ type: "sync" }), 120);
    const again = setInterval(() => act({ type: "sync" }), 1_100);
    return () => {
      clearTimeout(first);
      clearInterval(again);
    };
  }, [gap, act]);
  if (!live.view) return <Note>Setting up the arena…</Note>;
  return <Brawl {...props} view={live.view} steps={live.steps} deltas={heard.deltas} />;
}

function Brawl({
  view,
  steps,
  deltas,
  me,
  players,
  byId,
  isPlayer,
  act,
  serverNow,
  accent,
}: Omit<Props, "view"> & { view: SnakeView; steps?: SnakeView[]; deltas?: SnakeDelta[] }) {
  const reduced = useReducedMotion();
  const colorKey = players.map((p) => `${p.id}\t${p.color}`).join("\n");
  const colors = useMemo(() => assignColors(colorKey), [colorKey]);
  // Last direction you pressed, with the frame it was pressed on: lights up the D-pad until the server moves you.
  const [intent, setIntent] = useState<{ dir: Dir; round: number; tick: number } | null>(null);
  // Runs your own snake a network trip ahead so turns show at once (see predict.ts).
  const [pred] = useState(() => new SnakePredictor());
  const secs = useSecondsLeft(view.endsAt, serverNow);

  const { phase, round } = view;
  const mine = view.snakes.find((s) => s.id === me) ?? null;
  const alive = view.snakes.filter((s) => s.alive);
  const steerable = isPlayer && !!mine?.alive && (phase === "countdown" || phase === "play");
  const name = (id: string | null | undefined) => (id ? (byId[id]?.name ?? "Someone") : "Someone");
  const longest = phase === "play" ? longestSnake(view) : null;
  const winner = view.lastRoundWinner;

  const steer = (dir: Dir) => {
    if (!steerable) return;
    // The predictor drops presses the server would ignore and stamps the step the turn lands on.
    const stamp = pred.press(dir, serverNow(), performance.now());
    if (!stamp) return;
    setIntent({ dir, round, tick: view.tick });
    act({ type: "turn", dir, ...stamp });
  };
  // Shown until the server has turned you (or a tick later, if the turn just missed a tick).
  const heading =
    mine?.alive &&
    intent &&
    intent.round === round &&
    view.tick <= intent.tick + 4 &&
    intent.dir !== mine.dir &&
    intent.dir !== OPPOSITE[mine.dir]
      ? intent.dir
      : null;

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    const dir = KEYS.get(e.key) ?? KEYS.get(e.code);
    if (!dir || !steerable) return;
    if (e.key.startsWith("Arrow")) e.preventDefault();
    if (!e.repeat) steer(dir);
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Countdown beeps, then "go" as the round starts (buzz only if you have a snake in it).
  const inRound = isPlayer && !!mine?.alive;
  useEffect(() => {
    if (phase === "countdown" && secs > 0 && secs <= 3) sfx("tick");
  }, [phase, secs]);
  const lastPhase = useRef(phase);
  useEffect(() => {
    const was = lastPhase.current;
    lastPhase.current = phase;
    if (was === "countdown" && phase === "play") {
      if (inRound) feedback("go");
      else sfx("go");
    }
  }, [phase, inRound]);

  // ----- status copy -----
  let head: ReactNode;
  let sub: ReactNode;
  if (phase === "countdown") {
    head = `Round ${round} · Get ready!`;
    sub = !isPlayer ? (
      `${alive.length} snakes about to brawl`
    ) : mine?.alive ? (
      <>
        Your snake wears the <b className="text-text">YOU</b> tag
      </>
    ) : (
      "You'll get a snake next round"
    );
  } else if (phase === "play") {
    if (isPlayer && mine && !mine.alive) {
      head = "💥 You're out this round";
      sub = `${alive.length} still slithering`;
    } else {
      head = `🐍 ${alive.length} snake${alive.length === 1 ? "" : "s"} left`;
      sub = !isPlayer
        ? "You're watching"
        : !mine
          ? "You'll get a snake next round"
          : longest === me
            ? `Length ${mine.len} · you're the longest 👑`
            : `Length ${mine.len} · eat, grow, outlast`;
    }
  } else if (phase === "roundOver" && view.waiting) {
    const gone = players.filter((p) => !p.connected).map((p) => p.name);
    head = "⏳ Waiting for players…";
    sub = gone.length ? `${gone.join(", ")} dropped out · back in ${secs}s or the match ends` : "Starting the next round…";
  } else if (phase === "roundOver") {
    head = winner ? `🏆 ${winner === me ? "You take" : `${name(winner)} takes`} round ${round}!` : "🤝 Draw, nobody scores";
    sub = view.roundReason ? REASON[view.roundReason] : "";
  } else {
    head = "🏁 Match over";
    sub = "Final standings below";
  }

  const clock =
    phase === "play"
      ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`
      : phase === "countdown"
        ? `starts in ${secs}`
        : phase === "roundOver"
          ? view.waiting
            ? `ends in ${secs}`
            : `next round in ${secs}`
          : `${view.history.length} round${view.history.length === 1 ? "" : "s"} played`;
  const hurry = phase === "play" && secs <= 10;
  const ring =
    hurry
      ? "#f87171"
      : phase === "countdown" && mine?.alive
        ? colors[me]
        : (phase === "roundOver" || phase === "final") && winner
          ? (colors[winner] ?? accent)
          : accent + "88";
  const label =
    `Snake arena, ${view.w} by ${view.h} cells. ${alive.length} of ${view.snakes.length} snakes alive.` +
    (mine ? (mine.alive ? ` Your snake: length ${mine.len}, heading ${mine.dir}.` : " Your snake is out.") : "");

  return (
    <div className="@container mx-auto flex w-full max-w-4xl flex-col gap-3">
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
              of {maxRoundsOf(view)} max · first to {winsNeededOf(view)}
            </span>
          </span>
          <span className={`shrink-0 tabular-nums ${hurry ? "font-bold text-red-400" : "text-muted"}`}>⏱ {clock}</span>
        </div>
        <TimerBar
          endsAt={phase === "final" ? 0 : view.endsAt}
          total={phase === "roundOver" && view.waiting ? REJOIN_MS : phase === "play" ? roundMsOf(view) : PHASE_MS[phase]}
          serverNow={serverNow}
          color={hurry ? "#f87171" : accent}
        />
      </div>

      <Arena
        view={view}
        steps={steps}
        deltas={deltas}
        me={me}
        colors={colors}
        byId={byId}
        pred={pred}
        serverNow={serverNow}
        reduced={reduced}
        steerable={steerable}
        onSteer={steer}
        label={label}
        ringColor={ring}
      >
        <BoardOverlay view={view} me={me} secs={secs} byId={byId} colors={colors} hurry={hurry} />
      </Arena>

      {/* Controls stay put between rounds (disabled while you can't steer) so nothing jumps under your thumb. */}
      {isPlayer && phase !== "final" && (
        <>
          <p
            className={`hidden text-center text-xs text-muted transition-opacity @xl:block pointer-fine:block ${steerable ? "" : "opacity-50"}`}
          >
            Steer with <Kbd>←</Kbd> <Kbd>↑</Kbd> <Kbd>↓</Kbd> <Kbd>→</Kbd> or <Kbd>WASD</Kbd>, or drag on the board
          </p>
          <div className="hidden items-center gap-4 @max-xl:flex pointer-coarse:flex">
            <DPad
              onSteer={steer}
              current={steerable ? (heading ?? mine?.dir ?? null) : null}
              disabled={!steerable}
              accent={accent}
              avatar={byId[me]?.avatar}
            />
            <p className="min-w-0 flex-1 text-xs text-muted">
              {steerable
                ? "Swipe on the board, tap beside your head, or use the pad."
                : mine?.alive === false && phase === "play"
                  ? "You're out. Back in next round!"
                  : "Get ready for the next round."}
            </p>
          </div>
        </>
      )}
      {!isPlayer && <Note>👀 You&apos;re spectating. Snakes are steered by the players.</Note>}

      {phase !== "final" && <Roster view={view} players={players} me={me} colors={colors} longest={longest} />}
      {phase !== "final" && <KillFeed feed={view.feed} byId={byId} colors={colors} />}
      {phase === "final" && <FinalStandings view={view} players={players} byId={byId} me={me} colors={colors} />}
    </div>
  );
}

function longestSnake(view: SnakeView): string | null {
  let best = -1;
  let id: string | null = null;
  for (const s of view.snakes) {
    if (!s.alive) continue;
    if (s.len > best) [best, id] = [s.len, s.id];
    else if (s.len === best) id = null;
  }
  return id;
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-panel-2 px-1 py-px font-mono text-[11px] text-text">{children}</kbd>
  );
}

function BoardOverlay({
  view,
  me,
  secs,
  byId,
  colors,
  hurry,
}: {
  view: SnakeView;
  me: string;
  secs: number;
  byId: Record<string, Player>;
  colors: Record<string, string>;
  hurry: boolean;
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
  if (view.phase === "play") {
    if (secs >= roundMsOf(view) / 1000) {
      return (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="animate-pop font-display text-5xl font-black text-white/90 drop-shadow-[0_4px_14px_rgba(0,0,0,0.7)] @2xl:text-7xl">
            GO!
          </span>
        </div>
      );
    }
    if (hurry) {
      return (
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
          <span
            key={secs}
            className="animate-pop rounded-full bg-red-500/85 px-3 py-0.5 font-mono text-sm font-bold text-white tabular-nums shadow-lg shadow-black/40"
          >
            {secs}s
          </span>
        </div>
      );
    }
    return null;
  }
  if (view.phase === "roundOver") {
    const w = view.lastRoundWinner;
    const p = w ? byId[w] : undefined;
    return (
      <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-xl bg-ink/45">
        <div
          className="animate-pop card flex max-w-[85%] flex-col items-center px-4 py-2.5 text-center shadow-xl shadow-black/40 @xl:px-6 @xl:py-4"
          style={{ borderColor: (w && colors[w]) || undefined }}
        >
          <span className="text-3xl @xl:text-5xl" aria-hidden>
            <Avatar id={p ? p.avatar : "🤝"} />
          </span>
          <span
            className="max-w-full truncate font-display text-lg font-extrabold @xl:text-3xl"
            style={{ color: (w && colors[w]) || undefined }}
          >
            {w ? (w === me ? "You!" : (p?.name ?? "Someone")) : "Draw"}
          </span>
          <span className="text-xs text-muted @xl:text-sm">
            {w ? `takes round ${view.round}` : "nobody scores this round"}
          </span>
          {view.waiting && (
            <span className="mt-1.5 animate-rise rounded-full bg-panel-2 px-2.5 py-0.5 text-xs font-semibold text-brand-2 @xl:text-sm">
              ⏳ waiting for players ({secs}s)
            </span>
          )}
        </div>
      </div>
    );
  }
  return null;
}

function Pips({ wins, need, color }: { wins: number; need: number; color: string }) {
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

function Roster({
  view,
  players,
  me,
  colors,
  longest,
}: {
  view: SnakeView;
  players: Player[];
  me: string;
  colors: Record<string, string>;
  longest: string | null;
}) {
  return (
    <ul className="flex flex-wrap justify-center gap-1.5" aria-label="Snakes">
      {players.map((p) => {
        const sn = view.snakes.find((s) => s.id === p.id);
        const wins = view.roundWins[p.id] ?? 0;
        const color = colors[p.id] ?? p.color;
        const out = !!sn && !sn.alive;
        const state = !p.connected
          ? "offline"
          : !sn
            ? "joins next round"
            : sn.alive
              ? `length ${sn.len}`
              : "out this round";
        return (
          <li
            key={p.id}
            className={`flex min-h-9 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm transition-opacity ${
              out || !sn ? "opacity-55" : ""
            } ${p.id === me ? "ring-2 ring-white/60" : ""}`}
            style={{ borderColor: color + "88", background: color + "1c" }}
          >
            <span aria-hidden><Avatar id={p.avatar} /></span>
            <span className="max-w-[7.5rem] truncate font-semibold" style={{ color }}>
              {p.name}
            </span>
            {p.id === me && <span className="text-xs font-semibold text-text/80">you</span>}
            <Pips wins={wins} need={winsNeededOf(view)} color={color} />
            <span className="font-mono text-xs text-muted tabular-nums" aria-hidden>
              {sn?.alive ? `${longest === p.id ? "👑" : "🐍"}${sn.len}` : !p.connected ? "🔌" : sn ? "💀" : "⏳"}
            </span>
            <span className="sr-only">
              , {wins} round win{wins === 1 ? "" : "s"}, {state}
              {longest === p.id ? ", longest snake" : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function KillFeed({
  feed,
  byId,
  colors,
}: {
  feed: FeedItem[];
  byId: Record<string, Player>;
  colors: Record<string, string>;
}) {
  const items: FeedItem[] = [];
  for (const f of feed) {
    // A head-on crash is logged for both snakes; show it once.
    if (f.cause === "head" && items.some((o) => o.cause === "head" && o.id === f.by && o.by === f.id && o.at === f.at)) {
      continue;
    }
    items.push(f);
  }
  const who = (id: string | null) => (
    <b style={{ color: (id && colors[id]) || undefined }}>{(id && byId[id]?.name) || "someone"}</b>
  );
  return (
    <ol className="flex min-h-14 flex-col items-center gap-0.5 text-sm" aria-label="Knockouts this round">
      {items
        .slice(-3)
        .reverse()
        .map((f, i) => (
          <li key={`${f.id}-${f.at}`} className={`animate-rise truncate ${i > 0 ? "text-muted opacity-70" : ""}`}>
            {f.cause === "wall" && <>🧱 {who(f.id)} hit the wall</>}
            {f.cause === "self" && <>🌀 {who(f.id)} bit their own tail</>}
            {f.cause === "snake" && (
              <>
                💥 {who(f.id)} ran into {who(f.by)}
              </>
            )}
            {f.cause === "head" && (
              <>
                ⚔️ {who(f.id)} and {who(f.by)} collided head-on
              </>
            )}
            {f.cause === "left" && <>🔌 {who(f.id)} left the arena</>}
          </li>
        ))}
    </ol>
  );
}

function FinalStandings({
  view,
  players,
  byId,
  me,
  colors,
}: {
  view: SnakeView;
  players: Player[];
  byId: Record<string, Player>;
  me: string;
  colors: Record<string, string>;
}) {
  const wins = (id: string) => view.roundWins[id] ?? 0;
  const best = (id: string) => view.best[id] ?? 0;
  const champs = view.champions ?? [];
  const champ = (id: string) => (champs.includes(id) ? 1 : 0);
  // Champions first (a forfeit can crown someone who isn't ahead on rounds), then round wins;
  // remaining ties are broken (for display only) by the longest snake each player grew.
  const order = players
    .map((p) => p.id)
    .sort((a, b) => champ(b) - champ(a) || wins(b) - wins(a) || best(b) - best(a));
  const topLen = Math.max(0, ...order.map(best));
  const biggest = order.filter((id) => best(id) === topLen);
  const medal = ["🥇", "🥈", "🥉"];
  return (
    <div className="grid gap-3 @xl:grid-cols-[3fr_2fr]">
      <section className="card p-3" aria-label="Final standings">
        <div className="label mb-2">Final standings</div>
        <ol className="space-y-1.5">
          {order.map((id, i) => {
            const p = byId[id];
            const color = colors[id] ?? p?.color ?? "#94a3b8";
            const isChamp = champ(id) === 1;
            const rank = isChamp ? 1 : 1 + order.filter((o) => champ(o) > 0 || wins(o) > wins(id)).length;
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
                  {rank <= 3 && (isChamp || wins(id) > 0) ? medal[rank - 1] : <span className="text-sm text-muted">{rank}</span>}
                </span>
                <span className="sr-only">Place {rank}:</span>
                <span className="relative shrink-0 text-xl leading-none" aria-hidden>
                  <Avatar id={p?.avatar ?? "🐍"} />
                  {isChamp && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-sm motion-safe:animate-bounce">👑</span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-semibold" style={{ color }}>
                      {p?.name ?? "Someone"}
                    </span>
                    {id === me && <span className="shrink-0 text-xs font-semibold text-muted">you</span>}
                  </span>
                  <span className="block text-xs text-muted tabular-nums">longest {best(id)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Pips wins={wins(id)} need={winsNeededOf(view)} color={color} />
                  <span className="w-5 text-right font-mono text-lg font-bold tabular-nums">{wins(id)}</span>
                  <span className="sr-only"> round win{wins(id) === 1 ? "" : "s"}</span>
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
            {view.history.map((r: RoundResult, i) => (
              <li key={i} className="flex min-w-0 items-baseline gap-2">
                <span className="w-7 shrink-0 font-mono text-xs text-muted">R{i + 1}</span>
                <span className="min-w-0 break-words">
                  {r.winner ? (
                    <>
                      <span aria-hidden><Avatar id={byId[r.winner]?.avatar ?? "🏆"} /></span>{" "}
                      <b style={{ color: colors[r.winner] }}>{byId[r.winner]?.name ?? "Someone"}</b>
                    </>
                  ) : (
                    "🤝 Draw"
                  )}
                  <span className="text-muted"> · {REASON[r.reason].toLowerCase()}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        {topLen > START_LEN && (
          <div className="rounded-lg bg-panel-2 px-3 py-2 text-sm">
            <span className="label">Biggest snake</span>
            <div className="mt-0.5 truncate">
              🐍{" "}
              {biggest.map((id, i) => (
                <span key={id}>
                  {i > 0 && ", "}
                  <b style={{ color: colors[id] }}>{byId[id]?.name ?? "Someone"}</b>
                </span>
              ))}{" "}
              <span className="text-muted">· length {topLen}</span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function DPad({
  onSteer,
  current,
  disabled,
  accent,
  avatar,
}: {
  onSteer: (dir: Dir) => void;
  current: Dir | null;
  disabled: boolean;
  accent: string;
  avatar?: string;
}) {
  const pad = (dir: Dir, label: string, glyph: string, area: string) => (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className="grid size-16 touch-none place-items-center rounded-2xl border border-line bg-panel-2 text-2xl text-text shadow-md shadow-black/30 transition-[transform,opacity] select-none active:scale-90 disabled:opacity-35"
      style={{ gridArea: area, ...(current === dir ? { borderColor: accent, color: accent } : null) }}
      onPointerDown={(e) => {
        e.preventDefault();
        onSteer(dir);
      }}
      onClick={(e) => {
        // Keyboard activation (pointer presses were handled on pointerdown).
        if (e.detail === 0) onSteer(dir);
      }}
    >
      {glyph}
    </button>
  );
  return (
    <div
      role="group"
      aria-label="Steering pad"
      className="grid shrink-0 gap-2"
      style={{ gridTemplateAreas: '". u ." "l c r" ". d ."' }}
    >
      {pad("up", "Steer up", "▲", "u")}
      {pad("left", "Steer left", "◀", "l")}
      <span className="grid size-16 place-items-center text-2xl opacity-70" style={{ gridArea: "c" }} aria-hidden>
        <Avatar id={avatar ?? "🐍"} />
      </span>
      {pad("right", "Steer right", "▶", "r")}
      {pad("down", "Steer down", "▼", "d")}
    </div>
  );
}

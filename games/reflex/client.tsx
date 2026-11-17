"use client";

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Note, PlayerChip, TimerBar, useSecondsLeft } from "@/components/game-ui";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import type { FoulKind, Phase, ReflexAction, ReflexView, RoundEntry, RoundSummary } from "./server";
import { timeTap, type Painted } from "./timing";
import { Avatar } from "@/components/Avatar";
import { feedback, sfx } from "@/lib/feedback";

type Props = GameClientProps<ReflexView, ReflexAction>;
type SignalPhase = Extract<Phase, "ready" | "wait" | "fake" | "go">;

/** This client's own tap, shown instantly while the server catches up. */
interface MyTap {
  /** `${game}:${round}` the tap belongs to. */
  key: string;
  kind: "drew" | "early";
  rt: number | null;
  during: FoulKind;
}

const MEDALS = ["🥇", "🥈", "🥉"];
const STAGE_MIN_H = "min-h-[clamp(240px,50vh,520px)]";
const GOLD = "#facc15";
/** Focused controls outside the game keep their own Space/Enter behaviour. */
const INTERACTIVE =
  "a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=switch],[role=tab],[role=menuitem],[role=option]";
/** Long lists split into two columns (read top-to-bottom) when the game area is wide. */
const TWO_COL_ROWS: Record<number, string> = {
  4: "@xl:grid-flow-col @xl:grid-cols-2 @xl:grid-rows-[repeat(4,auto)]",
  5: "@xl:grid-flow-col @xl:grid-cols-2 @xl:grid-rows-[repeat(5,auto)]",
  6: "@xl:grid-flow-col @xl:grid-cols-2 @xl:grid-rows-[repeat(6,auto)]",
};

const CSS = `
.rx-arena { -webkit-tap-highlight-color: transparent; }
.rx-spark { opacity: 0; }
@media (prefers-reduced-motion: no-preference) {
  .rx-pulse { animation: rx-pulse 1.15s ease-in-out infinite; }
  .rx-shake { animation: rx-shake 0.42s linear both; }
  .rx-slam { animation: rx-slam 0.18s cubic-bezier(0.2, 1.6, 0.4, 1) both; }
  .rx-nudge { animation: rx-nudge 1.1s ease both; }
  .rx-breathe { animation: rx-breathe 1.8s ease-in-out infinite; }
  .rx-sway { animation: rx-sway 2.4s ease-in-out infinite; }
  .rx-hop { animation: rx-hop 0.55s cubic-bezier(0.2, 1.4, 0.4, 1) both; }
  .rx-spark { animation: rx-spark 0.95s ease-out both; }
  .rx-grow { animation: rx-grow 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
  .rx-flash { animation: rx-flash 0.32s ease-out both; }
  .rx-slide { animation: rx-slide 0.34s cubic-bezier(0.2, 0.9, 0.3, 1.15) both; }
}
.rx-grow { transform-origin: left center; }
.rx-flash { opacity: 0; }
@keyframes rx-grow { from { transform: scaleX(0); } to { transform: none; } }
@keyframes rx-flash { from { opacity: 0.9; } to { opacity: 0; } }
@keyframes rx-slide { from { opacity: 0; transform: translateX(-14px); } to { opacity: 1; transform: none; } }
@keyframes rx-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
@keyframes rx-shake {
  0%, 100% { transform: none; }
  15% { transform: translateX(-8px) rotate(-3deg); }
  30% { transform: translateX(8px) rotate(3deg); }
  45% { transform: translateX(-6px) rotate(-1.5deg); }
  60% { transform: translateX(6px) rotate(1.5deg); }
  80% { transform: translateX(-2px); }
}
@keyframes rx-slam { from { transform: scale(1.32); } to { transform: none; } }
@keyframes rx-nudge {
  0% { opacity: 0; transform: translateY(8px) scale(0.9); }
  12% { opacity: 1; transform: none; }
  70% { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes rx-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
@keyframes rx-sway { 0%, 100% { transform: rotate(-5deg); } 50% { transform: rotate(5deg); } }
@keyframes rx-hop {
  0% { opacity: 0; transform: translateY(16px) scale(0.6); }
  60% { opacity: 1; transform: translateY(-6px) scale(1.08); }
  100% { transform: none; }
}
@keyframes rx-spark {
  0% { opacity: 0; transform: translate(0, 0) scale(0.4); }
  20% { opacity: 1; }
  100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(1.15); }
}
`;

export default function QuickDraw({ view, me, byId, isPlayer, act, serverNow, accent }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  /** Frame timestamp (performance clock) at which "DRAW!" was painted, per game+round. */
  const painted = useRef<Painted | null>(null);
  /** Game+round we last sent a tap for: one tap per round, even with two fingers. */
  const sentKey = useRef("");
  /** When the last keyboard tap happened, so the click a key can synthesise isn't counted twice. */
  const keyTapAt = useRef(-Infinity);
  const [mine, setMine] = useState<MyTap | null>(null);
  const [nudge, setNudge] = useState<{ key: string; n: number } | null>(null);

  const phase = view?.phase ?? null;
  // Rounds restart at 1 every match, so local per-round state is keyed by the match too.
  const roundKey = view ? `${view.game}:${view.round}` : "";

  // Reaction time runs from the frame that shows DRAW!, not from when the message arrived.
  useLayoutEffect(() => {
    if (phase !== "go") return;
    const raf = requestAnimationFrame((at) => {
      painted.current = { key: roundKey, at };
    });
    return () => cancelAnimationFrame(raf);
  }, [phase, roundKey]);

  // Signal cues: once per phase change, never per render.
  const onPhase = useEffectEvent((p: Phase | null) => {
    if (!view) return;
    if (p === "go") {
      if (isPlayer && view.you?.status === "none") feedback("go");
      else sfx("go");
    } else if (p === "fake") sfx("bump");
    else if (p === "ready") sfx("tick");
    else if (p === "result" && isPlayer && view.last?.winners.includes(me)) feedback("score");
  });
  useEffect(() => {
    onPhase(phase);
  }, [phase, roundKey]);

  /** Handle a tap at `at` (event timestamp). Returns true when the game used it. */
  function trigger(at: number): boolean {
    if (!view || !isPlayer) return false;
    const r = view.round;
    const k = `${view.game}:${r}`;
    switch (view.phase) {
      case "ready":
        setNudge((n) => ({ key: k, n: n && n.key === k ? n.n + 1 : 1 }));
        return true;
      case "wait":
      case "fake":
      case "go": {
        if (sentKey.current === k || view.you?.status !== "none") return true;
        sentKey.current = k;
        // Timed from the frame that painted DRAW! to the tap's own timestamp (see timing.ts).
        const tap = timeTap(view.phase, k, painted.current, at);
        if (tap.kind === "drew") {
          setMine({ key: k, kind: "drew", rt: tap.rt, during: "wait" });
          feedback("hit");
          act({ type: "tap", round: r, rt: tap.rt });
        } else {
          // Tapped before this screen showed the signal: honest clients own up.
          setMine({ key: k, kind: "early", rt: null, during: view.phase === "fake" ? "fake" : "wait" });
          feedback("out");
          act({ type: "tap", round: r, rt: null });
        }
        return true;
      }
      case "paused":
        if (view.pauseReason === "idle") act({ type: "tap", round: r, rt: null });
        return true;
      case "result":
        // Nothing to do, but swallow the key so mashing Space doesn't scroll the arena away.
        return true;
      default:
        return false;
    }
  }

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if ((e.key !== " " && e.key !== "Enter") || e.repeat || e.defaultPrevented) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target instanceof HTMLElement ? e.target : null;
    if (el && (el.isContentEditable || el.closest("input, textarea, select"))) return;
    const inside = !!el && !!rootRef.current?.contains(el);
    if (el && !inside && el.closest(INTERACTIVE)) return;
    if (!trigger(e.timeStamp)) return;
    keyTapAt.current = e.timeStamp;
    e.preventDefault();
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    trigger(e.timeStamp);
  };

  // Pointer taps are handled on pointerdown. A click with detail 0 comes from a screen
  // reader, switch access or the keyboard, which never sent a pointerdown.
  const onAssistClick = (e: ReactMouseEvent) => {
    if (e.detail !== 0 || e.timeStamp - keyTapAt.current < 600) return;
    trigger(e.timeStamp);
  };

  if (!view) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Note>Saddling up…</Note>
      </div>
    );
  }

  const local = mine && mine.key === roundKey ? mine : null;
  const you = view.you;
  const pendingLocal = you?.status === "none" ? local : null;
  const fouled = isPlayer && (you?.status === "foul" || pendingLocal?.kind === "early");
  const drew = isPlayer && (you?.status === "drew" || pendingLocal?.kind === "drew");
  const myRt = you?.rt ?? pendingLocal?.rt ?? null;
  // What this player actually saw when they jumped wins over a server label that raced the fake's end.
  const foulKind: FoulKind = (local?.kind === "early" ? local.during : null) ?? you?.foul ?? "wait";
  const live = Object.values(view.live);
  const online = view.ids.filter((id) => byId[id]?.connected !== false).length;
  const counts = {
    drew: live.filter((x) => x === "drew").length,
    out: live.filter((x) => x === "foul").length,
    online,
  };
  const signal = view.phase === "ready" || view.phase === "wait" || view.phase === "fake" || view.phase === "go";

  let stage: ReactNode;
  if (view.phase === "result") {
    stage = <ResultPanel view={view} byId={byId} me={me} accent={accent} serverNow={serverNow} />;
  } else if (view.phase === "paused") {
    stage = (
      <PausedPanel view={view} byId={byId} isPlayer={isPlayer} accent={accent} serverNow={serverNow} onAssist={onAssistClick} />
    );
  } else if (view.phase === "over") {
    stage = <FinalPanel view={view} byId={byId} me={me} accent={accent} />;
  } else {
    stage = (
      <SignalArena
        phase={view.phase}
        round={view.round}
        fakeText={view.fakeText}
        isPlayer={isPlayer}
        fouled={fouled}
        drew={drew}
        rt={myRt}
        foulKind={foulKind}
        nudge={nudge && nudge.key === roundKey ? nudge.n : 0}
        counts={counts}
        onAssist={onAssistClick}
      />
    );
  }

  let hint: ReactNode = null;
  if (!isPlayer) {
    if (view.phase !== "over") hint = <Note>👀 You&apos;re watching. Players tap the instant the panel says DRAW!</Note>;
  } else if (signal)
    hint = (
      <p className="text-center text-xs text-muted">
        Tap anywhere in the game<span className="hidden sm:inline"> · or press Space / Enter</span>
      </p>
    );
  else if (view.phase === "paused" && view.pauseReason === "idle")
    hint = <p className="text-center text-xs text-muted">Tap anywhere (or press Space) to keep playing</p>;

  return (
    <div
      ref={rootRef}
      onPointerDown={onPointerDown}
      className="mx-auto flex w-full max-w-4xl touch-manipulation flex-col gap-3 select-none [-webkit-touch-callout:none]"
    >
      <style>{CSS}</style>
      <TopBar view={view} />
      {stage}
      {view.phase !== "over" && <Posse view={view} byId={byId} me={me} />}
      {hint}
      <p className="sr-only" aria-live="assertive" aria-atomic="true">
        {announce(view, { fouled, drew, rt: myRt }, byId, me)}
      </p>
    </div>
  );
}

// ---------- top bar ----------

const PHASE_TAGS: Record<Phase, { label: string; color: string }> = {
  ready: { label: "Get ready", color: "#fda4af" },
  // The fake-out looks exactly like waiting up here: only the arena tries to trick you.
  wait: { label: "Hold…", color: "#f87171" },
  fake: { label: "Hold…", color: "#f87171" },
  go: { label: "DRAW!", color: "#4ade80" },
  result: { label: "Results", color: GOLD },
  paused: { label: "Paused", color: "#a39dc8" },
  over: { label: "Final", color: GOLD },
};

function TopBar({ view }: { view: ReflexView }) {
  const tag = PHASE_TAGS[view.phase];
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="font-display text-lg font-bold whitespace-nowrap">
          {view.phase === "over" ? "Game over" : `Round ${Math.max(1, view.round)}`}
        </span>
        <span className="truncate text-xs text-muted">first to {view.target} wins</span>
      </div>
      <span
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold"
        style={{ borderColor: tag.color + "66", color: tag.color, background: tag.color + "17" }}
      >
        <span aria-hidden className="size-2 rounded-full" style={{ background: tag.color }} />
        {tag.label}
      </span>
    </div>
  );
}

// ---------- the arena (ready / wait / fake / go) ----------

interface Look {
  key: string;
  bg: string;
  border: string;
  color: string;
  main: ReactNode;
  size: string;
  sub?: ReactNode;
  subColor?: string;
  countColor: string;
  icon?: string;
  iconAnim?: string;
  anim?: string;
  glow?: string;
  vignette?: boolean;
  /** A bright burst behind the content as the signal lands (the text stays on top, fully legible). */
  flash?: boolean;
}

const SIZE_M = "clamp(2.1rem, 12.5cqi, 5.75rem)";
const SIZE_L = "clamp(2.6rem, 18cqi, 8rem)";
/** Huge signal word sized to its length (~0.7em per heavy capital), so even "DRAWER" keeps ~6% margins. */
const signalSize = (word: string) =>
  `clamp(2.6rem, ${Math.min(25, 88 / (Math.max(1, word.length) * 0.7)).toFixed(1)}cqi, 11rem)`;
const WAIT_BG = "radial-gradient(ellipse at 50% 42%, #c2183f 0%, #730d22 48%, #2c0611 100%)";
const GREEN_DRAW = <span className="font-black text-green-300">DRAW!</span>;
/** One tip per round while the players get ready. */
const READY_TIPS: ReactNode[] = [
  <>Get ready · tap the instant you see {GREEN_DRAW}</>,
  <>Yellow words are fake-outs · only a green {GREEN_DRAW} counts</>,
  <>Tap too early and you sit out the round</>,
  <>Fastest valid tap takes the point</>,
];

function lookFor(p: {
  phase: SignalPhase;
  round: number;
  fakeText: string | null;
  isPlayer: boolean;
  fouled: boolean;
  drew: boolean;
  rt: number | null;
  foulKind: FoulKind;
}): Look {
  if (p.fouled) {
    const go = p.phase === "go";
    return {
      key: `foul-${go}`,
      bg: go
        ? "radial-gradient(ellipse at 50% 40%, #166534 0%, #0b2a17 75%)"
        : "radial-gradient(ellipse at 50% 40%, #4a0f1d 0%, #17050b 78%)",
      border: go ? "#22c55e" : "#9f1239",
      color: "#fecaca",
      icon: "🚫",
      main: p.foulKind === "fake" ? "Faked out!" : "Too early!",
      size: SIZE_M,
      sub: go ? "DRAW! was called — you're out this round" : "You're out this round",
      subColor: go ? "#86efac" : "#fda4af",
      countColor: go ? "#bbf7d0" : "#fecdd3",
      anim: "rx-shake",
    };
  }
  if (p.drew) {
    return {
      key: "drew",
      bg: "radial-gradient(ellipse at 50% 40%, #22c55e 0%, #15803d 45%, #0b3d1d 100%)",
      border: "#86efac",
      color: "#f0fdf4",
      icon: "💥",
      main: (
        <>
          {p.rt ?? "…"}
          <span className="text-[0.42em]"> ms</span>
        </>
      ),
      size: SIZE_L,
      sub: "Bang! Waiting for the others…",
      subColor: "#dcfce7",
      countColor: "#dcfce7",
      // Fully visible on the very frame of the tap (a fade-in would hide it for a frame or two).
      anim: "rx-slam",
      flash: true,
    };
  }
  switch (p.phase) {
    case "ready":
      return {
        key: "ready",
        bg: "radial-gradient(ellipse at 50% 35%, #521122 0%, #24070f 72%)",
        border: "#6b1d30",
        color: "#ffe4e6",
        icon: "🤠",
        iconAnim: "rx-sway",
        main: "Hands off…",
        size: SIZE_M,
        sub: READY_TIPS[(Math.max(1, p.round) - 1) % READY_TIPS.length],
        subColor: "#fda4af",
        countColor: "#fecdd3",
        anim: "animate-rise",
      };
    case "wait":
      return {
        key: "wait",
        bg: WAIT_BG,
        border: "#fb7185",
        color: "#fff1f2",
        icon: "✋",
        iconAnim: "rx-breathe",
        main: "Wait for it…",
        size: SIZE_M,
        sub: p.isPlayer ? "Tap early and you're out" : undefined,
        subColor: "#fecdd3",
        countColor: "#fecdd3",
        vignette: true,
      };
    case "fake":
      return {
        key: "fake",
        bg: WAIT_BG,
        border: GOLD,
        color: "#fde047",
        main: p.fakeText ?? "DRAW?",
        size: signalSize(p.fakeText ?? "DRAW?"),
        glow: "0 0 28px rgb(250 204 21 / 0.55), 0 4px 0 rgb(0 0 0 / 0.35)",
        countColor: "#fecdd3",
        anim: "rx-shake",
        vignette: true,
      };
    default:
      return {
        key: "go",
        bg: "radial-gradient(ellipse at 50% 45%, #bbf7d0 0%, #4ade80 34%, #16a34a 100%)",
        border: "#f0fdf4",
        color: "#04230f",
        main: "DRAW!",
        size: signalSize("DRAW!"),
        sub: p.isPlayer ? "TAP!" : undefined,
        subColor: "#052e16",
        countColor: "#052e16",
        anim: "rx-slam",
        flash: true,
      };
  }
}

function SignalArena(props: {
  phase: SignalPhase;
  round: number;
  fakeText: string | null;
  isPlayer: boolean;
  fouled: boolean;
  drew: boolean;
  rt: number | null;
  foulKind: FoulKind;
  nudge: number;
  counts: { drew: number; out: number; online: number };
  onAssist: (e: ReactMouseEvent) => void;
}) {
  const look = lookFor(props);
  const { phase, isPlayer, nudge, counts } = props;
  // Live tally: who's out while waiting, who's drawn once the signal is up. Hidden from a
  // player who still has to tap, so nothing competes with DRAW!.
  const stillToTap = phase === "go" && isPlayer && !props.fouled && !props.drew;
  let tally: string | null = null;
  if (phase === "go" && !stillToTap) {
    tally = `${counts.drew} of ${counts.online} drew` + (counts.out ? ` · ${counts.out} out` : "");
  } else if ((phase === "wait" || phase === "fake") && counts.out > 0) {
    tally = `🚫 ${counts.out} out`;
  }
  return (
    <div
      className="rx-arena @container relative isolate h-[clamp(240px,50vh,520px)] touch-manipulation overflow-hidden rounded-3xl border-2"
      style={{ background: look.bg, borderColor: look.border }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {look.vignette && (
        <span
          aria-hidden
          className="rx-pulse pointer-events-none absolute inset-0"
          style={{ boxShadow: "inset 0 0 110px 34px rgb(0 0 0 / 0.62)" }}
        />
      )}
      {look.flash && (
        <span
          key={`flash-${look.key}`}
          aria-hidden
          className="rx-flash pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(ellipse at 50% 45%, #ffffff 0%, #f0fdf4 45%, rgb(240 253 244 / 0) 80%)" }}
        />
      )}
      <div
        key={look.key}
        className={`relative flex h-full flex-col items-center justify-center gap-2 px-4 text-center ${look.anim ?? ""}`}
      >
        {look.icon && (
          <div aria-hidden className={`text-4xl leading-none sm:text-5xl ${look.iconAnim ?? ""}`}>
            {look.icon}
          </div>
        )}
        <div
          className="font-display leading-[0.95] font-extrabold tracking-tight"
          style={{ fontSize: look.size, color: look.color, textShadow: look.glow }}
        >
          {look.main}
        </div>
        {look.sub && (
          <div className="max-w-md text-sm font-semibold sm:text-base" style={{ color: look.subColor }}>
            {look.sub}
          </div>
        )}
      </div>
      {nudge > 0 && phase === "ready" && (
        <div key={nudge} className="rx-nudge pointer-events-none absolute inset-x-0 top-4 text-center">
          <span className="rounded-full bg-black/40 px-3 py-1 text-sm font-bold text-rose-100">✋ Not yet!</span>
        </div>
      )}
      {tally && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs font-bold"
          style={{ color: look.countColor }}
        >
          {tally}
        </div>
      )}
      {isPlayer && (
        <button
          type="button"
          aria-label="Draw! Tap here, or press Space or Enter, the instant the panel says DRAW!"
          onClick={props.onAssist}
          className="absolute inset-0 z-10 cursor-pointer rounded-[inherit] outline-none focus-visible:ring-4 focus-visible:ring-white/60 focus-visible:ring-inset"
        />
      )}
    </div>
  );
}

// ---------- round result ----------

function ResultPanel({
  view,
  byId,
  me,
  accent,
  serverNow,
}: {
  view: ReflexView;
  byId: Record<string, Player>;
  me: string;
  accent: string;
  serverNow: () => number;
}) {
  const secs = useSecondsLeft(view.timer?.endsAt, serverNow);
  const last = view.last;
  if (!last) return null;
  return (
    <section
      aria-label={`Round ${last.round} results`}
      className={`card @container flex ${STAGE_MIN_H} flex-col gap-3 p-3 sm:p-5`}
      style={{ borderColor: accent + "55" }}
    >
      <Spotlight last={last} byId={byId} me={me} />
      <RoundList last={last} byId={byId} me={me} />
      <div className="mt-auto flex flex-col gap-1.5 pt-1">
        <TimerBar endsAt={view.timer?.endsAt} total={view.timer?.total ?? 1} serverNow={serverNow} color={accent} />
        <p className="text-center text-xs text-muted">Next round in {secs}s · hands off!</p>
      </div>
    </section>
  );
}

const SPARKS: [string, string, string][] = [
  ["-74px", "-26px", "🎉"],
  ["76px", "-28px", "✨"],
  ["-96px", "14px", "⭐"],
  ["98px", "12px", "🎉"],
  ["-52px", "-46px", "✨"],
  ["54px", "-48px", "⭐"],
  ["-64px", "38px", "✨"],
  ["66px", "40px", "⭐"],
];

function Spotlight({ last, byId, me }: { last: RoundSummary; byId: Record<string, Player>; me: string }) {
  const winners = last.winners.map((id) => playerOf(byId, id));
  const rt = last.entries.find((e) => e.win)?.rt ?? null;
  if (winners.length === 0) {
    const present = last.entries.filter((e) => !e.away);
    const allFouled = present.length > 0 && present.every((e) => e.foul);
    return (
      <div className="flex flex-col items-center gap-1 text-center">
        <div className="label">Round {last.round}</div>
        <div aria-hidden className="rx-hop text-5xl leading-none">
          {allFouled ? "🙈" : "🌵"}
        </div>
        <h3 className="font-display text-2xl leading-tight font-extrabold sm:text-3xl">
          {allFouled ? "Everyone jumped the gun!" : "Nobody drew in time"}
        </h3>
        <p className="text-sm text-muted">No points this round.</p>
        <FakeLine last={last} />
      </div>
    );
  }
  const solo = winners.length === 1;
  const youWon = last.winners.includes(me);
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <div className="label">Round {last.round}</div>
      <div className="relative flex justify-center -space-x-3 pt-1">
        {winners.slice(0, 5).map((p, i) => (
          <span
            key={p.id}
            aria-hidden
            className="rx-hop grid size-16 place-items-center rounded-full border-2 text-4xl leading-none"
            style={{ borderColor: p.color, background: p.color + "30", animationDelay: `${i * 90}ms` }}
          >
            <Avatar id={p.avatar} />
          </span>
        ))}
        {youWon && (
          <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
            {SPARKS.map(([dx, dy, e], i) => (
              <span
                key={i}
                className="rx-spark absolute text-xl"
                style={{ "--dx": dx, "--dy": dy, animationDelay: `${120 + i * 35}ms` } as CSSProperties}
              >
                {e}
              </span>
            ))}
          </span>
        )}
      </div>
      <h3 className="font-display text-2xl leading-tight font-extrabold sm:text-3xl">
        {solo ? (
          youWon ? (
            "You win the round!"
          ) : (
            <>
              <span style={{ color: winners[0].color }}>{winners[0].name}</span> wins!
            </>
          )
        ) : (
          "Dead heat!"
        )}
      </h3>
      {!solo && <p className="text-sm font-semibold">{joinNames(winners.map((p) => p.name))} all score</p>}
      <div className="flex items-center gap-2">
        <span className="font-mono text-3xl font-black tabular-nums sm:text-4xl">
          {rt !== null ? <CountUp value={rt} /> : null}
          <span className="text-base font-bold text-muted"> ms</span>
        </span>
        {rt !== null && rt < 200 && (
          <span className="rounded-full bg-yellow-300/15 px-2 py-0.5 text-xs font-bold text-yellow-200">⚡ lightning</span>
        )}
      </div>
      <FakeLine last={last} />
    </div>
  );
}

function FakeLine({ last }: { last: RoundSummary }) {
  if (!last.fakeText) return null;
  return (
    <p className="text-xs text-muted">
      Fake-out this round: <span className="font-bold text-yellow-300">{last.fakeText}</span>
    </p>
  );
}

function RoundList({ last, byId, me }: { last: RoundSummary; byId: Record<string, Player>; me: string }) {
  const times = last.entries.flatMap((e) => (e.rt !== null ? [e.rt] : []));
  const fastest = times.length ? Math.min(...times) : 0;
  const rows = Math.ceil(last.entries.length / 2);
  return (
    <ol className={`grid gap-1.5 gap-x-3 ${last.entries.length > 6 ? (TWO_COL_ROWS[rows] ?? "") : ""}`}>
      {last.entries.map((e, i) => {
        const p = playerOf(byId, e.id);
        const place = e.rt !== null ? 1 + times.filter((x) => x < e.rt!).length : null;
        return (
          <li
            key={e.id}
            className="rx-slide relative flex min-h-10 min-w-0 items-center gap-2 overflow-hidden rounded-xl border px-2 py-1"
            style={{
              animationDelay: `${Math.min(i, 11) * 55}ms`,
              borderColor: e.win ? p.color : "transparent",
              background: e.win ? p.color + "26" : "var(--color-panel-2)",
            }}
          >
            {e.rt !== null && (
              // Race bar: the fastest draw fills the row; slower ones trail off.
              <span
                aria-hidden
                className="rx-grow pointer-events-none absolute inset-x-0 bottom-0 h-[3px]"
                style={{
                  width: `${Math.max(8, Math.round((100 * fastest) / Math.max(1, e.rt)))}%`,
                  background: p.color,
                  opacity: e.win ? 0.95 : 0.55,
                  animationDelay: `${120 + Math.min(i, 11) * 55}ms`,
                }}
              />
            )}
            <span aria-hidden className="w-7 shrink-0 text-center text-lg leading-none">
              {e.foul ? "🚫" : place !== null ? (MEDALS[place - 1] ?? <span className="text-sm text-muted">{place}</span>) : "·"}
            </span>
            <span className="sr-only">{place !== null ? `Place ${place}:` : e.foul ? "Fouled:" : "No draw:"}</span>
            <span className="min-w-0 shrink">
              <PlayerChip player={p} size="sm" dim={!p.connected} />
            </span>
            {e.id === me && <span className="shrink-0 text-[10px] font-bold text-muted uppercase">you</span>}
            <span
              className={`ml-auto shrink-0 text-right text-sm ${
                e.rt !== null ? "font-mono font-bold tabular-nums" : e.foul ? "text-rose-300" : "text-muted"
              }`}
            >
              {e.rt !== null ? `${e.rt} ms` : entryLabel(e, last.fakeText)}
            </span>
            {e.win && <PlusOne />}
          </li>
        );
      })}
    </ol>
  );
}

// ---------- paused ----------

function PausedPanel({
  view,
  byId,
  isPlayer,
  accent,
  serverNow,
  onAssist,
}: {
  view: ReflexView;
  byId: Record<string, Player>;
  isPlayer: boolean;
  accent: string;
  serverNow: () => number;
  onAssist: (e: ReactMouseEvent) => void;
}) {
  const secs = useSecondsLeft(view.timer?.endsAt, serverNow);
  const idle = view.pauseReason === "idle";
  const away = view.ids.filter((id) => !byId[id]?.connected);
  return (
    <section
      aria-label="Game paused"
      className={`card flex ${STAGE_MIN_H} flex-col items-center justify-center gap-3 p-5 text-center`}
    >
      <div aria-hidden className="rx-breathe text-5xl leading-none">
        {idle ? "😴" : "🌵"}
      </div>
      <h3 className="font-display text-2xl font-extrabold">{idle ? "Still there, partner?" : "Ghost town…"}</h3>
      <p className="max-w-sm text-sm text-muted">
        {idle
          ? "Nobody drew for a few rounds, so the duel is on hold."
          : "Quick Draw needs 2 players online. It picks up again the moment someone is back."}
      </p>
      {!idle && away.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5">
          {away.map((id) => (
            <PlayerChip key={id} player={playerOf(byId, id)} size="sm" dim>
              <span className="text-[10px] text-muted uppercase">away</span>
            </PlayerChip>
          ))}
        </div>
      )}
      {idle &&
        (isPlayer ? (
          <button type="button" className="btn btn-primary min-h-12 px-7 text-base" onClick={onAssist}>
            🤠 Keep playing
          </button>
        ) : (
          <Note>Waiting for a player to tap back in.</Note>
        ))}
      <div className="mt-1 w-full max-w-xs">
        <TimerBar endsAt={view.timer?.endsAt} total={view.timer?.total ?? 1} serverNow={serverNow} color={accent} />
        <p className="mt-1.5 text-xs text-muted">Game ends in {secs}s</p>
      </div>
    </section>
  );
}

// ---------- final standings ----------

function FinalPanel({
  view,
  byId,
  me,
  accent,
}: {
  view: ReflexView;
  byId: Record<string, Player>;
  me: string;
  accent: string;
}) {
  const score = (id: string) => view.scores[id] ?? 0;
  const best = (id: string) => view.best[id] ?? null;
  const fouls = (id: string) => view.fouls[id] ?? 0;
  const ranked = [...view.ids].sort(
    (a, b) =>
      score(b) - score(a) || (best(a) ?? 1e9) - (best(b) ?? 1e9) || view.ids.indexOf(a) - view.ids.indexOf(b),
  );
  const bests = view.ids.flatMap((id) => (best(id) !== null ? [best(id)!] : []));
  const fastestRt = bests.length ? Math.min(...bests) : null;
  const fastest = view.ids.filter((id) => fastestRt !== null && best(id) === fastestRt);
  const mostFouls = Math.max(0, ...view.ids.map(fouls));
  const itchy = mostFouls > 0 ? view.ids.filter((id) => fouls(id) === mostFouls) : [];
  const rounds = view.last?.round ?? view.round;
  const reason =
    view.endReason === "away"
      ? "Ended early · not enough players"
      : view.endReason === "idle"
        ? "Ended · everyone holstered"
        : `First to ${view.target} · ${rounds} round${rounds === 1 ? "" : "s"}`;
  const rows = Math.ceil(ranked.length / 2);

  return (
    <section aria-label="Final standings" className="card @container flex flex-col gap-3 p-3 sm:p-5">
      <Champions view={view} byId={byId} me={me} />
      <div className="text-center">
        <div className="label">Final standings</div>
        <p className="mt-1 text-sm text-muted">{reason}</p>
      </div>
      <ol className={`grid gap-1.5 gap-x-3 ${ranked.length > 6 ? (TWO_COL_ROWS[rows] ?? "") : ""}`}>
        {ranked.map((id, i) => {
          const p = playerOf(byId, id);
          const rank = 1 + view.ids.filter((x) => score(x) > score(id)).length;
          const won = view.winners.includes(id);
          const b = best(id);
          return (
            <li
              key={id}
              className="animate-rise grid min-h-11 grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-2 rounded-xl border px-2 py-1.5"
              style={{
                animationDelay: `${Math.min(i, 11) * 60}ms`,
                borderColor: won ? p.color : "transparent",
                background: won ? p.color + "26" : "var(--color-panel-2)",
              }}
            >
              <span aria-hidden className="text-center text-lg leading-none">
                {rank <= 3 ? MEDALS[rank - 1] : <span className="text-sm text-muted">{rank}</span>}
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="sr-only">Rank {rank}:</span>
                <span className="min-w-0 shrink">
                  <PlayerChip player={p} size="sm" dim={!p.connected} />
                </span>
                {id === me && <span className="shrink-0 text-[10px] font-bold text-muted uppercase">you</span>}
              </span>
              <span className="text-right leading-tight">
                <span className="font-mono text-base font-bold tabular-nums">{score(id)}</span>
                <span className="text-xs text-muted"> {score(id) === 1 ? "pt" : "pts"}</span>
                <span className="block text-[11px] text-muted tabular-nums">
                  {b !== null ? `best ${b} ms` : "no draws"}
                  {fouls(id) > 0 && ` · 🚫${fouls(id)}`}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      {view.endReason === "target" && view.last && <DecidingRound last={view.last} byId={byId} />}
      {(fastest.length > 0 || itchy.length > 0) && (
        <div className="grid gap-2 @lg:grid-cols-2">
          {fastestRt !== null && (
            <StatTile icon="⚡" label="Fastest draw" accent={accent} ids={fastest} byId={byId}>
              <span className="font-mono font-bold tabular-nums">{fastestRt} ms</span>
            </StatTile>
          )}
          {itchy.length > 0 && (
            <StatTile icon="🚫" label="Itchiest trigger finger" accent={accent} ids={itchy} byId={byId}>
              <span className="font-bold tabular-nums">
                {mostFouls} foul{mostFouls === 1 ? "" : "s"}
              </span>
            </StatTile>
          )}
        </div>
      )}
    </section>
  );
}

/** Who took the match: avatars hop in, with a burst of sparks on the winner's own screen. */
function Champions({ view, byId, me }: { view: ReflexView; byId: Record<string, Player>; me: string }) {
  const winners = view.winners.map((id) => playerOf(byId, id));
  if (winners.length === 0) return null;
  const youWon = view.winners.includes(me);
  const top = view.scores[winners[0].id] ?? 0;
  const best = winners.length === 1 ? view.best[winners[0].id] : null;
  return (
    <div className="flex flex-col items-center gap-1 border-b border-line/70 pt-2 pb-3 text-center">
      <div className="relative flex justify-center -space-x-3">
        {winners.slice(0, 5).map((p, i) => (
          <span
            key={p.id}
            aria-hidden
            className="rx-hop grid size-16 place-items-center rounded-full border-2 text-4xl leading-none shadow-lg shadow-black/30"
            style={{ borderColor: p.color, background: p.color + "30", animationDelay: `${i * 90}ms` }}
          >
            <Avatar id={p.avatar} />
          </span>
        ))}
        <span aria-hidden className="rx-hop absolute -top-5 text-2xl" style={{ animationDelay: "220ms" }}>
          👑
        </span>
        {youWon && (
          <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
            {SPARKS.map(([dx, dy, e], i) => (
              <span
                key={i}
                className="rx-spark absolute text-xl"
                style={{ "--dx": dx, "--dy": dy, animationDelay: `${200 + i * 35}ms` } as CSSProperties}
              >
                {e}
              </span>
            ))}
          </span>
        )}
      </div>
      <h3 className="font-display text-2xl leading-tight font-extrabold">
        {winners.length > 1 ? (
          "Dead heat!"
        ) : youWon ? (
          "Fastest gun in the room: you!"
        ) : (
          <>
            <span style={{ color: winners[0].color }}>{winners[0].name}</span> is the fastest gun
          </>
        )}
      </h3>
      <p className="text-sm text-muted">
        {winners.length > 1 ? `${joinNames(winners.map((p) => p.name))} share the win · ` : ""}
        {top} {top === 1 ? "pt" : "pts"}
        {best !== null && best !== undefined ? ` · best ${best} ms` : ""}
      </p>
    </div>
  );
}

/** The round that settled it: the top three times, since the game ends the moment someone hits the target. */
function DecidingRound({ last, byId }: { last: RoundSummary; byId: Record<string, Player> }) {
  const valid = last.entries.filter((e) => e.rt !== null);
  if (valid.length === 0) return null;
  const times = valid.map((e) => e.rt!);
  const shown = valid.slice(0, 3);
  const rest = last.entries.length - shown.length;
  return (
    <div className="rounded-xl bg-panel-2 px-3 py-2">
      <div className="label text-[10px]">Deciding round · round {last.round}</div>
      <ol className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        {shown.map((e) => {
          const place = 1 + times.filter((x) => x < e.rt!).length;
          return (
            <li key={e.id} className="inline-flex min-w-0 items-center gap-1.5">
              <span aria-hidden className="leading-none">
                {MEDALS[place - 1] ?? place}
              </span>
              <span className="sr-only">Place {place}:</span>
              <PlayerChip player={playerOf(byId, e.id)} size="sm" />
              <span className="font-mono font-bold tabular-nums">{e.rt} ms</span>
            </li>
          );
        })}
        {rest > 0 && <li className="text-xs text-muted">+{rest} more</li>}
      </ol>
    </div>
  );
}

function StatTile({
  icon,
  label,
  accent,
  ids,
  byId,
  children,
}: {
  icon: string;
  label: string;
  accent: string;
  ids: string[];
  byId: Record<string, Player>;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2" style={{ borderColor: accent + "40" }}>
      <span aria-hidden className="text-2xl leading-none">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="label text-[10px]">{label}</div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {ids.slice(0, 3).map((id) => (
            <PlayerChip key={id} player={playerOf(byId, id)} size="sm" />
          ))}
          {ids.length > 3 && <span className="text-xs text-muted">+{ids.length - 3}</span>}
          {children}
        </div>
      </div>
    </div>
  );
}

// ---------- scoreboard strip ----------

function Posse({ view, byId, me }: { view: ReflexView; byId: Record<string, Player>; me: string }) {
  const inRound = view.phase === "wait" || view.phase === "fake" || view.phase === "go";
  const roundWinners = view.phase === "result" ? (view.last?.winners ?? []) : [];
  return (
    <ul
      aria-label={`Scores, first to ${view.target}`}
      className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-1.5"
    >
      {view.ids.map((id) => {
        const p = playerOf(byId, id);
        const score = view.scores[id] ?? 0;
        const won = roundWinners.includes(id);
        const status = inRound ? view.live[id] : undefined;
        return (
          <li
            key={id}
            className={`flex min-h-11 min-w-0 items-center gap-2 rounded-xl border px-2 py-1.5 ${p.connected ? "" : "opacity-55"}`}
            style={{ borderColor: id === me ? p.color : p.color + "40", background: p.color + (won ? "30" : "12") }}
          >
            <span aria-hidden className="text-xl leading-none">
              <Avatar id={p.avatar} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex min-w-0 items-center gap-1">
                <span className="truncate text-sm leading-tight font-semibold" style={{ color: p.color }}>
                  {p.name}
                </span>
                {id === me && <span className="shrink-0 text-[10px] font-bold text-muted uppercase">you</span>}
              </span>
              <Pips score={score} target={view.target} color={p.color} fresh={won} />
            </span>
            {won ? (
              <PlusOne />
            ) : status === "foul" ? (
              <span className="shrink-0 text-base leading-none">
                <span aria-hidden>🚫</span>
                <span className="sr-only">out this round</span>
              </span>
            ) : status === "drew" ? (
              <span className="animate-pop shrink-0 rounded-full bg-green-400/20 px-1.5 py-0.5 text-[11px] font-bold text-green-300">
                drew
              </span>
            ) : !p.connected ? (
              <span className="shrink-0 text-[10px] text-muted uppercase">away</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function Pips({ score, target, color, fresh }: { score: number; target: number; color: string; fresh: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-1" role="img" aria-label={`${score} of ${target} points`}>
      {Array.from({ length: target }, (_, i) => {
        const on = i < score;
        return (
          <span
            key={i}
            className={`size-2.5 shrink-0 rounded-full border ${fresh && i === score - 1 ? "animate-pop" : ""}`}
            style={{ borderColor: color, background: on ? color : "transparent", opacity: on ? 1 : 0.45 }}
          />
        );
      })}
    </span>
  );
}

function PlusOne() {
  return (
    <span
      className="animate-pop shrink-0 rounded-full px-1.5 py-0.5 text-xs font-black"
      style={{ background: GOLD, color: "#1a1206" }}
    >
      +1
    </span>
  );
}

/** A number that counts up from 0 when it appears (instantly under reduced motion). */
function CountUp({ value, ms = 450 }: { value: number; ms?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = String(value);
      return;
    }
    el.textContent = "0";
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, Math.max(0, (t - t0) / ms));
      el.textContent = String(Math.round(value * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return (
    <>
      <span ref={ref} aria-hidden />
      <span className="sr-only">{value}</span>
    </>
  );
}

// ---------- helpers ----------

function playerOf(byId: Record<string, Player>, id: string): Player {
  return byId[id] ?? { id, name: "Player", color: "#94a3b8", avatar: "🤠", connected: false };
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

function entryLabel(e: RoundEntry, fakeText: string | null): string {
  if (e.foul === "fake") return `fell for ${fakeText ?? "the fake"}`;
  if (e.foul) return "jumped the gun";
  return e.away ? "away" : "no draw";
}

function describeRound(last: RoundSummary, byId: Record<string, Player>, me: string): string {
  const rt = last.entries.find((e) => e.win)?.rt;
  if (last.winners.length === 1) {
    const id = last.winners[0];
    return id === me ? `You win the round with ${rt} milliseconds` : `${playerOf(byId, id).name} wins with ${rt} milliseconds`;
  }
  if (last.winners.length > 1) {
    return `Dead heat: ${joinNames(last.winners.map((id) => playerOf(byId, id).name))} at ${rt} milliseconds`;
  }
  const present = last.entries.filter((e) => !e.away);
  if (present.length > 0 && present.every((e) => e.foul)) return "Everyone jumped the gun";
  return "Nobody drew in time";
}

function announce(
  view: ReflexView,
  mine: { fouled: boolean; drew: boolean; rt: number | null },
  byId: Record<string, Player>,
  me: string,
): string {
  switch (view.phase) {
    case "ready":
      return `Round ${view.round}. Hands off. Get ready.`;
    case "wait":
    case "fake":
      // Fake-outs are not announced: screen reader users simply keep waiting.
      return mine.fouled ? "Too early! You're out this round." : "Wait for it.";
    case "go":
      if (mine.fouled) return "Draw! You're out this round.";
      return mine.drew ? `${mine.rt ?? ""} milliseconds. Waiting for the others.` : "Draw!";
    case "result":
      return view.last ? `Round ${view.last.round}: ${describeRound(view.last, byId, me)}.` : "";
    case "paused":
      return view.pauseReason === "idle" ? "Paused. Tap to keep playing." : "Paused. Waiting for players to come back.";
    default:
      return "Game over. Final standings.";
  }
}

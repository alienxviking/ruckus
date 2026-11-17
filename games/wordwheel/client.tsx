"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameClientProps } from "@/shared/client-game";
import { Note, PlayerChip, TimerBar, useSecondsLeft, useTicker } from "@/components/game-ui";
import { Confetti } from "@/components/Confetti";
import { RollingNumber } from "@/components/RollingNumber";
import type { Player } from "@/shared/types";
import { feedback, sfx } from "@/lib/feedback";
import {
  ALL_SEVEN_BONUS,
  MAX_LEN,
  MIN_LEN,
  usesAll,
  wordPoints,
  type WheelAction,
  type WheelEvent,
  type WheelRow,
  type WheelView,
} from "./shared";

type Props = GameClientProps<WheelView, WheelAction>;

const INK = "#0a0d02";
const GOOD = "#c6f432";
const BAD = "#ff5d73";
const MISSED_SHOWN = 14;

const CSS = `
.ww-wheel { position: relative; aspect-ratio: 1; width: 100%; user-select: none; -webkit-user-select: none; touch-action: manipulation; }
.ww-wheel::before { content: ""; position: absolute; inset: 6%; border-radius: 999px; border: 2px dashed color-mix(in oklab, var(--acc) 35%, var(--color-line));
  background: radial-gradient(closest-side, color-mix(in oklab, var(--acc) 12%, transparent), transparent 70%); }
.ww-spin::before { animation: ww-spin .5s cubic-bezier(.3,1.3,.5,1); }
@keyframes ww-spin { from { transform: rotate(-60deg); } to { transform: none; } }
.ww-l { position: absolute; width: 25%; aspect-ratio: 1; translate: -50% -50%; display: grid; place-items: center; border-radius: 999px;
  background: var(--color-paper); color: ${INK}; border: 3px solid ${INK}; box-shadow: 0 4px 0 ${INK}; font-family: var(--font-hero), system-ui, sans-serif;
  font-weight: 800; font-size: clamp(1.5rem, 8vw, 2.1rem); line-height: 1; text-transform: uppercase; cursor: pointer;
  transition: left .42s cubic-bezier(.3,1.25,.5,1), top .42s cubic-bezier(.3,1.25,.5,1), transform .08s ease, background-color .15s ease;
  -webkit-tap-highlight-color: transparent; }
.ww-l:hover:not(:disabled) { background: #fff; }
.ww-l:active:not(:disabled) { transform: translateY(3px); box-shadow: 0 1px 0 ${INK}; }
.ww-l:disabled { cursor: default; }
.ww-c { width: 31%; background: var(--acc); font-size: clamp(1.9rem, 10vw, 2.6rem); box-shadow: 0 5px 0 ${INK}, 0 0 0 6px color-mix(in oklab, var(--acc) 25%, transparent); }
.ww-c:hover:not(:disabled) { background: color-mix(in oklab, var(--acc) 85%, #fff); }
.ww-tap { animation: ww-tap .22s ease; }
@keyframes ww-tap { 50% { transform: scale(.88); } }
.ww-input { min-height: 3.2rem; display: flex; align-items: center; justify-content: center; gap: .05em; font-family: var(--font-hero), system-ui, sans-serif;
  font-weight: 800; font-size: clamp(1.7rem, 8.5vw, 2.4rem); line-height: 1; text-transform: uppercase; letter-spacing: .04em; }
.ww-input > span { display: inline-block; animation: ww-pop .14s ease both; }
.ww-caret { width: 3px; height: 1.1em; border-radius: 2px; background: var(--acc); animation: ww-blink 1s steps(1) infinite !important; }
@keyframes ww-blink { 50% { opacity: 0; } }
@keyframes ww-pop { 0% { transform: translateY(6px) scale(.8); opacity: 0; } 100% { transform: none; opacity: 1; } }
.ww-shake { animation: ww-shake .4s ease both; }
@keyframes ww-shake { 0%,100% { transform: none; } 20% { transform: translateX(-9px); } 40% { transform: translateX(8px); } 60% { transform: translateX(-5px); } 80% { transform: translateX(3px); } }
.ww-float { position: absolute; left: 50%; top: 0; translate: -50% 0; pointer-events: none; white-space: nowrap; animation: ww-float 1.1s ease-out both; }
@keyframes ww-float { 0% { transform: translateY(12px) scale(.7); opacity: 0; } 20% { transform: translateY(0) scale(1.1); opacity: 1; } 70% { opacity: 1; } 100% { transform: translateY(-26px) scale(1); opacity: 0; } }
.ww-chip { animation: ww-chip .35s cubic-bezier(.2,1.5,.4,1) both; }
@keyframes ww-chip { 0% { transform: scale(.4); opacity: 0; } 100% { transform: none; opacity: 1; } }
.ww-seven { animation: ww-seven 2.4s cubic-bezier(.2,1.4,.4,1) both; }
@keyframes ww-seven { 0% { transform: scale(.3) rotate(-12deg); opacity: 0; } 15% { transform: scale(1.08) rotate(-4deg); opacity: 1; } 25% { transform: scale(1) rotate(-3deg); }
  85% { transform: scale(1) rotate(-3deg); opacity: 1; } 100% { transform: scale(.9) rotate(-3deg); opacity: 0; } }
.ww-count { animation: ww-count .9s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes ww-count { 0% { transform: scale(2); opacity: 0; } 30% { transform: scale(1); opacity: 1; } 100% { transform: scale(.9); opacity: .85; } }
.ww-in { animation: ww-in .35s cubic-bezier(.2,1.2,.4,1) both; }
@keyframes ww-in { from { transform: translateY(10px); opacity: 0; } to { transform: none; opacity: 1; } }
.ww-ctl { display: inline-flex; align-items: center; justify-content: center; gap: .35rem; min-height: 3rem; border-radius: .9rem; padding: 0 1rem;
  font-weight: 800; background: var(--color-panel-2); border: 2px solid var(--color-line); box-shadow: 0 3px 0 rgb(0 0 0 / .45);
  touch-action: manipulation; -webkit-tap-highlight-color: transparent; transition: transform .08s ease; }
.ww-ctl:active:not(:disabled) { transform: translateY(2px); box-shadow: 0 1px 0 rgb(0 0 0 / .45); }
.ww-ctl:disabled { opacity: .4; }
@media (prefers-reduced-motion: reduce) { .ww-l { transition: none; } .ww-shake, .ww-float, .ww-chip, .ww-seven, .ww-count, .ww-in, .ww-input > span { animation-duration: 1ms !important; } }
`;

/** Slot positions for the six ring letters (percent of the wheel), starting at the top. */
const SLOTS = Array.from({ length: 6 }, (_, k) => {
  const a = ((k * 60 - 90) * Math.PI) / 180;
  return { left: 50 + 34 * Math.cos(a), top: 50 + 34 * Math.sin(a) };
});

const PRAISE: Record<number, string> = {
  4: "nice!",
  5: "badhiya!",
  6: "shabaash!",
  7: "kya baat!",
  8: "ustaad!",
};
const praise = (len: number) => PRAISE[Math.min(8, len)] ?? "nice!";

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function shuffled(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function WordWheel({ view, me, byId, isPlayer, act, serverNow, onEvent, accent, players }: Props) {
  useTicker(250);
  const mine = view?.me ?? null;
  const now = serverNow();
  const live = !!view && !!mine && isPlayer && view.phase === "play" && now >= view.startsAt && !mine.finished;
  const all = view ? view.centre + view.ring.join("") : "";

  const [typed, setTyped] = useState("");
  const [order, setOrder] = useState([0, 1, 2, 3, 4, 5]);
  const [spinN, setSpinN] = useState(0);
  const [err, setErr] = useState<{ text: string; n: number } | null>(null);
  const [float, setFloat] = useState<{
    text: string;
    good: boolean;
    n: number;
  } | null>(null);
  const [seven, setSeven] = useState<{
    w: string;
    pts: number;
    n: number;
  } | null>(null);
  const [shout, setShout] = useState<{ text: string; n: number } | null>(null);
  const [tapped, setTapped] = useState<{ ch: string; n: number } | null>(null);
  const n = useRef(0);

  // A new wheel: fresh input and ring order.
  const roundKey = view ? `${view.round}:${all}` : "";
  const [seenRound, setSeenRound] = useState(roundKey);
  if (roundKey !== seenRound) {
    setSeenRound(roundKey);
    setTyped("");
    setOrder([0, 1, 2, 3, 4, 5]);
    setErr(null);
  }

  useEffect(
    () =>
      onEvent((e) => {
        const ev = e as WheelEvent;
        if (ev?.t === "no") {
          const W = ev.w.toUpperCase();
          const text =
            ev.why === "short"
              ? `${W}: 4 letters or more`
              : ev.why === "centre"
                ? `${W} is missing the centre letter`
                : ev.why === "dup"
                  ? `Already found ${W}`
                  : ev.why === "letters"
                    ? "Only letters on the wheel"
                    : `${W}? Not in our word list`;
          setErr({ text, n: ++n.current });
          setFloat(null);
          feedback("error");
        } else if (ev?.t === "ok") {
          setErr(null);
          if (ev.seven) {
            setSeven({ w: ev.w, pts: ev.pts, n: ++n.current });
            feedback("win");
          } else {
            setFloat({
              text: `+${ev.pts} ${praise(ev.w.length)}`,
              good: true,
              n: ++n.current,
            });
            feedback(ev.w.length >= 6 ? "score" : "pop");
          }
        } else if (ev?.t === "seven") {
          setShout({
            text: `${byId[ev.id]?.name ?? "Someone"} found an all-seven word!`,
            n: ++n.current,
          });
          sfx("hit");
        }
      }),
    [onEvent, byId],
  );
  useEffect(() => {
    if (!seven) return;
    const t = setTimeout(() => setSeven(null), 2500);
    return () => clearTimeout(t);
  }, [seven]);
  useEffect(() => {
    if (!shout) return;
    const t = setTimeout(() => setShout(null), 3500);
    return () => clearTimeout(t);
  }, [shout]);

  // Countdown / end-of-wheel cues.
  const prevPhase = useRef<string | null>(null);
  useEffect(() => {
    if (!view) return;
    const p = prevPhase.current;
    prevPhase.current = view.phase;
    if (!p || p === view.phase) return;
    if (view.phase === "play") feedback("go");
    if (view.phase === "between" || view.phase === "over") feedback("end");
  }, [view]);

  const fail = useCallback((text: string) => {
    setErr({ text, n: ++n.current });
    feedback("error");
  }, []);

  const press = useCallback(
    (k: string) => {
      if (!live || !view || !mine) return;
      if (k === "enter") {
        const w = typed;
        if (!w) return;
        if (w.length < MIN_LEN) return fail("4 letters or more");
        if (!w.includes(view.centre)) return fail(`Use the centre letter ${view.centre.toUpperCase()}`);
        if (mine.found.includes(w)) return fail(`Already found ${w.toUpperCase()}`);
        setTyped("");
        act({ type: "word", r: view.round, w });
        return;
      }
      if (k === "back") {
        setTyped((t) => t.slice(0, -1));
        return;
      }
      if (k === "shuffle") {
        setOrder(shuffled(6));
        setSpinN((x) => x + 1);
        sfx("bump");
        return;
      }
      if (!all.includes(k)) return fail("Only letters on the wheel");
      setErr(null);
      setTapped({ ch: k, n: ++n.current });
      setTyped((t) => (t.length < MAX_LEN ? t + k : t));
    },
    [live, view, mine, typed, act, all, fail],
  );

  useEffect(() => {
    if (!live) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (/^[a-z]$/.test(k)) {
        e.preventDefault();
        press(k);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        press("back");
      } else if (e.key === "Enter") {
        e.preventDefault();
        press("enter");
      } else if (e.key === " ") {
        e.preventDefault();
        press("shuffle");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live, press]);

  if (!view) return <Note>Spinning up the wheel…</Note>;
  const solo = players.length === 1;
  const ended = view.phase === "between" || view.phase === "over";

  return (
    <div className="@container mx-auto w-full max-w-[980px]" style={{ "--acc": accent } as React.CSSProperties}>
      <style href="ruckus-wordwheel" precedence="default">
        {CSS}
      </style>
      <div className="flex flex-col gap-3 @3xl:flex-row @3xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {view.phase === "ready" ? (
            <Ready view={view} serverNow={serverNow} />
          ) : ended ? (
            <Reveal view={view} serverNow={serverNow} found={mine?.found ?? []} watching={!mine} />
          ) : (
            <section className="card relative mx-auto flex w-full max-w-[34rem] flex-col gap-2 p-3 sm:p-4">
              <Header view={view} serverNow={serverNow} pts={mine?.pts ?? null} />
              {shout && (
                <div key={shout.n} className="ww-in marker text-center text-base text-sun">
                  {shout.text}
                </div>
              )}
              {mine ? (
                <div className="relative">
                  {float && (
                    <span key={float.n} className="ww-float marker z-10 text-xl" style={{ color: float.good ? GOOD : BAD }}>
                      {float.text}
                    </span>
                  )}
                  <div
                    key={err?.n ?? 0}
                    className={`ww-input ${err ? "ww-shake" : ""}`}
                    aria-live="polite"
                    aria-label={`Your word: ${typed.toUpperCase() || "empty"}`}
                  >
                    {typed ? (
                      [...typed].map((ch, i) => (
                        <span
                          key={i}
                          style={{
                            color: ch === view.centre ? "var(--acc)" : undefined,
                          }}
                        >
                          {ch}
                        </span>
                      ))
                    ) : (
                      <span className="text-base font-semibold tracking-normal text-muted normal-case">
                        {mine.finished ? "You're done" : "Tap or type a word"}
                      </span>
                    )}
                    {live && <i className="ww-caret ml-1" aria-hidden />}
                  </div>
                </div>
              ) : null}
              <p className={`min-h-5 text-center text-sm font-semibold ${err ? "text-[#ff8da0]" : "text-muted"}`}>
                {err?.text ??
                  (mine ? `Every word needs ${view.centre.toUpperCase()} · 4+ letters · letters can repeat` : "Watching the wheel")}
              </p>
              <div className="mx-auto w-full max-w-[17.5rem] sm:max-w-[19rem]">
                <div key={spinN} className={`ww-wheel ${spinN ? "ww-spin" : ""}`}>
                  {order.map((ri, slot) => {
                    const ch = view.ring[ri];
                    return (
                      <button
                        key={ch}
                        className={`ww-l ${tapped?.ch === ch ? "ww-tap" : ""}`}
                        style={{
                          left: `${SLOTS[slot].left}%`,
                          top: `${SLOTS[slot].top}%`,
                        }}
                        disabled={!live}
                        onClick={() => press(ch)}
                        aria-label={`Letter ${ch.toUpperCase()}`}
                      >
                        <span key={tapped?.ch === ch ? tapped.n : 0} className={tapped?.ch === ch ? "ww-tap" : ""}>
                          {ch}
                        </span>
                      </button>
                    );
                  })}
                  <button
                    className="ww-l ww-c"
                    style={{ left: "50%", top: "50%" }}
                    disabled={!live}
                    onClick={() => press(view.centre)}
                    aria-label={`Centre letter ${view.centre.toUpperCase()}`}
                  >
                    <span key={tapped?.ch === view.centre ? tapped.n : 0} className={tapped?.ch === view.centre ? "ww-tap" : ""}>
                      {view.centre}
                    </span>
                  </button>
                </div>
              </div>
              {mine && (
                <div className="mt-1 flex items-center justify-center gap-2">
                  <button className="ww-ctl" disabled={!live || !typed} onClick={() => press("back")} aria-label="Delete letter">
                    ⌫
                  </button>
                  <button className="ww-ctl" disabled={!live} onClick={() => press("shuffle")} aria-label="Shuffle the ring">
                    ↻ <span className="text-sm">Shuffle</span>
                  </button>
                  <button
                    className="stk-btn min-h-12 px-6 text-lg"
                    style={
                      {
                        "--btn-bg": "var(--acc)",
                        "--stk-shade": "#9a5b00",
                      } as React.CSSProperties
                    }
                    disabled={!live || !typed}
                    onClick={() => press("enter")}
                  >
                    Enter
                  </button>
                </div>
              )}
              {seven && (
                <div
                  className="pointer-events-none absolute inset-0 z-20 grid place-items-center overflow-hidden rounded-[inherit]"
                  aria-live="assertive"
                >
                  <Confetti pieces={44} />
                  <div
                    key={seven.n}
                    className="ww-seven stk px-6 py-4 text-center"
                    style={
                      {
                        "--stk-bg": "var(--acc)",
                        "--stk-fg": INK,
                      } as React.CSSProperties
                    }
                  >
                    <div className="font-hero text-3xl font-black tracking-tight uppercase sm:text-4xl">All seven!</div>
                    <div className="font-hero text-2xl font-extrabold uppercase">{seven.w}</div>
                    <div className="marker text-xl">+{seven.pts} · kya baat hai!!</div>
                  </div>
                </div>
              )}
              {mine && (
                <Found
                  view={view}
                  found={mine.found}
                  pts={mine.pts}
                  finished={mine.finished}
                  live={live}
                  onFinish={() => act({ type: "finish", r: view.round })}
                />
              )}
            </section>
          )}
        </div>
        {(!solo || !isPlayer) && <Board view={view} byId={byId} me={me} />}
        {solo && isPlayer && view.phase === "play" && <ScoringCard />}
      </div>
    </div>
  );
}

function Ready({ view, serverNow }: { view: WheelView; serverNow: () => number }) {
  const secs = useSecondsLeft(view.startsAt, serverNow);
  useEffect(() => {
    if (secs > 0) sfx("tick");
  }, [secs]);
  return (
    <div className="card grid min-h-[24rem] place-items-center p-6 text-center">
      <div>
        <div className="label mb-2">
          {view.rounds > 1 ? `Wheel ${view.round + 1} of ${view.rounds} · ` : ""}
          {Math.round(view.roundMs / 60000)} minutes · {view.count} words hiding
        </div>
        <div
          key={secs}
          className="ww-count font-hero text-8xl font-black"
          style={{ color: "var(--acc)", textShadow: "0 0 40px var(--acc)" }}
        >
          {secs || "GO"}
        </div>
        <p className="marker mt-3 text-lg text-sun">centre letter har word mein!</p>
      </div>
    </div>
  );
}

function Header({ view, serverNow, pts }: { view: WheelView; serverNow: () => number; pts: number | null }) {
  const left = view.endsAt - serverNow();
  const low = left < 15_000;
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="label">{view.rounds > 1 ? `Wheel ${view.round + 1} of ${view.rounds}` : "The wheel"}</div>
          <div className="font-mono text-xs text-muted">
            {view.count} words · {view.sevens} all-seven
          </div>
        </div>
        <div className={`font-hero text-3xl font-black tabular-nums ${low ? "text-[#ff8da0]" : ""}`} aria-label="Time left">
          {fmtClock(left)}
        </div>
        {pts !== null && (
          <div className="text-right">
            <div className="label">Points</div>
            <div className="font-hero text-2xl font-extrabold">
              <RollingNumber value={pts} />
            </div>
          </div>
        )}
      </div>
      <TimerBar endsAt={view.endsAt} total={view.roundMs} serverNow={serverNow} color={low ? BAD : "var(--acc)"} />
    </>
  );
}

function Found({
  view,
  found,
  pts,
  finished,
  live,
  onFinish,
}: {
  view: WheelView;
  found: string[];
  pts: number;
  finished: boolean;
  live: boolean;
  onFinish: () => void;
}) {
  const [arm, setArm] = useState(false);
  const all = view.centre + view.ring.join("");
  const sorted = found.slice().sort();
  const newest = found[found.length - 1];
  return (
    <div className="mt-2 rounded-xl border-2 border-line bg-panel-2/50 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-bold">
          {found.length} word{found.length === 1 ? "" : "s"} <span className="font-normal text-muted">of {view.count}</span>
        </div>
        {(live || finished) && (
          <button
            className="btn min-h-10 px-3 py-1.5 text-sm disabled:opacity-60"
            disabled={finished}
            style={arm ? { color: BAD } : undefined}
            onClick={() => (arm ? onFinish() : setArm(true))}
            onBlur={() => setArm(false)}
          >
            {finished ? "Waiting for the others…" : arm ? "Stop for good?" : "I'm done"}
          </button>
        )}
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${(found.length / Math.max(1, view.count)) * 100}%`,
            background: "var(--acc)",
          }}
        />
      </div>
      {sorted.length > 0 ? (
        <ul className="mt-2 flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
          {sorted.map((w) => {
            const seven = usesAll(w, all);
            return (
              <li
                key={w}
                className={`rounded-md border px-1.5 py-0.5 font-mono text-[13px] font-semibold uppercase ${w === newest ? "ww-chip" : ""}`}
                style={seven ? { background: "var(--acc)", color: INK, borderColor: INK } : { borderColor: "var(--color-line)" }}
              >
                {w}
                <span className="ml-1 text-xs opacity-60">{wordPoints(w, all)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-center text-xs text-muted">Your words show up here. {pts === 0 && "Short ones count too!"}</p>
      )}
    </div>
  );
}

function Reveal({ view, serverNow, found, watching }: { view: WheelView; serverNow: () => number; found: string[]; watching: boolean }) {
  const [more, setMore] = useState(false);
  const secs = useSecondsLeft(view.phase === "between" ? view.startsAt : null, serverNow);
  const all = view.centre + view.ring.join("");
  const answers = view.answers ?? [];
  const missed = answers.filter((w) => !found.includes(w));
  // All-seven words first, then the commonest ones (the list arrives most-common-first).
  const ordered = [...missed.filter((w) => usesAll(w, all)), ...missed.filter((w) => !usesAll(w, all))];
  const shown = more ? ordered : ordered.slice(0, MISSED_SHOWN);
  const pts = found.reduce((t, w) => t + wordPoints(w, all), 0);
  const gotSeven = found.some((w) => usesAll(w, all));
  return (
    <section
      className="stk ww-in relative mx-auto w-full max-w-[34rem] p-4"
      style={{ "--stk-bg": "var(--color-panel)" } as React.CSSProperties}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="label">{view.rounds > 1 ? `Wheel ${view.round + 1} of ${view.rounds} done` : "Wheel done"}</div>
          <div className="mt-1 flex items-center gap-1" aria-label={`Letters: ${all.toUpperCase()}`}>
            {[view.centre, ...view.ring].map((ch, i) => (
              <span
                key={i}
                className="grid size-7 place-items-center rounded-full border-2 border-ink font-hero text-sm font-extrabold uppercase"
                style={{
                  background: i === 0 ? "var(--acc)" : "var(--color-paper)",
                  color: INK,
                }}
              >
                {ch}
              </span>
            ))}
          </div>
          <div className="marker mt-1 text-lg text-sun">
            {watching
              ? "itne saare words!"
              : found.length === 0
                ? "arre, koi baat nahi!"
                : gotSeven
                  ? "all-seven bhi mila, wah!"
                  : found.length >= answers.length / 2
                    ? "shabaash, wordsmith!"
                    : "bas thoda aur next time"}
          </div>
        </div>
        {!watching && (
          <div className="shrink-0 text-right">
            <div className="label">This wheel</div>
            <div className="font-hero text-3xl font-extrabold" style={{ color: "var(--acc)" }}>
              {pts}
            </div>
            <div className="font-mono text-xs text-muted">
              {found.length}/{answers.length} words
            </div>
          </div>
        )}
      </div>
      {missed.length > 0 ? (
        <div className="mt-3">
          <div className="label mb-1.5">{found.length ? "Words you missed" : `All ${answers.length} words hiding in there`}</div>
          <ul className="flex flex-wrap gap-1.5">
            {shown.map((w) => {
              const seven = usesAll(w, all);
              return (
                <li
                  key={w}
                  className="rounded-md border px-1.5 py-0.5 font-mono text-[13px] font-semibold uppercase"
                  style={
                    seven
                      ? {
                          background: "var(--acc)",
                          color: INK,
                          borderColor: INK,
                        }
                      : {
                          borderColor: "var(--color-line)",
                          color: "var(--color-muted)",
                        }
                  }
                >
                  {w}
                  {seven && <span className="ml-1 text-xs">★ all 7</span>}
                </li>
              );
            })}
            {ordered.length > MISSED_SHOWN && (
              <li>
                <button
                  className="rounded-md px-1.5 py-0.5 text-xs font-semibold text-muted underline hover:text-text"
                  onClick={() => setMore((m) => !m)}
                >
                  {more ? "show fewer" : `+${ordered.length - MISSED_SHOWN} more`}
                </button>
              </li>
            )}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-center font-hero text-xl font-extrabold text-volt">You found every single word! 🤯</p>
      )}
      {view.phase === "between" ? (
        <div className="label mt-4 text-center">
          Wheel {view.round + 2} of {view.rounds} in {secs}…
        </div>
      ) : (
        view.me &&
        view.rounds > 1 && (
          <div className="mt-4 border-t-2 border-line pt-3">
            <div className="label mb-1">All wheels</div>
            <ol className="flex flex-col gap-1 font-mono text-sm">
              {view.me.history.map((h, i) => (
                <li key={i} className="flex justify-between">
                  <span className="text-muted">Wheel {i + 1}</span>
                  <span>
                    {h.words} words · <b>{h.pts}</b> pts
                  </span>
                </li>
              ))}
              <li className="flex justify-between border-t border-line pt-1 font-bold">
                <span>Total</span>
                <span style={{ color: "var(--acc)" }}>{view.me.total} pts</span>
              </li>
            </ol>
          </div>
        )
      )}
    </section>
  );
}

function Board({ view, byId, me }: { view: WheelView; byId: Record<string, Player>; me: string }) {
  const rows = view.board.slice().sort((a, b) => b.total - a.total || b.words - a.words);
  const best = Math.max(1, ...rows.map((r) => r.words));
  return (
    <aside className="card flex flex-col gap-2 p-3 @3xl:w-72 @3xl:shrink-0">
      <div className="label">Race · points (words stay secret)</div>
      <ol className="flex flex-col gap-1.5">
        {rows.map((r: WheelRow, i) => (
          <li
            key={r.id}
            className={`flex flex-col gap-1 rounded-md px-2 py-1.5 ${r.id === me ? "bg-panel-2 shadow-[inset_3px_0_0_var(--acc)]" : ""}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="w-4 font-mono text-xs text-muted">{i + 1}</span>
                <PlayerChip player={byId[r.id]} size="sm" dim={!byId[r.id]?.connected} />
                {r.seven && (
                  <span
                    className="rounded-sm px-1 text-[10px] font-black"
                    style={{ background: "var(--acc)", color: INK }}
                    title="Found an all-seven word"
                  >
                    ★7
                  </span>
                )}
              </span>
              <span className="font-hero text-lg font-extrabold">
                <RollingNumber value={view.rounds > 1 ? r.total : r.pts} />
              </span>
            </div>
            <div className="flex items-center gap-2 pl-6">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${(r.words / best) * 100}%`,
                    background: "var(--acc)",
                  }}
                />
              </div>
              <span className="shrink-0 text-right font-mono text-xs whitespace-nowrap text-muted">
                {r.words} word{r.words === 1 ? "" : "s"}
                {r.finished ? " · done" : ""}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function ScoringCard() {
  return (
    <aside className="card p-3 text-sm @3xl:w-60 @3xl:shrink-0">
      <div className="label mb-1.5">How it&apos;s scored</div>
      <ul className="space-y-1 text-muted">
        <li>
          4 letters: <b className="text-text">1</b> point
        </li>
        <li>
          Longer: <b className="text-text">1 per letter</b>
        </li>
        <li>
          All seven letters: <b className="text-text">+{ALL_SEVEN_BONUS}</b> bonus
        </li>
      </ul>
    </aside>
  );
}

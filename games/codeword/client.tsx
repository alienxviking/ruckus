"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameClientProps } from "@/shared/client-game";
import { Note, PlayerChip, TimerBar, useSecondsLeft, useTicker } from "@/components/game-ui";
import { Confetti } from "@/components/Confetti";
import { RollingNumber } from "@/components/RollingNumber";
import type { Player } from "@/shared/types";
import { feedback, sfx } from "@/lib/feedback";
import {
  LEN,
  MAX_GUESSES,
  SPEED_MAX,
  SPEED_MS,
  WORD_MS,
  crackPoints,
  hardProblem,
  speedBonus,
  type BoardRow,
  type CodeAction,
  type CodeEvent,
  type CodeView,
  type MyRun,
  type WordResult,
} from "./shared";

type Props = GameClientProps<CodeView, CodeAction>;

const HIT = "#c6f432";
const NEAR = "#4ce0ff";
const MISS = "#272c3c";
const BAD = "#ff5d73";
const STAGGER = 220;
const FLIP = 450;
const REVEAL_MS = STAGGER * (LEN - 1) + FLIP + 80;

const KEYS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

const CSS = `
.cw-grid { display: grid; gap: .38rem; width: 100%; perspective: 600px; }
.cw-row { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: .38rem; }
.cw-tile { --bg: var(--color-panel); --bd: var(--color-line); --fg: var(--color-text); --sh: transparent;
  position: relative; display: grid; place-items: center; aspect-ratio: 1; border-radius: .6rem; border: 2px solid var(--bd);
  background: var(--bg); color: var(--fg); box-shadow: 0 3px 0 var(--sh); font-family: var(--font-hero), system-ui, sans-serif;
  font-weight: 800; font-size: clamp(1.35rem, 6.6vw, 1.85rem); line-height: 1; text-transform: uppercase; user-select: none; }
.cw-tile[data-s="t"] { --bd: color-mix(in oklab, var(--color-text) 55%, var(--color-line)); animation: cw-pop .14s ease both; }
.cw-tile[data-s="2"] { --bg: ${HIT}; --bd: ${HIT}; --fg: #0a0d02; --sh: #6c8a00; }
.cw-tile[data-s="1"] { --bg: ${NEAR}; --bd: ${NEAR}; --fg: #04222b; --sh: #1b7f96; }
.cw-tile[data-s="0"] { --bg: ${MISS}; --bd: ${MISS}; --fg: #8a91a7; }
.cw-tile[data-s="1"]::after { content: ""; position: absolute; top: 12%; right: 12%; width: 16%; height: 16%; border-radius: 99px; background: currentColor; opacity: .55; }
.cw-flip { animation: cw-flip ${FLIP}ms ease-in-out both; animation-delay: calc(var(--i) * ${STAGGER}ms); }
.cw-flip::after { animation: cw-dot ${FLIP}ms linear both; animation-delay: calc(var(--i) * ${STAGGER}ms); }
@keyframes cw-flip {
  0% { transform: rotateX(0); background: var(--color-panel); border-color: color-mix(in oklab, var(--color-text) 55%, var(--color-line)); color: var(--color-text); box-shadow: none; }
  49.9% { transform: rotateX(90deg); background: var(--color-panel); border-color: color-mix(in oklab, var(--color-text) 55%, var(--color-line)); color: var(--color-text); box-shadow: none; }
  50% { transform: rotateX(90deg); background: var(--bg); border-color: var(--bd); color: var(--fg); }
  100% { transform: rotateX(0); background: var(--bg); border-color: var(--bd); color: var(--fg); } }
@keyframes cw-dot { 0%, 50% { opacity: 0; } 100% { opacity: .55; } }
.cw-hop { animation: cw-flip ${FLIP}ms ease-in-out both, cw-hop .55s cubic-bezier(.3,1.6,.5,1) forwards;
  animation-delay: calc(var(--i) * ${STAGGER}ms), calc(${REVEAL_MS}ms + var(--i) * 90ms); }
@keyframes cw-hop { 0% { transform: none; } 40% { transform: translateY(-38%) rotate(-4deg); } 100% { transform: none; } }
@keyframes cw-pop { 0% { transform: scale(.82); } 60% { transform: scale(1.08); } 100% { transform: none; } }
.cw-shake { animation: cw-shake .42s ease both; }
@keyframes cw-shake { 0%,100% { transform: none; } 20% { transform: translateX(-9px); } 40% { transform: translateX(8px); } 60% { transform: translateX(-5px); } 80% { transform: translateX(3px); } }
.cw-key { --bg: var(--color-panel-2); --bd: var(--color-line); --fg: var(--color-text); --sh: rgb(0 0 0 / .45);
  min-width: 0; flex: 1 1 0; height: 3.35rem; border-radius: .6rem; background: var(--bg); border: 2px solid var(--bd); color: var(--fg);
  box-shadow: 0 3px 0 var(--sh); font-weight: 800; font-size: 1.05rem; text-transform: uppercase; touch-action: manipulation;
  -webkit-tap-highlight-color: transparent; transition: transform .08s ease, background-color .25s ease, color .25s ease; user-select: none; }
.cw-key:active:not(:disabled) { transform: translateY(2px); box-shadow: 0 1px 0 var(--sh); }
.cw-key:disabled { opacity: .5; }
.cw-key[data-s="2"] { --bg: ${HIT}; --bd: ${HIT}; --fg: #0a0d02; --sh: #6c8a00; }
.cw-key[data-s="1"] { --bg: ${NEAR}; --bd: ${NEAR}; --fg: #04222b; --sh: #1b7f96; }
.cw-key[data-s="0"] { --bg: #171a24; --bd: #171a24; --fg: #5d6479; --sh: transparent; }
.cw-key[data-wide="true"] { flex: 1.55 1 0; font-size: .78rem; letter-spacing: .02em; }
.cw-mini { display: grid; grid-template-columns: repeat(5, 1fr); gap: 2px; }
.cw-mini > span { aspect-ratio: 1; border-radius: 2px; background: color-mix(in oklab, var(--color-line) 70%, transparent); }
.cw-mini > span[data-s="2"] { background: ${HIT}; } .cw-mini > span[data-s="1"] { background: ${NEAR}; } .cw-mini > span[data-s="0"] { background: #3a4054; }
.cw-mini > span[data-new="true"] { animation: cw-pop .3s ease both; }
.cw-count { animation: cw-count .9s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes cw-count { 0% { transform: scale(2); opacity: 0; } 30% { transform: scale(1); opacity: 1; } 100% { transform: scale(.9); opacity: .85; } }
.cw-in { animation: cw-in .35s cubic-bezier(.2,1.2,.4,1) both; }
@keyframes cw-in { from { transform: translateY(10px); opacity: 0; } to { transform: none; opacity: 1; } }
.cw-dot { width: .6rem; height: .6rem; border-radius: 99px; background: var(--color-line); }
.cw-dot[data-s="cur"] { background: var(--color-text); box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-text) 20%, transparent); }
.cw-dot[data-s="ok"] { background: ${HIT}; } .cw-dot[data-s="bad"] { background: ${BAD}; }
@media (prefers-reduced-motion: reduce) { .cw-flip, .cw-hop, .cw-shake, .cw-count, .cw-in, .cw-tile[data-s="t"] { animation-duration: 1ms !important; animation-delay: 0ms !important; } }
`;

const CRACK_QUIP = ["", "jaadu! 🤯", "kya baat hai!", "shabaash!", "badhiya!", "phew, nice one", "bach gaye! 😅"];

/** Best status per letter over these rows: 2 beats 1 beats 0. */
function keyStates(guesses: string[], marks: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  guesses.forEach((g, r) => {
    [...g].forEach((ch, i) => {
      const m = marks[r]?.[i] ?? "0";
      if ((out[ch] ?? "") < m) out[ch] = m;
    });
  });
  return out;
}

export default function CodeWord({ view, me, byId, isPlayer, act, serverNow, onEvent, players }: Props) {
  useTicker(250);
  const run = view?.me ?? null;
  const now = serverNow();
  const playing = !!view && !!run && isPlayer && view.phase === "play" && !run.done;
  const between = playing && !!run && now < run.startedAt && run.results.length > 0;
  const live = playing && !between && !!run && now >= run.startedAt;

  // The grid on screen: the current word, or (between words) the one just finished.
  const last: WordResult | undefined = run?.results[run.results.length - 1];
  const showingLast = !!run && !!last && (between || run.done);
  const guesses = showingLast ? last!.guesses : (run?.guesses ?? []);
  const marks = showingLast ? last!.marks : (run?.marks ?? []);

  // Every guess ever made, across words: when it grows, the newest row flips in.
  const total = run ? run.results.reduce((t, r) => t + r.used, 0) + run.guesses.length : 0;
  const [seen, setSeen] = useState(total);
  const [flipRow, setFlipRow] = useState<{ row: number; n: number } | null>(null);
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState<{ text: string; n: number } | null>(null);
  const [pending, setPending] = useState(false);
  const errN = useRef(0);
  // A new word (cracked, failed, given up or timed out) clears whatever was half typed.
  const wordIdx = run?.idx ?? -1;
  const [seenIdx, setSeenIdx] = useState(wordIdx);
  if (wordIdx !== seenIdx) {
    setSeenIdx(wordIdx);
    setTyped("");
    setErr(null);
    setPending(false);
  }
  if (total !== seen) {
    setSeen(total);
    if (total > seen) setFlipRow({ row: guesses.length - 1, n: total });
    setTyped("");
    setPending(false);
    setErr(null);
  }
  // The keyboard catches up once the flip has finished.
  const [kbN, setKbN] = useState(total);
  useEffect(() => {
    if (kbN === total) return;
    const t = setTimeout(() => setKbN(total), total > kbN ? REVEAL_MS : 0);
    return () => clearTimeout(t);
  }, [total, kbN]);
  const flipping = flipRow !== null && flipRow.n === total && kbN !== total;

  // Refusals come back as private events.
  useEffect(
    () =>
      onEvent((e) => {
        const ev = e as CodeEvent;
        if (ev?.t !== "no") return;
        setPending(false);
        const W = ev.w.toUpperCase();
        const text =
          ev.why === "word"
            ? `${W}? Not a word`
            : ev.why === "used"
              ? `You already tried ${W}`
              : ev.why === "hard"
                ? (ev.msg ?? "Use your hints")
                : "Five letters, please";
        setErr({ text, n: ++errN.current });
        feedback("error");
      }),
    [onEvent],
  );
  // A lost reply never leaves the input stuck.
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(false), 4000);
    return () => clearTimeout(t);
  }, [pending]);

  // Sounds: the go, every flip, the crack.
  const prev = useRef<{ phase: string; results: number; total: number } | null>(null);
  useEffect(() => {
    if (!view) return;
    const p = prev.current;
    const cur = { phase: view.phase, results: run?.results.length ?? 0, total };
    prev.current = cur;
    if (!p) return;
    if (p.phase === "ready" && cur.phase === "play") feedback("go");
    if (cur.total > p.total) {
      for (let i = 0; i < LEN; i++) setTimeout(() => sfx("pop"), i * STAGGER + FLIP / 2);
      if (cur.results > p.results && run) {
        const r = run.results[cur.results - 1];
        setTimeout(() => feedback(r.ok ? "win" : "out"), REVEAL_MS);
      }
    }
  }, [view, run, total]);

  const submit = useCallback(() => {
    if (!live || !run || pending) return;
    const fail = (text: string) => {
      setErr({ text, n: ++errN.current });
      feedback("error");
    };
    if (typed.length < LEN) return fail("Not enough letters");
    if (run.guesses.includes(typed)) return fail(`You already tried ${typed.toUpperCase()}`);
    if (view?.hard) {
      const why = hardProblem(typed, run.guesses, run.marks);
      if (why) return fail(why);
    }
    setErr(null);
    setPending(true);
    act({ type: "guess", p: run.idx, w: typed });
  }, [live, run, pending, typed, view?.hard, act]);

  const press = useCallback(
    (k: string) => {
      if (!live || pending) return;
      if (k === "enter") return submit();
      if (k === "back") return setTyped((t) => t.slice(0, -1));
      setTyped((t) => (t.length < LEN ? t + k : t));
      setErr(null);
    },
    [live, pending, submit],
  );

  // Physical keyboard.
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live, press]);

  // The keyboard colours in from this word's rows, once each row has finished flipping.
  const hideRow = flipping ? 1 : 0;
  const keys = keyStates(guesses.slice(0, guesses.length - hideRow), marks.slice(0, marks.length - hideRow));

  // After the last word, linger on its grid for a moment before the summary.
  const isDone = !!run?.done;
  const [summary, setSummary] = useState(isDone);
  useEffect(() => {
    if (!isDone || summary) return;
    const t = setTimeout(() => setSummary(true), REVEAL_MS + 2600);
    return () => clearTimeout(t);
  }, [isDone, summary]);

  if (!view) return <Note>Setting up the secret words…</Note>;
  const solo = players.length === 1;

  if (!run) return <Spectate view={view} byId={byId} />;

  return (
    <div className="@container mx-auto w-full max-w-[980px]">
      <style href="ruckus-codeword" precedence="default">
        {CSS}
      </style>
      <div className="flex flex-col gap-3 @3xl:flex-row @3xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {view.phase === "ready" ? (
            <Ready view={view} serverNow={serverNow} />
          ) : run.done && summary ? (
            <Summary run={run} over={view.phase === "over"} n={view.n} />
          ) : (
            <section className="card relative mx-auto flex w-full max-w-[34rem] flex-col gap-3 p-3 sm:p-4">
              <Header
                view={view}
                run={run}
                serverNow={serverNow}
                live={live}
                past={showingLast}
                hidePts={flipping && showingLast ? (last?.pts ?? 0) : 0}
              />
              <div className="mx-auto w-full max-w-[18.5rem] sm:max-w-[20rem]">
                <Grid
                  guesses={guesses}
                  marks={marks}
                  typed={live ? typed : ""}
                  flipRow={flipRow && flipRow.n === total ? flipRow.row : -1}
                  won={showingLast && !!last?.ok}
                  shakeN={err?.n ?? 0}
                  pending={pending}
                />
              </div>
              {(between || run.done) && last && !flipping ? (
                <Between result={last} startsAt={run.done ? null : run.startedAt} serverNow={serverNow} next={run.idx + 1} n={view.n} />
              ) : (
                <>
                  <p
                    key={err?.n ?? 0}
                    className={`min-h-6 text-center text-sm font-semibold ${err ? "cw-shake text-[#ff8da0]" : "text-muted"}`}
                    aria-live="polite"
                  >
                    {err?.text ??
                      (pending
                        ? "Checking…"
                        : flipping || between
                          ? " "
                          : run.guesses.length === 0
                            ? "Type any five-letter word, then Enter."
                            : `${MAX_GUESSES - run.guesses.length} guess${MAX_GUESSES - run.guesses.length === 1 ? "" : "es"} left${view.hard ? " · hard mode" : ""}`)}
                  </p>
                  <Keyboard
                    keys={keys}
                    onKey={press}
                    disabled={!live || pending}
                    canGiveUp={live && run.guesses.length > 0}
                    onGiveUp={() => act({ type: "giveup", p: run.idx })}
                  />
                </>
              )}
            </section>
          )}
        </div>
        {(!solo || view.phase === "over") && view.board.length > 1 && <Board view={view} byId={byId} me={me} />}
        {solo && view.phase !== "ready" && <ScoringCard hard={view.hard} />}
      </div>
    </div>
  );
}

function Ready({ view, serverNow }: { view: CodeView; serverNow: () => number }) {
  const secs = useSecondsLeft(view.startsAt, serverNow);
  useEffect(() => {
    if (secs > 0) sfx("tick");
  }, [secs]);
  return (
    <div className="card grid min-h-[24rem] place-items-center p-6 text-center">
      <div>
        <div className="label mb-2">
          {view.n} secret word{view.n === 1 ? "" : "s"} · 6 guesses each
          {view.hard ? " · hard mode" : ""}
        </div>
        <div
          key={secs}
          className="cw-count font-hero text-8xl font-black text-volt"
          style={{ textShadow: "0 0 40px rgb(198 244 50 / .5)" }}
        >
          {secs || "GO"}
        </div>
        <div className="mx-auto mt-4 flex max-w-[15rem] gap-1.5" aria-hidden>
          {"crack".split("").map((ch, i) => (
            <span key={i} className="cw-tile flex-1 text-xl" data-s={["2", "0", "1", "0", "2"][i]}>
              {ch}
            </span>
          ))}
        </div>
        <p className="marker mt-3 text-lg text-sun">dimaag lagao, code todo!</p>
      </div>
    </div>
  );
}

function Header({
  view,
  run,
  serverNow,
  live,
  past,
  hidePts,
}: {
  view: CodeView;
  run: MyRun;
  serverNow: () => number;
  live: boolean;
  past: boolean;
  /** Points of a word whose last row is still flipping (not revealed yet). */
  hidePts: number;
}) {
  const used = Math.max(0, serverNow() - run.startedAt);
  const bonus = live ? speedBonus(used) : 0;
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="label">
            Word {past ? run.idx : Math.min(run.idx + 1, view.n)} of {view.n}
            {view.hard && <span className="ml-1.5 rounded-sm bg-pink/20 px-1 text-[10px] text-pink">HARD</span>}
          </div>
          <div className="mt-1.5 flex gap-1.5" aria-hidden>
            {Array.from({ length: view.n }, (_, i) => (
              <span
                key={i}
                className="cw-dot"
                data-s={i < run.results.length ? (run.results[i].ok ? "ok" : "bad") : i === run.idx ? "cur" : ""}
              />
            ))}
          </div>
        </div>
        <div className="text-center">
          <div className="label">Speed bonus</div>
          <div
            className="font-mono text-sm font-bold"
            style={{
              color: bonus > 0 ? "var(--color-sun)" : "var(--color-muted)",
            }}
          >
            {live ? `+${bonus}` : "–"}
          </div>
        </div>
        <div className="text-right">
          <div className="label">Points</div>
          <div className="font-hero text-2xl font-extrabold">
            <RollingNumber value={run.total - hidePts} />
          </div>
        </div>
      </div>
      <div className="opacity-50">
        <TimerBar endsAt={live ? run.startedAt + WORD_MS : null} total={WORD_MS} serverNow={serverNow} color={HIT} />
      </div>
    </>
  );
}

function Grid({
  guesses,
  marks,
  typed,
  flipRow,
  won,
  shakeN,
  pending,
}: {
  guesses: string[];
  marks: string[];
  typed: string;
  flipRow: number;
  won: boolean;
  shakeN: number;
  pending: boolean;
}) {
  const rows = Array.from({ length: MAX_GUESSES }, (_, r) => r);
  const cur = guesses.length;
  return (
    <div className="cw-grid" role="grid" aria-label="Your guesses">
      {rows.map((r) => {
        if (r < cur) {
          const g = guesses[r];
          const m = marks[r];
          const anim = r === flipRow ? (won && r === cur - 1 ? "cw-hop" : "cw-flip") : "";
          return (
            <div key={`${r}${g}`} className="cw-row" role="row" aria-label={`${g.toUpperCase()}: ${describe(m)}`}>
              {[...g].map((ch, i) => (
                <span key={i} className={`cw-tile ${anim}`} data-s={m[i]} style={{ "--i": i } as React.CSSProperties}>
                  {ch}
                </span>
              ))}
            </div>
          );
        }
        if (r === cur && (typed || shakeN)) {
          return (
            <div
              key={`t${shakeN}`}
              className={`cw-row ${shakeN ? "cw-shake" : ""}`}
              role="row"
              style={pending ? { opacity: 0.55 } : undefined}
            >
              {Array.from({ length: LEN }, (_, i) => (
                <span key={`${i}${typed[i] ?? ""}`} className="cw-tile" data-s={typed[i] ? "t" : ""}>
                  {typed[i] ?? ""}
                </span>
              ))}
            </div>
          );
        }
        return (
          <div key={`e${r}`} className="cw-row" role="row">
            {Array.from({ length: LEN }, (_, i) => (
              <span key={i} className="cw-tile" />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function describe(m: string): string {
  return [...m].map((c, i) => `${i + 1} ${c === "2" ? "right spot" : c === "1" ? "elsewhere" : "not in word"}`).join(", ");
}

function Keyboard({
  keys,
  onKey,
  disabled,
  canGiveUp,
  onGiveUp,
}: {
  keys: Record<string, string>;
  onKey: (k: string) => void;
  disabled: boolean;
  canGiveUp: boolean;
  onGiveUp: () => void;
}) {
  const [arm, setArm] = useState(false);
  return (
    <div className="mx-auto flex w-full max-w-[32rem] flex-col gap-1.5" aria-label="Keyboard">
      {KEYS.map((row, r) => (
        <div key={r} className="flex justify-center gap-1" style={{ paddingInline: r === 1 ? "4.5%" : 0 }}>
          {r === 2 && (
            <button className="cw-key" data-wide="true" disabled={disabled} onClick={() => onKey("enter")} aria-label="Enter">
              ENTER
            </button>
          )}
          {[...row].map((k) => (
            <button key={k} className="cw-key" data-s={keys[k] ?? ""} disabled={disabled} onClick={() => onKey(k)}>
              {k}
            </button>
          ))}
          {r === 2 && (
            <button className="cw-key" data-wide="true" disabled={disabled} onClick={() => onKey("back")} aria-label="Delete">
              ⌫
            </button>
          )}
        </div>
      ))}
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
        <span className="flex items-center gap-2.5">
          <Legend s="2" text="right spot" />
          <Legend s="1" text="elsewhere" />
          <Legend s="0" text="not in it" />
        </span>
        {canGiveUp && (
          <button
            className="rounded-md px-2 py-1 font-semibold hover:text-text"
            style={arm ? { color: BAD } : undefined}
            onClick={() => (arm ? onGiveUp() : setArm(true))}
            onBlur={() => setArm(false)}
          >
            {arm ? "Sure? 0 points" : "Give up"}
          </button>
        )}
      </div>
    </div>
  );
}

function Legend({ s, text }: { s: string; text: string }) {
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <span className="inline-block size-3 rounded-[3px]" style={{ background: s === "2" ? HIT : s === "1" ? NEAR : "#3a4054" }} />
      {text}
    </span>
  );
}

function Between({
  result,
  startsAt,
  serverNow,
  next,
  n,
}: {
  result: WordResult;
  startsAt: number | null;
  serverNow: () => number;
  next: number;
  n: number;
}) {
  const secs = useSecondsLeft(startsAt, serverNow);
  return (
    <div className="cw-in relative flex flex-col items-center gap-2 py-1 text-center">
      {result.ok && <Confetti pieces={28} />}
      {result.ok ? (
        <>
          <div className="font-hero text-3xl font-extrabold text-volt">Cracked in {result.used}!</div>
          <div className="marker text-xl text-sun">{CRACK_QUIP[result.used]}</div>
          <div className="font-mono text-sm text-muted">
            {crackPoints(result.used)} + {result.pts - crackPoints(result.used)} speed = <b className="text-text">+{result.pts}</b>
          </div>
        </>
      ) : (
        <>
          <div className="marker text-xl text-sun">arre! the word was</div>
          <Answer word={result.answer} />
          <div className="font-mono text-sm text-muted">0 points this time</div>
        </>
      )}
      <div className="label mt-1">{startsAt ? `Word ${next} of ${n} in ${secs}…` : "That was the last word!"}</div>
    </div>
  );
}

function Answer({ word, small }: { word: string; small?: boolean }) {
  return (
    <div className={`flex gap-1 ${small ? "w-36" : "w-52"}`} aria-label={`Answer: ${word.toUpperCase()}`}>
      {[...word].map((ch, i) => (
        <span
          key={i}
          className={`cw-tile cw-flip flex-1 ${small ? "!text-base" : "!text-2xl"}`}
          data-s="2"
          style={{ "--i": i } as React.CSSProperties}
        >
          {ch}
        </span>
      ))}
    </div>
  );
}

function Summary({ run, over, n }: { run: MyRun; over: boolean; n: number }) {
  const cracked = run.results.filter((r) => r.ok).length;
  return (
    <section className="stk cw-in mx-auto w-full max-w-[34rem] p-4" style={{ "--stk-bg": "var(--color-panel)" } as React.CSSProperties}>
      {cracked === n && <Confetti pieces={36} />}
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="label">{over ? "Final" : "All done"}</div>
          <div className="font-hero text-2xl font-extrabold">
            {cracked}/{n} cracked
          </div>
          <div className="marker text-lg text-sun">
            {cracked === n ? "full marks, ustaad!" : cracked ? "not bad at all" : "agli baar pakka!"}
          </div>
        </div>
        <div className="text-right">
          <div className="label">Points</div>
          <div className="font-hero text-4xl font-extrabold text-volt">{run.total}</div>
        </div>
      </div>
      <ol className="mt-4 flex flex-col gap-2">
        {run.results.map((r, i) => (
          <li key={i} className="flex items-center gap-3 rounded-xl border-2 border-line bg-panel-2/60 p-2.5">
            <Answer word={r.answer} small />
            <div className="min-w-0 flex-1">
              <div className="flex gap-[3px]" aria-hidden>
                {r.marks.map((m, j) => (
                  <span key={j} className="cw-mini w-6">
                    {[...m].map((c, k) => (
                      <span key={k} data-s={c} />
                    ))}
                  </span>
                ))}
              </div>
              <div className="mt-1 font-mono text-xs text-muted">
                {r.ok ? `cracked in ${r.used} · ${r.secs}s` : "not cracked"} · <b className="text-text">+{r.pts}</b>
              </div>
            </div>
          </li>
        ))}
      </ol>
      {!over && <p className="mt-3 text-center text-sm text-muted">Waiting for the others to finish…</p>}
    </section>
  );
}

/** Someone's current word as colour rows only (six rows, blanks for unused guesses). */
function MiniGrid({ rows, size = "w-[4.2rem]" }: { rows: string[]; size?: string }) {
  return (
    <div className={`flex flex-col gap-[2px] ${size}`} aria-hidden>
      {Array.from({ length: MAX_GUESSES }, (_, r) => (
        <div key={r} className="cw-mini">
          {Array.from({ length: LEN }, (_, i) => (
            <span key={i} data-s={rows[r]?.[i] ?? ""} data-new={r === rows.length - 1} />
          ))}
        </div>
      ))}
    </div>
  );
}

function sortBoard(rows: BoardRow[]): BoardRow[] {
  return rows.slice().sort((a, b) => b.total - a.total || b.idx - a.idx);
}

function Board({ view, byId, me }: { view: CodeView; byId: Record<string, Player>; me: string }) {
  return (
    <aside className="card flex flex-col gap-2 p-3 @3xl:w-80 @3xl:shrink-0">
      <div className="flex items-baseline justify-between">
        <div className="label">The race · colours only, no letters</div>
      </div>
      <ol className="grid grid-cols-2 gap-2 @3xl:grid-cols-1">
        {sortBoard(view.board).map((r, i) => (
          <li
            key={r.id}
            className={`flex gap-2 rounded-xl border-2 p-2 ${r.id === me ? "border-volt/60 bg-panel-2" : "border-line bg-panel-2/40"}`}
          >
            <MiniGrid rows={r.rows} size="w-[3.4rem] shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col justify-between gap-1">
              <div className="min-w-0">
                <div className="flex items-center gap-1 text-xs text-muted">
                  <span className="font-mono">#{i + 1}</span>
                </div>
                <div className="truncate text-xs font-bold" style={{ color: byId[r.id]?.color }}>
                  {byId[r.id]?.name ?? "?"}
                  {r.id === me ? " (you)" : ""}
                </div>
              </div>
              <div className="font-hero text-lg leading-none font-extrabold">
                <RollingNumber value={r.total} />
              </div>
              <div className="flex flex-wrap gap-1" aria-hidden>
                {Array.from({ length: view.n }, (_, k) => (
                  <span
                    key={k}
                    className="cw-dot !size-2"
                    data-s={k < r.past.length ? (r.past[k].ok ? "ok" : "bad") : k === r.idx ? "cur" : ""}
                  />
                ))}
              </div>
              <div className="font-mono text-xs whitespace-nowrap text-muted">
                {r.done ? "done" : `word ${r.idx + 1} · ${r.rows.length}/6`}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function Spectate({ view, byId }: { view: CodeView; byId: Record<string, Player> }) {
  return (
    <div className="mx-auto w-full max-w-[980px]">
      <style href="ruckus-codeword" precedence="default">
        {CSS}
      </style>
      <section className="card p-4">
        <div className="mb-3 text-center">
          <div className="font-hero text-xl font-extrabold">
            {view.phase === "ready" ? "Get ready…" : view.phase === "over" ? "Final boards" : "Code breakers at work"}
          </div>
          <p className="text-sm text-muted">Everyone is cracking the same secret words. You see their colours, never their letters.</p>
        </div>
        <ol className="flex flex-wrap justify-center gap-3">
          {sortBoard(view.board).map((r) => (
            <li key={r.id} className="flex flex-col items-center gap-2 rounded-xl border-2 border-line bg-panel-2/50 p-3">
              <PlayerChip player={byId[r.id]} size="sm" dim={!byId[r.id]?.connected} />
              <MiniGrid rows={r.rows} size="w-24" />
              <div className="font-mono text-xs text-muted">
                <b className="text-text">{r.total}</b> pts · {r.done ? "done" : `word ${r.idx + 1}/${view.n}`}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function ScoringCard({ hard }: { hard: boolean }) {
  return (
    <aside className="card p-3 text-sm @3xl:w-64 @3xl:shrink-0">
      <div className="label mb-1.5">How it&apos;s scored</div>
      <ul className="space-y-1 text-muted">
        <li>
          Cracked in 1 guess: <b className="text-text">600</b>, then 100 less per extra guess (6 guesses: <b className="text-text">100</b>).
        </li>
        <li>
          Speed bonus up to <b className="text-text">+{SPEED_MAX}</b>, gone after {SPEED_MS / 60000} minutes.
        </li>
        <li>Not cracked: 0, and you see the word.</li>
        {hard && <li className="text-pink">Hard mode: hints you&apos;ve seen must be used.</li>}
      </ul>
    </aside>
  );
}

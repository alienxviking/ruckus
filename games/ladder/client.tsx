"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameClientProps } from "@/shared/client-game";
import { Note, PlayerChip, TimerBar, useSecondsLeft, useTicker } from "@/components/game-ui";
import { RollingNumber } from "@/components/RollingNumber";
import type { Player } from "@/shared/types";
import { feedback, sfx } from "@/lib/feedback";
import {
  BASE_POINTS,
  EXTRA_STEP_COST,
  HINT_COST,
  SPEED_POINTS,
  type BoardRow,
  type LadderAction,
  type LadderEvent,
  type LadderView,
  type MyRun,
  type PuzzleResult,
} from "./shared";

type Props = GameClientProps<LadderView, LadderAction>;

const KEYS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const GOOD = "#4ade80";
const BAD = "#ff5d73";

const CSS = `
.wl-tile { display: grid; place-items: center; aspect-ratio: 1; border-radius: .6rem; font-family: var(--font-display); font-weight: 800;
  text-transform: uppercase; border: 1.5px solid var(--color-line); background: var(--color-panel-2); color: var(--color-text);
  transition: transform .15s ease, border-color .15s ease, background .15s ease, box-shadow .15s ease; user-select: none; }
.wl-word { display: grid; gap: .4rem; width: 100%; }
.wl-cur .wl-tile { cursor: pointer; }
.wl-cur .wl-tile:hover { transform: translateY(-2px); }
.wl-tile[data-sel="true"] { border-color: var(--acc); box-shadow: 0 0 0 3px color-mix(in oklab, var(--acc) 35%, transparent), 0 8px 24px -10px var(--acc);
  transform: translateY(-3px); background: color-mix(in oklab, var(--acc) 16%, var(--color-panel-2)); }
.wl-tile[data-hit="true"] { background: color-mix(in oklab, ${GOOD} 22%, var(--color-panel-2)); border-color: color-mix(in oklab, ${GOOD} 60%, transparent); color: #d9ffe6; }
.wl-tile[data-changed="true"] { animation: wl-flip .42s cubic-bezier(.2,1.4,.4,1) both; }
@keyframes wl-flip { 0% { transform: rotateX(90deg) scale(.9); } 100% { transform: none; } }
.wl-goal .wl-tile { border-color: color-mix(in oklab, var(--acc) 70%, transparent); background: linear-gradient(180deg, color-mix(in oklab, var(--acc) 28%, transparent), color-mix(in oklab, var(--acc) 10%, transparent));
  color: #fff; text-shadow: 0 0 14px var(--acc); }
.wl-old .wl-tile { background: transparent; color: color-mix(in oklab, var(--color-text) 62%, transparent); border-style: dashed; }
.wl-rails { position: relative; padding: 0 .9rem; }
.wl-rails::before, .wl-rails::after { content: ""; position: absolute; top: 0; bottom: 0; width: 5px; border-radius: 3px;
  background: linear-gradient(180deg, var(--acc), color-mix(in oklab, var(--acc) 25%, transparent)); opacity: .55; }
.wl-rails::before { left: 0; } .wl-rails::after { right: 0; }
.wl-rung { position: relative; }
.wl-rung::before { content: ""; position: absolute; left: -.9rem; right: -.9rem; top: 50%; height: 3px; background: color-mix(in oklab, var(--acc) 30%, transparent); z-index: 0; border-radius: 2px; }
.wl-rung > * { position: relative; z-index: 1; }
.wl-in { animation: wl-in .38s cubic-bezier(.2,1.3,.4,1) both; }
@keyframes wl-in { from { transform: translateY(16px) scale(.96); opacity: 0; } to { transform: none; opacity: 1; } }
.wl-shake { animation: wl-shake .4s ease both; }
@keyframes wl-shake { 0%,100% { transform: none; } 20% { transform: translateX(-8px); } 40% { transform: translateX(7px); } 60% { transform: translateX(-5px); } 80% { transform: translateX(3px); } }
.wl-key { min-width: 0; flex: 1 1 0; height: 3rem; border-radius: .5rem; background: var(--color-panel-2); border: 1px solid var(--color-line);
  font-weight: 700; text-transform: uppercase; font-size: 1.05rem; transition: transform .08s ease, background .15s ease; touch-action: manipulation; }
.wl-key:active:not(:disabled) { transform: scale(.92); background: color-mix(in oklab, var(--acc) 30%, var(--color-panel-2)); }
.wl-key[data-goal="true"] { border-color: color-mix(in oklab, var(--acc) 55%, transparent); color: color-mix(in oklab, var(--acc) 70%, white); }
.wl-key:disabled { opacity: .35; }
.wl-count { animation: wl-count .9s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes wl-count { 0% { transform: scale(2); opacity: 0; } 30% { transform: scale(1); opacity: 1; } 100% { transform: scale(.9); opacity: .85; } }
.wl-glow { animation: wl-glow 1.2s ease-out both; }
@keyframes wl-glow { 0% { box-shadow: 0 0 0 0 var(--acc); } 100% { box-shadow: 0 0 0 22px transparent; } }
.wl-dot { width: .7rem; height: .7rem; border-radius: 999px; background: var(--color-line); }
.wl-dot[data-s="cur"] { background: var(--acc); box-shadow: 0 0 10px var(--acc); animation: wl-pulse 1.2s ease-in-out infinite; }
.wl-dot[data-s="ok"] { background: ${GOOD}; } .wl-dot[data-s="bad"] { background: ${BAD}; }
@keyframes wl-pulse { 50% { transform: scale(1.3); } }
`;

const sizeFor = (len: number) => (len === 4 ? "max-w-[17rem] text-[1.75rem]" : "max-w-[21rem] text-[1.6rem]");

function Word({
  word,
  goal,
  kind,
  sel,
  changedAt = -1,
  onPick,
}: {
  word: string;
  goal?: string;
  kind: "goal" | "cur" | "old" | "start";
  sel?: number;
  changedAt?: number;
  onPick?: (i: number) => void;
}) {
  const cls = kind === "goal" ? "wl-goal" : kind === "cur" ? "wl-cur" : kind === "old" ? "wl-old" : "";
  return (
    <div
      className={`wl-word ${cls} mx-auto ${sizeFor(word.length)}`}
      style={{ gridTemplateColumns: `repeat(${word.length}, minmax(0, 1fr))` }}
      role={kind === "cur" ? "radiogroup" : undefined}
      aria-label={kind === "cur" ? `Current word ${word.toUpperCase()}: pick the letter to change` : `${kind === "goal" ? "Goal" : "Word"} ${word.toUpperCase()}`}
    >
      {[...word].map((ch, i) => {
        const hit = !!goal && kind !== "goal" && goal[i] === ch;
        return kind === "cur" ? (
          <button
            key={`${i}${ch}`}
            className="wl-tile"
            data-sel={sel === i}
            data-hit={hit}
            data-changed={changedAt === i}
            role="radio"
            aria-checked={sel === i}
            aria-label={`Letter ${i + 1}: ${ch.toUpperCase()}`}
            onClick={() => onPick?.(i)}
          >
            {ch}
          </button>
        ) : (
          <span key={`${i}${ch}`} className="wl-tile" data-hit={hit}>
            {ch}
          </span>
        );
      })}
    </div>
  );
}

function diffAt(a: string, b: string): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return i;
  return -1;
}

function firstMismatch(word: string, goal: string): number {
  const i = diffAt(word, goal);
  return i < 0 ? 0 : i;
}

export default function WordLadder({ view, me, byId, isPlayer, act, serverNow, onEvent, accent, players }: Props) {
  useTicker(250);
  const run = view?.me ?? null;
  const live = !!view && !!run && isPlayer && view.phase === "play" && !run.done && serverNow() >= run.startedAt;
  const cur = run && run.ladder.length ? run.ladder[run.ladder.length - 1] : "";
  const [sel, setSel] = useState(0);
  const [err, setErr] = useState<{ text: string; n: number } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [skipArm, setSkipArm] = useState(false);
  const errN = useRef(0);

  // Pick a sensible letter slot whenever a new puzzle starts.
  const puzzleKey = run ? `${run.idx}:${run.goal}` : "";
  const [selKey, setSelKey] = useState("");
  if (run && puzzleKey !== selKey && cur) {
    setSelKey(puzzleKey);
    setSel(firstMismatch(cur, run.goal));
  }
  // Any new ladder state settles a pending step.
  const ladderKey = run ? `${run.idx}:${run.ladder.join(",")}` : "";
  const [seenLadder, setSeenLadder] = useState(ladderKey);
  if (ladderKey !== seenLadder) {
    setSeenLadder(ladderKey);
    setPending(null);
    setSkipArm(false);
    setErr(null);
  }

  // Refusals come back as private events.
  useEffect(
    () =>
      onEvent((e) => {
        const ev = e as LadderEvent;
        if (ev?.t !== "no") return;
        setPending(null);
        const W = ev.w.toUpperCase();
        const text =
          ev.why === "word" ? `${W} isn't in our word list` : ev.why === "used" ? `${W} is already on your ladder` : "Change exactly one letter";
        setErr({ text, n: ++errN.current });
        feedback("error");
      }),
    [onEvent],
  );

  // Sounds for the big moments.
  const prev = useRef<{ results: number; steps: number; phase: string } | null>(null);
  useEffect(() => {
    if (!view) return;
    const p = prev.current;
    const now = { results: run?.results.length ?? 0, steps: run?.ladder.length ?? 0, phase: view.phase };
    prev.current = now;
    if (!p) return;
    if (p.phase === "ready" && now.phase === "play") feedback("go");
    if (now.results > p.results && run) {
      const r = run.results[now.results - 1];
      feedback(r.ok ? "score" : "out");
    } else if (now.steps > p.steps) sfx("pop");
  }, [view, run]);

  const send = useCallback(
    (letter: string) => {
      if (!live || !run || pending) return;
      if (cur[sel] === letter) {
        setErr({ text: `That letter is already ${letter.toUpperCase()}`, n: ++errN.current });
        feedback("error");
        return;
      }
      const w = cur.slice(0, sel) + letter + cur.slice(sel + 1);
      setErr(null);
      setPending(w);
      act({ type: "step", p: run.idx, w });
    },
    [live, run, pending, cur, sel, act],
  );

  // Desktop keys: letters change the chosen slot, arrows move it, Backspace steps back.
  useEffect(() => {
    if (!live || !run) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (/^[a-z]$/.test(k)) {
        e.preventDefault();
        send(k);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSel((s) => (s + cur.length - 1) % cur.length);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setSel((s) => (s + 1) % cur.length);
      } else if (/^[1-5]$/.test(e.key) && Number(e.key) <= cur.length) {
        setSel(Number(e.key) - 1);
      } else if (e.key === "Backspace" && run.ladder.length > 1) {
        e.preventDefault();
        act({ type: "undo", p: run.idx });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live, run, cur, send, act]);

  if (!view) return <Note>Setting up the ladders…</Note>;

  const shown: MyRun | null = run ?? view.watch?.run ?? null;
  const watching = !run && view.watch ? byId[view.watch.id] : undefined;
  const solo = players.length === 1;
  const now = serverNow();
  const between = !!shown && !shown.done && now < shown.startedAt && view.phase === "play";
  const last = shown?.results[shown.results.length - 1];

  return (
    <div className="@container mx-auto w-full max-w-[960px]" style={{ "--acc": accent } as React.CSSProperties}>
      <style href="ruckus-ladder" precedence="default">
        {CSS}
      </style>
      <div className="flex flex-col gap-3 @3xl:flex-row @3xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {view.phase === "ready" ? (
            <Ready view={view} serverNow={serverNow} />
          ) : !shown ? (
            <Note>Waiting for players…</Note>
          ) : shown.done ? (
            <Summary run={shown} over={view.phase === "over"} who={watching} />
          ) : (
            <div className="card relative overflow-hidden p-3 sm:p-4">
              {watching && (
                <div className="mb-2 flex items-center justify-center gap-2 text-sm text-muted">
                  Watching <PlayerChip player={watching} size="sm" />
                </div>
              )}
              <Header view={view} run={shown} />
              <div className="mt-2">
                <TimerBar endsAt={between ? null : shown.endsAt} total={shown.limit} serverNow={serverNow} color={accent} />
              </div>
              {between && last ? (
                <Between result={last} startsAt={shown.startedAt} serverNow={serverNow} next={shown} />
              ) : (
                <div className="mt-4 flex flex-col gap-3">
                  <div className="wl-rails flex flex-col gap-2 py-1">
                    <div className="wl-rung">
                      <Word word={shown.goal} kind="goal" />
                    </div>
                    <div className="py-0.5 text-center font-mono text-[11px] uppercase tracking-widest text-muted">
                      {shown.away > 0 ? (
                        <>
                          ▲ <span className="text-text">{shown.away}</span> step{shown.away === 1 ? "" : "s"} to the goal · par {shown.par}
                        </>
                      ) : (
                        <>par {shown.par}</>
                      )}
                    </div>
                    <Ladder
                      run={shown}
                      sel={sel}
                      setSel={setSel}
                      pending={live ? pending : null}
                      errN={err?.n ?? 0}
                      editable={live}
                    />
                  </div>
                  {live && (
                    <>
                      <p
                        key={err?.n ?? 0}
                        className={`min-h-5 text-center text-sm ${err ? "wl-shake text-[#ff8da0]" : "text-muted"}`}
                        aria-live="polite"
                      >
                        {err?.text ?? (pending ? "Checking…" : "Tap a letter tile, then a new letter.")}
                      </p>
                      <Keyboard goal={shown.goal} cur={cur} sel={sel} onKey={send} disabled={!!pending} />
                      <div className="flex flex-wrap justify-center gap-2">
                        <button
                          className="btn min-h-10 px-4"
                          disabled={shown.ladder.length <= 1}
                          onClick={() => act({ type: "undo", p: shown.idx })}
                        >
                          ↶ Step back
                        </button>
                        <button className="btn min-h-10 px-4" onClick={() => act({ type: "hint", p: shown.idx })}>
                          💡 Hint <span className="font-mono text-xs text-muted">−{HINT_COST}</span>
                        </button>
                        <button
                          className="btn min-h-10 px-4"
                          style={skipArm ? { borderColor: BAD, color: BAD } : undefined}
                          onClick={() => {
                            if (skipArm) act({ type: "skip", p: shown.idx });
                            else setSkipArm(true);
                          }}
                        >
                          {skipArm ? "Tap again to give up" : "Give up"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        {(!solo || !isPlayer) && <Board view={view} byId={byId} me={me} />}
        {solo && isPlayer && view.phase !== "ready" && <ScoringCard />}
      </div>
    </div>
  );
}

function Ready({ view, serverNow }: { view: LadderView; serverNow: () => number }) {
  const secs = useSecondsLeft(view.startsAt, serverNow);
  useEffect(() => {
    if (secs > 0) sfx("tick");
  }, [secs]);
  return (
    <div className="card grid min-h-[22rem] place-items-center p-6 text-center">
      <div>
        <div className="label mb-2">
          {view.n} ladder{view.n === 1 ? "" : "s"} · {[...new Set(view.lens)].sort().join(" & ")} letters
        </div>
        <div key={secs} className="wl-count font-display text-8xl font-black" style={{ color: "var(--acc)", textShadow: "0 0 40px var(--acc)" }}>
          {secs || "GO"}
        </div>
        <p className="mt-3 text-sm text-muted">Change one letter per step. Every step must be a real word.</p>
      </div>
    </div>
  );
}

function Header({ view, run }: { view: LadderView; run: MyRun }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="label">
          Ladder {Math.min(run.idx + 1, view.n)} / {view.n}
        </div>
        <div className="mt-1 flex gap-1.5" aria-hidden>
          {Array.from({ length: view.n }, (_, i) => (
            <span key={i} className="wl-dot" data-s={i < run.results.length ? (run.results[i].ok ? "ok" : "bad") : i === run.idx ? "cur" : ""} />
          ))}
        </div>
      </div>
      <div className="text-right">
        <div className="label">Score</div>
        <RollingNumber value={run.score} className="font-mono text-2xl font-bold" />
      </div>
    </div>
  );
}

function Ladder({
  run,
  sel,
  setSel,
  pending,
  errN,
  editable,
}: {
  run: MyRun;
  sel: number;
  setSel: (i: number) => void;
  pending: string | null;
  errN: number;
  editable: boolean;
}) {
  const words = run.ladder;
  const cur = words[words.length - 1] ?? "";
  const prevWord = words[words.length - 2];
  const changedAt = prevWord ? diffAt(prevWord, cur) : -1;
  // Newest at the top, just under the goal; the start word sits at the bottom.
  const older = words.slice(0, -1).reverse();
  const MAX_OLD = 5;
  const hidden = Math.max(0, older.length - MAX_OLD);
  const visible = hidden ? [...older.slice(0, MAX_OLD - 1), older[older.length - 1]] : older;
  return (
    <div className="flex flex-col gap-2">
      <div key={`${words.length}:${errN}`} className={`wl-rung ${errN ? "wl-shake" : "wl-in"}`}>
        {pending ? (
          <div className="opacity-60">
            <Word word={pending} goal={run.goal} kind="old" />
          </div>
        ) : editable ? (
          <Word word={cur} goal={run.goal} kind="cur" sel={sel} changedAt={changedAt} onPick={setSel} />
        ) : (
          <Word word={cur} goal={run.goal} kind="start" />
        )}
      </div>
      {visible.map((w, i) => {
        const isStart = w === words[0];
        return (
          <div key={`${w}${i}`} className="wl-rung">
            {hidden > 0 && i === MAX_OLD - 1 && (
              <div className="mb-2 text-center font-mono text-[11px] text-muted">⋮ {hidden} more</div>
            )}
            <Word word={w} goal={run.goal} kind="old" />
            {isStart && <div className="mt-1 text-center font-mono text-[10px] uppercase tracking-widest text-muted">start</div>}
          </div>
        );
      })}
      {words.length === 1 && editable && (
        <div className="text-center font-mono text-[10px] uppercase tracking-widest text-muted">start word</div>
      )}
    </div>
  );
}

function Keyboard({ goal, cur, sel, onKey, disabled }: { goal: string; cur: string; sel: number; onKey: (k: string) => void; disabled: boolean }) {
  return (
    <div className="mx-auto flex w-full max-w-[34rem] flex-col gap-1.5" aria-label="Letters">
      {KEYS.map((row, r) => (
        <div key={r} className="flex justify-center gap-1" style={{ paddingInline: r === 1 ? "4.5%" : r === 2 ? "14%" : 0 }}>
          {[...row].map((k) => (
            <button
              key={k}
              className="wl-key"
              data-goal={goal[sel] === k && cur[sel] !== k}
              disabled={disabled || cur[sel] === k}
              onClick={() => onKey(k)}
              aria-label={`Change letter ${sel + 1} to ${k.toUpperCase()}`}
            >
              {k}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function Between({ result, startsAt, serverNow, next }: { result: PuzzleResult; startsAt: number; serverNow: () => number; next: MyRun }) {
  const secs = useSecondsLeft(startsAt, serverNow);
  return (
    <div className="wl-in mt-4 flex flex-col items-center gap-3 py-2 text-center">
      <div className="font-display text-3xl font-black" style={{ color: result.ok ? GOOD : BAD }}>
        {result.ok ? (result.steps <= result.par && result.hints === 0 ? "Perfect climb!" : "Solved!") : "Out of rungs"}
      </div>
      <div className="font-mono text-sm text-muted">
        {result.ok ? `${result.steps} steps (par ${result.par})` : `best was ${result.par} steps`}
        {result.hints ? ` · ${result.hints} hint${result.hints === 1 ? "" : "s"}` : ""} ·{" "}
        <span className="font-bold text-text">+{result.pts}</span>
      </div>
      <PathChips words={result.best} label="A best ladder" />
      <div className="label mt-2">
        Ladder {next.idx + 1} in {secs}…
      </div>
    </div>
  );
}

function PathChips({ words, label }: { words: string[]; label: string }) {
  return (
    <div className="flex max-w-full flex-col items-center gap-1">
      <div className="label">{label}</div>
      <div className="flex flex-wrap items-center justify-center gap-1 font-mono text-sm uppercase">
        {words.map((w, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-muted">→</span>}
            <span className="rounded-md border border-line bg-panel-2 px-1.5 py-0.5" style={i === words.length - 1 ? { color: "var(--acc)" } : undefined}>
              {w}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Summary({ run, over, who }: { run: MyRun; over: boolean; who?: Player }) {
  const solved = run.results.filter((r) => r.ok).length;
  return (
    <div className="card wl-in p-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="label">{who ? `${who.name}'s ladders` : over ? "Final" : "All done"}</div>
          <div className="font-display text-2xl font-black">
            {solved}/{run.results.length} solved
          </div>
        </div>
        <div className="text-right">
          <div className="label">Score</div>
          <div className="font-mono text-3xl font-bold" style={{ color: "var(--acc)" }}>
            {run.score}
          </div>
        </div>
      </div>
      <ol className="mt-4 flex flex-col gap-2">
        {run.results.map((r, i) => (
          <li key={i} className="rounded-lg border border-line bg-panel-2/60 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-sm">
              <span className="whitespace-nowrap font-mono uppercase">
                <span style={{ color: r.ok ? GOOD : BAD }}>{r.ok ? "✓" : "✗"}</span> {r.best[0]} → {r.best[r.best.length - 1]}
              </span>
              <span className="whitespace-nowrap font-mono text-xs text-muted">
                {r.ok ? `${r.steps} steps · par ${r.par}` : "unsolved"}{r.hints ? ` · ${r.hints}💡` : ""} · {r.secs}s · <b className="text-text">+{r.pts}</b>
              </span>
            </div>
            {(!r.ok || r.steps > r.par) && (
              <div className="mt-1.5 truncate font-mono text-xs uppercase text-muted">best: {r.best.join(" → ")}</div>
            )}
          </li>
        ))}
      </ol>
      {!over && <p className="mt-3 text-center text-sm text-muted">Waiting for the others to finish…</p>}
    </div>
  );
}

function Board({ view, byId, me }: { view: LadderView; byId: Record<string, Player>; me: string }) {
  const rows = view.board.slice().sort((a, b) => b.score - a.score || b.idx - a.idx);
  return (
    <aside className="card flex flex-col gap-2 p-3 @3xl:w-72 @3xl:shrink-0">
      <div className="label">Race</div>
      <ol className="flex flex-col gap-1.5">
        {rows.map((r: BoardRow, i) => (
          <li
            key={r.id}
            className={`flex flex-col gap-1 rounded-md px-2 py-1.5 ${r.id === me ? "bg-panel-2 shadow-[inset_2px_0_0_var(--acc)]" : ""}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="w-4 font-mono text-[11px] text-muted">{i + 1}</span>
                <PlayerChip player={byId[r.id]} size="sm" dim={!byId[r.id]?.connected} />
              </span>
              <RollingNumber value={r.score} className="font-mono font-bold" />
            </div>
            <div className="flex items-center gap-2 pl-6">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${(Math.min(r.idx, view.n) / view.n) * 100}%`, background: "var(--acc)" }}
                />
              </div>
              <span className="w-20 text-right font-mono text-[10px] text-muted">
                {r.done ? "done ✓" : `#${r.idx + 1} · ${r.steps} step${r.steps === 1 ? "" : "s"}`}
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
    <aside className="card p-3 text-sm @3xl:w-64 @3xl:shrink-0">
      <div className="label mb-1.5">Points per ladder</div>
      <ul className="space-y-1 text-muted">
        <li>
          Solve: <b className="text-text">+{BASE_POINTS}</b>, speed up to <b className="text-text">+{SPEED_POINTS}</b>
        </li>
        <li>
          Each step over par: <b className="text-text">−{EXTRA_STEP_COST}</b>
        </li>
        <li>
          Each hint: <b className="text-text">−{HINT_COST}</b>
        </li>
      </ul>
    </aside>
  );
}

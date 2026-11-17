"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameClientProps } from "@/shared/client-game";
import { Note, PlayerChip, TimerBar, useSecondsLeft, useTicker } from "@/components/game-ui";
import { Confetti } from "@/components/Confetti";
import type { Player } from "@/shared/types";
import { feedback, sfx } from "@/lib/feedback";
import {
  GROUP_POINTS,
  LEVEL_COLORS,
  LEVEL_NAMES,
  PUZZLE_MS,
  REVEAL_MS,
  SPARE_POINTS,
  SPEED_POINTS,
  type BoardRow,
  type Group,
  type GroupUpAction,
  type GroupUpEvent,
  type GroupUpView,
  type MyRun,
} from "./shared";

type Props = GameClientProps<GroupUpView, GroupUpAction>;

const INK = "#10131c";
const BAD = "#ff5d73";

const CSS = `
.gu-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: clamp(6px, 1.6cqi, 10px); }
.gu-tile { position: relative; display: grid; place-items: center; min-width: 0; height: clamp(3.9rem, 15cqi, 5.2rem); padding: 0 .3rem; border-radius: .8rem;
  background: var(--color-paper); color: ${INK}; border: 2.5px solid ${INK}; box-shadow: 0 4px 0 rgb(0 0 0 / .5);
  font-family: var(--font-hero), var(--font-display), system-ui; font-weight: 800; letter-spacing: -.01em; line-height: 1.05; text-align: center; overflow-wrap: normal; word-break: keep-all; white-space: normal;
  transition: transform .14s var(--ease-spring), background-color .12s ease, color .12s ease, box-shadow .14s ease; user-select: none; -webkit-user-select: none;
  touch-action: manipulation; -webkit-tap-highlight-color: transparent; cursor: pointer; }
.gu-tile:hover:not(:disabled) { transform: translateY(-2px); }
.gu-tile:active:not(:disabled) { transform: translateY(2px) scale(.97); box-shadow: 0 1px 0 rgb(0 0 0 / .5); }
.gu-tile[aria-pressed="true"] { background: ${INK}; color: var(--color-paper); border-color: var(--acc); box-shadow: 0 4px 0 color-mix(in oklab, var(--acc) 60%, #000); transform: translateY(-3px) rotate(var(--tilt, 0deg)); }
.gu-tile:disabled { cursor: default; }
.gu-tile:focus-visible { outline: 3px solid var(--acc); outline-offset: 2px; }
.gu-in { animation: gu-in .38s var(--ease-spring) both; animation-delay: calc(var(--i, 0) * 18ms); }
@keyframes gu-in { from { transform: scale(.6) rotate(-6deg); opacity: 0; } to { transform: none; opacity: 1; } }
.gu-shake { animation: gu-shake .45s ease both; }
@keyframes gu-shake { 0%,100% { translate: 0; } 20% { translate: -7px; } 40% { translate: 6px; } 60% { translate: -4px; } 80% { translate: 3px; } }
.gu-band { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .15rem; min-height: clamp(3.9rem, 15cqi, 5.2rem);
  padding: .45rem .75rem; border-radius: .9rem; border: 2.5px solid ${INK}; color: ${INK}; text-align: center; box-shadow: 0 4px 0 rgb(0 0 0 / .5); }
.gu-band[data-missed="true"] { opacity: .8; background-image: repeating-linear-gradient(-45deg, rgb(0 0 0 / .08) 0 8px, transparent 8px 16px); }
.gu-band .t { font-family: var(--font-hero), var(--font-display); font-weight: 800; font-size: clamp(.95rem, 3.6cqi, 1.2rem); line-height: 1.1; }
.gu-band .w { font-size: clamp(.72rem, 2.7cqi, .9rem); font-weight: 600; letter-spacing: .02em; }
.gu-band .lv { position: absolute; top: .3rem; right: .55rem; font-family: var(--font-mono); font-size: .6rem; font-weight: 700; opacity: .65; text-transform: uppercase; }
.gu-slap { animation: gu-slap .5s var(--ease-spring) both; }
@keyframes gu-slap { 0% { transform: scale(1.25) rotate(-3deg); opacity: 0; } 60% { transform: scale(.97) rotate(.6deg); opacity: 1; } 100% { transform: none; } }
.gu-dot { width: .85rem; height: .85rem; border-radius: 999px; border: 2px solid var(--color-muted); transition: background .2s, border-color .2s, transform .25s var(--ease-spring); }
.gu-dot[data-on="true"] { background: var(--acc); border-color: var(--acc); }
.gu-dot[data-lost="true"] { background: transparent; border-color: var(--color-line); transform: scale(.7); }
.gu-toast { animation: gu-toast .35s var(--ease-spring) both; }
@keyframes gu-toast { from { transform: translateY(6px) scale(.9); opacity: 0; } to { transform: none; opacity: 1; } }
.gu-count { animation: gu-count .9s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes gu-count { 0% { transform: scale(2); opacity: 0; } 30% { transform: scale(1); opacity: 1; } 100% { transform: scale(.9); opacity: .85; } }
@media (prefers-reduced-motion: reduce) { .gu-in, .gu-shake, .gu-slap, .gu-toast, .gu-count { animation: none; } }
`;

const tileFont = (word: string) => {
  const longest = Math.max(...word.split(" ").map((p) => p.length));
  // Fit the longest word on one line: a tile is a quarter of the row minus gaps and padding.
  return `clamp(10px, calc((25cqi - 22px) / ${(0.72 * Math.max(5, longest)).toFixed(2)}), 1.35rem)`;
};

function Band({ g, words, missed, fresh }: { g: Group; words: string[]; missed?: boolean; fresh?: boolean }) {
  return (
    <div className={`gu-band ${fresh ? "gu-slap" : ""}`} data-missed={!!missed} style={{ background: LEVEL_COLORS[g.level] }}>
      <span className="lv">{missed ? "missed" : LEVEL_NAMES[g.level]}</span>
      <span className="t">{g.title}</span>
      <span className="w">{g.w.map((i) => words[i]).join(" · ")}</span>
    </div>
  );
}

export default function GroupUp({ view, me, byId, isPlayer, act, serverNow, onEvent, accent, players }: Props) {
  useTicker(500);
  const run: MyRun | null = view?.me ?? view?.watch?.run ?? null;
  const watching = !view?.me && view?.watch ? byId[view.watch.id] : undefined;
  const live = !!view && !!view.me && isPlayer && view.phase === "play" && view.me.state === "play";
  const words = run?.words ?? [];
  const puzzleKey = run && words.length ? `${run.idx}:${words.join(",")}` : "";

  const [order, setOrder] = useState<number[]>([]);
  const [sel, setSel] = useState<number[]>([]);
  const [pending, setPending] = useState(false);
  const [toast, setToast] = useState<{ text: string; note?: string; n: number; bad?: boolean } | null>(null);
  const [shake, setShake] = useState(0);
  const toastN = useRef(0);

  // A new puzzle: start from the server's (shuffled) order, nothing selected.
  const [orderKey, setOrderKey] = useState("");
  if (puzzleKey !== orderKey) {
    setOrderKey(puzzleKey);
    setOrder(Array.from({ length: words.length }, (_, i) => i));
    setSel([]);
    setPending(false);
    setToast(null);
  }
  // Groups found: drop their words from the selection, settle the pending guess.
  const foundKey = run ? `${run.idx}:${run.found.length}:${run.mistakes}:${run.state}` : "";
  const [seenFound, setSeenFound] = useState(foundKey);
  const [freshTitle, setFreshTitle] = useState("");
  if (foundKey !== seenFound) {
    setSeenFound(foundKey);
    setPending(false);
    const last = run?.found[run.found.length - 1];
    const prevCount = Number(seenFound.split(":")[1] ?? 0);
    if (run && last && run.found.length > prevCount && seenFound.split(":")[0] === String(run.idx)) {
      setFreshTitle(last.title);
      setSel([]);
    }
  }

  const locked = new Set((run?.found ?? []).flatMap((g) => g.w));
  const remaining = order.filter((i) => !locked.has(i) && i < words.length);

  // Sounds.
  const prev = useRef<{ found: number; state: string; phase: string; idx: number } | null>(null);
  useEffect(() => {
    if (!view || !view.me) return;
    const cur = { found: view.me.found.length, state: view.me.state, phase: view.phase, idx: view.me.idx };
    const p = prev.current;
    prev.current = cur;
    if (!p) return;
    if (p.phase === "ready" && cur.phase === "play") feedback("go");
    if (cur.idx === p.idx && cur.found > p.found) feedback(cur.found === 4 ? "win" : "score");
    else if (cur.idx === p.idx && p.state === "play" && cur.state === "reveal" && cur.found < 4) feedback("out");
    else if (cur.idx > p.idx && cur.state === "play") sfx("go");
  }, [view]);

  useEffect(
    () =>
      onEvent((e) => {
        const ev = e as GroupUpEvent;
        if (!ev || !["wrong", "away", "dupe"].includes(ev.t)) return;
        setPending(false);
        const n = ++toastN.current;
        if (ev.t === "dupe") {
          setToast({ text: "You already tried that one", note: "free pass, koi baat nahi", n });
          sfx("bump");
          return;
        }
        setShake(n);
        if (ev.t === "away") setToast({ text: "One away! 3 of those 4 belong together", note: "arre, bas ek galat!", n, bad: true });
        else setToast({ text: "Not a group", note: "phir se socho…", n, bad: true });
        feedback("error");
      }),
    [onEvent],
  );

  const toggle = useCallback(
    (i: number) => {
      if (!live || pending) return;
      setSel((s) => (s.includes(i) ? s.filter((x) => x !== i) : s.length >= 4 ? s : [...s, i]));
      sfx("tick");
    },
    [live, pending],
  );
  const submit = useCallback(() => {
    if (!live || pending || sel.length !== 4 || !run) return;
    setPending(true);
    act({ type: "guess", p: run.idx, w: sel });
  }, [live, pending, sel, run, act]);
  const doShuffle = useCallback(() => {
    setOrder((o) => {
      const a = o.slice();
      for (let k = a.length - 1; k > 0; k--) {
        const j = Math.floor(Math.random() * (k + 1));
        [a[k], a[j]] = [a[j], a[k]];
      }
      return a;
    });
    setShake(0);
    sfx("pop");
  }, []);

  // Desktop keys: Enter submits, S shuffles, Escape deselects.
  useEffect(() => {
    if (!live) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Enter" && sel.length === 4 && !(t && t.tagName === "BUTTON" && t.dataset.tile)) {
        e.preventDefault();
        submit();
      } else if (e.key.toLowerCase() === "s") doShuffle();
      else if (e.key === "Escape") setSel([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live, sel, submit, doShuffle]);

  if (!view) return <Note>Shuffling the words…</Note>;
  const solo = players.length === 1;

  return (
    <div className="@container mx-auto w-full max-w-[980px]" style={{ "--acc": accent } as React.CSSProperties}>
      <style href="ruckus-groupup" precedence="default">
        {CSS}
      </style>
      <div className="flex flex-col gap-3 @3xl:flex-row @3xl:items-start">
        <div className="relative flex min-w-0 flex-1 flex-col gap-3">
          {view.phase === "ready" ? (
            <Ready view={view} serverNow={serverNow} />
          ) : !run ? (
            <Note>Waiting for players…</Note>
          ) : run.state === "done" ? (
            <Summary view={view} run={run} who={watching} />
          ) : (
            <div className="card relative w-full p-3 sm:p-4">
              {run.state === "reveal" && run.found.length === 4 && <Confetti pieces={36} />}
              <Header view={view} run={run} serverNow={serverNow} who={watching} />
              <div className="@container mx-auto mt-3 flex w-full max-w-[36rem] flex-col gap-[clamp(6px,1.6cqi,10px)]">
                {run.found.map((g) => (
                  <Band key={g.title} g={g} words={words} fresh={g.title === freshTitle} />
                ))}
                {run.state === "reveal" &&
                  run.missed
                    .slice()
                    .sort((a, b) => a.level - b.level)
                    .map((g, k) => (
                      <div key={g.title} className="gu-slap" style={{ animationDelay: `${150 + k * 160}ms` }}>
                        <Band g={g} words={words} missed />
                      </div>
                    ))}
                {run.state === "play" && remaining.length > 0 && (
                  <div className="gu-grid" role="group" aria-label="Words">
                    {remaining.map((i, k) => {
                      const on = sel.includes(i);
                      return (
                        <button
                          key={`${i}:${orderKey}`}
                          type="button"
                          data-tile="1"
                          className={`gu-tile gu-in ${on && shake && toast?.n === shake ? "gu-shake" : ""}`}
                          aria-pressed={on}
                          disabled={!live}
                          onClick={() => toggle(i)}
                          style={{ fontSize: tileFont(words[i]), "--i": k, "--tilt": `${((i * 7) % 5) - 2}deg` } as React.CSSProperties}
                        >
                          {words[i]}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              {run.state === "play" && live && (
                <>
                  <div className="mt-3 min-h-11 text-center" aria-live="polite">
                    {toast ? (
                      <div key={toast.n} className="gu-toast">
                        <div className="text-sm font-bold" style={toast.bad ? { color: BAD } : undefined}>
                          {toast.text}
                        </div>
                        {toast.note && <div className="marker text-base text-sun">{toast.note}</div>}
                      </div>
                    ) : (
                      <div className="text-sm text-muted">
                        {sel.length === 4 ? "Four picked. Submit when you're sure!" : `Pick four that belong together (${sel.length}/4)`}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                    <button type="button" className="btn min-h-11 px-4" onClick={doShuffle}>
                      ⤮ Shuffle
                    </button>
                    <button type="button" className="btn min-h-11 px-4" onClick={() => setSel([])} disabled={!sel.length}>
                      Deselect all
                    </button>
                    <button
                      type="button"
                      className="stk-btn min-h-12 px-6 text-lg"
                      onClick={submit}
                      disabled={sel.length !== 4 || pending}
                      style={{ "--btn-bg": sel.length === 4 ? "var(--color-volt)" : "#5c6270" } as React.CSSProperties}
                    >
                      {pending ? "Checking…" : "Submit"}
                    </button>
                  </div>
                  <p className="mt-2 hidden text-center text-xs text-muted sm:block">
                    Click words to pick · Enter submits · S shuffles · Esc deselects
                  </p>
                </>
              )}
              {run.state === "reveal" && <Reveal view={view} run={run} act={view.me ? act : null} serverNow={serverNow} />}
            </div>
          )}
        </div>
        {(!solo || !isPlayer) && <Race view={view} byId={byId} me={me} />}
        {solo && isPlayer && view.phase !== "ready" && <ScoringCard view={view} />}
      </div>
    </div>
  );
}

function Ready({ view, serverNow }: { view: GroupUpView; serverNow: () => number }) {
  const secs = useSecondsLeft(view.startsAt, serverNow);
  useEffect(() => {
    if (secs > 0) sfx("tick");
  }, [secs]);
  return (
    <div className="card grid min-h-[22rem] place-items-center p-6 text-center">
      <div>
        <div className="label mb-2">
          {view.n} puzzle{view.n === 1 ? "" : "s"} · {view.maxMistakes} mistakes allowed each
        </div>
        <div key={secs} className="gu-count font-hero text-8xl font-black" style={{ color: "var(--acc)", textShadow: "0 0 40px var(--acc)" }}>
          {secs || "GO"}
        </div>
        <p className="mt-3 text-sm text-muted">16 words, 4 secret groups of 4. Watch out for words that seem to fit twice!</p>
        <p className="marker mt-1 text-lg text-sun">dimaag ki batti jalao 💡</p>
      </div>
    </div>
  );
}

function Header({ view, run, serverNow, who }: { view: GroupUpView; run: MyRun; serverNow: () => number; who?: Player }) {
  const left = view.maxMistakes - run.mistakes;
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {who ? (
            <div className="flex items-center gap-1.5 text-sm text-muted">
              Watching <PlayerChip player={who} size="sm" />
            </div>
          ) : (
            <div className="label">
              {view.n > 1 ? `Puzzle ${run.idx + 1} of ${view.n} · ` : ""}
              {run.found.length}/4 groups
            </div>
          )}
          <div className="mt-1.5 flex items-center gap-1.5" aria-label={`${left} mistakes left`}>
            <span className="text-xs font-semibold text-muted">Mistakes left</span>
            {Array.from({ length: view.maxMistakes }, (_, i) => (
              <span key={i} className="gu-dot" data-on={i < left} data-lost={i >= left} />
            ))}
          </div>
        </div>
        <div className="text-right">
          <div className="label">Score</div>
          <div className="font-mono text-2xl font-bold">{run.total + (run.state === "play" ? GROUP_POINTS * run.found.length : 0)}</div>
        </div>
      </div>
      <div className="mt-2 opacity-50">
        <TimerBar endsAt={run.state === "play" ? run.startedAt + PUZZLE_MS : null} total={PUZZLE_MS} serverNow={serverNow} color="var(--acc)" />
      </div>
    </div>
  );
}

function Reveal({ view, run, act, serverNow }: { view: GroupUpView; run: MyRun; act: Props["act"] | null; serverNow: () => number }) {
  const secs = useSecondsLeft(run.nextAt, serverNow);
  const r = run.results[run.results.length - 1];
  if (!r) return null;
  const last = run.idx + 1 >= view.n;
  return (
    <div className="mt-4 flex flex-col items-center gap-2 text-center">
      <div className="font-hero text-3xl font-extrabold" style={{ color: r.cleared ? "var(--color-volt)" : BAD }}>
        {r.cleared ? (r.mistakes === 0 ? "Flawless!" : "All four!") : r.found ? `${r.found} of 4 found` : "No groups this time"}
      </div>
      <div className="marker text-xl text-sun">
        {r.cleared ? (r.mistakes === 0 ? "ekdum perfect, shabaash!" : "shabaash!") : "arre! agli baar pakka"}
      </div>
      <div className="font-mono text-sm text-muted">
        {r.mistakes} mistake{r.mistakes === 1 ? "" : "s"} · {r.secs}s · <b className="text-text">+{r.score}</b> points
      </div>
      {act && (
        <button type="button" className="stk-btn mt-1 min-h-12 px-6 text-lg" onClick={() => act({ type: "next", p: run.idx })}>
          {last ? "Finish" : "Next puzzle"} <span className="font-mono text-sm opacity-70">{secs}s</span>
        </button>
      )}
      <div className="mt-1 h-1 w-40 overflow-hidden rounded-full bg-panel-2">
        <TimerBar endsAt={run.nextAt} total={REVEAL_MS} serverNow={serverNow} color="var(--acc)" />
      </div>
    </div>
  );
}

function Summary({ view, run, who }: { view: GroupUpView; run: MyRun; who?: Player }) {
  const found = run.results.reduce((t, r) => t + r.found, 0);
  const miss = run.results.reduce((t, r) => t + r.mistakes, 0);
  const perfect = found === 4 * view.n && miss === 0;
  return (
    <div className="stk slap p-4 text-center" style={{ "--tilt": "-1deg", "--stk-bg": "var(--color-panel)" } as React.CSSProperties}>
      {perfect && <Confetti pieces={40} />}
      <div className="label">{who ? `${who.name}'s game` : view.phase === "over" ? "Final" : "All done"}</div>
      <div className="font-hero text-3xl font-extrabold">
        {found}/{4 * view.n} groups
      </div>
      <div className="font-mono text-sm text-muted">
        {miss} mistake{miss === 1 ? "" : "s"} · <b style={{ color: "var(--acc)" }}>{run.total}</b> points
      </div>
      <div className="marker mt-1 text-xl text-sun">{perfect ? "full marks, yaar! 🔥" : found >= 2 * view.n ? "shabaash!" : "chalo, next time"}</div>
      <ol className="@container mx-auto mt-3 flex max-w-[36rem] flex-col gap-3 text-left">
        {run.results.map((r, i) => (
          <li key={i} className="flex flex-col gap-1.5">
            {view.n > 1 && (
              <div className="flex items-center justify-between px-1 font-mono text-xs">
                <span>Puzzle {i + 1}</span>
                <span className="text-muted">
                  {r.found}/4 · {r.mistakes}✗ · {r.secs}s · <b className="text-text">{r.score}</b>
                </span>
              </div>
            )}
            {r.groups.map((g) => (
              <Band key={g.title} g={{ title: g.title, level: g.level, w: [0, 1, 2, 3] }} words={g.words} missed={!g.found} />
            ))}
          </li>
        ))}
      </ol>
      {view.phase !== "over" && <p className="mt-3 text-sm text-muted">Waiting for the others to finish…</p>}
    </div>
  );
}

function Race({ view, byId, me }: { view: GroupUpView; byId: Record<string, Player>; me: string }) {
  const rows = view.board.slice().sort((a, b) => b.total + GROUP_POINTS * b.found - (a.total + GROUP_POINTS * a.found) || a.mistakes - b.mistakes);
  return (
    <aside className="card flex w-full flex-col gap-2 p-3 @3xl:w-72 @3xl:shrink-0">
      <div className="label">Race · same words for everyone</div>
      <ol className="flex flex-col gap-1.5">
        {rows.map((r: BoardRow, i) => (
          <li key={r.id} className={`flex flex-col gap-1 rounded-md px-2 py-1.5 ${r.id === me ? "bg-panel-2 shadow-[inset_2px_0_0_var(--acc)]" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="w-4 font-mono text-[11px] text-muted">{i + 1}</span>
                <PlayerChip player={byId[r.id]} size="sm" dim={!byId[r.id]?.connected} />
              </span>
              <span className="font-mono text-sm font-bold">{r.total}</span>
            </div>
            <div className="flex items-center gap-2 pl-6">
              <span className="flex gap-1" aria-label={`${r.found} groups found`}>
                {[0, 1, 2, 3].map((k) => (
                  <span key={k} className="h-2.5 w-4 rounded-sm" style={{ background: k < r.found && !r.done ? LEVEL_COLORS[k] : "var(--color-panel-2)" }} />
                ))}
              </span>
              <span className="flex-1 text-right font-mono text-[10px] text-muted">
                {r.done ? `done · ${r.totalFound}/${4 * view.n}` : `${view.n > 1 ? `#${r.idx + 1} · ` : ""}${r.mistakes}✗`}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function ScoringCard({ view }: { view: GroupUpView }) {
  return (
    <aside className="card w-full p-3 text-sm @3xl:w-64 @3xl:shrink-0">
      <div className="label mb-1.5">How it&apos;s scored</div>
      <ul className="space-y-1 text-muted">
        <li>
          Each group found: <b className="text-text">{GROUP_POINTS}</b>.
        </li>
        <li>
          Clear all four: <b className="text-text">+{SPARE_POINTS}</b> per mistake left (of {view.maxMistakes}) and up to <b className="text-text">+{SPEED_POINTS}</b> for speed.
        </li>
      </ul>
      <div className="mt-2 flex flex-wrap gap-1">
        {LEVEL_NAMES.map((n, i) => (
          <span key={n} className="rounded-md border-2 px-1.5 py-0.5 text-[11px] font-bold" style={{ background: LEVEL_COLORS[i], borderColor: INK, color: INK }}>
            {n}
          </span>
        ))}
      </div>
      <p className="marker mt-2 text-base text-sun">colours go from easy to sneaky</p>
    </aside>
  );
}

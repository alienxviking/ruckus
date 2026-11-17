"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameClientProps } from "@/shared/client-game";
import { Note, PlayerChip, useSecondsLeft, useTicker } from "@/components/game-ui";
import { Confetti } from "@/components/Confetti";
import type { Player } from "@/shared/types";
import { feedback, sfx } from "@/lib/feedback";
import {
  LEVEL_NAME,
  MISTAKE_COST,
  PARTIAL_POINTS,
  SOLVE_POINTS,
  SPEED_POINTS,
  fmtTime,
  type BoardRow,
  type MyBoard,
  type NineboxAction,
  type NineboxEvent,
  type NineboxView,
} from "./shared";

type Props = GameClientProps<NineboxView, NineboxAction>;

const INK = "#10131c";
const MINE = "#2453d6";
const BAD = "#e5354f";

const CSS = `
.nb-board { --line: #c9c2ae; display: grid; background: var(--color-paper); border: 3px solid ${INK}; border-radius: 1rem; overflow: hidden;
  box-shadow: 5px 6px 0 rgb(0 0 0 / .55), 0 0 0 3px var(--color-paper); user-select: none; -webkit-user-select: none; touch-action: manipulation; }
.nb-cell { position: relative; display: grid; place-items: center; aspect-ratio: 1; min-width: 0; padding: 0; background: transparent; color: ${INK};
  font-family: var(--font-display); font-weight: 700; line-height: 1; border: 0; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line);
  transition: background-color .12s ease; -webkit-tap-highlight-color: transparent; outline: none; cursor: pointer; }
.nb-cell[data-br="true"] { border-right: 2.5px solid ${INK}; }
.nb-cell[data-bb="true"] { border-bottom: 2.5px solid ${INK}; }
.nb-cell[data-last-c="true"] { border-right: 0; }
.nb-cell[data-last-r="true"] { border-bottom: 0; }
.nb-cell[data-peer="true"] { background: color-mix(in oklab, var(--acc) 13%, var(--color-paper)); }
.nb-cell[data-same="true"] { background: color-mix(in oklab, var(--acc) 34%, var(--color-paper)); }
.nb-cell[data-sel="true"] { background: color-mix(in oklab, var(--acc) 55%, var(--color-paper)); box-shadow: inset 0 0 0 2.5px ${INK}; z-index: 1; }
.nb-cell[data-mine="true"] { color: ${MINE}; font-weight: 600; }
.nb-val { display: block; }
.nb-pop { animation: nb-pop .32s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes nb-pop { 0% { transform: scale(.3); opacity: 0; } 100% { transform: none; opacity: 1; } }
.nb-bad { color: ${BAD} !important; animation: nb-shake .45s ease both; }
@keyframes nb-shake { 0%,100% { transform: none; } 20% { transform: translateX(-5px) rotate(-6deg); } 40% { transform: translateX(5px) rotate(5deg); } 60% { transform: translateX(-3px); } 80% { transform: translateX(2px); } }
.nb-pending { opacity: .45; }
.nb-notes { position: absolute; inset: 6%; display: grid; font-family: var(--font-sans); font-weight: 600; color: #6b6656; line-height: 1; }
.nb-notes > span { display: grid; place-items: center; }
.nb-notes > span[data-hit="true"] { color: ${INK}; background: color-mix(in oklab, var(--acc) 45%, transparent); border-radius: 3px; }
.nb-flash { animation: nb-flash .7s ease both; }
@keyframes nb-flash { 0% { background: color-mix(in oklab, var(--color-volt) 70%, var(--color-paper)); } 100% { } }
.nb-wave .nb-val { animation: nb-wave .6s cubic-bezier(.2,1.5,.4,1) both; animation-delay: calc(var(--d) * 45ms); }
@keyframes nb-wave { 0% { transform: none; } 40% { transform: translateY(-30%) scale(1.25); color: var(--acc); } 100% { transform: none; } }
.nb-key { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; min-width: 0; flex: 1 1 0; height: 3.4rem; border-radius: .75rem; background: var(--color-panel-2);
  border: 2px solid var(--color-line); box-shadow: 0 3px 0 rgb(0 0 0 / .45); font-family: var(--font-display); font-weight: 800; font-size: 1.55rem;
  transition: transform .08s ease, background .15s ease, border-color .15s ease; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.nb-key:active:not(:disabled) { transform: translateY(2px); box-shadow: 0 1px 0 rgb(0 0 0 / .45); background: color-mix(in oklab, var(--acc) 30%, var(--color-panel-2)); }
.nb-key:disabled { opacity: .25; }
.nb-key[data-notes="true"] { font-size: 1.05rem; color: var(--acc); border-style: dashed; }
.nb-key small { display: block; font-family: var(--font-mono); font-size: .58rem; line-height: 1; font-weight: 600; color: var(--color-muted); }
.nb-tool { display: flex; flex-direction: column; align-items: center; gap: 2px; flex: 1 1 0; min-width: 0; padding: .45rem .25rem; border-radius: .75rem;
  font-size: .72rem; font-weight: 700; color: var(--color-muted); border: 2px solid transparent; transition: color .15s, background .15s, border-color .15s; }
.nb-tool:hover:not(:disabled) { color: var(--color-text); background: var(--color-panel-2); }
.nb-tool:disabled { opacity: .35; }
.nb-tool[aria-pressed="true"] { color: #0a0d02; background: var(--acc); border-color: ${INK}; }
.nb-tool .ic { font-size: 1.25rem; line-height: 1; }
.nb-count { animation: nb-count .9s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes nb-count { 0% { transform: scale(2); opacity: 0; } 30% { transform: scale(1); opacity: 1; } 100% { transform: scale(.9); opacity: .85; } }
.nb-heart { display: inline-block; width: .8rem; height: .8rem; margin: 0 .1rem; border-radius: .2rem; border: 2px solid var(--color-muted); transform: rotate(45deg); }
.nb-heart[data-used="true"] { background: ${BAD}; border-color: ${BAD}; }
@media (prefers-reduced-motion: reduce) { .nb-pop, .nb-bad, .nb-wave .nb-val, .nb-flash, .nb-count { animation: none; } }
`;

const NOTES_KEY = "ruckus:ninebox:notes";

function loadNotes(key: string): Record<number, number> {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    if (!raw) return {};
    const saved = JSON.parse(raw) as { key: string; notes: Record<number, number> };
    return saved.key === key ? saved.notes : {};
  } catch {
    return {};
  }
}
function saveNotes(key: string, notes: Record<number, number>) {
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify({ key, notes }));
  } catch {
    /* storage blocked */
  }
}

/** Row, column and box helpers for an n×n grid (6×6 uses 2×3 boxes). */
function geometry(n: number) {
  const br = n === 9 ? 3 : 2;
  const bc = 3;
  const box = (i: number) => Math.floor(Math.floor(i / n) / br) * (n / bc) + Math.floor((i % n) / bc);
  const peers = (i: number, j: number) =>
    i !== j && (Math.floor(i / n) === Math.floor(j / n) || i % n === j % n || box(i) === box(j));
  const units: number[][] = [];
  for (let r = 0; r < n; r++) units.push(Array.from({ length: n }, (_, c) => r * n + c));
  for (let c = 0; c < n; c++) units.push(Array.from({ length: n }, (_, r) => r * n + c));
  for (let b = 0; b < n; b++) units.push(Array.from({ length: n * n }, (_, i) => i).filter((i) => box(i) === b));
  return { br, bc, box, peers, units };
}

export default function NineBox({ view, me, byId, isPlayer, act, serverNow, onEvent, accent, players }: Props) {
  useTicker(500);
  const run: MyBoard | null = view?.me ?? view?.watch?.run ?? null;
  const watching = !view?.me && view?.watch ? byId[view.watch.id] : undefined;
  const n = view?.size ?? 9;
  const geo = useMemo(() => geometry(n), [n]);
  const givens = view?.givens ?? "";
  const cells = run?.cells ?? "";
  const live = !!view && !!view.me && isPlayer && view.phase === "play" && view.me.status === "play" && cells.length === n * n;

  const [sel, setSel] = useState<number>(-1);
  const [notesMode, setNotesMode] = useState(false);
  const [notes, setNotes] = useState<Record<number, number>>({});
  const [undo, setUndo] = useState<Record<number, number>[]>([]);
  const [bad, setBad] = useState<{ i: number; v: number; n: number } | null>(null);
  const [pending, setPending] = useState<{ i: number; v: number } | null>(null);
  const [flash, setFlash] = useState<{ cells: Set<number>; n: number } | null>(null);
  const badN = useRef(0);

  // A new puzzle: restore notes saved in this browser (a refresh mid-game keeps them).
  const [notesFor, setNotesFor] = useState("");
  if (givens && view?.me && notesFor !== givens) {
    setNotesFor(givens);
    setNotes(loadNotes(givens));
    setUndo([]);
    setSel(Math.floor((n * n) / 2));
  }

  // New numbers from the server: settle the pending one, flash any row/col/box just completed.
  const [seenCells, setSeenCells] = useState(cells);
  if (cells !== seenCells) {
    setSeenCells(cells);
    setPending(null);
    if (seenCells.length === cells.length && view?.me) {
      const changed: number[] = [];
      for (let i = 0; i < cells.length; i++) if (cells[i] !== seenCells[i]) changed.push(i);
      const done = new Set<number>();
      for (const i of changed)
        for (const u of geo.units) if (u.includes(i) && u.every((j) => cells[j] !== "0")) for (const j of u) done.add(j);
      if (done.size) setFlash({ cells: done, n: (flash?.n ?? 0) + 1 });
    }
  }

  // Sounds for new numbers and the finish.
  const prev = useRef<{ filled: number; status: string; phase: string } | null>(null);
  useEffect(() => {
    if (!view || !view.me) return;
    const filled = [...view.me.cells].filter((c) => c !== "0").length;
    const p = prev.current;
    prev.current = { filled, status: view.me.status, phase: view.phase };
    if (!p) return;
    if (p.phase === "ready" && view.phase === "play") feedback("go");
    if (p.status === "play" && view.me.status === "solved") feedback("win");
    else if (p.status === "play" && view.me.status !== "play") feedback("out");
    else if (filled > p.filled) sfx("pop");
  }, [view]);

  useEffect(
    () =>
      onEvent((e) => {
        const ev = e as NineboxEvent;
        if (ev?.t !== "bad") return;
        setPending(null);
        const k = ++badN.current;
        setBad({ i: ev.i, v: ev.v, n: k });
        feedback("error");
        setTimeout(() => setBad((b) => (b && b.n === k ? null : b)), 900);
      }),
    [onEvent],
  );

  const commitNotes = useCallback(
    (next: Record<number, number>) => {
      setUndo((u) => [...u.slice(-99), notes]);
      setNotes(next);
      saveNotes(givens, next);
    },
    [notes, givens],
  );

  const press = useCallback(
    (d: number, asNote = false) => {
      if (!live || sel < 0 || cells[sel] !== "0" || d < 1 || d > n) return;
      if (notesMode || asNote) {
        const next = { ...notes, [sel]: (notes[sel] ?? 0) ^ (1 << d) };
        if (!next[sel]) delete next[sel];
        commitNotes(next);
        sfx("tick");
        return;
      }
      if (pending) return;
      setPending({ i: sel, v: d });
      act({ type: "place", i: sel, v: d });
    },
    [live, sel, cells, n, notesMode, notes, commitNotes, pending, act],
  );

  const erase = useCallback(() => {
    if (!live || sel < 0 || !notes[sel]) return;
    const next = { ...notes };
    delete next[sel];
    commitNotes(next);
  }, [live, sel, notes, commitNotes]);

  const doUndo = useCallback(() => {
    if (!undo.length) return;
    const last = undo[undo.length - 1];
    setUndo(undo.slice(0, -1));
    setNotes(last);
    saveNotes(givens, last);
  }, [undo, givens]);

  // Desktop keys.
  useEffect(() => {
    if (!live) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        doUndo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
      const digit = m ? Number(m[1]) : /^\d$/.test(e.key) ? Number(e.key) : -1;
      const move = (dr: number, dc: number) => {
        e.preventDefault();
        setSel((s) => {
          const cur = s < 0 ? 0 : s;
          const r = (Math.floor(cur / n) + dr + n) % n;
          const c = ((cur % n) + dc + n) % n;
          return r * n + c;
        });
      };
      if (digit >= 1 && digit <= n) {
        e.preventDefault();
        press(digit, e.shiftKey);
      } else if (digit === 0 || e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        erase();
      } else if (e.key === "ArrowUp") move(-1, 0);
      else if (e.key === "ArrowDown") move(1, 0);
      else if (e.key === "ArrowLeft") move(0, -1);
      else if (e.key === "ArrowRight") move(0, 1);
      else if (e.key.toLowerCase() === "n") setNotesMode((x) => !x);
      else if (e.key.toLowerCase() === "u") doUndo();
      else if (e.key === "Escape") setSel(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live, n, press, erase, doUndo]);

  if (!view) return <Note>Setting up the grid…</Note>;

  const solo = players.length === 1;
  const showBoard = view.phase !== "ready" && !!run && cells.length === n * n;
  const status = run?.status ?? "play";
  const solved = status === "solved";
  const solution = view.solution ?? "";

  return (
    <div className="@container mx-auto w-full max-w-[980px]" style={{ "--acc": accent } as React.CSSProperties}>
      <style href="ruckus-ninebox" precedence="default">
        {CSS}
      </style>
      <div className="flex flex-col gap-3 @3xl:flex-row @3xl:items-start">
        <div className="relative flex min-w-0 flex-1 flex-col items-center gap-3">
          {view.phase === "ready" ? (
            <Ready view={view} serverNow={serverNow} />
          ) : !showBoard || !run ? (
            <Note>Waiting for players…</Note>
          ) : (
            <>
              {solved && <Confetti pieces={40} />}
              <TopBar view={view} run={run} serverNow={serverNow} who={watching} />
              <div className="w-full max-w-[30rem]">
                <Grid
                  n={n}
                  geo={geo}
                  givens={givens}
                  cells={cells}
                  solution={status !== "play" && status !== "solved" ? solution : ""}
                  notes={live ? notes : {}}
                  sel={live ? sel : -1}
                  onSel={live ? setSel : undefined}
                  bad={bad}
                  pending={pending}
                  flash={flash}
                  wave={solved}
                />
              </div>
              {live ? (
                <Controls
                  n={n}
                  cells={cells}
                  notesMode={notesMode}
                  setNotesMode={setNotesMode}
                  canUndo={undo.length > 0}
                  canErase={sel >= 0 && !!notes[sel]}
                  onDigit={(d) => press(d)}
                  onErase={erase}
                  onUndo={doUndo}
                  onQuit={() => act({ type: "quit" })}
                />
              ) : (
                <Finished view={view} run={run} who={watching} />
              )}
            </>
          )}
        </div>
        {(!solo || !isPlayer) && <Race view={view} byId={byId} me={me} />}
        {solo && isPlayer && view.phase !== "ready" && <ScoringCard view={view} />}
      </div>
    </div>
  );
}

function Ready({ view, serverNow }: { view: NineboxView; serverNow: () => number }) {
  const secs = useSecondsLeft(view.startsAt, serverNow);
  useEffect(() => {
    if (secs > 0) sfx("tick");
  }, [secs]);
  return (
    <div className="card grid min-h-[24rem] w-full place-items-center p-6 text-center">
      <div>
        <div className="label mb-2">
          {view.size}×{view.size} · {LEVEL_NAME[view.level]} · {view.maxMistakes ? `${view.maxMistakes} mistakes allowed` : "no mistake limit"}
        </div>
        <div key={secs} className="nb-count font-hero text-8xl font-black" style={{ color: "var(--acc)", textShadow: "0 0 40px var(--acc)" }}>
          {secs || "GO"}
        </div>
        <p className="mt-3 text-sm text-muted">
          Every row, column and box gets each number 1–{view.size} exactly once.
        </p>
        <p className="marker mt-2 text-lg text-sun">dimaag lagao, guess mat karo!</p>
      </div>
    </div>
  );
}

function TopBar({ view, run, serverNow, who }: { view: NineboxView; run: MyBoard; serverNow: () => number; who?: Player }) {
  const ms = run.status === "play" ? Math.max(0, serverNow() - view.startsAt) : run.ms;
  const left = Math.max(0, view.endsAt - serverNow());
  return (
    <div className="flex w-full max-w-[30rem] items-center justify-between gap-2">
      <div className="min-w-0">
        {who ? (
          <div className="flex items-center gap-1.5 text-sm text-muted">
            Watching <PlayerChip player={who} size="sm" />
          </div>
        ) : (
          <div className="label">
            {view.size}×{view.size} · {LEVEL_NAME[view.level]}
          </div>
        )}
        <div className="mt-1 flex items-center gap-1.5" aria-label={`Mistakes: ${run.mistakes}${view.maxMistakes ? ` of ${view.maxMistakes}` : ""}`}>
          <span className="text-xs font-semibold text-muted">Mistakes</span>
          {view.maxMistakes > 0 ? (
            Array.from({ length: view.maxMistakes }, (_, i) => <span key={i} className="nb-heart" data-used={i < run.mistakes} />)
          ) : (
            <span className="font-mono text-sm font-bold" style={{ color: run.mistakes ? BAD : undefined }}>
              {run.mistakes}
            </span>
          )}
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono text-3xl font-bold tabular-nums" aria-label="Time">
          {fmtTime(ms)}
        </div>
        {run.status === "play" && left < 120_000 && (
          <div className="font-mono text-[11px] font-bold" style={{ color: BAD }}>
            {fmtTime(left)} left!
          </div>
        )}
      </div>
    </div>
  );
}

function Grid({
  n,
  geo,
  givens,
  cells,
  solution,
  notes,
  sel,
  onSel,
  bad,
  pending,
  flash,
  wave,
}: {
  n: number;
  geo: ReturnType<typeof geometry>;
  givens: string;
  cells: string;
  solution: string;
  notes: Record<number, number>;
  sel: number;
  onSel?: (i: number) => void;
  bad: { i: number; v: number; n: number } | null;
  pending: { i: number; v: number } | null;
  flash: { cells: Set<number>; n: number } | null;
  wave: boolean;
}) {
  const selVal = sel >= 0 ? cells[sel] : "0";
  const font = n === 9 ? "clamp(1.1rem, 6.2cqi, 2rem)" : "clamp(1.5rem, 9cqi, 2.8rem)";
  const noteFont = n === 9 ? "clamp(.5rem, 2.3cqi, .8rem)" : "clamp(.6rem, 3cqi, 1rem)";
  const noteCols = n === 9 ? 3 : 3;
  return (
    <div className="@container w-full">
      <div className={`nb-board ${wave ? "nb-wave" : ""}`} style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} role="grid" aria-label="Puzzle grid">
        {Array.from({ length: n * n }, (_, i) => {
          const r = Math.floor(i / n);
          const c = i % n;
          const v = cells[i];
          const given = givens[i] !== "0";
          const empty = v === "0";
          const isBad = bad && bad.i === i && empty;
          const isPending = pending && pending.i === i && empty;
          const reveal = empty && solution ? solution[i] : "";
          // Notes, minus digits already placed in the same row/column/box.
          let mask = empty ? (notes[i] ?? 0) : 0;
          if (mask) for (let j = 0; j < n * n; j++) if (cells[j] !== "0" && geo.peers(i, j)) mask &= ~(1 << Number(cells[j]));
          const shown = isBad ? String(bad.v) : isPending ? String(pending.v) : !empty ? v : reveal;
          return (
            <button
              key={i}
              type="button"
              role="gridcell"
              className={`nb-cell ${flash?.cells.has(i) ? "nb-flash" : ""}`}
              data-br={c % geo.bc === geo.bc - 1 && c < n - 1}
              data-bb={r % geo.br === geo.br - 1 && r < n - 1}
              data-last-c={c === n - 1}
              data-last-r={r === n - 1}
              data-sel={sel === i}
              data-peer={sel >= 0 && sel !== i && geo.peers(sel, i)}
              data-same={sel !== i && selVal !== "0" && v === selVal}
              data-mine={!given && !empty}
              style={{ fontSize: font, "--d": r + c } as React.CSSProperties}
              onClick={onSel ? () => onSel(i) : undefined}
              tabIndex={-1}
              aria-label={`Row ${r + 1} column ${c + 1}: ${empty ? "empty" : v}${given ? " (clue)" : ""}`}
            >
              {shown ? (
                <span
                  key={`${shown}${isBad ? bad.n : ""}`}
                  className={`nb-val ${isBad ? "nb-bad" : isPending ? "nb-pending" : !given && !reveal ? "nb-pop" : ""}`}
                  style={reveal && !isBad && !isPending ? { color: BAD, opacity: 0.55 } : undefined}
                >
                  {shown}
                </span>
              ) : mask ? (
                <span className="nb-notes" style={{ gridTemplateColumns: `repeat(${noteCols}, 1fr)`, fontSize: noteFont }} aria-hidden>
                  {Array.from({ length: n }, (_, k) => (
                    <span key={k} data-hit={selVal !== "0" && Number(selVal) === k + 1 && !!(mask & (1 << (k + 1)))}>
                      {mask & (1 << (k + 1)) ? k + 1 : ""}
                    </span>
                  ))}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Controls({
  n,
  cells,
  notesMode,
  setNotesMode,
  canUndo,
  canErase,
  onDigit,
  onErase,
  onUndo,
  onQuit,
}: {
  n: number;
  cells: string;
  notesMode: boolean;
  setNotesMode: (f: (x: boolean) => boolean) => void;
  canUndo: boolean;
  canErase: boolean;
  onDigit: (d: number) => void;
  onErase: () => void;
  onUndo: () => void;
  onQuit: () => void;
}) {
  const [quitArm, setQuitArm] = useState(false);
  const counts = new Array(n + 1).fill(0);
  for (const ch of cells) counts[Number(ch)]++;
  return (
    <div className="flex w-full max-w-[30rem] flex-col gap-2.5">
      <div className="flex gap-1.5">
        <button type="button" className="nb-tool" onClick={onUndo} disabled={!canUndo} title="Undo a note change (U or Ctrl+Z)">
          <span className="ic">↶</span>Undo
        </button>
        <button type="button" className="nb-tool" onClick={onErase} disabled={!canErase} title="Clear notes in this cell (Backspace)">
          <span className="ic">⌫</span>Erase
        </button>
        <button type="button" className="nb-tool" aria-pressed={notesMode} onClick={() => setNotesMode((x) => !x)} title="Pencil marks (N, or Shift+number)">
          <span className="ic">✎</span>Notes {notesMode ? "on" : "off"}
        </button>
        <button
          type="button"
          className="nb-tool"
          style={quitArm ? { color: BAD, borderColor: BAD } : undefined}
          onClick={() => (quitArm ? onQuit() : setQuitArm(true))}
          onBlur={() => setQuitArm(false)}
        >
          <span className="ic">⚑</span>
          {quitArm ? "Sure?" : "Give up"}
        </button>
      </div>
      <div className="flex gap-1 sm:gap-1.5" aria-label="Numbers">
        {Array.from({ length: n }, (_, k) => {
          const d = k + 1;
          const done = counts[d] >= n;
          return (
            <button key={d} type="button" className="nb-key" data-notes={notesMode} disabled={done} onClick={() => onDigit(d)} aria-label={`${notesMode ? "Note" : "Place"} ${d}`}>
              <span className="leading-none">{d}</span>
              <small aria-hidden>{done ? "✓" : n - counts[d]}</small>
            </button>
          );
        })}
      </div>
      <p className="hidden text-center text-xs text-muted sm:block">
        Arrows move · 1–{n} place · Shift+number or <kbd>N</kbd> for notes · Backspace erases notes · <kbd>U</kbd> undo
      </p>
    </div>
  );
}

function Finished({ view, run, who }: { view: NineboxView; run: MyBoard; who?: Player }) {
  const whose = who ? `${who.name} ` : "";
  const title =
    run.status === "solved"
      ? who
        ? `${who.name} solved it!`
        : "Solved!"
      : run.status === "out"
        ? `${whose}ran out of mistakes`
        : run.status === "time"
          ? "Time's up"
          : "Gave up";
  const note = run.status === "solved" ? (run.mistakes === 0 ? "shabaash! ekdum perfect" : "shabaash!") : "arre! next time pakka";
  return (
    <div className="stk slap flex w-full max-w-[30rem] flex-col items-center gap-1 p-4 text-center" style={{ "--tilt": "-1.5deg", "--stk-bg": "var(--color-panel)" } as React.CSSProperties}>
      <div className="font-hero text-3xl font-extrabold" style={{ color: run.status === "solved" ? "var(--color-volt)" : BAD }}>
        {title}
      </div>
      <div className="font-mono text-sm text-muted">
        {fmtTime(run.ms)} · {run.mistakes} mistake{run.mistakes === 1 ? "" : "s"}
      </div>
      <div className="marker text-xl text-sun">{note}</div>
      {view.phase !== "over" && <p className="mt-1 text-sm text-muted">Waiting for the others to finish…</p>}
      {view.phase === "over" && run.status !== "solved" && <p className="mt-1 text-xs text-muted">The missing numbers are shown in red.</p>}
    </div>
  );
}

function Race({ view, byId, me }: { view: NineboxView; byId: Record<string, Player>; me: string }) {
  const rank = (r: BoardRow) => (r.status === "solved" ? 0 : r.status === "play" ? 1 : 2);
  const rows = view.board.slice().sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? a.secs - b.secs : b.pct - a.pct) || a.mistakes - b.mistakes);
  return (
    <aside className="card flex w-full flex-col gap-2 p-3 @3xl:w-72 @3xl:shrink-0">
      <div className="label">Race · same grid for everyone</div>
      <ol className="flex flex-col gap-1.5">
        {rows.map((r, i) => (
          <li key={r.id} className={`flex flex-col gap-1 rounded-md px-2 py-1.5 ${r.id === me ? "bg-panel-2 shadow-[inset_2px_0_0_var(--acc)]" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="w-4 font-mono text-[11px] text-muted">{i + 1}</span>
                <PlayerChip player={byId[r.id]} size="sm" dim={!byId[r.id]?.connected} />
              </span>
              <span className="whitespace-nowrap font-mono text-xs font-bold">
                {r.status === "solved" ? (
                  <span className="text-volt">✓ {fmtTime(r.secs * 1000)}</span>
                ) : r.status === "play" ? (
                  `${r.pct}%`
                ) : (
                  <span style={{ color: BAD }}>{r.status === "out" ? "out" : r.status === "time" ? "time" : "gave up"}</span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-2 pl-6">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${r.pct}%`, background: r.status === "solved" ? "var(--color-volt)" : "var(--acc)" }}
                />
              </div>
              <span className="w-12 text-right font-mono text-[10px] text-muted">
                {r.mistakes} ✗{view.maxMistakes ? `/${view.maxMistakes}` : ""}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function ScoringCard({ view }: { view: NineboxView }) {
  return (
    <aside className="card w-full p-3 text-sm @3xl:w-64 @3xl:shrink-0">
      <div className="label mb-1.5">How it&apos;s scored</div>
      <ul className="space-y-1 text-muted">
        <li>
          Solve it: <b className="text-text">{SOLVE_POINTS}</b>, plus up to <b className="text-text">{SPEED_POINTS}</b> for speed.
        </li>
        <li>
          Each mistake: <b className="text-text">−{MISTAKE_COST}</b>
          {view.maxMistakes ? ` (${view.maxMistakes} and you're out)` : ""}.
        </li>
        <li>
          Not solved: up to <b className="text-text">{PARTIAL_POINTS}</b> for cells filled.
        </li>
      </ul>
      <p className="marker mt-2 text-base text-sun">use notes, no stress</p>
    </aside>
  );
}

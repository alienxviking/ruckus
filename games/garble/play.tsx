"use client";

import { useCallback, useEffect, useId, useState, useSyncExternalStore, type FormEvent } from "react";
import type { Player } from "@/shared/types";
import { Note, StatusBanner } from "@/components/game-ui";
import { SketchCanvas } from "../sketch/canvas";
import type { SketchAction } from "../sketch/server";
import type { GarbleAction, GarbleEvent, GarbleView, HoldView, PageView } from "./server";
import { Drawing, InkStore } from "./drawing";
import { INK_LOW, MAX_TEXT, cleanText, stepKind, type StepKind } from "./shared";
import { PhaseClock, StepTrack, Tracker, who } from "./ui";

interface PlayProps {
  view: GarbleView;
  me: string;
  players: Player[];
  byId: Record<string, Player>;
  isPlayer: boolean;
  act: (a: GarbleAction) => void;
  serverNow: () => number;
  onEvent: (fn: (e: unknown) => void) => () => void;
  accent: string;
}

const EXAMPLES = [
  "a cat filing its taxes",
  "grandma's secret skateboard",
  "a shark at the dentist",
  "a snowman on holiday",
  "a robot learning to dance",
];

const DOING: Record<StepKind, string> = {
  write: "writing",
  draw: "drawing",
  describe: "describing",
};

export function PlayPhase({ view, me, players, byId, isPlayer, act, serverNow, onEvent, accent }: PlayProps) {
  const kind = stepKind(view.step);
  const hold = isPlayer ? view.hold : null;
  const done = view.done.includes(me);
  const waiting = players.filter((p) => p.connected && !view.done.includes(p.id)).length;

  let status: string;
  if (!hold) status = `👀 Everyone's ${DOING[kind]}…`;
  else if (done) status = waiting ? `✅ Sent! Waiting for ${waiting} more…` : "✅ Sent! Turning the page…";
  else if (kind === "write") status = "✍️ Write a funny prompt";
  else if (kind === "draw") status = "🎨 Draw what the page says!";
  else status = "💬 Describe this drawing";

  return (
    <>
      <StepTrack steps={view.steps} step={view.step} accent={accent} />
      <div aria-live="polite" aria-atomic="true">
        <StatusBanner key={`${view.step}-${done ? 1 : 0}-${hold ? 1 : 0}`} accent={accent}>
          {status}
        </StatusBanner>
      </div>
      <PhaseClock endsAt={view.endsAt} total={view.phaseMs} serverNow={serverNow} accent={accent} />
      {view.soloEndsAt !== null && <SoloNote until={view.soloEndsAt} serverNow={serverNow} />}

      {hold ? (
        kind === "draw" ? (
          <DrawStep key={view.step} view={view} hold={hold} me={me} byId={byId} act={act} onEvent={onEvent} accent={accent} />
        ) : (
          <TextStep
            key={view.step}
            kind={kind}
            view={view}
            hold={hold}
            me={me}
            byId={byId}
            act={act}
            onEvent={onEvent}
          />
        )
      ) : (
        <WatchCard view={view} accent={accent} />
      )}

      <Tracker players={players} done={view.done} accent={accent} label="Done this step" />
    </>
  );
}

function SoloNote({ until, serverNow }: { until: number; serverNow: () => number }) {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const t = window.setInterval(() => setNow(serverNow()), 250);
    return () => window.clearInterval(t);
  }, [serverNow]);
  const secs = Math.max(0, Math.ceil((until - now) / 1000));
  return (
    <p role="status" className="card animate-rise border-amber-400/50 px-3 py-2 text-center text-sm">
      <span aria-hidden>📡 </span>Everyone else left. Skipping to the reveal in <b className="tabular-nums">{secs}s</b> unless
      someone comes back.
    </p>
  );
}

function WatchCard({ view, accent }: { view: GarbleView; accent: string }) {
  const kind = stepKind(view.step);
  return (
    <div className="card flex flex-col items-center gap-2 px-4 py-8 text-center" style={{ borderColor: `${accent}55` }}>
      <span aria-hidden className="gb-book text-5xl">
        {kind === "draw" ? "🎨" : kind === "write" ? "✍️" : "💬"}
      </span>
      <p className="font-display text-lg font-bold">The books are being passed around</p>
      <Note>👀 You&apos;re watching. Every page stays secret until the big reveal at the end.</Note>
    </div>
  );
}

/** Whose book you hold this step. */
function BookTag({ hold, me, byId, step }: { hold: HoldView; me: string; byId: Record<string, Player>; step: number }) {
  const owner = who(byId, hold.owner);
  return (
    <span className="text-xs font-semibold text-muted">
      <span aria-hidden>📕 </span>
      {hold.owner === me ? (
        "Your book"
      ) : (
        <>
          <span style={{ color: owner.color }}>{owner.name}</span>&apos;s book
        </>
      )}{" "}
      · page {step + 1}
    </span>
  );
}

// ---------- the page you respond to ----------

function PromptCard({ page, byId, label }: { page: PageView; byId: Record<string, Player>; label: string }) {
  const by = who(byId, page.by);
  return (
    <div className="gb-paper gb-slide rounded-2xl px-4 py-3">
      <p className="text-[11px] font-bold tracking-widest text-[#7a6e93] uppercase">{label}</p>
      {page.blank ? (
        <p className="mt-1 text-lg font-semibold text-[#7a6e93]">🤐 The last page was left blank. Make something up!</p>
      ) : (
        <p className="mt-0.5 font-display text-2xl leading-tight font-extrabold break-words @md:text-3xl">“{page.text}”</p>
      )}
      <p className="mt-1 text-xs text-[#7a6e93]">
        {page.auto ? (
          <>🎲 picked by the game</>
        ) : (
          <>
            ✍️ written by <b style={{ color: shade(by.color) }}>{by.name}</b>
          </>
        )}
      </p>
    </div>
  );
}

/** Player colours are tuned for the dark UI; darken them for the paper. */
function shade(hex: string) {
  return `color-mix(in oklab, ${hex} 70%, #1a1430)`;
}

// ---------- write / describe ----------

function TextStep({
  kind,
  view,
  hold,
  me,
  byId,
  act,
  onEvent,
}: {
  kind: StepKind;
  view: GarbleView;
  hold: HoldView;
  me: string;
  byId: Record<string, Player>;
  act: (a: GarbleAction) => void;
  onEvent: PlayProps["onEvent"];
}) {
  const id = useId();
  const [text, setText] = useState(hold.draft);
  // The drawing to describe never changes during the step: keep the first copy so it doesn't replay.
  const [prev] = useState(() => hold.prev);
  const done = view.done.includes(me);
  const clean = cleanText(text);
  const write = kind === "write";

  // Autosave the draft shortly after typing stops (it's submitted at the deadline).
  useEffect(() => {
    if (done) return;
    const t = window.setTimeout(() => act({ type: "write", text }), 300);
    return () => window.clearTimeout(t);
  }, [text, done, act]);

  useEffect(() => {
    if (!write) return;
    return onEvent((raw) => {
      const e = raw as GarbleEvent | null;
      if (e && typeof e === "object" && e.k === "inspire" && typeof e.text === "string") setText(e.text);
    });
  }, [onEvent, write]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!clean || done) return;
    act({ type: "done", text });
  };

  const label = write ? "Your prompt" : "Your description";
  const left = MAX_TEXT - Array.from(text).length;

  return (
    <div className="flex flex-col gap-3">
      {!write && prev && (
        <figure className="gb-slide mx-auto flex w-full flex-col gap-1.5" style={{ maxWidth: "calc(48vh * 4 / 3)" }}>
          <div className="flex items-baseline justify-between gap-2 px-1">
            <BookTag hold={hold} me={me} byId={byId} step={view.step} />
            {!prev.blank && (
              <span className="truncate text-xs text-muted">
                🎨 drawn by <b style={{ color: who(byId, prev.by).color }}>{who(byId, prev.by).name}</b>
              </span>
            )}
          </div>
          {prev.blank ? (
            <div className="gb-paper grid aspect-[4/3] w-full place-items-center rounded-xl p-4 text-center">
              <p className="text-lg font-semibold text-[#7a6e93]">
                <span className="text-4xl" aria-hidden>
                  🤐
                </span>
                <br />
                The last page was left blank.
                <br />
                Describe anything you like!
              </p>
            </div>
          ) : (
            <Drawing
              strokes={prev.strokes}
              replay
              label={`Drawing by ${who(byId, prev.by).name}, for you to describe`}
              className="gb-sheet rounded-xl ring-1 ring-white/10"
            />
          )}
        </figure>
      )}

      <form onSubmit={submit} className="gb-paper gb-slide flex flex-col gap-2 rounded-2xl p-3 @md:p-4" style={{ animationDelay: "80ms" }}>
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={id} className="text-[11px] font-bold tracking-widest text-[#7a6e93] uppercase">
            {label}
          </label>
          {write && <BookTag hold={hold} me={me} byId={byId} step={view.step} />}
        </div>
        {done ? (
          <div className="relative flex min-h-12 items-center">
            <p id={id} className="pr-16 font-display text-2xl leading-tight font-extrabold break-words">
              “{clean}”
            </p>
            <span
              aria-hidden
              className="gb-stamp absolute top-1/2 right-0 -translate-y-1/2 rotate-[-10deg] rounded-md border-2 px-1.5 py-0.5 text-xs font-black tracking-wider uppercase"
              style={{ borderColor: "#16a34a", color: "#16a34a" }}
            >
              Sent
            </span>
          </div>
        ) : (
          <input
            id={id}
            className="w-full rounded-xl border-2 border-[#d9cfee] bg-white/80 px-3 py-2.5 font-display text-xl font-bold text-[#2a2238] outline-none placeholder:font-normal placeholder:text-[#a79cbf] focus:border-[#8b5cf6] @md:text-2xl"
            value={text}
            maxLength={MAX_TEXT}
            autoComplete="off"
            enterKeyHint="done"
            placeholder={write ? `e.g. ${EXAMPLES[view.players.indexOf(me) % EXAMPLES.length] ?? EXAMPLES[0]}` : "It looks like…"}
            aria-describedby={`${id}-left`}
            onChange={(e) => setText(e.target.value)}
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span
            id={`${id}-left`}
            className={`mr-auto basis-full text-xs tabular-nums @sm:basis-auto ${left < 10 && !done ? "text-[#c2410c]" : "text-[#7a6e93]"}`}
          >
            {done ? "Waiting for the others…" : `${left} characters left`}
          </span>
          {done ? (
            <button type="button" className="btn min-h-11 flex-1 text-text @sm:flex-none" onClick={() => act({ type: "edit" })}>
              <span aria-hidden>✏️</span> Edit
            </button>
          ) : (
            <>
              {write && (
                <button type="button" className="btn min-h-11 flex-1 text-text @sm:flex-none" onClick={() => act({ type: "inspire" })}>
                  <span aria-hidden>🎲</span> Inspire me
                </button>
              )}
              <button type="submit" className="btn btn-primary min-h-11 flex-1 @sm:flex-none" disabled={!clean}>
                Done <span aria-hidden>✓</span>
              </button>
            </>
          )}
        </div>
      </form>
      {write && !done && (
        <p className="text-center text-xs text-muted">Keep it drawable: the next player has to sketch it in {Math.round(view.times[1] / 1000)} seconds.</p>
      )}
    </div>
  );
}

// ---------- draw ----------

function DrawStep({
  view,
  hold,
  me,
  byId,
  act,
  onEvent,
  accent,
}: {
  view: GarbleView;
  hold: HoldView;
  me: string;
  byId: Record<string, Player>;
  act: (a: GarbleAction) => void;
  onEvent: PlayProps["onEvent"];
  accent: string;
}) {
  const [store] = useState(() => new InkStore());
  const [prompt] = useState(() => hold.prev);
  // After a refresh mid-drawing, the server still has what we drew: ask for it once.
  const [recover] = useState(() => hold.ink > 0);
  const done = view.done.includes(me);
  const step = view.step;
  const level = useSyncExternalStore(store.watch, store.level, () => 0);
  const hasInk = useSyncExternalStore(
    store.subscribe,
    () => store.list.some((s) => s.pts.length > 0),
    () => false,
  );

  useEffect(
    () =>
      onEvent((raw) => {
        const e = raw as GarbleEvent | null;
        if (!e || typeof e !== "object" || e.k !== "mine" || e.step !== step || !Array.isArray(e.strokes)) return;
        store.handle({ k: "sync", t: 0, rev: 0, strokes: e.strokes });
      }),
    [onEvent, store, step],
  );

  useEffect(() => {
    if (recover) act({ type: "mine" });
  }, [recover, act]);

  const sketchAct = useCallback(
    (a: SketchAction) => {
      if (a.type === "stroke" || a.type === "undo" || a.type === "clear") act(a);
    },
    [act],
  );

  const low = level >= INK_LOW * 100;
  const empty = level >= 100;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 @md:flex-row @md:items-stretch">
        <div className="min-w-0 flex-1">
          {prompt ? (
            <PromptCard page={prompt} byId={byId} label="Draw this" />
          ) : (
            <div className="gb-paper rounded-2xl px-4 py-3 font-display text-xl font-bold">Draw anything!</div>
          )}
        </div>
        <div className="flex items-center gap-2 @md:w-44 @md:flex-col @md:items-stretch @md:justify-center">
          <InkGauge level={level} accent={accent} />
          {done ? (
            <button type="button" className="btn ml-auto min-h-11 @md:ml-0" onClick={() => act({ type: "edit" })}>
              <span aria-hidden>✏️</span> Keep drawing
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary ml-auto min-h-11 px-5 @md:ml-0"
              disabled={!hasInk}
              onClick={() => act({ type: "done" })}
            >
              Done <span aria-hidden>✓</span>
            </button>
          )}
        </div>
      </div>
      <div className="flex justify-between px-1">
        <BookTag hold={hold} me={me} byId={byId} step={view.step} />
        {!hasInk && !done && <span className="text-xs text-muted">Draw on the white page</span>}
      </div>
      <SketchCanvas
        store={store}
        canDraw={!done}
        act={sketchAct}
        label="Your page: draw with a mouse, finger or pen"
        overlay={<CanvasOverlay done={done} low={low} empty={empty} />}
      />
    </div>
  );
}

function InkGauge({ level, accent }: { level: number; accent: string }) {
  const left = 100 - level;
  const color = level >= 100 ? "#f87171" : level >= INK_LOW * 100 ? "#fbbf24" : accent;
  return (
    <div className="flex min-w-0 items-center gap-1.5 @md:w-full" title="Ink left on this page">
      <span aria-hidden className="text-sm">
        🖋️
      </span>
      <div
        className="h-2 w-20 overflow-hidden rounded-full bg-panel-2 @md:flex-1"
        role="meter"
        aria-label="Ink left"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={left}
      >
        <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${left}%`, background: color }} />
      </div>
      <span className="text-[11px] text-muted tabular-nums">{left}%</span>
    </div>
  );
}

function CanvasOverlay({ done, low, empty }: { done: boolean; low: boolean; empty: boolean }) {
  if (done) {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
        <span className="gb-stamp rounded-full bg-emerald-500/95 px-3 py-1 text-sm font-bold text-white shadow-lg" role="status">
          ✓ Sent!
        </span>
      </div>
    );
  }
  if (empty) {
    return (
      <div className="absolute inset-0 flex items-start justify-center rounded-xl bg-black/10 pt-2" role="status">
        <span className="animate-pop rounded-full bg-red-500/95 px-3 py-1 text-sm font-bold text-white shadow-lg">
          🖋️ Out of ink! Undo or clear to keep drawing
        </span>
      </div>
    );
  }
  if (low) {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center" role="status">
        <span className="animate-pop rounded-full bg-amber-400/95 px-3 py-1 text-xs font-bold text-amber-950 shadow">
          🖋️ Ink&apos;s running low
        </span>
      </div>
    );
  }
  return null;
}

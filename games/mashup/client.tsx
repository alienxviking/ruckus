"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { Note, StatusBanner } from "@/components/game-ui";
import { feedback } from "@/lib/feedback";
import type { DrawHold, MashupAction, MashupEvent, MashupView, NameTask } from "./server";
import { GuideStrip, MonsterArt, MonsterCache, useFetchMonsters, useMonster } from "./art";
import { InkStore, PartCanvas } from "./canvas";
import { FinalPhase, ResultsPhase, RevealPhase, VotePhase } from "./show";
import { GUIDE, H, INK_LOW, MAX_NAME, PART_ICON, PART_LABEL, cleanText } from "./shared";
import { CSS, PhaseClock, StageTrack, Tracker, who } from "./ui";

type Act = (a: MashupAction) => void;
type OnEvent = (fn: (e: unknown) => void) => () => void;

export default function Mashup({ view, me, players, byId, isPlayer, act, serverNow, onEvent, accent }: GameClientProps<MashupView, MashupAction>) {
  // Finished monsters arrive as events, once each, and stay client-side.
  const [cache] = useState(() => new MonsterCache());
  useEffect(() => onEvent((e) => cache.handle(e)), [onEvent, cache]);

  const vars = { "--mm-accent": accent } as CSSProperties;

  // Each new task for you (a draw stage, naming, voting) is your turn: chime once as it lands.
  const task =
    isPlayer && view && (view.phase === "draw" || view.phase === "name" || view.phase === "vote")
      ? `${view.phase}:${view.round}:${view.stage}`
      : "";
  const lastTask = useRef("");
  useEffect(() => {
    if (task && task !== lastTask.current) feedback("turn");
    lastTask.current = task;
  }, [task]);

  if (!view) {
    return (
      <div className="card grid min-h-60 place-items-center p-6 text-muted" style={vars}>
        🧪 Warming up the monster lab…
      </div>
    );
  }

  const common = { view, me, players, byId, isPlayer, act, serverNow, accent, cache };
  return (
    <div className="@container mx-auto flex w-full max-w-4xl flex-col gap-3" style={vars}>
      <style href="ruckus-mashup" precedence="default">
        {CSS}
      </style>
      {view.phase !== "final" && view.phase !== "results" && <StageTrack view={view} accent={accent} />}
      {view.phase === "draw" ? (
        <DrawPhase {...common} onEvent={onEvent} />
      ) : view.phase === "name" ? (
        <NamePhase {...common} />
      ) : view.phase === "reveal" ? (
        <RevealPhase {...common} />
      ) : view.phase === "vote" ? (
        <VotePhase {...common} />
      ) : view.phase === "results" ? (
        <ResultsPhase {...common} />
      ) : (
        <FinalPhase {...common} />
      )}
      {/* Keeps the last controls clear of the floating chat button on phones. */}
      <div aria-hidden className="h-16 @3xl:h-2" />
    </div>
  );
}

interface PhaseProps {
  view: MashupView;
  me: string;
  players: Player[];
  byId: Record<string, Player>;
  isPlayer: boolean;
  act: Act;
  serverNow: () => number;
  accent: string;
  cache: MonsterCache;
}

export function SoloNote({ until, serverNow }: { until: number; serverNow: () => number }) {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const t = window.setInterval(() => setNow(serverNow()), 250);
    return () => window.clearInterval(t);
  }, [serverNow]);
  const secs = Math.max(0, Math.ceil((until - now) / 1000));
  return (
    <p role="status" className="card animate-rise border-amber-400/50 px-3 py-2 text-center text-sm">
      <span aria-hidden>📡 </span>Everyone else left. The game wraps up in <b className="tabular-nums">{secs}s</b> unless someone
      comes back.
    </p>
  );
}

function WatchCard({ icon, title, note, accent }: { icon: string; title: string; note: string; accent: string }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-4 py-8 text-center" style={{ borderColor: `${accent}55` }}>
      <span aria-hidden className="mm-lab text-5xl">
        {icon}
      </span>
      <p className="font-display text-lg font-bold">{title}</p>
      <Note>{note}</Note>
    </div>
  );
}

// ---------- draw ----------

const DRAW_TITLE = ["👹 Draw a HEAD!", "👕 Draw a BODY!", "🦵 Draw the LEGS!"];

function DrawPhase({ view, me, players, byId, isPlayer, act, serverNow, accent, onEvent }: PhaseProps & { onEvent: OnEvent }) {
  const hold = isPlayer ? view.draw : null;
  const done = view.done.includes(me);
  const waiting = players.filter((p) => p.connected && !view.done.includes(p.id)).length;
  let status: string;
  if (!hold) status = `🧪 Everyone's drawing ${PART_LABEL[view.stage].toLowerCase()}…`;
  else if (done) status = waiting ? `✅ Done! Waiting for ${waiting} more…` : "✅ Done! Stitching the parts…";
  else status = DRAW_TITLE[hold.part];

  return (
    <>
      <div aria-live="polite" aria-atomic="true">
        <StatusBanner key={`${view.round}-${view.stage}-${done ? 1 : 0}`} accent={accent}>
          {status}
        </StatusBanner>
      </div>
      <PhaseClock endsAt={view.endsAt} total={view.phaseMs} serverNow={serverNow} accent={accent} />
      {view.soloEndsAt !== null && <SoloNote until={view.soloEndsAt} serverNow={serverNow} />}
      {hold ? (
        <DrawStep key={`${view.round}-${view.stage}`} view={view} hold={hold} done={done} byId={byId} act={act} onEvent={onEvent} accent={accent} />
      ) : (
        <WatchCard
          icon="🧪"
          title={`${view.count} monsters are being stitched together`}
          note="👀 You're watching. Nobody sees a whole monster until the big reveal."
          accent={accent}
        />
      )}
      <Tracker players={players} done={view.done} accent={accent} label={`Done with the ${PART_LABEL[view.stage].toLowerCase()}`} />
    </>
  );
}

function hintFor(hold: DrawHold, byId: Record<string, Player>) {
  const above = who(byId, hold.guideBy);
  const prev = hold.part === 1 ? "head" : "body";
  if (hold.part === 0) return <>Any creature you like. Let its neck reach the bottom edge: the next artist only sees that strip.</>;
  if (hold.guideBlank)
    return (
      <>
        <b style={{ color: above.color }}>{above.name}</b> left the {prev} blank, so it&apos;s all yours: start the {hold.part === 1 ? "body" : "legs"} from
        the top edge.
      </>
    );
  return (
    <>
      Join the lines in the striped strip: the bottom of{" "}
      <b style={{ color: above.color }}>
        {above.name}
        &apos;s
      </b>{" "}
      {prev}.{hold.part === 1 ? " Leave hips at the bottom edge for the legs." : " Then stand it on the ground!"}
    </>
  );
}

function DrawStep({
  view,
  hold,
  done,
  byId,
  act,
  onEvent,
  accent,
}: {
  view: MashupView;
  hold: DrawHold;
  done: boolean;
  byId: Record<string, Player>;
  act: Act;
  onEvent: OnEvent;
  accent: string;
}) {
  const [store] = useState(() => new InkStore());
  // The guide never changes during a stage: keep the first copy.
  const [guide] = useState(() => hold.guide);
  // After a refresh mid-drawing, the server still has what we drew: ask for it once.
  const [recover] = useState(() => hold.ink > 0);
  const { round, stage } = view;
  const level = useSyncExternalStore(store.watch, store.level, () => 0);
  const hasInk = useSyncExternalStore(
    store.subscribe,
    () => store.list.some((s) => s.pts.length > 0),
    () => false,
  );

  useEffect(
    () =>
      onEvent((raw) => {
        const e = raw as MashupEvent | null;
        if (!e || typeof e !== "object" || e.k !== "mine" || e.round !== round || e.stage !== stage || !Array.isArray(e.strokes)) return;
        store.handle({ k: "sync", t: 0, rev: 0, strokes: e.strokes });
      }),
    [onEvent, store, round, stage],
  );

  useEffect(() => {
    if (recover) act({ type: "mine" });
  }, [recover, act]);

  const drawAct = useCallback((a: Extract<MashupAction, { type: "stroke" | "undo" | "clear" }>) => act(a), [act]);

  const low = level >= INK_LOW * 100;
  const empty = level >= 100;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 @md:flex-row @md:items-center">
        <p className="min-w-0 flex-1 text-sm text-muted">{hintFor(hold, byId)}</p>
        <div className="flex items-center gap-2">
          <InkGauge level={level} accent={accent} />
          {done ? (
            <button type="button" className="btn ml-auto min-h-11" onClick={() => act({ type: "edit" })}>
              <span aria-hidden>✏️</span> Keep drawing
            </button>
          ) : (
            <button type="button" className="btn btn-primary ml-auto min-h-11 px-5" disabled={!hasInk} onClick={() => act({ type: "done" })}>
              Done <span aria-hidden>✓</span>
            </button>
          )}
        </div>
      </div>
      <div className="flex items-baseline justify-between gap-2 px-1 text-xs font-semibold text-muted">
        <span>
          <span aria-hidden>{PART_ICON[hold.part]} </span>
          {PART_LABEL[hold.part]} of monster #{hold.m + 1}
        </span>
        {hold.part > 0 && !hold.guideBlank && <span aria-hidden>↓ continue these lines</span>}
      </div>
      <PartCanvas
        store={store}
        canDraw={!done}
        act={drawAct}
        frameColor={accent}
        label={`Your monster's ${PART_LABEL[hold.part].toLowerCase()}: draw with a mouse, finger or pen`}
        top={guide ? <GuideStrip strokes={guide} blank={hold.guideBlank} /> : undefined}
        overlay={<CanvasOverlay part={hold.part} done={done} low={low} empty={empty} />}
      />
    </div>
  );
}

function InkGauge({ level, accent }: { level: number; accent: string }) {
  const left = 100 - level;
  const color = level >= 100 ? "#f87171" : level >= INK_LOW * 100 ? "#fbbf24" : accent;
  return (
    <div className="flex min-w-0 items-center gap-1.5" title="Ink left for this part">
      <span aria-hidden className="text-sm">
        🖋️
      </span>
      <div
        className="h-2 w-20 overflow-hidden rounded-full bg-panel-2"
        role="meter"
        aria-label="Ink left"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={left}
      >
        <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${left}%`, background: color }} />
      </div>
      <span className="text-xs text-muted tabular-nums">{left}%</span>
    </div>
  );
}

function CanvasOverlay({ part, done, low, empty }: { part: number; done: boolean; low: boolean; empty: boolean }) {
  return (
    <>
      {part < 2 && (
        // The strip the next artist will see.
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 border-t-2 border-dashed"
          style={{ height: `${(GUIDE / H) * 100}%`, borderColor: "var(--mm-accent)", background: "color-mix(in oklab, var(--mm-accent) 9%, transparent)" }}
        >
          <span className="absolute right-1.5 bottom-full mb-0.5 rounded bg-white/85 px-1 text-xs font-bold text-slate-500">
            next artist sees this strip ↓
          </span>
        </div>
      )}
      {done ? (
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
          <span className="mm-stamp rounded-full bg-emerald-500/95 px-3 py-1 text-sm font-bold text-white shadow-lg" role="status">
            ✓ Done!
          </span>
        </div>
      ) : empty ? (
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center" role="status">
          <span className="animate-pop rounded-full bg-red-500/95 px-3 py-1 text-sm font-bold text-white shadow-lg">🖋️ Out of ink! Undo to keep drawing</span>
        </div>
      ) : low ? (
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center" role="status">
          <span className="animate-pop rounded-full bg-amber-400/95 px-3 py-1 text-xs font-bold text-amber-950 shadow">🖋️ Ink&apos;s running low</span>
        </div>
      ) : null}
    </>
  );
}

// ---------- name ----------

function NamePhase({ view, me, players, isPlayer, act, serverNow, accent, cache }: PhaseProps) {
  const tasks = isPlayer ? view.name : null;
  const done = view.done.includes(me);
  const waiting = players.filter((p) => p.connected && !view.done.includes(p.id)).length;
  let status: string;
  if (!tasks) status = "🏷️ The players are naming the monsters…";
  else if (done) status = waiting ? `✅ Named! Waiting for ${waiting} more…` : "✅ Named! Raising the curtain…";
  else status = tasks.length > 1 ? "🏷️ Name these two monsters!" : "🏷️ Name this monster!";
  return (
    <>
      <div aria-live="polite" aria-atomic="true">
        <StatusBanner key={`${view.round}-name-${done ? 1 : 0}`} accent={accent}>
          {status}
        </StatusBanner>
      </div>
      <PhaseClock endsAt={view.endsAt} total={view.phaseMs} serverNow={serverNow} accent={accent} />
      {view.soloEndsAt !== null && <SoloNote until={view.soloEndsAt} serverNow={serverNow} />}
      {tasks && tasks.length ? (
        <NameStep key={view.round} round={view.round} tasks={tasks} done={done} act={act} cache={cache} />
      ) : (
        <WatchCard
          icon="🏷️"
          title="Christening time"
          note="Each monster gets names from players who didn't draw it. The reveal is next!"
          accent={accent}
        />
      )}
      <Tracker players={players} done={view.done} accent={accent} label="Done naming" />
    </>
  );
}

function NameStep({ round, tasks, done, act, cache }: { round: number; tasks: NameTask[]; done: boolean; act: Act; cache: MonsterCache }) {
  const [texts, setTexts] = useState<Record<number, string>>(() => Object.fromEntries(tasks.map((t) => [t.m, t.draft])));
  const sent = useRef<Record<number, string>>(Object.fromEntries(tasks.map((t) => [t.m, t.draft])));
  useFetchMonsters(
    cache,
    round,
    tasks.map((t) => t.m),
    act,
  );

  const flush = useCallback(() => {
    for (const [k, text] of Object.entries(texts)) {
      const m = Number(k);
      if (sent.current[m] !== text) {
        sent.current[m] = text;
        act({ type: "name", m, text });
      }
    }
  }, [texts, act]);

  // Autosave drafts shortly after typing stops (they're submitted at the deadline).
  useEffect(() => {
    if (done) return;
    const t = window.setTimeout(flush, 350);
    return () => window.clearTimeout(t);
  }, [flush, done]);

  const filled = tasks.filter((t) => cleanText(texts[t.m] ?? "")).length;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (done) return;
    flush();
    act({ type: "done" });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid gap-3 @2xl:grid-cols-2">
        {tasks.map((t, i) => (
          <NameCard
            key={t.m}
            round={round}
            m={t.m}
            blank={t.blank}
            index={i}
            text={texts[t.m] ?? ""}
            done={done}
            cache={cache}
            onChange={(text) => setTexts((prev) => ({ ...prev, [t.m]: text }))}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {done ? (
          <button type="button" className="btn min-h-11 px-5" onClick={() => act({ type: "edit" })}>
            <span aria-hidden>✏️</span> Change names
          </button>
        ) : (
          <button type="submit" className="btn btn-primary min-h-11 px-6" disabled={!filled}>
            {filled < tasks.length ? `Done (${filled}/${tasks.length} named)` : "Done"} <span aria-hidden>✓</span>
          </button>
        )}
      </div>
    </form>
  );
}

function NameCard({
  round,
  m,
  blank,
  index,
  text,
  done,
  cache,
  onChange,
}: {
  round: number;
  m: number;
  blank: boolean[];
  index: number;
  text: string;
  done: boolean;
  cache: MonsterCache;
  onChange: (t: string) => void;
}) {
  const id = useId();
  const parts = useMonster(cache, round, m);
  const clean = cleanText(text);
  const left = MAX_NAME - Array.from(text).length;
  return (
    <div className="card mm-rise flex items-center gap-3 p-3" style={{ animationDelay: `${index * 90}ms` }}>
      <div className="w-[42%] max-w-44 shrink-0">
        <MonsterArt parts={parts} blank={blank} label={`Monster #${m + 1}`} className="mm-wobble" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <label htmlFor={id} className="label">
          Name monster #{m + 1}
        </label>
        {done ? (
          <p id={id} className="font-display text-xl leading-tight font-extrabold break-words">
            {clean ? `“${clean}”` : <span className="text-muted">(no name)</span>}
          </p>
        ) : (
          <input
            id={id}
            className="input w-full font-display text-lg font-bold"
            value={text}
            maxLength={MAX_NAME}
            autoComplete="off"
            enterKeyHint="done"
            placeholder={["e.g. Sir Wobbles", "e.g. Big Kevin", "e.g. The Sockmonger"][index % 3]}
            aria-describedby={`${id}-left`}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        <span id={`${id}-left`} className={`text-xs tabular-nums ${left < 6 && !done ? "text-amber-300" : "text-muted"}`}>
          {done ? "Locked in" : `${left} characters left`}
        </span>
      </div>
    </div>
  );
}

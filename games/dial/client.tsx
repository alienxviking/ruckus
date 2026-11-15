"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { Note, PlayerChip, Scoreboard, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import type { DialAction, DialRecap, DialReveal, DialRow, DialSeat, DialView } from "./server";
import { CLUE_MAX, DIAL_START, cleanClue, clueProblem, isDialEvent } from "./shared";
import { BAND_COLOR, Burst, CX, CY, DialStyles, Gauge, LEFT_COLOR, RIGHT_COLOR, type GaugeNeedle } from "./gauge";

type Props = GameClientProps<DialView, DialAction>;
type Who = (id: string) => Player;

/** Needle updates go out at most this often (~12 per second). */
const SEND_EVERY_MS = 85;

export default function OnTheDial(props: Props) {
  if (!props.view) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Note>Tuning the dial…</Note>
      </div>
    );
  }
  return <Board {...props} view={props.view} />;
}

// ---------- helpers ----------

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

/** Plain-words position on the spectrum, e.g. "a little toward Hot". */
function lean(v: number, left: string, right: string): string {
  const d = Math.abs(v - 50);
  if (d <= 4) return "right in the middle";
  const side = v < 50 ? left : right;
  if (d <= 15) return `a little toward ${side}`;
  if (d <= 32) return `toward ${side}`;
  return `far toward ${side}`;
}

function names(ids: string[], who: Who): string {
  const n = ids.map((id) => who(id).name);
  if (n.length <= 1) return n.join("");
  if (n.length > 3) return `${n.slice(0, 2).join(", ")} & ${n.length - 2} more`;
  return `${n.slice(0, -1).join(", ")} & ${n[n.length - 1]}`;
}

/** Live needle positions from transient events, layered over the last full view. */
function useLiveNeedles(view: DialView, onEvent: Props["onEvent"]): Map<string, number> | null {
  const [live, setLive] = useState<{ base: DialView; vals: Map<string, number> } | null>(null);
  const viewRef = useRef(view);
  useLayoutEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    let raf = 0;
    // Each update remembers which view it arrived on: a newer view supersedes it.
    let batch = new Map<string, { v: number; base: DialView }>();
    const off = onEvent((e) => {
      if (!isDialEvent(e)) return;
      batch.set(e.id, { v: e.v, base: viewRef.current });
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const updates = batch;
        batch = new Map();
        const base = viewRef.current;
        setLive((prev) => {
          const vals = new Map(prev && prev.base === base ? prev.vals : []);
          for (const [id, u] of updates) if (u.base === base) vals.set(id, u.v);
          return { base, vals };
        });
      });
    });
    return () => {
      off();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [onEvent]);

  return live && live.base === view ? live.vals : null;
}

// ---------- the board ----------

function Board({ view, me, byId, isPlayer, act, serverNow, onEvent, accent }: Props & { view: DialView }) {
  const who: Who = (id) => byId[id] ?? { id, name: "Someone", color: "#94a3b8", avatar: "❔", connected: false };
  const live = useLiveNeedles(view, onEvent);
  const mySeat = view.seats.find((s) => s.id === me) ?? null;
  const canDrag = isPlayer && view.phase === "guess" && view.role === "guesser" && !!mySeat && !mySeat.locked;

  // My needle: what I'm dragging this round, else the server's copy. Keyed by game
  // and round, because the component stays mounted across "Play again".
  const roundKey = `${view.game}:${view.round}`;
  const [mine, setMine] = useState<{ key: string; v: number } | null>(null);
  const myValue = view.phase === "guess" && mine?.key === roundKey ? mine.v : (mySeat?.v ?? null);

  const latest = useRef({ key: roundKey, value: myValue, canDrag });
  useLayoutEffect(() => {
    latest.current = { key: roundKey, value: myValue, canDrag };
  });

  // Throttled sender: at most one "dial" per SEND_EVERY_MS, always ending on the latest value.
  const outbox = useRef<{ last: number; timer: ReturnType<typeof setTimeout> | null; pending: number | null }>({
    last: 0,
    timer: null,
    pending: null,
  });
  useEffect(() => {
    const q = outbox.current;
    return () => {
      if (q.timer) clearTimeout(q.timer);
    };
  }, []);

  const flush = useCallback(() => {
    const q = outbox.current;
    if (q.timer) clearTimeout(q.timer);
    q.timer = null;
    if (q.pending === null) return;
    act({ type: "dial", v: q.pending });
    q.pending = null;
    q.last = performance.now();
  }, [act]);

  const setDial = useCallback(
    (raw: number) => {
      const L = latest.current;
      if (!L.canDrag) return;
      const v = clamp(raw);
      if (v === L.value) return;
      L.value = v;
      setMine({ key: L.key, v });
      const q = outbox.current;
      q.pending = v;
      const wait = SEND_EVERY_MS - (performance.now() - q.last);
      if (wait <= 0) flush();
      else if (!q.timer) q.timer = setTimeout(flush, wait);
    },
    [flush],
  );

  const nudge = useCallback((delta: number) => setDial((latest.current.value ?? DIAL_START) + delta), [setDial]);

  const lock = useCallback(() => {
    const L = latest.current;
    if (!L.canDrag) return;
    const q = outbox.current;
    if (q.timer) clearTimeout(q.timer);
    q.timer = null;
    q.pending = null;
    act(L.value === null ? { type: "lock" } : { type: "lock", v: L.value });
    L.canDrag = false; // until the next view says otherwise
  }, [act]);

  // Arrow keys / Enter work anywhere on the page while it's my turn to guess (not while typing).
  useEffect(() => {
    if (!canDrag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        nudge((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 5 : 1));
      } else if (e.key === "Enter" && !t?.closest("button, a, summary, [role=button]")) {
        e.preventDefault();
        lock();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canDrag, nudge, lock]);

  // ----- needles to draw -----
  const rows = view.reveal ? new Map(view.reveal.rows.map((r) => [r.id, r])) : null;
  const needles: GaugeNeedle[] = [];
  if (view.phase === "guess" || view.phase === "reveal") {
    for (const seat of view.seats) {
      if (seat.id === view.giver) continue;
      const p = who(seat.id);
      const isMe = seat.id === me;
      const v =
        view.phase === "reveal"
          ? (rows?.get(seat.id)?.v ?? null)
          : isMe
            ? myValue
            : (live?.get(seat.id) ?? seat.v);
      const ghost = isMe && v === null && canDrag;
      if (v === null && !ghost) continue;
      needles.push({
        id: seat.id,
        v: v ?? DIAL_START,
        color: p.color,
        avatar: p.avatar,
        label: `${p.name}${isMe ? " (you)" : ""}${v === null ? "" : `: ${v}`}`,
        me: isMe,
        locked: seat.locked,
        away: seat.away,
        ghost,
        smooth: !isMe && view.phase === "guess",
        pts: view.phase === "reveal" ? (rows?.get(seat.id)?.pts ?? 0) : null,
      });
    }
  }

  if (view.phase === "final") {
    return (
      <div className="@container mx-auto flex w-full max-w-2xl flex-col gap-3 pb-24 lg:pb-4">
        <DialStyles />
        <Final view={view} who={who} byId={byId} me={me} />
        {!isPlayer && <Note>👀 You were watching this game.</Note>}
      </div>
    );
  }

  const moved = (s: DialSeat) => s.v !== null || !!live?.has(s.id) || (s.id === me && myValue !== null);
  const bullseye = view.reveal?.rows.some((r) => r.pts === 4) ?? false;

  return (
    <div className="@container mx-auto flex w-full max-w-2xl flex-col gap-3 pb-24 lg:pb-4">
      <DialStyles />

      <div aria-live="polite">
        <Headline view={view} me={me} who={who} myValue={myValue} accent={accent} serverNow={serverNow} />
      </div>

      <Meta view={view} who={who} serverNow={serverNow} accent={accent} />

      {view.endingAt !== null && <EndingSoon endsAt={view.endingAt} serverNow={serverNow} />}
      {view.notice && (
        <p className="animate-rise text-center text-sm text-muted" role="status">
          ⏭️ {who(view.notice.id).name}
          {view.notice.why === "timeout" ? " ran out of time" : " dropped out"}, so their turn was skipped.
        </p>
      )}

      <DialPad
        view={view}
        needles={needles}
        canDrag={canDrag}
        myValue={myValue}
        accent={accent}
        onValue={setDial}
        onNudge={nudge}
        onLock={lock}
        onRelease={flush}
        burst={view.phase === "reveal" && bullseye}
      />

      {view.phase === "clue" && view.role === "giver" && (
        <ClueForm key={roundKey} view={view} act={act} accent={accent} />
      )}
      {view.phase === "clue" && view.role === "guesser" && (
        <Note>
          When the clue drops, drag your needle to where it sits between {view.left} and {view.right}.
        </Note>
      )}
      {view.phase === "clue" && view.role === "spectator" && (
        <Note>👀 You&apos;re watching. Everyone&apos;s needles will move live once the clue drops.</Note>
      )}
      {view.phase === "guess" && (
        <GuessControls
          view={view}
          me={me}
          who={who}
          canDrag={canDrag}
          myValue={myValue}
          onNudge={nudge}
          onLock={lock}
        />
      )}
      {view.phase === "reveal" && view.reveal && (
        <RevealList reveal={view.reveal} giver={view.giver} who={who} me={me} />
      )}

      <PlayerStrip view={view} who={who} me={me} moved={moved} />
    </div>
  );
}

// ---------- header pieces ----------

function Headline({
  view,
  me,
  who,
  myValue,
  accent,
  serverNow,
}: {
  view: DialView;
  me: string;
  who: Who;
  myValue: number | null;
  accent: string;
  serverNow: () => number;
}) {
  const giver = who(view.giver);
  if (view.phase === "guess") {
    const mySeat = view.seats.find((s) => s.id === me);
    let line: ReactNode;
    if (view.role === "giver") line = <>🤐 Your clue is out. No hints now!</>;
    else if (view.role === "spectator") line = <>{giver.name}&apos;s clue</>;
    else if (mySeat?.locked) line = <>🔒 Locked in at {myValue ?? mySeat.v}. Waiting for the others…</>;
    else line = <>{giver.name}&apos;s clue. Drag your needle to it!</>;
    return (
      <div
        key={`g${view.round}`}
        className="card animate-rise px-4 py-3 text-center"
        style={{ borderColor: accent + "66", background: `linear-gradient(135deg, ${accent}18, transparent 65%), var(--color-panel)` }}
      >
        <div className="text-sm font-semibold text-muted">{line}</div>
        <div
          className={`animate-pop mt-1 font-display leading-tight font-extrabold [overflow-wrap:anywhere] ${
            (view.clue?.length ?? 0) > 24 ? "text-2xl @lg:text-3xl" : "text-3xl @lg:text-4xl"
          }`}
        >
          “{view.clue}”
        </div>
      </div>
    );
  }

  if (view.phase === "reveal" && view.reveal) {
    const r = view.reveal;
    const bulls = r.rows.filter((x) => x.pts === 4).map((x) => x.id);
    const best = r.rows.find((x) => x.dist !== null);
    let sub: ReactNode;
    if (bulls.length) sub = <>Bullseye for {names(bulls, who)}!</>;
    else if (best && best.dist !== null) sub = <>Closest: {who(best.id).name}, {best.dist} off</>;
    else sub = <>Nobody moved a needle this time.</>;
    const myPts = view.giver === me ? r.giverPts : r.rows.find((x) => x.id === me)?.pts;
    return (
      <div key={`r${view.round}`}>
        <StatusBanner accent={accent}>
          <div>🎯 The target was {r.target}</div>
          <div className="mt-0.5 font-sans text-sm font-semibold text-muted">
            {sub}
            {myPts !== undefined && (
              <>
                {" · "}
                <span className={myPts > 0 ? "text-text" : undefined}>
                  {view.giver === me ? "Your clue" : "You"}: +{myPts}
                </span>
              </>
            )}
          </div>
        </StatusBanner>
        <p className="mt-2 text-center text-sm text-muted">
          {giver.name}&apos;s clue:{" "}
          <span className="font-display text-base font-bold text-text [overflow-wrap:anywhere]">“{view.clue}”</span>
        </p>
      </div>
    );
  }

  // Clue phase.
  return (
    <div key={`c${view.round}`}>
      <StatusBanner accent={accent}>
        {view.role === "giver" ? (
          <>🎙️ Your turn to give the clue!</>
        ) : view.skipAt !== null ? (
          <>
            📡 Waiting for {giver.name} to reconnect…
            <SkipCountdown at={view.skipAt} serverNow={serverNow} />
          </>
        ) : (
          <>🎙️ {giver.name} is thinking of a clue…</>
        )}
      </StatusBanner>
    </div>
  );
}

function SkipCountdown({ at, serverNow }: { at: number; serverNow: () => number }) {
  const s = useSecondsLeft(at, serverNow);
  // The live region around the banner shouldn't re-announce every second.
  return (
    <div className="mt-0.5 font-sans text-sm font-semibold text-muted">
      <span aria-hidden>Skipping their turn in {s}s</span>
      <span className="sr-only">Their turn will be skipped soon.</span>
    </div>
  );
}

function Meta({ view, who, serverNow, accent }: { view: DialView; who: Who; serverNow: () => number; accent: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="label">
          Round {view.round}/{view.rounds}
        </span>
        {view.phase === "reveal" ? (
          view.next ? (
            <span className="flex items-center gap-1.5 text-muted">
              Next up
              <PlayerChip player={who(view.next)} size="sm">
                <span aria-hidden>🎙️</span>
              </PlayerChip>
            </span>
          ) : (
            <span className="text-muted">Final scores next</span>
          )
        ) : (
          <PlayerChip player={who(view.giver)} size="sm">
            <span aria-hidden>🎙️</span>
            <span className="sr-only">is the clue-giver</span>
          </PlayerChip>
        )}
        <SecondsLeft endsAt={view.endsAt} serverNow={serverNow} />
      </div>
      <TimerBar endsAt={view.endsAt} total={view.phaseMs} serverNow={serverNow} color={accent} />
    </div>
  );
}

function SecondsLeft({ endsAt, serverNow }: { endsAt: number; serverNow: () => number }) {
  const s = useSecondsLeft(endsAt, serverNow);
  return (
    <span
      aria-hidden
      className={`ml-auto font-mono text-sm font-bold tabular-nums ${s <= 5 && s > 0 ? "text-brand" : "text-text"}`}
    >
      {s}s
    </span>
  );
}

function EndingSoon({ endsAt, serverNow }: { endsAt: number; serverNow: () => number }) {
  const s = useSecondsLeft(endsAt, serverNow);
  return (
    <div role="status" className="card animate-rise border-amber-400/60 px-3 py-2 text-center text-sm">
      ⚠️ Not enough players connected. The game ends <span aria-hidden>in {s}s</span>
      <span className="sr-only">soon</span> unless someone comes back.
    </div>
  );
}

// ---------- the dial itself ----------

function DialPad({
  view,
  needles,
  canDrag,
  myValue,
  accent,
  onValue,
  onNudge,
  onLock,
  onRelease,
  burst,
}: {
  view: DialView;
  needles: GaugeNeedle[];
  canDrag: boolean;
  myValue: number | null;
  accent: string;
  onValue: (v: number) => void;
  onNudge: (d: number) => void;
  onLock: () => void;
  onRelease: () => void;
  burst: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const labelsId = useId();

  const valueAt = (clientX: number, clientY: number): number | null => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    const dx = p.x - CX;
    const dy = Math.max(0, CY - p.y);
    if (dx * dx + dy * dy < 12 * 12) return null; // on the hub: direction is meaningless
    return clamp(100 - (Math.atan2(dy, dx) / Math.PI) * 100);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!canDrag || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is best-effort (e.g. synthetic events).
    }
    dragging.current = true;
    const v = valueAt(e.clientX, e.clientY);
    if (v !== null) onValue(v);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !canDrag) return;
    const v = valueAt(e.clientX, e.clientY);
    if (v !== null) onValue(v);
  };
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    onRelease();
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!canDrag || e.altKey || e.ctrlKey || e.metaKey) return;
    const step = e.shiftKey ? 5 : 1;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => onNudge(-step),
      ArrowDown: () => onNudge(-step),
      ArrowRight: () => onNudge(step),
      ArrowUp: () => onNudge(step),
      PageDown: () => onNudge(-10),
      PageUp: () => onNudge(10),
      Home: () => onValue(0),
      End: () => onValue(100),
      Enter: onLock,
    };
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  };

  const shown = myValue ?? DIAL_START;
  const hiddenTarget = view.target === null && (view.phase === "clue" || view.phase === "guess");
  const a11y = canDrag
    ? {
        role: "slider",
        tabIndex: 0,
        "aria-label": `Your dial, from ${view.left} to ${view.right}`,
        "aria-valuemin": 0,
        "aria-valuemax": 100,
        "aria-valuenow": shown,
        "aria-valuetext": `${shown}, ${lean(shown, view.left, view.right)}`,
        "aria-describedby": labelsId,
      }
    : {
        role: "img",
        "aria-label":
          view.target !== null
            ? `Dial from ${view.left} to ${view.right}. Target at ${view.target}, ${lean(view.target, view.left, view.right)}.`
            : `Dial from ${view.left} to ${view.right}. The target is hidden.`,
      };

  return (
    // Width cap doubles as a height cap (the dial is ~0.56 as tall as wide), so the
    // clue, dial and controls fit on one laptop screen.
    <div className="mx-auto w-full" style={{ maxWidth: "min(100%, 580px, 75vh)" }}>
      <div
        {...a11y}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={() => {
          if (dragging.current) {
            dragging.current = false;
            onRelease();
          }
        }}
        onKeyDown={onKeyDown}
        className={`relative rounded-2xl outline-none focus-visible:ring-1 ${
          canDrag ? "cursor-grab active:cursor-grabbing" : ""
        }`}
        style={{ touchAction: canDrag ? "none" : "auto", ["--tw-ring-color" as string]: accent + "88" }}
      >
        <Gauge
          needles={needles}
          target={view.target}
          animateWedge={view.phase === "reveal"}
          hidden={hiddenTarget}
          accent={accent}
          svgRef={svgRef}
        />
        {burst && <Burst key={`burst-${view.round}`} />}
      </div>
      <div
        id={labelsId}
        key={`${view.left}|${view.right}`}
        className="animate-pop mt-1 flex items-start justify-between gap-3 font-display text-sm leading-tight font-bold @md:text-base"
      >
        <span className="flex max-w-[48%] items-start gap-1 text-left" style={{ color: LEFT_COLOR }}>
          <span aria-hidden>◀</span>
          <span className="sr-only">0 is </span>
          {view.left}
        </span>
        <span className="flex max-w-[48%] items-start gap-1 text-right" style={{ color: RIGHT_COLOR }}>
          <span className="sr-only">100 is </span>
          {view.right}
          <span aria-hidden>▶</span>
        </span>
      </div>
    </div>
  );
}

// ---------- phase controls ----------

function ClueForm({ view, act, accent }: { view: DialView; act: Props["act"]; accent: string }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const hintId = useId();
  const clean = cleanClue(text);

  // Desktop: jump straight into the box unless the player is busy elsewhere (e.g. chat).
  useEffect(() => {
    const active = document.activeElement;
    if ((!active || active === document.body) && window.matchMedia("(pointer: fine)").matches) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, []);

  const submit = () => {
    const problem = clueProblem(clean);
    if (problem) {
      setError(problem);
      return;
    }
    act({ type: "clue", text: clean });
  };

  const target = view.target ?? DIAL_START;
  return (
    <form
      className="card animate-rise flex flex-col gap-2 p-3"
      style={{ borderColor: accent + "55" }}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <label htmlFor={inputId} className="label">
          Your clue
        </label>
        <span className="text-xs text-muted">
          Target <b className="font-mono text-text">{target}</b>: {lean(target, view.left, view.right)}
        </span>
      </div>
      <div className="flex gap-2">
        <input
          id={inputId}
          ref={inputRef}
          className="input min-w-0 flex-1 text-base"
          value={text}
          maxLength={CLUE_MAX}
          autoComplete="off"
          enterKeyHint="send"
          placeholder="Type a clue…"
          aria-describedby={hintId}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
        <button type="submit" className="btn btn-primary shrink-0 px-4" disabled={!clean}>
          Send
        </button>
      </div>
      <div className="flex items-start justify-between gap-3 text-xs">
        <span id={hintId} className={error ? "font-semibold text-brand" : "text-muted"} role={error ? "alert" : undefined}>
          {error ?? "A word, a thing, a phrase. No numbers!"}
        </span>
        <span className="shrink-0 font-mono text-muted tabular-nums">
          {clean.length}/{CLUE_MAX}
        </span>
      </div>
      <button
        type="button"
        className="btn self-start px-3 py-2.5 text-sm"
        disabled={view.rerolled}
        onClick={() => act({ type: "reroll" })}
      >
        🎲 {view.rerolled ? "Spectrum swapped" : "Swap spectrum (once)"}
      </button>
    </form>
  );
}

function GuessControls({
  view,
  me,
  who,
  canDrag,
  myValue,
  onNudge,
  onLock,
}: {
  view: DialView;
  me: string;
  who: Who;
  canDrag: boolean;
  myValue: number | null;
  onNudge: (d: number) => void;
  onLock: () => void;
}) {
  if (view.role === "giver") {
    return <Note>Only you can see the target wedge. Watch them squirm!</Note>;
  }
  if (view.role === "spectator") {
    return <Note>👀 You&apos;re watching. Needles move live.</Note>;
  }
  const waiting = view.seats.filter((s) => s.id !== view.giver && s.id !== me && !s.locked && !s.away).map((s) => s.id);
  if (!canDrag) {
    return (
      <div className="flex flex-col items-center gap-1 text-center">
        <span className="animate-pop rounded-full border border-line bg-panel-2 px-4 py-2 text-sm font-semibold">
          🔒 Locked at <span className="font-mono">{myValue ?? "?"}</span>
        </span>
        {waiting.length > 0 && <Note>Waiting for {names(waiting, who)}…</Note>}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          className="btn size-12 p-0 text-lg"
          aria-label={`Nudge toward ${view.left}`}
          onClick={() => onNudge(-1)}
        >
          ◀
        </button>
        <button type="button" className="btn btn-primary h-12 min-w-44 px-5 text-base" onClick={onLock}>
          🔒 Lock in{myValue !== null ? ` at ${myValue}` : ""}
        </button>
        <button
          type="button"
          className="btn size-12 p-0 text-lg"
          aria-label={`Nudge toward ${view.right}`}
          onClick={() => onNudge(1)}
        >
          ▶
        </button>
      </div>
      <p className="text-center text-xs text-muted">
        <span className="pointer-fine:hidden">Drag the dial or tap ◀ ▶, then lock it in.</span>
        <span className="hidden pointer-fine:inline">Drag the dial · ← → nudge (Shift = 5) · Enter locks</span>
      </p>
    </div>
  );
}

// ---------- reveal & standings ----------

function RevealList({ reveal, giver, who, me }: { reveal: DialReveal; giver: string; who: Who; me: string }) {
  const detail = (r: DialRow) =>
    r.v === null ? "didn't guess" : r.dist === 0 ? `at ${r.v} · exact!` : `at ${r.v} · ${r.dist} off`;
  return (
    <ol
      className="card animate-rise divide-y divide-line/70 overflow-hidden"
      style={{ animationDelay: "0.3s" }}
      aria-label="Round results"
    >
      {reveal.rows.map((r, i) => (
        <li
          key={r.id}
          className={`animate-rise flex items-center gap-2 px-3 py-2 ${r.id === me ? "bg-panel-2" : ""}`}
          style={{ animationDelay: `${0.45 + i * 0.06}s` }}
        >
          <span className="w-4 shrink-0 text-right text-xs text-muted tabular-nums">{r.v === null ? "–" : i + 1}</span>
          <PlayerChip player={who(r.id)} size="sm" />
          <span className="min-w-0 truncate text-xs text-muted @md:text-sm">{detail(r)}</span>
          <span
            className="ml-auto shrink-0 font-mono text-base font-extrabold tabular-nums"
            style={{ color: r.pts ? BAND_COLOR[r.pts] : "var(--color-muted)" }}
          >
            {r.pts === 4 && <span aria-hidden>🎯 </span>}+{r.pts}
          </span>
        </li>
      ))}
      <li
        className={`animate-rise flex items-center gap-2 px-3 py-2 ${giver === me ? "bg-panel-2" : ""}`}
        style={{ animationDelay: `${0.45 + reveal.rows.length * 0.06}s` }}
      >
        <span aria-hidden className="w-4 shrink-0 text-right text-xs">
          🎙️
        </span>
        <PlayerChip player={who(giver)} size="sm" />
        <span className="min-w-0 truncate text-xs text-muted @md:text-sm">clue-giver · avg of guesses</span>
        <span className="ml-auto shrink-0 font-mono text-base font-extrabold tabular-nums">+{reveal.giverPts}</span>
      </li>
    </ol>
  );
}

function PlayerStrip({
  view,
  who,
  me,
  moved,
}: {
  view: DialView;
  who: Who;
  me: string;
  moved: (s: DialSeat) => boolean;
}) {
  const pts = new Map(view.reveal?.rows.map((r) => [r.id, r.pts]));
  const status = (s: DialSeat): { icon: string; label: string } | null => {
    if (s.away) return { icon: "📡", label: "disconnected" };
    if (s.id === view.giver) return { icon: "🎙️", label: "clue-giver" };
    if (view.phase === "guess") {
      if (s.locked) return { icon: "🔒", label: "locked in" };
      return moved(s) ? { icon: "🤔", label: "still deciding" } : { icon: "💤", label: "hasn't moved yet" };
    }
    return null;
  };
  return (
    <ul className="flex flex-wrap justify-center gap-1.5" aria-label="Players and scores">
      {view.seats.map((s) => {
        const st = status(s);
        const gained = view.phase === "reveal" ? (s.id === view.giver ? view.reveal?.giverPts : pts.get(s.id)) : undefined;
        return (
          <li key={s.id} className={s.id === me ? "rounded-full ring-1 ring-white/40" : undefined}>
            <PlayerChip player={who(s.id)} size="sm" dim={s.away}>
              {st && (
                <>
                  <span aria-hidden>{st.icon}</span>
                  <span className="sr-only">{st.label}</span>
                </>
              )}
              <span className="font-mono text-text tabular-nums">{s.score}</span>
              {gained !== undefined && gained > 0 && (
                <span className="animate-pop font-mono text-[11px] text-emerald-300" style={{ animationDelay: "0.9s" }}>
                  +{gained}
                </span>
              )}
            </PlayerChip>
          </li>
        );
      })}
    </ul>
  );
}

function Final({ view, who, byId, me }: { view: DialView; who: Who; byId: Record<string, Player>; me: string }) {
  const scores = Object.fromEntries(view.seats.map((s) => [s.id, s.score]));
  const played = view.recap.filter((r) => !r.skipped);
  let sharpest: DialRecap | null = null;
  let bestClue: DialRecap | null = null;
  for (const r of played) {
    if (r.best && (!sharpest || r.best.dist < sharpest.best!.dist)) sharpest = r;
    if (r.giverPts > 0 && (!bestClue || r.giverPts > bestClue.giverPts)) bestClue = r;
  }
  return (
    <div className="flex animate-rise flex-col gap-3">
      {view.abandoned && <Note>The game ended early: not enough players were left.</Note>}
      <Scoreboard
        scores={scores}
        byId={byId}
        order={view.seats.map((s) => s.id)}
        highlight={me}
        title="Final standings"
      />
      {(sharpest || bestClue) && (
        <div className="grid gap-2 @lg:grid-cols-2">
          {sharpest?.best && (
            <Award icon="🎯" title="Sharpest guess">
              <b style={{ color: who(sharpest.best.id).color }}>{who(sharpest.best.id).name}</b>{" "}
              {sharpest.best.dist === 0 ? "hit it dead on" : `was ${sharpest.best.dist} off`} for “{sharpest.clue}”
            </Award>
          )}
          {bestClue && (
            <Award icon="🎙️" title="Best clue">
              “{bestClue.clue}” by <b style={{ color: who(bestClue.giver).color }}>{who(bestClue.giver).name}</b> (+
              {bestClue.giverPts})
            </Award>
          )}
        </div>
      )}
      {view.recap.length > 0 && (
        <div className="card p-3">
          <div className="label mb-2">Round by round</div>
          <ol className="divide-y divide-line/60">
            {view.recap.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-sm">
                <span className="w-6 shrink-0 text-xs text-muted tabular-nums">R{i + 1}</span>
                <PlayerChip player={who(r.giver)} size="sm" />
                <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">
                  {r.skipped ? <span className="font-normal text-muted italic">skipped</span> : <>“{r.clue}”</>}
                </span>
                <span className="w-full pl-8 text-xs text-muted @lg:ml-auto @lg:w-auto @lg:pl-0">
                  {r.left} ↔ {r.right} · target {r.target}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function Award({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <div className="card flex items-start gap-3 p-3">
      <span aria-hidden className="text-2xl">
        {icon}
      </span>
      <div className="min-w-0 text-sm">
        <div className="label">{title}</div>
        <div className="mt-0.5 [overflow-wrap:anywhere]">{children}</div>
      </div>
    </div>
  );
}

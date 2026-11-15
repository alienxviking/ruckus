"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import { Note, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import type { FibAction, FibErrorEvent, FibView, RoundSummary } from "./server";
import { HOLD_MS, MAX_LIE, PICK_MS, POINTS, REVEAL_CAP_MS, WRITE_MS, cleanLie, lieProblem } from "./shared";
import {
  Dots,
  FactCard,
  FibStyles,
  FinalScreen,
  RevealStage,
  RoundPips,
  ScoreStrip,
  Tracker,
  isTypingTarget,
  ordinal,
  rankOf,
  useRevealClock,
  type ById,
} from "./ui";

type Props = GameClientProps<FibView, FibAction>;

function isFibError(e: unknown): e is FibErrorEvent {
  if (!e || typeof e !== "object") return false;
  const { type, message } = e as { type?: unknown; message?: unknown };
  return type === "fib-error" && typeof message === "string";
}

export default function FibFinder({ view, me, players, byId, isPlayer, act, serverNow, onEvent, accent }: Props) {
  if (!view) return <Note>Digging up some strange facts…</Note>;

  const last = view.history.length ? view.history[view.history.length - 1] : null;
  const revealing = view.phase === "reveal" && last !== null;

  return (
    <div className="@container mx-auto flex w-full max-w-4xl flex-col gap-3 pb-20 lg:pb-2">
      <FibStyles />

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-xs text-muted @md:text-sm">
          <span aria-hidden>🤥 </span>Fill the blank with a fib. Then find the truth.
        </p>
        {view.phase !== "final" && <RoundPips round={view.round} total={view.totalRounds} accent={accent} />}
      </div>

      {view.shortUntil !== null && view.phase !== "final" && <ShortWarning until={view.shortUntil} serverNow={serverNow} />}

      {revealing ? (
        <RevealPhase key={`reveal-${view.round}`} view={view} summary={last} me={me} byId={byId} serverNow={serverNow} accent={accent} />
      ) : (
        <>
          <div aria-live="polite" aria-atomic="true">
            <StatusBanner key={`${view.phase}-${view.round}-${statusKey(view, isPlayer)}`} accent={accent}>
              {statusLine(view, isPlayer, me)}
            </StatusBanner>
          </div>

          {view.phase !== "final" && <PhaseTimer view={view} serverNow={serverNow} accent={accent} />}

          {view.phase === "write" &&
            (isPlayer ? (
              <WritePanel key={view.round} view={view} act={act} onEvent={onEvent} serverNow={serverNow} accent={accent} />
            ) : (
              <>
                <FactCard prompt={view.prompt} round={view.round} accent={accent} />
                <div key={`watch-${view.round}`} className="fib-in">
                  <SpectatorNote />
                </div>
              </>
            ))}

          {view.phase === "pick" && (
            <PickPanel key={view.round} view={view} isPlayer={isPlayer} act={act} accent={accent} />
          )}

          {(view.phase === "write" || view.phase === "pick") && (
            <Tracker
              players={players.map((p) => byId[p.id] ?? p)}
              done={view.phase === "write" ? view.submitted : view.picked}
              label={view.phase === "write" ? "Fibs in" : "Picks locked"}
              me={me}
              accent={accent}
            />
          )}

          {view.phase === "final" && (
            <div key="final" className="fib-in">
              <FinalScreen view={view} byId={byId} me={me} accent={accent} />
            </div>
          )}

          {view.phase !== "final" && <ScoreStrip scores={view.scores} byId={byId} me={me} />}
        </>
      )}
    </div>
  );
}

// ---------- status & timers ----------

function statusKey(view: FibView, isPlayer: boolean): string {
  if (!isPlayer) return "watch";
  if (view.phase === "write") return view.myLie ? "in" : "writing";
  if (view.phase === "pick") return view.myPick !== null ? "locked" : "picking";
  return "x";
}

function statusLine(view: FibView, isPlayer: boolean, me: string): ReactNode {
  switch (view.phase) {
    case "write":
      if (!isPlayer) return <>✍️ The players are writing fibs…</>;
      return view.myLie ? <>✅ Fib in! Waiting for the others…</> : <>✍️ Write a fib that sounds true</>;
    case "pick":
      if (!isPlayer) return <>🔍 The players are hunting for the truth…</>;
      return view.myPick !== null ? <>🔒 Locked in! Now we wait…</> : <>🔍 Which one is the truth?</>;
    case "final": {
      if (!isPlayer || !(me in view.scores)) return <>🏁 That&apos;s the game!</>;
      const rank = rankOf(view.scores, me);
      const total = Object.keys(view.scores).length;
      if (rank === 1 && (view.scores[me] ?? 0) > 0) {
        const tied = Object.values(view.scores).filter((v) => v === view.scores[me]).length > 1;
        return tied ? <>🏆 You tied for the win!</> : <>🏆 You won Fib Finder!</>;
      }
      return (
        <>
          🏁 You finished {ordinal(rank)} of {total}
        </>
      );
    }
    default:
      return <>🎭 The reveal!</>;
  }
}

function PhaseTimer({
  view,
  serverNow,
  accent,
  label,
  total,
}: {
  view: FibView;
  serverNow: () => number;
  accent: string;
  label?: string;
  total?: number;
}) {
  const secs = useSecondsLeft(view.endsAt, serverNow);
  const fullMs = total ?? (view.phase === "write" ? WRITE_MS : view.phase === "pick" ? PICK_MS : REVEAL_CAP_MS + HOLD_MS);
  const text = label ?? (view.phase === "write" ? "Writing time" : view.phase === "pick" ? "Picking time" : "");
  const urgent = (view.phase === "write" || view.phase === "pick") && secs <= 5;
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-xs text-muted @sm:w-28">{text}</span>
      <div className="min-w-0 flex-1">
        <TimerBar endsAt={view.endsAt} total={fullMs} serverNow={serverNow} color={urgent ? "var(--color-brand)" : accent} />
      </div>
      <span
        className={`w-9 shrink-0 text-right font-mono text-sm tabular-nums ${urgent ? "font-bold text-brand" : "text-muted"}`}
        aria-label={`${secs} seconds left`}
      >
        {secs}s
      </span>
    </div>
  );
}

function ShortWarning({ until, serverNow }: { until: number; serverNow: () => number }) {
  const secs = useSecondsLeft(until, serverNow);
  return (
    <div role="status" className="card animate-rise border-brand/60 px-4 py-2 text-sm">
      <span aria-hidden>⚠️ </span>Not enough players connected. The game ends{" "}
      <span aria-hidden>
        in <b className="tabular-nums">{secs}s</b>
      </span>
      <span className="sr-only">soon</span> unless someone rejoins.
    </div>
  );
}

function SpectatorNote() {
  return (
    <div className="card px-4 py-3 text-sm text-muted">
      <span aria-hidden>👀 </span>You&apos;re watching. Fibs stay anonymous until the reveal.
    </div>
  );
}

// ---------- write ----------

function WritePanel({
  view,
  act,
  onEvent,
  serverNow,
  accent,
}: {
  view: FibView;
  act: Props["act"];
  onEvent: Props["onEvent"];
  serverNow: Props["serverNow"];
  accent: string;
}) {
  const secs = useSecondsLeft(view.endsAt, serverNow);
  const id = useId();
  const hintId = `${id}-hint`;
  const [draft, setDraft] = useState(view.myLie ?? "");
  const [editing, setEditing] = useState(view.myLie === null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; truth: boolean } | null>(null);
  const [shakes, setShakes] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);

  useEffect(
    () =>
      onEvent((e) => {
        if (!isFibError(e)) return;
        setError({ message: e.message, truth: e.truth === true });
        setPending(null);
        setEditing(true);
        setShakes((k) => k + 1);
      }),
    [onEvent],
  );

  const showForm = editing || (view.myLie === null && pending === null);

  // Jump into the box when it (re)appears, unless the player is typing somewhere else (chat).
  // After a submit the form goes away: put focus on the "tap to edit" card instead of
  // dropping it on <body>, so keyboard and screen-reader users keep their place.
  useEffect(() => {
    const active = document.activeElement;
    const free = !active || active === document.body;
    if (showForm && (free || active?.closest("[data-fib-edit]"))) inputRef.current?.focus();
    else if (!showForm && free) editRef.current?.focus();
  }, [showForm]);

  const problem = draft.trim() ? lieProblem(draft) : null;
  const ready = draft.trim().length > 0 && !problem;
  const shown = error?.message ?? problem;
  const length = [...draft].length;
  // A typed but unsent fib is lost when the timer runs out: nudge in the last seconds.
  const hurry = ready && secs > 0 && secs <= 10 && cleanLie(draft) !== view.myLie;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const issue = lieProblem(draft);
    if (issue) {
      setError({ message: issue, truth: false });
      setShakes((k) => k + 1);
      return;
    }
    const clean = cleanLie(draft);
    setError(null);
    setEditing(false);
    if (clean === view.myLie) {
      setPending(null);
      return;
    }
    setPending(clean);
    act({ type: "lie", text: clean });
  };

  const sent = view.myLie !== null && (pending === null || pending === view.myLie);
  // While an edit is in flight show the new text (with "sending" dots), not the old fib.
  const fibText = pending ?? view.myLie ?? "";

  return (
    <div className="flex flex-col gap-3">
      <FactCard
        prompt={view.prompt}
        round={view.round}
        accent={accent}
        fill={showForm ? draft : fibText}
        fillStyle={showForm ? "preview" : "pick"}
        fillKey={showForm ? "draft" : fibText}
      />
      {showForm ? (
        <form
          onSubmit={submit}
          noValidate
          className="card fib-in flex flex-col gap-1.5 p-3"
          style={{ borderColor: accent, boxShadow: `0 0 0 3px ${accent}26, 0 12px 30px -12px ${accent}66` }}
        >
          <label htmlFor={id} className="label" style={{ color: accent }}>
            Your fib
          </label>
          <div className={`flex gap-2 ${shakes ? `fib-shake-${shakes % 2}` : ""}`}>
            <input
              id={id}
              ref={inputRef}
              className="input min-w-0 flex-1 text-lg font-semibold"
              value={draft}
              maxLength={MAX_LIE}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              placeholder="A believable fake"
              aria-invalid={!!shown}
              aria-describedby={hintId}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
            />
            {/* Neutral until there's something to send, then the bright primary style. */}
            <button
              type="submit"
              className={`btn min-h-11 shrink-0 px-4 ${ready ? "btn-primary" : "text-muted"}`}
              disabled={!ready}
            >
              {view.myLie ? "Update" : "Submit"}
            </button>
          </div>
          <p className="flex min-h-5 items-start justify-between gap-2 text-xs">
            <span
              id={hintId}
              aria-live="polite"
              className={error?.truth ? "animate-pop font-semibold" : shown || hurry ? "font-semibold text-brand" : "text-muted"}
              style={error?.truth ? { color: accent } : undefined}
            >
              {error?.truth
                ? `🤫 ${error.message}`
                : shown
                  ? `⚠️ ${shown}`
                  : hurry
                    ? `⏰ ${view.myLie ? "Hit Update" : "Hit Submit"}, time's almost up!`
                    : "Make it sound true. Others will try to spot it."}
            </span>
            <span aria-hidden className={`shrink-0 font-mono tabular-nums ${length >= MAX_LIE ? "text-brand" : "text-muted"}`}>
              {length}/{MAX_LIE}
            </span>
          </p>
          {view.myLie && (
            <button
              type="button"
              className="self-start text-xs text-muted underline-offset-2 hover:text-text hover:underline"
              onClick={() => {
                setDraft(view.myLie ?? "");
                setError(null);
                setEditing(false);
              }}
            >
              Keep “{view.myLie}”
            </button>
          )}
        </form>
      ) : (
        <button
          ref={editRef}
          type="button"
          data-fib-edit
          onClick={() => {
            setDraft(fibText);
            setEditing(true);
          }}
          className="card fib-in flex min-h-24 w-full flex-col gap-1 p-3 text-left transition-colors hover:border-text/40"
          style={{ borderColor: accent + "88", background: `linear-gradient(135deg, ${accent}1f, transparent 70%), var(--color-panel)` }}
          aria-label={`Your fib: ${fibText}. ${sent ? "Submitted" : "Sending"}. Tap to edit.`}
        >
          <span className="flex items-center justify-between gap-2">
            <span className="label" style={{ color: accent }}>
              Your fib
            </span>
            <span
              key={sent ? "sent" : "sending"}
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${sent ? "animate-pop" : ""}`}
              style={sent ? { color: "#06281c", background: accent } : { color: "var(--color-muted)", background: "var(--color-ink)" }}
            >
              {sent ? "Submitted ✓" : <Dots />}
            </span>
          </span>
          <span className="font-display text-2xl font-extrabold [overflow-wrap:anywhere]">“{fibText}”</span>
          <span className="text-xs text-muted">✏️ Tap to edit. You can change it until time runs out.</span>
        </button>
      )}
    </div>
  );
}

// ---------- pick ----------

function PickPanel({
  view,
  isPlayer,
  act,
  accent,
}: {
  view: FibView;
  isPlayer: boolean;
  act: Props["act"];
  accent: string;
}) {
  const [sentPick, setSentPick] = useState<number | null>(null);
  const chosen = view.myPick ?? sentPick;
  const canPick = isPlayer && chosen === null;
  const chosenText = view.options.find((o) => o.id === chosen)?.text ?? null;
  const shortcutIds = canPick ? view.options.slice(0, 9).map((o) => o.id).join(",") : "";

  // If the server never confirms the pick (message lost), unlock the buttons again.
  useEffect(() => {
    if (sentPick === null || view.myPick !== null) return;
    const timer = setTimeout(() => setSentPick(null), 4000);
    return () => clearTimeout(timer);
  }, [sentPick, view.myPick]);

  const choose = (option: number) => {
    if (!canPick) return;
    setSentPick(option);
    act({ type: "pick", option });
  };

  // Number keys 1-9 pick the matching answer (ignored while typing, e.g. in chat).
  useEffect(() => {
    if (!shortcutIds) return;
    const ids = shortcutIds.split(",").map(Number);
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return;
      if (!/^[1-9]$/.test(e.key)) return;
      const option = ids[Number(e.key) - 1];
      if (option === undefined) return;
      setSentPick(option);
      act({ type: "pick", option });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcutIds, act]);

  return (
    <div className="flex flex-col gap-3">
      <FactCard
        prompt={view.prompt}
        round={view.round}
        accent={accent}
        fill={chosenText}
        fillStyle="pick"
        fillKey={chosen ?? undefined}
      />
      <section aria-label="Answers" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2 px-1">
          <h3 className="label">{isPlayer ? "One of these is true" : "The answers"}</h3>
          <span className="text-xs text-muted">{view.options.length} answers</span>
        </div>
        <div className="grid gap-2 @lg:grid-cols-2">
          {view.options.map((o, i) => {
            const mine = chosen === o.id;
            return (
              <button
                key={o.id}
                type="button"
                disabled={!canPick}
                aria-pressed={isPlayer ? mine : undefined}
                onClick={() => choose(o.id)}
                className={`card fib-in relative flex min-h-14 min-w-0 items-center gap-3 px-3 py-2.5 text-left transition-[transform,border-color,background-color,box-shadow,opacity] duration-200 ease-out enabled:hover:-translate-y-0.5 enabled:active:scale-[0.98] disabled:cursor-default ${
                  mine ? "fib-lock" : chosen !== null ? "opacity-50" : ""
                }`}
                style={{
                  animationDelay: mine ? undefined : `${80 + i * 55}ms`,
                  ...(mine ? { borderColor: accent, background: accent + "26", boxShadow: `0 0 0 2px ${accent}` } : {}),
                }}
              >
                <span
                  aria-hidden
                  className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-line font-mono text-xs font-bold text-muted"
                  style={mine ? { borderColor: accent, color: accent } : undefined}
                >
                  {i < 9 ? i + 1 : "•"}
                </span>
                <span className="min-w-0 flex-1 font-display text-lg leading-tight font-bold [overflow-wrap:anywhere]">{o.text}</span>
                {mine && (
                  <span className="animate-pop shrink-0 text-xs font-bold tracking-wider uppercase" style={{ color: accent }}>
                    <span aria-hidden>🔒</span>
                    <span className="hidden @sm:inline"> Your pick</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {isPlayer ? (
          <p className="px-1 text-xs text-muted">
            {chosen === null ? (
              <>
                Find the truth for <b className="text-text">+{POINTS.truth}</b>. Picks are final!
                {view.myLie && <> Your fib “{view.myLie}” isn&apos;t listed for you.</>}
              </>
            ) : (
              <>Locked in. Every friend who falls for your fib earns you +{POINTS.fooled}.</>
            )}
          </p>
        ) : (
          <SpectatorNote />
        )}
      </section>
    </div>
  );
}

// ---------- reveal ----------

function RevealPhase({
  view,
  summary,
  me,
  byId,
  serverNow,
  accent,
}: {
  view: FibView;
  summary: RoundSummary;
  me: string;
  byId: ById;
  serverNow: () => number;
  accent: string;
}) {
  const { step, beat, done } = useRevealClock(view.revealAt, view.stepMs, summary.steps.length, serverNow);
  const truthNow = summary.options[summary.steps[step]]?.kind === "truth";
  const stage = done ? "done" : truthNow ? "truth" : "fibs";
  // Hold back this round's points until the walk-through is over, so the strip doesn't spoil it.
  const shownScores = done
    ? view.scores
    : Object.fromEntries(Object.entries(view.scores).map(([id, sc]) => [id, sc - (summary.points[id] ?? 0)]));
  const last = view.round >= view.totalRounds;
  return (
    <>
      <div aria-live="polite" aria-atomic="true">
        <StatusBanner key={`reveal-${view.round}-${stage}`} accent={accent}>
          {stage === "done" ? (
            <>✨ Round {summary.round} points are in!</>
          ) : stage === "truth" ? (
            <>🥁 And the truth is…</>
          ) : (
            <>🎭 Exposing the fibs…</>
          )}
        </StatusBanner>
      </div>
      <PhaseTimer view={view} serverNow={serverNow} accent={accent} label={last ? "Final scores in" : "Next fact in"} total={view.endsAt - view.revealAt} />
      <div className="fib-in flex flex-col gap-3">
        <RevealStage s={summary} step={step} beat={beat} done={done} byId={byId} me={me} accent={accent} />
        <ScoreStrip scores={shownScores} byId={byId} me={me} gains={done ? summary.points : null} />
      </div>
    </>
  );
}

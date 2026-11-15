"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { Note, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import type { ImpostorAction, ImpostorErrorEvent, ImpostorView } from "./server";
import {
  CLUE_MS,
  GUESS_MS,
  LAPS,
  MAX_CLUE,
  MAX_GUESS,
  POINTS,
  REVEAL_MS,
  VOTE_MS,
  VOTE_SETTLE_MS,
  clueProblem,
  guessProblem,
} from "./shared";
import {
  BigChip,
  ClueBoard,
  Dots,
  FinalScreen,
  GameStyles,
  RevealCard,
  RoundPips,
  ScoreStrip,
  VoteGrid,
  Who,
  WordCard,
  nameOf,
} from "./ui";

type Props = GameClientProps<ImpostorView, ImpostorAction>;
type ById = Record<string, Player>;

function isErrorEvent(e: unknown): e is ImpostorErrorEvent {
  if (!e || typeof e !== "object") return false;
  const { type, message } = e as { type?: unknown; message?: unknown };
  return type === "error" && typeof message === "string";
}

export default function OddOneOut({ view, me, byId, isPlayer, act, serverNow, onEvent, accent }: Props) {
  const [hidden, setHidden] = useState(false);
  if (!view) return <Note>Dealing out the secret words…</Note>;

  const toggleWord = () => setHidden((h) => !h);
  const last = view.history.length ? view.history[view.history.length - 1] : null;
  const myTurn = isPlayer && view.phase === "clues" && view.currentId === me;
  const caughtMe = view.phase === "lastGuess" && view.caughtId === me;
  const settling = view.phase === "vote" && view.allVoted;
  const status = statusLine(view, me, isPlayer, byId, settling, last);
  const earlier = view.clues.flatMap((c) => (c.text === null ? [] : [c.text]));

  const wordCard = (compact?: boolean, hint?: ReactNode) =>
    isPlayer && view.myWord ? (
      <WordCard
        word={view.myWord}
        round={view.round}
        hidden={hidden}
        onToggle={toggleWord}
        accent={accent}
        compact={compact}
        hint={hint}
      />
    ) : (
      <div className="card px-4 py-3 text-sm text-muted">
        <span aria-hidden>👀 </span>You&apos;re watching. The words stay secret until the reveal.
      </div>
    );

  return (
    <div className="@container mx-auto flex w-full max-w-4xl flex-col gap-3 pb-20 lg:pb-2">
      <GameStyles />

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-xs text-muted @md:text-sm">
          <span aria-hidden>🕵️ </span>One player has a different word, and doesn&apos;t know it.
        </p>
        {view.phase !== "final" && <RoundPips round={view.round} total={view.totalRounds} accent={accent} />}
      </div>

      {view.shortUntil !== null && view.phase !== "final" && (
        <ShortWarning until={view.shortUntil} serverNow={serverNow} />
      )}

      <div aria-live="polite" aria-atomic="true">
        <StatusBanner key={status.key} accent={accent}>
          {status.node}
        </StatusBanner>
      </div>

      {view.phase !== "final" && (
        <PhaseTimer view={view} serverNow={serverNow} accent={accent} myTurn={myTurn} caughtMe={caughtMe} settling={settling} />
      )}

      {view.phase === "clues" && (
        <div className="grid gap-3 @2xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] @2xl:items-start">
          <div className="flex min-w-0 flex-col gap-3">
            {wordCard(false, "Clue it without giving it away. Someone has a different word…")}
            {myTurn && view.myWord ? (
              <ClueInput
                key={view.turn}
                myWord={view.myWord}
                earlier={earlier}
                act={act}
                onEvent={onEvent}
                accent={accent}
              />
            ) : (
              isPlayer && <TurnHint view={view} me={me} byId={byId} />
            )}
          </div>
          <ClueBoard view={view} byId={byId} me={me} accent={accent} />
        </div>
      )}

      {view.phase === "vote" && (
        <>
          {wordCard(true)}
          <VoteGrid view={view} me={me} byId={byId} isPlayer={isPlayer} act={act} accent={accent} />
        </>
      )}

      {view.phase === "lastGuess" && (
        <div className="grid gap-3 @2xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] @2xl:items-start">
          {caughtMe && view.myWord ? (
            <GuessPanel myWord={view.myWord} act={act} onEvent={onEvent} accent={accent} />
          ) : (
            <CaughtCard caught={view.caughtId} byId={byId} isPlayer={isPlayer} accent={accent} />
          )}
          <ClueBoard view={view} byId={byId} me={me} accent={accent} />
        </div>
      )}

      {view.phase === "reveal" && last && (
        <div className="grid gap-3 @2xl:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] @2xl:items-start">
          <RevealCard s={last} byId={byId} me={me} accent={accent} />
          <ClueBoard view={view} byId={byId} me={me} accent={accent} oddId={last.oddId} />
        </div>
      )}

      {view.phase === "final" && <FinalScreen view={view} byId={byId} me={me} accent={accent} />}

      {view.phase !== "final" && <ScoreStrip view={view} byId={byId} me={me} />}
    </div>
  );
}

// ---------- status & timers ----------

function statusLine(
  view: ImpostorView,
  me: string,
  isPlayer: boolean,
  byId: ById,
  settling: boolean,
  last: ImpostorView["history"][number] | null,
): { key: string; node: ReactNode } {
  const key = `${view.phase}-${view.round}`;
  switch (view.phase) {
    case "clues": {
      if (view.currentId === me) return { key: `${key}-${view.turn}`, node: <>✍️ Your turn! Give a clue</> };
      return {
        key: `${key}-${view.turn}`,
        node: (
          <>
            <Who player={byId[view.currentId ?? ""]} /> is thinking of a clue…
          </>
        ),
      };
    }
    case "vote":
      if (settling) return { key: `${key}-in`, node: <>🔒 All votes in! Counting…</> };
      if (!isPlayer) return { key, node: <>🔍 The players are voting…</> };
      if (view.myVote) {
        return {
          key: `${key}-voted`,
          node: (
            <>
              👉 You voted <Who player={byId[view.myVote]} />
            </>
          ),
        };
      }
      return { key, node: <>🔍 Vote for the odd one!</> };
    case "lastGuess":
      if (view.caughtId === me) return { key, node: <>🎯 Guess the others&apos; word!</> };
      return {
        key,
        node: (
          <>
            🚨 <Who player={byId[view.caughtId ?? ""]} /> got caught!
          </>
        ),
      };
    case "reveal": {
      if (!last) return { key, node: <>The reveal!</> };
      const you = last.oddId === me;
      const odd = <Who player={byId[last.oddId]} you={you} />;
      if (last.outcome === "escaped") return { key, node: <>🕵️ {odd} got away!</> };
      if (last.outcome === "guessed") return { key, node: <>🎯 {odd} guessed the word!</> };
      return { key, node: <>🎉 {odd} {you ? "were" : "was"} caught!</> };
    }
    default:
      return { key, node: <>🏁 That&apos;s the game!</> };
  }
}

function PhaseTimer({
  view,
  serverNow,
  accent,
  myTurn,
  caughtMe,
  settling,
}: {
  view: ImpostorView;
  serverNow: () => number;
  accent: string;
  myTurn: boolean;
  caughtMe: boolean;
  settling: boolean;
}) {
  const secs = useSecondsLeft(view.endsAt, serverNow);
  const total = { clues: CLUE_MS, vote: settling ? VOTE_SETTLE_MS : VOTE_MS, lastGuess: GUESS_MS, reveal: REVEAL_MS, final: 1 }[view.phase];
  const label = {
    clues: myTurn ? "Your turn" : "Clue timer",
    vote: settling ? "Closing" : "Voting closes in",
    lastGuess: caughtMe ? "Your guess" : "Guess",
    reveal: view.round >= view.totalRounds ? "Final scores in" : "Next round in",
    final: "",
  }[view.phase];
  const urgent = (myTurn || caughtMe || view.phase === "vote") && secs <= 5;
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-xs text-muted">{label}</span>
      <div className="min-w-0 flex-1">
        <TimerBar endsAt={view.endsAt} total={total} serverNow={serverNow} color={urgent ? "var(--color-brand)" : accent} />
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

function TurnHint({ view, me, byId }: { view: ImpostorView; me: string; byId: ById }) {
  // Count only turns that will really happen: offline players are skipped instantly.
  const n = view.order.length;
  let away = -1;
  let prevId: string | null = null;
  let ahead = 0;
  for (let k = view.turn; k < n * LAPS; k++) {
    const id = view.order[k % n];
    if (id === me) {
      away = ahead;
      break;
    }
    if (byId[id]?.connected !== false) {
      ahead += 1;
      prevId = id;
    }
  }
  return (
    <p className="px-1 text-sm text-muted">
      {away < 0 ? (
        <>✅ You&apos;ve given your clues. Watch for the one that doesn&apos;t fit.</>
      ) : away <= 1 ? (
        <>
          ⏭️ You&apos;re up next{prevId && (
            <>
              , after <Who player={byId[prevId]} />
            </>
          )}
          . Get a clue ready!
        </>
      ) : (
        <>⏳ Your turn comes in {away} turns.</>
      )}
    </p>
  );
}

// ---------- text entry ----------

function WordForm({
  label,
  maxLength,
  validate,
  submitLabel,
  idleHint,
  onSubmit,
  onEvent,
  accent,
}: {
  label: string;
  maxLength: number;
  validate: (text: string) => string | null;
  submitLabel: string;
  idleHint: string;
  onSubmit: (text: string) => void;
  onEvent: Props["onEvent"];
  accent: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const [text, setText] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [shakes, setShakes] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () =>
      onEvent((e) => {
        if (!isErrorEvent(e)) return;
        setServerError(e.message);
        setSent(false);
        setShakes((k) => k + 1);
      }),
    [onEvent],
  );

  // Jump into the box when it appears, unless the player is typing somewhere else (chat).
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) inputRef.current?.focus();
  }, []);

  const trimmed = text.trim();
  const problem = trimmed ? validate(text) : null;
  const ready = trimmed.length > 0 && !problem;
  const error = serverError ?? problem;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (sent) return;
    if (!ready) {
      setShakes((k) => k + 1);
      return;
    }
    setSent(true);
    onSubmit(trimmed);
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-1.5">
      <label htmlFor={id} className="label" style={{ color: accent }}>
        {label}
      </label>
      <div className={`flex gap-2 ${shakes ? `oo-shake-${shakes % 2}` : ""}`}>
        <input
          id={id}
          ref={inputRef}
          className="input min-w-0 flex-1 text-lg font-semibold"
          value={text}
          maxLength={maxLength}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="send"
          aria-invalid={!!error}
          aria-describedby={hintId}
          onChange={(e) => {
            setText(e.target.value);
            setServerError(null);
            setSent(false);
          }}
        />
        <button type="submit" className="btn btn-primary min-h-11 shrink-0 px-4" disabled={!ready || sent}>
          {sent ? <Dots /> : submitLabel}
        </button>
      </div>
      <p className="flex min-h-5 items-start justify-between gap-2 text-xs">
        <span id={hintId} aria-live="polite" className={error ? "text-brand" : ready ? "text-green-300" : "text-muted"}>
          {error ? `⚠️ ${error}` : ready ? "✓ Looks good. Press Enter to send." : idleHint}
        </span>
        <span aria-hidden className="shrink-0 font-mono text-muted tabular-nums">
          {[...text].length}/{maxLength}
        </span>
      </p>
    </form>
  );
}

function ClueInput({
  myWord,
  earlier,
  act,
  onEvent,
  accent,
}: {
  myWord: string;
  earlier: string[];
  act: (a: ImpostorAction) => void;
  onEvent: Props["onEvent"];
  accent: string;
}) {
  return (
    <div
      className="card animate-pop p-3"
      style={{ borderColor: accent, boxShadow: `0 0 0 3px ${accent}26, 0 12px 30px -12px ${accent}66` }}
    >
      <WordForm
        label="Your clue"
        maxLength={MAX_CLUE}
        validate={(t) => clueProblem(t, myWord, earlier)}
        submitLabel="Send"
        idleHint="One word. Not your word, not a repeat."
        onSubmit={(text) => act({ type: "clue", text })}
        onEvent={onEvent}
        accent={accent}
      />
    </div>
  );
}

function GuessPanel({
  myWord,
  act,
  onEvent,
  accent,
}: {
  myWord: string;
  act: (a: ImpostorAction) => void;
  onEvent: Props["onEvent"];
  accent: string;
}) {
  return (
    <div
      className="card animate-pop flex min-w-0 flex-col gap-3 p-4"
      style={{
        borderColor: accent,
        background: `radial-gradient(120% 120% at 0% 0%, ${accent}33, transparent 60%), var(--color-panel)`,
      }}
    >
      <div>
        <p className="font-display text-xl font-extrabold">You&apos;ve been caught! 🎯</p>
        <p className="mt-1 text-sm text-muted">
          Your word was <b className="text-text capitalize">{myWord}</b>, but everyone else had a different one. Use their
          clues: name it to steal <b className="text-text">+{POINTS.guess}</b>.
        </p>
      </div>
      <WordForm
        label="Your guess"
        maxLength={MAX_GUESS}
        validate={guessProblem}
        submitLabel="Guess"
        idleHint="One shot. Close spellings count."
        onSubmit={(text) => act({ type: "guess", text })}
        onEvent={onEvent}
        accent={accent}
      />
    </div>
  );
}

function CaughtCard({
  caught,
  byId,
  isPlayer,
  accent,
}: {
  caught: string | null;
  byId: ById;
  isPlayer: boolean;
  accent: string;
}) {
  const name = nameOf(byId, caught);
  return (
    <section
      aria-label="Caught"
      className="card animate-pop flex min-w-0 flex-col items-center gap-2 p-4 text-center"
      style={{
        borderColor: accent,
        background: `radial-gradient(120% 120% at 50% 0%, ${accent}2e, transparent 60%), var(--color-panel)`,
      }}
    >
      <p className="label">Caught red-handed</p>
      <BigChip player={caught ? byId[caught] : undefined} delay={120} />
      <p className="text-sm">
        <b>{name}</b> had the odd word! They get one guess at {isPlayer ? "yours" : "the majority word"}…
      </p>
      <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: accent }}>
        <Dots /> guessing
      </span>
      <p className="text-xs text-muted">
        If they miss: everyone else +{POINTS.catch}, and +{POINTS.sharpEye} more for voting {name}. If they nail it: {name} +
        {POINTS.guess}.
      </p>
    </section>
  );
}

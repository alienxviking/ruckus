"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { Note, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import { feedback, sfx } from "@/lib/feedback";
import type { PlayerLine, TriviaAction, TriviaView } from "./server";
import { CATEGORIES, LETTERS, STREAK_CAP, fmt } from "./shared";
import { FinalScreen } from "./final";
import { Leaderboard, Lineup, LockedIn, SoloStats } from "./standings";
import { AnswerButton, CategoryChip, DiffPill, TriviaStyles, cssVars, ordinal, personOf, seconds, type AnswerLook } from "./ui";

/** When several copies of the game share a page (the dev simulator), the one touched last owns the keyboard. */
const keyboard = { owner: null as string | null };

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

/** "1".."4" or "a".."d" -> 0..3, anything else -> -1. */
function keyToChoice(key: string): number {
  const k = key.toLowerCase();
  if (k.length !== 1) return -1;
  const digit = "1234".indexOf(k);
  return digit !== -1 ? digit : "abcd".indexOf(k);
}

export default function TriviaRush({
  view,
  me,
  byId,
  isPlayer,
  act,
  serverNow,
  accent,
}: GameClientProps<TriviaView, TriviaAction>) {
  const secs = useSecondsLeft(view?.endsAt, serverNow);
  const [pending, setPending] = useState<{ q: number; choice: number } | null>(null);
  const questionId = useId();

  const phase = view?.phase ?? null;
  const qNum = view?.qNum ?? 0;
  // Show our pick instantly; the server's copy takes over once it arrives.
  const myChoice = view?.myChoice ?? (phase === "question" && pending?.q === qNum ? pending.choice : null);
  const canAnswer = isPlayer && phase === "question" && myChoice === null && secs > 0;

  const answer = useCallback(
    (choice: number) => {
      if (!canAnswer) return;
      setPending({ q: qNum, choice });
      act({ type: "answer", choice, q: qNum });
    },
    [canAnswer, qNum, act],
  );

  useEffect(() => {
    if (!canAnswer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || isTyping(e.target)) return;
      if (keyboard.owner !== null && keyboard.owner !== me) return;
      const choice = keyToChoice(e.key);
      if (choice === -1) return;
      e.preventDefault();
      answer(choice);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canAnswer, answer, me]);

  // A new question pops in; at the reveal, your own answer scores or misses.
  const asking = phase === "question" ? qNum : -1;
  const lastAsked = useRef(-1);
  useEffect(() => {
    if (asking > 0 && asking !== lastAsked.current) sfx("pop");
    lastAsked.current = asking;
  }, [asking]);
  const myOutcome = isPlayer && phase === "reveal" ? view?.players.find((l) => l.id === me)?.outcome : null;
  const verdict = myOutcome ? `${qNum}:${myOutcome.correct ? "y" : "n"}` : "";
  const lastVerdict = useRef("");
  useEffect(() => {
    if (verdict && verdict !== lastVerdict.current) {
      if (verdict.endsWith("y")) feedback("score");
      else sfx("error");
    }
    lastVerdict.current = verdict;
  }, [verdict]);

  const claimKeyboard = () => {
    keyboard.owner = me;
  };

  if (!view) {
    return (
      <div className="card mx-auto w-full max-w-4xl p-6 text-center text-muted">
        <span aria-hidden>⚡</span> Shuffling the questions…
      </div>
    );
  }

  const lines = view.players;
  const mine = lines.find((l) => l.id === me) ?? null;
  const solo = lines.length === 1;
  const q = view.question;
  const revealing = phase === "reveal";

  return (
    <div
      className="@container mx-auto flex w-full max-w-4xl flex-col gap-3 pb-20 lg:pb-2"
      onPointerDown={claimKeyboard}
      onFocusCapture={claimKeyboard}
    >
      <TriviaStyles />
      <p className="sr-only" aria-live="polite">
        {liveText(view, mine, myChoice)}
      </p>

      {phase === "intro" && <Intro view={view} secs={secs} accent={accent} byId={byId} />}

      {(phase === "question" || phase === "reveal") && q && (
        <>
          <StatusBanner key={`${phase}-${qNum}`} accent={bannerAccent(view, mine, isPlayer, accent)}>
            {/* Re-keyed when what we're saying changes (pick -> locked -> time's up), so it swaps in instead of snapping. */}
            <div key={bannerKey(view, isPlayer, myChoice, secs)} className="trv-swap">
              <Banner view={view} mine={mine} isPlayer={isPlayer} myChoice={myChoice} secs={secs} byId={byId} />
            </div>
          </StatusBanner>

          <div className="grid items-start gap-3 @2xl:grid-cols-[minmax(0,1fr)_17.5rem]">
            <div className="flex min-w-0 flex-col gap-3">
              <section key={`q-${qNum}`} aria-labelledby={questionId} className="card trv-enter p-4 @lg:p-5">
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <CategoryChip cat={q.cat} accent={accent} />
                    <DiffPill diff={q.diff} />
                  </div>
                  <span className="font-mono text-sm font-bold text-muted tabular-nums">
                    <span className="sr-only">Question </span>
                    <span className="text-text">{qNum}</span>/{view.total}
                  </span>
                </div>
                <h2 id={questionId} className="font-display text-xl leading-snug font-bold text-balance @lg:text-2xl">
                  {q.text}
                </h2>
                <div className="mt-3 flex items-center gap-2.5">
                  <div className="min-w-0 flex-1">
                    <TimerBar
                      endsAt={view.endsAt}
                      total={view.phaseMs}
                      serverNow={serverNow}
                      color={revealing ? "#a39dc8" : secs <= 5 ? "#fb7185" : accent}
                    />
                  </div>
                  {revealing ? (
                    <span className="shrink-0 text-xs text-muted tabular-nums">
                      {qNum < view.total ? "Next in" : "Results in"} {secs}s
                    </span>
                  ) : (
                    <span
                      className={`w-9 shrink-0 text-right font-mono text-sm font-bold tabular-nums ${
                        secs <= 5 && secs > 0 ? "trv-pulse text-rose-300" : "text-muted"
                      }`}
                    >
                      {secs}s
                    </span>
                  )}
                </div>
              </section>

              <div role="group" aria-label="Answers" className="@container/answers grid grid-cols-2 gap-x-2.5 gap-y-3.5 pb-1 @lg:gap-3">
                {q.choices.map((text, i) => (
                  // The wrapper deals the tiles in (staggered) when a question arrives; the
                  // button's own animations (lock, pop, shake) stay free to play on top.
                  <div key={`${qNum}-${i}`} className="trv-tile-in flex" style={cssVars({ "--i": String(i) })}>
                    <AnswerButton
                      index={i}
                      text={text}
                      look={lookFor(i, view, myChoice, canAnswer)}
                      mine={revealing ? mine?.outcome?.choice === i : false}
                      pickers={revealing ? lines.filter((l) => l.outcome?.choice === i).map((l) => personOf(byId, l.id)) : []}
                      points={revealing && mine?.outcome?.choice === i ? mine.outcome.points : 0}
                      accent={accent}
                      onPick={answer}
                    />
                  </div>
                ))}
              </div>
            </div>

            {solo && mine ? (
              <SoloStats line={mine} asked={view.asked} revealing={revealing} accent={accent} />
            ) : phase === "question" ? (
              <LockedIn lines={lines} byId={byId} me={me} />
            ) : (
              <Leaderboard lines={lines} byId={byId} me={me} qNum={qNum} showDelta={qNum > 1} />
            )}
          </div>
        </>
      )}

      {phase === "final" && <FinalScreen view={view} me={me} byId={byId} accent={accent} />}

      {!isPlayer && phase !== "final" && <Note>👀 You&apos;re watching. Only players can answer.</Note>}
    </div>
  );
}

function lookFor(i: number, view: TriviaView, myChoice: number | null, canAnswer: boolean): AnswerLook {
  if (view.phase === "reveal") return i === view.answer ? "correct" : "wrong";
  if (myChoice !== null) return i === myChoice ? "locked" : "faded";
  return canAnswer ? "open" : "plain";
}

function bannerKey(view: TriviaView, isPlayer: boolean, myChoice: number | null, secs: number): string {
  if (view.phase !== "question" || !isPlayer) return "info";
  return myChoice !== null ? "locked" : secs > 0 ? "pick" : "late";
}

function bannerAccent(view: TriviaView, mine: PlayerLine | null, isPlayer: boolean, accent: string): string {
  if (view.phase !== "reveal" || !isPlayer || !mine?.outcome) return accent;
  return mine.outcome.correct ? "#4ade80" : "#fb7185";
}

function Banner({
  view,
  mine,
  isPlayer,
  myChoice,
  secs,
  byId,
}: {
  view: TriviaView;
  mine: PlayerLine | null;
  isPlayer: boolean;
  myChoice: number | null;
  secs: number;
  byId: Record<string, Player>;
}): ReactNode {
  const lines = view.players;
  if (view.phase === "question") {
    const inCount = lines.filter((l) => l.answered).length;
    const waiting = lines.filter((l) => !l.answered && personOf(byId, l.id).connected).length;
    if (!isPlayer) return <>👀 {inCount}/{lines.length} locked in</>;
    if (myChoice !== null) {
      return (
        <>
          🔒 Locked in {LETTERS[myChoice]}!
          {waiting > 0 && lines.length > 1 && (
            <span className="block text-sm font-semibold text-muted @md:inline @md:pl-2">
              Waiting for {waiting} more…
            </span>
          )}
        </>
      );
    }
    return secs > 0 ? <>⏱ Pick an answer!</> : <>⌛ Time&apos;s up!</>;
  }

  // Reveal
  const right = view.answer ?? 0;
  const correctText = view.question?.choices[right] ?? "";
  const gotIt = lines.filter((l) => l.outcome?.correct).length;
  const crowd =
    lines.length > 1
      ? gotIt === 0
        ? "Nobody got it"
        : `${gotIt === lines.length ? "Everyone" : `${gotIt} of ${lines.length}`} got it`
      : null;
  const out = mine?.outcome;
  let head: ReactNode;
  const details: string[] = [];
  if (!isPlayer || !out) {
    head = (
      <>
        💡 It&apos;s {LETTERS[right]}: {correctText}
      </>
    );
  } else if (out.correct) {
    head = <>✅ Correct! +{fmt(out.points)}</>;
    details.push(`answered in ${seconds(out.ms)}`);
    if (out.bonus > 0) details.push(`🔥 ${out.streak} in a row: +${out.bonus}${out.bonus >= STREAK_CAP ? " (max)" : ""}`);
  } else {
    head = (
      <>
        {out.choice === null ? "⌛ Too slow!" : "❌ Not quite!"} It was {LETTERS[right]}
      </>
    );
    details.push(correctText);
    if (out.lost >= 2) details.push(`💔 ${out.lost}-streak lost`);
  }
  if (crowd) details.push(crowd);
  return (
    <>
      {head}
      {details.length > 0 && <span className="mt-0.5 block font-sans text-sm font-semibold text-muted">{details.join(" · ")}</span>}
    </>
  );
}

function Intro({
  view,
  secs,
  accent,
  byId,
}: {
  view: TriviaView;
  secs: number;
  accent: string;
  byId: Record<string, Player>;
}) {
  return (
    <>
      <div
        className="card animate-rise flex flex-col items-center gap-4 px-4 py-6 text-center"
        style={{
          borderColor: accent + "66",
          background: `radial-gradient(120% 80% at 50% 0%, ${accent}22, transparent 65%), var(--color-panel)`,
        }}
      >
        <span className="label">
          {view.total} questions · {Math.min(view.total, CATEGORIES.length)} categories
        </span>
        <h2 className="font-display text-3xl font-black @lg:text-4xl">Get ready!</h2>
        <div
          key={secs}
          aria-hidden
          className="trv-count grid size-24 place-items-center rounded-full border-4 font-display text-5xl font-black tabular-nums"
          style={{ borderColor: accent, color: accent, boxShadow: `0 0 44px -10px ${accent}` }}
        >
          {secs > 0 ? secs : "Go!"}
        </div>
        <ul className="grid gap-x-6 gap-y-1.5 text-left text-sm text-muted @xl:grid-cols-2">
          {[
            ["⏱", `${view.questionMs / 1000} seconds per question`],
            ["⚡", "Faster right answers score more, up to 1,000"],
            ["🔥", `Answer streaks earn up to +${STREAK_CAP}`],
            ["⌨️", "Press 1–4 or A–D to answer"],
          ].map(([icon, text]) => (
            <li key={icon} className="flex gap-2">
              <span aria-hidden className="w-5 shrink-0 text-center">
                {icon}
              </span>
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </div>
      <Lineup lines={view.players} byId={byId} />
    </>
  );
}

function liveText(view: TriviaView, mine: PlayerLine | null, myChoice: number | null): string {
  const q = view.question;
  switch (view.phase) {
    case "intro":
      return `Get ready: ${view.total} questions coming up.`;
    case "question":
      if (myChoice !== null) return `Locked in answer ${LETTERS[myChoice]}.`;
      return q ? `Question ${view.qNum} of ${view.total}, ${q.cat}: ${q.text}` : "";
    case "reveal": {
      const right = view.answer ?? 0;
      const answerText = `The answer is ${LETTERS[right]}: ${q?.choices[right] ?? ""}.`;
      const out = mine?.outcome;
      if (!out) return answerText;
      return out.correct ? `Correct! Plus ${out.points} points.` : `${out.choice === null ? "Out of time." : "Wrong."} ${answerText}`;
    }
    case "final": {
      if (!mine) return "Game over.";
      const how = view.players.length > 1 ? `You finished ${ordinal(mine.rank)} with` : "You scored";
      return `Game over. ${how} ${mine.score} points, ${mine.correct} of ${view.asked} correct.`;
    }
  }
}

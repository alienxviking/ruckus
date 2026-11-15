"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { Note, PlayerChip, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import {
  CATEGORIES_PER_ROUND,
  MAX_ANSWER,
  TYPING_MS,
  autoVerdict,
  splitArticle,
  type LettersAction,
  type LettersView,
} from "./shared";
import { Board } from "./board";
import { FinalStandings, RoundResults } from "./standings";
import { LETTERS_CSS, LetterTile, clock, playerOf, useNow, waitList } from "./ui";

type Props = GameClientProps<LettersView, LettersAction>;
type PhaseProps = Pick<Props, "byId" | "act" | "serverNow" | "accent"> & { view: LettersView };

/** Send an answer this long after the last keystroke (and always on blur). */
const DEBOUNCE_MS = 400;
/** In the last moments of the round, pending edits go out straight away. */
const FLUSH_BEFORE_MS = 800;

export default function LetterRush({ view, byId, act, serverNow, accent }: Props) {
  if (!view) return <Note>Shuffling the alphabet…</Note>;
  const props = { view, byId, act, serverNow, accent };
  return (
    <div className="@container mx-auto flex w-full max-w-4xl flex-col gap-3 pb-20 lg:pb-4">
      <style href="ruckus-letters" precedence="medium">
        {LETTERS_CSS}
      </style>
      {view.phase === "answer" && <AnswerPhase key={view.round} {...props} />}
      {view.phase === "review" && <ReviewPhase {...props} />}
      {view.phase === "results" && <ResultsPhase {...props} />}
      {view.phase === "final" && (
        <>
          <p className="sr-only" aria-live="polite">
            Game over. Final standings.
          </p>
          <FinalStandings view={view} byId={byId} accent={accent} />
        </>
      )}
    </div>
  );
}

// ---------- shared chrome ----------

/** Sticky strip with the letter, the clock and the phase's main button, so they stay in reach while scrolling. */
function Hud({ view, accent, serverNow, children }: PhaseProps & { children?: ReactNode }) {
  const secs = useSecondsLeft(view.endsAt, serverNow);
  const urgent = view.phase === "answer" && view.endsAt !== null && secs <= 10;
  const label = view.phase === "answer" ? "Answer" : view.phase === "review" ? "Review" : view.waiting ? "Paused" : "Results";
  return (
    <div className="sticky top-0 z-20 -mx-1 bg-ink/85 px-1 py-1 backdrop-blur-md">
      <div className="card flex items-center gap-3 p-2.5" style={{ borderColor: `${accent}59` }}>
        <LetterTile letter={view.letter} spin={view.phase === "answer"} spinKey={view.round} accent={accent} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[11px] font-bold tracking-widest text-muted uppercase">
              <span className="hidden @lg:inline">{label} · </span>
              <span className="hidden @sm:inline">Round </span>
              <span className="sr-only @sm:hidden">Round </span>
              {view.round}/{view.rounds}
            </span>
            <span
              className={`font-mono text-lg leading-none font-bold tabular-nums ${urgent ? "text-red-400 motion-safe:animate-pulse" : ""}`}
            >
              {clock(secs)}
            </span>
          </div>
          <div className="mt-2">
            <TimerBar endsAt={view.endsAt} total={view.phaseMs} serverNow={serverNow} color={urgent ? "#f87171" : accent} />
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function Banner({ id, accent, children }: { id: string; accent: string; children: ReactNode }) {
  return (
    <div aria-live="polite" aria-atomic="true">
      <StatusBanner key={id} accent={accent}>
        <span className="block text-balance">{children}</span>
      </StatusBanner>
    </div>
  );
}

/** Names of the other online players still holding things up. */
function pendingNames(view: LettersView, byId: Record<string, Player>, settled: (k: number) => boolean): string[] {
  return view.order.flatMap((id, k) =>
    k !== view.you && byId[id]?.connected && !settled(k) ? [playerOf(byId, id).name] : [],
  );
}

function PlayerStrip({
  view,
  byId,
  serverNow,
  extra,
}: Pick<PhaseProps, "view" | "byId" | "serverNow"> & { extra?: (k: number) => ReactNode }) {
  const now = useNow(serverNow, 500);
  return (
    <ul className="flex flex-wrap justify-center gap-1.5" aria-label="Players">
      {view.order.map((id, k) => {
        const p = playerOf(byId, id);
        const st = view.status[k];
        const settled = !!(view.phase === "answer" ? st?.done : st?.ready);
        const typing = !!st && st.activeAt > 0 && now - st.activeAt < TYPING_MS;
        let icon: string;
        let label: string;
        if (!p.connected) [icon, label] = ["💤", "offline"];
        else if (view.phase === "answer") [icon, label] = settled ? ["✓", "done"] : typing ? ["✍️", "typing…"] : ["💭", "thinking"];
        else [icon, label] = settled ? ["✓", "ready"] : ["👀", "reviewing"];
        return (
          <li key={id} className={settled ? "rounded-full ring-1 ring-green-400/60" : undefined}>
            <PlayerChip player={p} size="sm" dim={!p.connected}>
              <span key={label} className="animate-pop inline-flex items-center gap-1 text-[11px] font-medium text-muted">
                <span aria-hidden className={`${settled ? "font-black text-green-300" : ""} ${typing && !settled ? "motion-safe:animate-pulse" : ""}`}>
                  {icon}
                </span>
                <span className="sr-only @lg:not-sr-only">{label}</span>
              </span>
              {extra?.(k)}
            </PlayerChip>
          </li>
        );
      })}
    </ul>
  );
}

const Letter = ({ letter, accent }: { letter: string; accent: string }) => (
  <span className="font-black" style={{ color: accent }}>
    {letter}
  </span>
);

function CategoryNumber({ i }: { i: number }) {
  return (
    <span
      aria-hidden
      className="mt-px grid size-5 shrink-0 place-items-center rounded-md bg-panel-2 text-[11px] font-bold text-muted"
    >
      {i + 1}
    </span>
  );
}

// ---------- answer phase ----------

function AnswerPhase(props: PhaseProps) {
  const { view, byId, act, serverNow, accent } = props;
  const doneId = useId();
  const you = view.you;
  const playing = you >= 0;
  const done = playing && !!view.status[you]?.done;

  // Local drafts win over the server copy while typing; the server copy fills in after a reload.
  const [drafts, setDrafts] = useState<(string | null)[]>(() => view.categories.map(() => null));
  const latest = useRef<(string | undefined)[]>([]);
  const sent = useRef<string[]>(view.mine?.slice() ?? []);
  const timers = useRef<(ReturnType<typeof setTimeout> | undefined)[]>([]);

  const send = useCallback(
    (i: number) => {
      clearTimeout(timers.current[i]);
      timers.current[i] = undefined;
      const text = latest.current[i];
      if (text === undefined || text === sent.current[i]) return;
      sent.current[i] = text;
      act({ type: "answer", i, text });
    },
    [act],
  );

  const flushAll = useCallback(() => {
    for (let i = 0; i < CATEGORIES_PER_ROUND; i++) if (timers.current[i] !== undefined) send(i);
  }, [send]);

  // Get half-typed answers in just before the buzzer. Polled (not one long timeout) so a
  // corrected server clock can't make us miss the window.
  useEffect(() => {
    const endsAt = view.endsAt;
    if (endsAt === null) return;
    const id = setInterval(() => {
      if (endsAt - serverNow() < FLUSH_BEFORE_MS) flushAll();
    }, 200);
    return () => clearInterval(id);
  }, [view.endsAt, serverNow, flushAll]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => clearTimeout(t));
  }, []);

  const edit = (i: number, text: string) => {
    setDrafts((d) => d.map((v, j) => (j === i ? text : v)));
    latest.current[i] = text;
    clearTimeout(timers.current[i]);
    timers.current[i] = setTimeout(() => send(i), DEBOUNCE_MS);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    const inputs = Array.from(e.currentTarget.form?.querySelectorAll("input") ?? []);
    const next = inputs[inputs.indexOf(e.currentTarget) + 1];
    if (next) next.focus();
    else document.getElementById(doneId)?.focus();
  };

  const values = view.categories.map((_, i) => drafts[i] ?? view.mine?.[i] ?? "");
  const good = values.filter((v) => autoVerdict(v, view.letter) === "ok").length;
  const waiting = pendingNames(view, byId, (k) => !!view.status[k]?.done);
  const L = <Letter letter={view.letter} accent={accent} />;

  let status: ReactNode;
  if (!playing) status = <>Everyone&apos;s hunting for {L} words…</>;
  else if (!done) status = <>Six answers, all starting with&nbsp;{L}</>;
  else if (waiting.length) status = <>Done! Waiting for {waitList(waiting)}…</>;
  else status = <>All done!</>;

  return (
    <>
      <Hud {...props}>
        {playing && (
          <button
            id={doneId}
            type="button"
            aria-pressed={done}
            onClick={() => {
              if (done) act({ type: "undone" });
              else {
                flushAll();
                act({ type: "done" });
              }
            }}
            className={`btn shrink-0 px-3.5 ${done ? "border-green-400/60 bg-green-400/15 text-green-200" : "btn-primary"}`}
          >
            {done ? (
              "✓ Done"
            ) : (
              <>
                Done{" "}
                <span className="font-mono text-xs opacity-70">
                  {good}/{view.categories.length}
                  <span className="sr-only"> answers ready</span>
                </span>
              </>
            )}
          </button>
        )}
      </Hud>
      <Banner id={`answer-${view.round}-${done}`} accent={accent}>
        {status}
      </Banner>
      <PlayerStrip view={view} byId={byId} serverNow={serverNow} />

      {playing ? (
        <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-2" aria-label={`Answers for letter ${view.letter}`}>
          {done && <Note>Locked in. Tap ✓ Done again to make changes.</Note>}
          <div className="grid gap-2.5 @xl:grid-cols-2">
            {view.categories.map((category, i) => (
              <AnswerField
                key={i}
                index={i}
                category={category}
                letter={view.letter}
                value={values[i]}
                locked={done}
                last={i === view.categories.length - 1}
                onChange={(text) => edit(i, text)}
                onCommit={() => send(i)}
                onKeyDown={onKeyDown}
              />
            ))}
          </div>
        </form>
      ) : (
        <>
          <Note>You&apos;re watching. Answers stay secret until review.</Note>
          <ol className="grid gap-2 @xl:grid-cols-2">
            {view.categories.map((category, i) => (
              <li key={i} className="card flex items-start gap-2 p-3 text-sm font-semibold">
                <CategoryNumber i={i} />
                <span className="flex-1">{category}</span>
                <span aria-hidden>🤫</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}

function AnswerField({
  index,
  category,
  letter,
  value,
  locked,
  last,
  onChange,
  onCommit,
  onKeyDown,
}: {
  index: number;
  category: string;
  letter: string;
  value: string;
  locked: boolean;
  last: boolean;
  onChange: (text: string) => void;
  onCommit: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const typed = value.trim().length > 0;
  const verdict = typed ? autoVerdict(value, letter) : "blank";
  const article = verdict === "ok" ? splitArticle(value).article : null;
  const tone = verdict === "ok" ? "ok" : typed ? "warn" : "idle";
  const hint =
    verdict === "ok"
      ? article
        ? `✓ ${letter} (“${article[0].toUpperCase()}${article.slice(1)}” ignored)`
        : `✓ Starts with ${letter}`
      : verdict === "letter"
        ? `✗ Must start with ${letter}`
        : verdict === "short"
          ? "✗ Too short"
          : null;

  return (
    <div
      className={`card flex flex-col gap-1.5 p-2.5 transition-colors ${
        tone === "ok" ? "border-green-400/35" : tone === "warn" ? "border-amber-400/45" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <CategoryNumber i={index} />
        <label htmlFor={id} className="min-w-0 flex-1 text-sm leading-snug font-semibold">
          {category}
        </label>
        <span
          id={hintId}
          className={`max-w-[55%] shrink-0 text-right text-xs leading-snug font-semibold ${
            tone === "ok" ? "text-green-300" : "text-amber-300"
          }`}
        >
          {hint ? (
            <span key={hint} className="animate-pop inline-block">
              {hint}
            </span>
          ) : (
            <span className="sr-only">Must start with {letter}</span>
          )}
        </span>
      </div>
      <input
        id={id}
        className={`input text-base transition-opacity ${locked ? "opacity-60" : ""} ${
          tone === "ok"
            ? "border-green-400/60 focus:border-green-400"
            : tone === "warn"
              ? "border-amber-400/70 focus:border-amber-400"
              : ""
        }`}
        value={value}
        maxLength={MAX_ANSWER}
        placeholder={`${letter}…`}
        autoComplete="off"
        enterKeyHint={last ? "done" : "next"}
        readOnly={locked}
        aria-describedby={hintId}
        aria-invalid={tone === "warn"}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

// ---------- review phase ----------

function ReviewPhase(props: PhaseProps) {
  const { view, byId, act, serverNow, accent } = props;
  const you = view.you;
  const playing = you >= 0;
  const ready = playing && !!view.status[you]?.ready;
  const board = view.board ?? [];
  const projected = view.order.map((_, k) => board.reduce((sum, row) => sum + (row[k]?.points ?? 0), 0));
  const waiting = pendingNames(view, byId, (k) => !!view.status[k]?.ready);

  let status: ReactNode;
  if (!playing) status = <>Players are checking answers</>;
  else if (!ready) status = <>Veto bad answers, then tap Looks good</>;
  else if (waiting.length) status = <>Waiting for {waitList(waiting)} to finish reviewing…</>;
  else status = <>Tallying up…</>;

  return (
    <>
      <Hud {...props}>
        {playing && (
          <button
            type="button"
            aria-pressed={ready}
            onClick={() => act({ type: ready ? "unready" : "ready" })}
            className={`btn shrink-0 px-3.5 ${ready ? "border-green-400/60 bg-green-400/15 text-green-200" : "btn-primary"}`}
          >
            {ready ? "✓ Looks good" : "Looks good"}
          </button>
        )}
      </Hud>
      <Banner id={`review-${view.round}-${ready}`} accent={accent}>
        {status}
      </Banner>
      <PlayerStrip
        view={view}
        byId={byId}
        serverNow={serverNow}
        extra={(k) => (
          <span className="font-mono text-[11px] font-bold tabular-nums" style={{ color: accent }}>
            +{projected[k]}
          </span>
        )}
      />
      <Note>
        {playing ? "Tap 👎 on answers that don't fit. " : "You're watching. "}
        Unique answers score 10, shared ones 5.
      </Note>
      <Board
        categories={view.categories}
        rows={board}
        order={view.order}
        you={you}
        byId={byId}
        letter={view.letter}
        accent={accent}
        onVeto={playing ? (k, i) => act({ type: "veto", player: view.order[k], i }) : undefined}
      />
    </>
  );
}

// ---------- results phase ----------

function ResultsPhase(props: PhaseProps) {
  const { view, byId, accent } = props;
  const last = view.round >= view.rounds;
  let status: ReactNode;
  if (view.waiting) status = <>Waiting for players to reconnect…</>;
  else status = last ? <>Final round scored!</> : <>Round {view.round} scored!</>;
  return (
    <>
      <Hud {...props} />
      <Banner id={`results-${view.round}-${view.waiting}`} accent={accent}>
        {status}
      </Banner>
      <Note>
        {view.waiting
          ? "Letter Rush needs two players online. If nobody's back soon, the game ends here."
          : last
            ? "Final standings coming up…"
            : `Round ${view.round + 1} of ${view.rounds} starts when the bar runs out.`}
      </Note>
      <RoundResults view={view} byId={byId} accent={accent} />
    </>
  );
}

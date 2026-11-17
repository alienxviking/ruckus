"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { Note, PlayerChip, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import { feedback } from "@/lib/feedback";
import type { LockState, MmAction, MmView } from "./server";
import { MAX_WORD, bestRound, checkWord, isMmEvent, meldWord, rating, type RoundRecord } from "./shared";
import {
  Confetti,
  FlipCard,
  cardLayout,
  Journey,
  MmStyles,
  RatingLadder,
  SyncBadge,
  SyncMeter,
  WordRow,
  joinNames,
  revealTiming,
  stagger,
  type Who,
} from "./ui";

type Props = GameClientProps<MmView, MmAction>;

/** An unlocked but valid first word is sent this long before the writing deadline. */
const AUTO_LOCK_LEAD_MS = 700;

export default function MindMeld(props: Props) {
  if (!props.view) {
    return <div className="grid min-h-40 place-items-center text-sm text-muted">Syncing minds…</div>;
  }
  return <Game {...props} view={props.view} />;
}

function Game({ view, players, byId, isPlayer, act, serverNow, onEvent, accent }: Props & { view: MmView }) {
  const who: Who = (id) =>
    byId[id] ??
    players.find((p) => p.id === id) ?? { id, name: "Someone", color: "#a39dc8", avatar: "🙂", connected: false };
  const last: RoundRecord | null = view.history[view.history.length - 1] ?? null;
  const over = view.phase === "melded" || view.phase === "failed";
  const paused = view.phase === "writing" && view.pausedLeft !== null;
  const meLocked = !!view.me?.locked;

  // Every writing round is everyone's turn: chime once as a new one opens.
  const task = isPlayer && view.phase === "writing" ? view.round : -1;
  const lastTask = useRef(-1);
  useEffect(() => {
    if (task >= 0 && task !== lastTask.current) feedback("turn");
    lastTask.current = task;
  }, [task]);

  return (
    <div className="@container relative mx-auto flex w-full max-w-2xl flex-col gap-3 pb-20 lg:pb-2">
      <MmStyles />
      <RoundTrack view={view} accent={accent} serverNow={serverNow} />

      {!over && (
        <div aria-live="polite">
          <StatusBanner key={`${view.phase}-${view.round}-${meLocked}-${paused}`} accent={accent}>
            <Status view={view} isPlayer={isPlayer} who={who} paused={paused} />
          </StatusBanner>
        </div>
      )}

      {!over && !paused && (
        <TimerBar endsAt={view.endsAt} total={view.phaseMs} serverNow={serverNow} color={accent} />
      )}

      {/* One keyed wrapper per phase + round: it animates in on a phase change and
          never remounts on ordinary view updates, so typing keeps its focus and caret. */}
      <div key={`${view.phase}-${view.round}`} className="mm-enter flex flex-col gap-3">
        {paused && <PausedCard view={view} who={who} serverNow={serverNow} />}
        {view.phase === "writing" && (
          <Writing
            view={view}
            isPlayer={isPlayer}
            who={who}
            act={act}
            onEvent={onEvent}
            serverNow={serverNow}
            accent={accent}
            last={last}
          />
        )}
        {view.phase === "reveal" && last && (
          <Reveal
            record={last}
            who={who}
            accent={accent}
            final={view.round >= view.maxRounds}
            endsAt={view.endsAt}
            phaseMs={view.phaseMs}
            serverNow={serverNow}
          />
        )}
        {view.phase === "melded" && last && (
          <Melded record={last} accent={accent} colors={[accent, ...players.map((p) => p.color)]} />
        )}
        {view.phase === "failed" && <Failed view={view} who={who} accent={accent} />}

        {!isPlayer && view.phase === "writing" && (
          <Note>👀 You&apos;re watching. Words stay secret until the reveal.</Note>
        )}
      </div>

      {over ? (
        <Journey rounds={view.history} who={who} accent={accent} title="Your journey" />
      ) : (
        <Journey rounds={view.history.slice(0, -1)} who={who} accent={accent} title="Earlier rounds" />
      )}
    </div>
  );
}

// ---------- header ----------

function RoundTrack({ view, accent, serverNow }: { view: MmView; accent: string; serverNow: () => number }) {
  const secs = useSecondsLeft(view.endsAt, serverNow);
  const over = view.phase === "melded" || view.phase === "failed";
  const urgent = view.phase === "writing" && view.endsAt !== null && secs <= 10;
  const finalRound = view.round >= view.maxRounds;
  return (
    <div className="flex items-center justify-between gap-3 px-1">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="font-display text-base font-bold whitespace-nowrap">
          Round {view.round}
          <span className="text-muted">/{view.maxRounds}</span>
        </span>
        <ol className="flex items-center gap-1" aria-label="Round progress">
          {Array.from({ length: view.maxRounds }, (_, i) => {
            const r = view.history[i];
            const current = !r && i + 1 === view.round && !over;
            const strength = r ? (r.total > 0 ? r.sync / r.total : 0) : 0;
            return (
              <li
                key={i}
                className={`size-3 rounded-full border transition-[background-color,border-color,transform] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] ${current ? "motion-safe:animate-pulse" : ""}`}
                style={
                  r
                    ? {
                        borderColor: accent,
                        background: r.melded ? accent : `color-mix(in oklab, ${accent} ${Math.round(20 + strength * 60)}%, transparent)`,
                        transform: r.melded ? "scale(1.35)" : undefined,
                      }
                    : current
                      ? { borderColor: accent, borderWidth: 2 }
                      : { borderColor: "var(--color-line)" }
                }
              >
                <span className="sr-only">
                  {r
                    ? `Round ${r.round}: ${r.sync} of ${r.total} in sync${r.melded ? ", melded" : ""}`
                    : current
                      ? `Round ${i + 1}: now`
                      : `Round ${i + 1}: to come`}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      {!over && (
        <span
          className={`shrink-0 font-mono text-sm font-bold whitespace-nowrap tabular-nums ${urgent ? "text-brand motion-safe:animate-pulse" : "text-muted"}`}
        >
          {view.endsAt === null ? (
            <>
              <span aria-hidden>⏸ </span>paused
            </>
          ) : view.phase === "reveal" ? (
            <>
              {finalRound ? "Results" : `R${view.round + 1}`} in {secs}s
            </>
          ) : (
            <>
              <span aria-hidden>⏱ </span>
              {secs}s<span className="sr-only"> left</span>
            </>
          )}
        </span>
      )}
    </div>
  );
}

function namesList(names: string[]): string {
  if (names.length <= 2) return joinNames(names);
  return `${names.length} players`;
}

function Status({ view, isPlayer, who, paused }: { view: MmView; isPlayer: boolean; who: Who; paused: boolean }) {
  if (view.phase === "reveal") {
    const r = view.history[view.history.length - 1];
    return (
      <>
        <span aria-hidden>🥁 </span>Round {view.round} reveal
        {r && <span className="sr-only">: {r.melded ? "Mind Meld! Every word matches." : `${r.sync} of ${r.total} in sync.`}</span>}
      </>
    );
  }
  if (paused) {
    return (
      <>
        <span aria-hidden>⏸ </span>Round paused
        <span className="sr-only">: waiting for players to reconnect</span>
      </>
    );
  }
  const finalRound = view.round === view.maxRounds;
  if (isPlayer && view.me?.locked) {
    const waiting = view.locks
      .filter((l) => l.state !== "locked" && who(l.id).connected)
      .map((l) => who(l.id).name);
    return (
      <>
        <span aria-hidden>🔒 </span>Locked in!
        <span className="mt-0.5 block font-sans text-sm font-medium text-muted">
          {waiting.length ? `Waiting for ${namesList(waiting)}…` : "Revealing…"}
        </span>
      </>
    );
  }
  if (view.round === 1) {
    return isPlayer ? (
      <>
        <span aria-hidden>💭 </span>Think of any word
      </>
    ) : (
      <>
        <span aria-hidden>💭 </span>Minds at work…
      </>
    );
  }
  const lead = finalRound ? "Last round! " : "";
  return isPlayer ? (
    <>
      <span aria-hidden>🔗 </span>
      {lead}What links these words?
    </>
  ) : (
    <>
      <span aria-hidden>🔗 </span>
      {lead}Hunting for the link…
    </>
  );
}

function PausedCard({ view, who, serverNow }: { view: MmView; who: Who; serverNow: () => number }) {
  const secs = useSecondsLeft(view.waitUntil, serverNow);
  const away = view.locks.filter((l) => !who(l.id).connected).map((l) => who(l.id).name);
  return (
    <div className="card mm-swap flex items-center gap-3 border-brand/50 p-3 text-sm">
      <span className="text-2xl leading-none" aria-hidden>
        ⏳
      </span>
      <p>
        A meld needs at least two minds online
        {away.length ? <>. Waiting for {namesList(away)} to reconnect</> : null}. The game ends in{" "}
        <b className="tabular-nums">{secs}s</b> if nobody comes back.
      </p>
    </div>
  );
}

// ---------- writing ----------

function Writing({
  view,
  isPlayer,
  who,
  act,
  onEvent,
  serverNow,
  accent,
  last,
}: {
  view: MmView;
  isPlayer: boolean;
  who: Who;
  act: (a: MmAction) => void;
  onEvent: Props["onEvent"];
  serverNow: () => number;
  accent: string;
  last: RoundRecord | null;
}) {
  const me = view.me;
  return (
    <>
      {last ? <Clue record={last} who={who} accent={accent} /> : <FirstRound accent={accent} />}
      {isPlayer && me && (
        <>
          {me.locked && me.word ? (
            <LockedIn word={me.word} accent={accent} onChange={() => act({ type: "unlock" })} />
          ) : (
            <WordForm
              key={view.round}
              initial={me.word ?? ""}
              history={view.history}
              round={view.round}
              endsAt={view.endsAt}
              serverNow={serverNow}
              act={act}
              onEvent={onEvent}
              accent={accent}
            />
          )}
        </>
      )}
      <LockList locks={view.locks} who={who} />
    </>
  );
}

function FirstRound({ accent }: { accent: string }) {
  return (
    <section className="card flex items-center gap-3 p-3 text-sm @sm:p-4" style={{ borderColor: accent + "44" }}>
      <span className="text-3xl" aria-hidden>
        🧠
      </span>
      <p className="text-muted">
        <b className="text-text">Any word goes.</b> Next round, everyone hunts for the one word that links them
        all. When every word matches, you&apos;ve melded!
      </p>
    </section>
  );
}

function Clue({ record, who, accent }: { record: RoundRecord; who: Who; accent: string }) {
  const anyWords = record.entries.some((e) => e.word !== null);
  return (
    <section
      className="card p-3 @sm:p-4"
      aria-label={`Round ${record.round} words`}
      style={{
        borderColor: accent + "55",
        background: `linear-gradient(160deg, ${accent}17, transparent 65%), var(--color-panel)`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="label">Round {record.round} words</h3>
        <SyncBadge record={record} accent={accent} />
      </div>
      {anyWords ? (
        <WordRow
          record={record}
          who={who}
          accent={accent}
          size={record.entries.length > 6 ? "md" : "lg"}
          className={`mt-3 mb-1 items-center justify-center ${record.entries.length > 6 ? "gap-1.5" : "gap-2"}`}
        />
      ) : (
        <p className="mt-3 text-center text-sm text-muted">Nobody wrote anything last round. Any new word goes!</p>
      )}
    </section>
  );
}

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}

function WordForm({
  initial,
  history,
  round,
  endsAt,
  serverNow,
  act,
  onEvent,
  accent,
}: {
  /** The word already on the server (still counts while editing), or "". */
  initial: string;
  history: RoundRecord[];
  round: number;
  endsAt: number | null;
  serverNow: () => number;
  act: (a: MmAction) => void;
  onEvent: Props["onEvent"];
  accent: string;
}) {
  // The draft is local: incoming views never overwrite it.
  const [draft, setDraft] = useState(initial);
  const [serverError, setServerError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const secs = useSecondsLeft(endsAt, serverNow);
  const check = checkWord(draft, history);
  const hint = draft.trim() === "" ? null : check.ok ? null : check.msg;
  const problem = serverError ?? hint;
  const closing = endsAt !== null && secs <= 10;

  // Latest values for the deadline timer, without re-arming it on every keystroke.
  const latest = useRef({ draft, history, act });
  useEffect(() => {
    latest.current = { draft, history, act };
  });

  // Private rejections from the server (e.g. a word that was already played).
  useEffect(
    () =>
      onEvent((e) => {
        if (isMmEvent(e)) setServerError(e.msg);
      }),
    [onEvent],
  );

  // Typed a good first word but never pressed Lock in? Send it just before time
  // runs out: a blank can never meld. (An existing word is left alone: it counts.)
  // Polled against serverNow (not one long timeout) so clock corrections can't make it miss.
  useEffect(() => {
    if (endsAt === null || initial) return;
    let sent = false;
    const id = setInterval(() => {
      if (sent || endsAt - serverNow() > AUTO_LOCK_LEAD_MS) return;
      const { draft: d, history: h, act: send } = latest.current;
      const c = checkWord(d, h);
      if (!c.ok) return;
      sent = true;
      send({ type: "submit", word: c.word });
    }, 200);
    return () => clearInterval(id);
  }, [endsAt, initial, serverNow]);

  // Ready to type: focus the box when nothing else (like the chat) has focus,
  // and let a letter typed anywhere on the page land in it.
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) inputRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1 || !/\p{L}/u.test(e.key) || isEditable(e.target)) return;
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const c = checkWord(draft, history);
    if (!c.ok) {
      setServerError(c.msg);
      feedback("error");
      return;
    }
    setServerError(null);
    act({ type: "submit", word: c.word });
  };

  let note: ReactNode;
  if (initial && draft.trim() === initial) note = `“${initial}” still counts if time runs out. Enter to lock it again.`;
  else if (initial && !draft.trim()) note = `“${initial}” still counts unless you lock in a new word.`;
  else if (initial) note = `Enter to lock in · ${MAX_WORD - draft.length} characters left`;
  else if (closing && check.ok) note = <b className="text-text">⏳ Time&apos;s nearly up: this word locks in by itself.</b>;
  else if (closing) note = <b className="text-brand">⏳ Hurry! A blank can&apos;t meld.</b>;
  else if (draft.trim()) note = `Enter to lock in · ${MAX_WORD - draft.length} characters left`;
  else note = "You can change it until the reveal.";

  return (
    <form
      onSubmit={submit}
      className={`card p-3 @sm:p-4 ${initial ? "mm-swap" : ""}`}
      style={{ borderColor: accent + "66" }}
      noValidate
    >
      <label htmlFor={id} className="label">
        Your word
      </label>
      <div className="mt-2 flex flex-col gap-2 @lg:flex-row">
        <input
          id={id}
          ref={inputRef}
          className="input min-w-0 flex-1 font-display text-2xl font-bold"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setServerError(null);
          }}
          maxLength={MAX_WORD}
          placeholder={round === 1 ? "Any word…" : "The link…"}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          aria-invalid={problem ? true : undefined}
          aria-describedby={`${id}-hint`}
        />
        <button
          type="submit"
          className={`btn min-h-12 px-6 text-lg ${check.ok ? "btn-primary" : ""}`}
          disabled={!check.ok}
        >
          Lock in <span aria-hidden>🔒</span>
        </button>
      </div>
      <p id={`${id}-hint`} className="mt-2 min-h-5 text-sm">
        {/* Only problems are announced; the character counter would be noise. */}
        <span className="font-semibold text-brand" aria-live="polite">
          {problem}
        </span>
        {!problem && <span className="text-muted">{note}</span>}
      </p>
    </form>
  );
}

function LockedIn({ word, accent, onChange }: { word: string; accent: string; onChange: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  // Locking in removes the focused input; keep keyboard users on the card.
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) btn.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      className="card mm-lock flex items-center gap-3 p-3 @sm:p-4"
      style={{
        borderColor: accent + "99",
        background: `linear-gradient(135deg, ${accent}22, transparent 70%), var(--color-panel)`,
      }}
    >
      <span className="text-3xl" aria-hidden>
        🔒
      </span>
      <div className="min-w-0 flex-1">
        <div className="label">Your word</div>
        <div className="font-display text-2xl leading-tight font-extrabold break-words">{word}</div>
      </div>
      <button ref={btn} type="button" className="btn min-h-11 shrink-0" onClick={onChange} aria-label="Change your word">
        <span aria-hidden>✎</span> Change
      </button>
    </div>
  );
}

const LOCK_UI: Record<LockState | "offline", { icon: string; text: string; color?: string }> = {
  locked: { icon: "✓", text: "locked in", color: "#4ade80" },
  editing: { icon: "✎", text: "changing their word" },
  thinking: { icon: "💭", text: "thinking" },
  offline: { icon: "⏸", text: "offline" },
};

function LockList({ locks, who }: { locks: MmView["locks"]; who: Who }) {
  const done = locks.filter((l) => l.state === "locked").length;
  return (
    <section className="card p-3" aria-label="Who has locked in">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="label">Locked in</span>
        <span className="font-mono text-sm font-bold tabular-nums">
          {done}/{locks.length}
        </span>
      </div>
      <div className="mb-2 h-1 overflow-hidden rounded-full bg-panel-2" aria-hidden>
        <div
          className="h-full w-full origin-left rounded-full bg-[#4ade80] transition-transform duration-300 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none"
          style={{ transform: `scaleX(${locks.length ? done / locks.length : 0})` }}
        />
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {locks.map((l) => {
          const p: Player = who(l.id);
          const ui = LOCK_UI[p.connected ? l.state : "offline"];
          return (
            <li key={l.id}>
              <PlayerChip player={p} size="sm" dim={!p.connected}>
                <span
                  key={ui.text}
                  className={`animate-pop font-bold ${l.state === "thinking" && p.connected ? "motion-safe:animate-pulse" : ""}`}
                  style={{ color: ui.color }}
                  aria-hidden
                >
                  {ui.icon}
                </span>
                <span className="sr-only">{ui.text}</span>
              </PlayerChip>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------- reveal ----------

function Reveal({
  record,
  who,
  accent,
  final,
  endsAt,
  phaseMs,
  serverNow,
}: {
  record: RoundRecord;
  who: Who;
  accent: string;
  final: boolean;
  endsAt: number | null;
  phaseMs: number;
  serverNow: () => number;
}) {
  // How far into the reveal we are when this mounts: ~0 normally, more after a
  // reload or late join, so the flips resume at the right moment instead of
  // replaying. Read once; later view updates must not shift the animation.
  const [offset] = useState(() => {
    if (endsAt === null) return 0;
    const t = serverNow() - (endsAt - phaseMs);
    return t > 250 ? Math.min(t, phaseMs) : 0;
  });
  const n = record.entries.length;
  const t = revealTiming(n);
  const layout = cardLayout(n);
  const grouped = record.sync >= 2;
  return (
    <section className="flex flex-col gap-3" aria-label={`Round ${record.round} words`}>
      <SyncMeter record={record} accent={accent} delay={t.flipDone - offset} final={final} />
      <ul className="flex flex-wrap justify-center gap-2">
        {record.entries.map((e, i) => (
          <FlipCard
            key={`${record.round}-${e.id}`}
            entry={e}
            player={who(e.id)}
            deal={i * t.deal - offset}
            flip={t.first + i * t.stagger - offset}
            snap={t.flipDone - offset}
            highlight={grouped && e.group === 0}
            dim={grouped && !record.melded && e.group === -1}
            accent={accent}
            layout={layout}
          />
        ))}
      </ul>
    </section>
  );
}

// ---------- the end ----------

function Melded({ record, accent, colors }: { record: RoundRecord; accent: string; colors: string[] }) {
  const rounds = record.round;
  return (
    <section
      className="card relative overflow-hidden px-4 py-6 text-center"
      style={{
        borderColor: accent,
        background: `radial-gradient(120% 90% at 50% 0%, ${accent}38, transparent 70%), var(--color-panel)`,
      }}
    >
      <Confetti colors={colors} />
      <div className="relative">
        <div className="mm-count inline-block" style={stagger(0, 0)}>
          <div className="mm-float text-5xl" aria-hidden>
            🧠
          </div>
        </div>
        <p className="label mm-appear mt-2" style={stagger(1)}>
          Everyone said
        </p>
        <p
          className="mm-stamp font-display text-4xl font-extrabold break-words"
          style={{ color: accent, textShadow: "0 2px 18px rgb(0 0 0 / 0.45)", ...stagger(2) }}
        >
          “{meldWord(record)}”
        </p>
        <p className="mm-appear mt-1 text-sm text-muted" style={stagger(3)}>
          Melded in {rounds} round{rounds === 1 ? "" : "s"}
        </p>
        <Badge accent={accent} delay={4}>
          {rating(rounds)}
        </Badge>
        <RatingLadder rounds={rounds} accent={accent} delay={120 + 5 * 110} />
      </div>
    </section>
  );
}

function Badge({ accent, delay, children }: { accent: string; delay: number; children: ReactNode }) {
  return (
    <p
      className="mm-count mt-3 inline-block rounded-full px-4 py-1.5 font-display text-lg font-extrabold"
      style={{ background: accent, color: "#1a0f14", ...stagger(delay) }}
    >
      {children}
    </p>
  );
}

function Failed({ view, who, accent }: { view: MmView; who: Who; accent: string }) {
  const best = bestRound(view.history);
  const dropped = view.reason === "players";
  return (
    <section className="card px-4 py-6 text-center">
      <div className="text-5xl" aria-hidden>
        {dropped ? "💤" : "😅"}
      </div>
      <h3 className="mt-2 font-display text-2xl font-extrabold">
        {dropped ? "The meld fizzled out" : "No meld this time"}
      </h3>
      <p className="mt-1 text-sm text-muted">
        {dropped
          ? "Too many players dropped out to keep going."
          : `${view.maxRounds} rounds and the minds never quite lined up.`}
      </p>
      {best && best.sync >= 2 && (
        <div className="mm-appear mt-4 rounded-xl bg-panel-2/60 p-3" style={stagger(1, 200)}>
          <p className="text-sm">
            Closest: <b>round {best.round}</b>, {best.sync} of {best.total} in sync
          </p>
          <WordRow record={best} who={who} accent={accent} className="mt-2 justify-center gap-1" />
        </div>
      )}
      <p className="mt-3 text-sm text-muted">Your brains are warmed up now. Another go?</p>
    </section>
  );
}

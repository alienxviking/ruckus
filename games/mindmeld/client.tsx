"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { Note, PlayerChip, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
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
  WordChip,
  revealTiming,
  type Who,
} from "./ui";

type Props = GameClientProps<MmView, MmAction>;

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
      {paused && <PausedCard view={view} who={who} serverNow={serverNow} />}

      {view.phase === "writing" && (
        <Writing view={view} isPlayer={isPlayer} who={who} act={act} onEvent={onEvent} accent={accent} last={last} />
      )}
      {view.phase === "reveal" && last && (
        <Reveal record={last} who={who} accent={accent} final={view.round >= view.maxRounds} />
      )}
      {view.phase === "melded" && last && (
        <Melded record={last} accent={accent} colors={[accent, ...players.map((p) => p.color)]} />
      )}
      {view.phase === "failed" && <Failed view={view} />}

      {!isPlayer && view.phase === "writing" && (
        <Note>👀 You&apos;re watching. Words stay secret until the reveal.</Note>
      )}

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
                className={`size-3 rounded-full border transition-colors ${current ? "motion-safe:animate-pulse" : ""}`}
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
          className={`shrink-0 font-mono text-sm font-bold tabular-nums ${urgent ? "text-brand motion-safe:animate-pulse" : "text-muted"}`}
        >
          {view.endsAt === null ? (
            <>
              <span aria-hidden>⏸ </span>paused
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
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.length} players`;
}

function Status({ view, isPlayer, who, paused }: { view: MmView; isPlayer: boolean; who: Who; paused: boolean }) {
  if (view.phase === "reveal") {
    const r = view.history[view.history.length - 1];
    return (
      <>
        <span aria-hidden>👀 </span>Round {view.round} reveal
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
    <div className="card animate-rise flex items-center gap-3 border-brand/50 p-3 text-sm">
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
  accent,
  last,
}: {
  view: MmView;
  isPlayer: boolean;
  who: Who;
  act: (a: MmAction) => void;
  onEvent: Props["onEvent"];
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
    <section
      className="card animate-rise flex items-center gap-3 p-3 text-sm @sm:p-4"
      style={{ borderColor: accent + "44" }}
    >
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
      className="card animate-rise p-3 @sm:p-4"
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
        <ul
          className={`mt-3 mb-1 flex flex-wrap items-center justify-center ${record.entries.length > 6 ? "gap-1.5" : "gap-2"}`}
        >
          {record.entries.map((e) => (
            <WordChip key={e.id} entry={e} player={who(e.id)} size={record.entries.length > 6 ? "md" : "lg"} />
          ))}
        </ul>
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
  act,
  onEvent,
  accent,
}: {
  initial: string;
  history: RoundRecord[];
  round: number;
  act: (a: MmAction) => void;
  onEvent: Props["onEvent"];
  accent: string;
}) {
  const [draft, setDraft] = useState(initial);
  const [serverError, setServerError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const check = checkWord(draft, history);
  const hint = draft.trim() === "" ? null : check.ok ? null : check.msg;
  const problem = serverError ?? hint;

  // Private rejections from the server (e.g. a word that was already played).
  useEffect(
    () =>
      onEvent((e) => {
        if (isMmEvent(e)) setServerError(e.msg);
      }),
    [onEvent],
  );

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
      return;
    }
    setServerError(null);
    act({ type: "submit", word: c.word });
  };

  return (
    <form
      onSubmit={submit}
      className="card animate-rise p-3 @sm:p-4"
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
        {!problem && (
          <span className="text-muted">
            {initial && draft.trim() === initial
              ? `“${initial}” still counts if time runs out. Enter to lock it again.`
              : draft.trim()
                ? `Enter to lock in · ${MAX_WORD - draft.length} characters left`
                : initial
                  ? `“${initial}” still counts unless you lock in a new word.`
                  : "You can change it until the reveal."}
          </span>
        )}
      </p>
    </form>
  );
}

function LockedIn({ word, accent, onChange }: { word: string; accent: string; onChange: () => void }) {
  return (
    <div
      className="card animate-pop flex items-center gap-3 p-3 @sm:p-4"
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
      <button type="button" className="btn min-h-11 shrink-0" onClick={onChange} aria-label="Change your word">
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
}: {
  record: RoundRecord;
  who: Who;
  accent: string;
  final: boolean;
}) {
  const { stagger, flipDone } = revealTiming(record.entries.length);
  const layout = cardLayout(record.entries.length);
  return (
    <section className="flex flex-col gap-3" aria-label={`Round ${record.round} words`}>
      <SyncMeter record={record} accent={accent} delay={flipDone} final={final} />
      <ul className="flex flex-wrap justify-center gap-2">
        {record.entries.map((e, i) => (
          <FlipCard
            key={`${record.round}-${e.id}`}
            entry={e}
            player={who(e.id)}
            delay={i * stagger}
            highlight={e.group === 0 && record.sync >= 2}
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
      className="card animate-pop relative overflow-hidden px-4 py-6 text-center"
      style={{
        borderColor: accent,
        background: `radial-gradient(120% 90% at 50% 0%, ${accent}38, transparent 70%), var(--color-panel)`,
      }}
    >
      <Confetti colors={colors} />
      <div className="relative">
        <div className="mm-float inline-block text-5xl" aria-hidden>
          🧠
        </div>
        <p className="label mt-2">Everyone said</p>
        <p className="font-display text-4xl font-extrabold break-words" style={{ color: accent }}>
          “{meldWord(record)}”
        </p>
        <p className="mt-1 text-sm text-muted">
          Melded in {rounds} round{rounds === 1 ? "" : "s"}
        </p>
        <Badge accent={accent}>{rating(rounds)}</Badge>
        <RatingLadder rounds={rounds} accent={accent} />
      </div>
    </section>
  );
}

function Badge({ accent, children }: { accent: string; children: ReactNode }) {
  return (
    <p
      className="mt-3 inline-block rounded-full px-4 py-1.5 font-display text-lg font-extrabold"
      style={{ background: accent, color: "#1a0f14" }}
    >
      {children}
    </p>
  );
}

function Failed({ view }: { view: MmView }) {
  const best = bestRound(view.history);
  const dropped = view.reason === "players";
  return (
    <section className="card animate-rise px-4 py-6 text-center">
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
        <p className="mt-3 text-sm">
          Closest: <b>round {best.round}</b>, {best.sync} of {best.total} in sync.
        </p>
      )}
      <p className="mt-3 text-sm text-muted">Your brains are warmed up now. Another go?</p>
    </section>
  );
}

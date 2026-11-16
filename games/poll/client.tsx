"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { Note, PlayerChip, Scoreboard, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import type { PollAction, PollAward, PollRecap, PollReveal, PollSeat, PollView } from "./server";
import {
  MAJORITY_MULT,
  MISS_COST,
  OPTION_COLORS,
  OPTION_LETTERS,
  READ_PTS,
  SELF_COST,
  WOLF_BONUS,
  evenSplit,
  splitOption,
  type PollKind,
} from "./shared";

type Props = GameClientProps<PollView, PollAction>;
type Who = (id: string) => Player;

/** A complete draft prediction goes out this long after the last tap. */
const DRAFT_DEBOUNCE_MS = 450;

const STYLES = `
@keyframes poll-grow { from { transform: scaleX(0); } }
@keyframes poll-in { from { opacity: 0; transform: translateY(8px) scale(.97); } }
@keyframes poll-flash { 0% { background: rgba(244,114,182,.45); } 100% { background: transparent; } }
@keyframes poll-bump { 0% { transform: scale(1); } 40% { transform: scale(1.35); } 100% { transform: scale(1); } }
@keyframes poll-glow { 0%, 100% { box-shadow: 0 0 0 0 rgba(250,204,21,0); } 50% { box-shadow: 0 0 18px 2px rgba(250,204,21,.45); } }
@keyframes poll-dot { 0%, 70%, 100% { opacity: .25; } 35% { opacity: 1; } }
.poll-bar { transform-origin: left center; animation: poll-grow .9s cubic-bezier(.2,.9,.25,1) both; }
.poll-in { animation: poll-in .35s ease both; }
.poll-flash { animation: poll-flash .6s ease-out; }
.poll-bump { display: inline-block; animation: poll-bump .25s ease-out; }
.poll-top { animation: poll-glow 1.6s ease-in-out 1s 2; }
.poll-dot { animation: poll-dot 1.2s infinite; }
@media (prefers-reduced-motion: reduce) {
  .poll-bar, .poll-in, .poll-bump, .poll-top, .poll-dot { animation: none; }
}
`;

export default function PollPosition(props: Props) {
  if (!props.view) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Note>Counting the ballots…</Note>
      </div>
    );
  }
  return <Board {...props} view={props.view} />;
}

// ---------- helpers ----------

const KIND_INFO: Record<PollKind, { badge: string; tip: string } | null> = {
  normal: null,
  room: { badge: "🔦 Read the room", tip: "After voting, everyone guesses ONE player's vote." },
  majority: {
    badge: "👑 Majority rules",
    tip: `Only voters on the most popular answer score, and they score ×${MAJORITY_MULT}.`,
  },
};

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

function names(ids: string[], who: Who): string {
  const n = ids.map((id) => who(id).name);
  if (n.length <= 1) return n.join("");
  if (n.length > 3) return `${n.slice(0, 2).join(", ")} & ${n.length - 2} more`;
  return `${n.slice(0, -1).join(", ")} & ${n[n.length - 1]}`;
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}

/** Answer badge: colour plus letter, so colour is never the only cue. */
function Letter({ i, size = 28 }: { i: number; size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-lg font-display font-black text-ink"
      style={{ width: size, height: size, background: OPTION_COLORS[i], fontSize: size * 0.5 }}
    >
      {OPTION_LETTERS[i]}
    </span>
  );
}

function OptionText({ text, className = "", compact }: { text: string; className?: string; compact?: boolean }) {
  const { emoji, label } = splitOption(text);
  return (
    <span className={`flex min-w-0 items-center gap-2 ${className}`}>
      {emoji ? (
        <span aria-hidden className={`shrink-0 text-xl leading-none ${compact ? "hidden @sm:inline" : ""}`}>
          {emoji}
        </span>
      ) : null}
      <span className="min-w-0 break-words leading-tight">{label}</span>
    </span>
  );
}

/** Counts up from 0 to `to` once, after `delay` ms (instant with reduced motion). */
function CountUp({ to, delay = 0, ms = 800 }: { to: number; delay?: number; ms?: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const start = performance.now() + (reduce ? 0 : delay);
    const step = (now: number) => {
      const p = reduce ? 1 : Math.min(1, Math.max(0, (now - start) / ms));
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, delay, ms]);
  return <>{v}</>;
}

function Avatar({ p, size = 26 }: { p: Player; size?: number }) {
  return (
    <span
      title={p.name}
      className="grid shrink-0 place-items-center rounded-full border-2 bg-panel-2 leading-none"
      style={{ width: size, height: size, borderColor: p.color, fontSize: size * 0.55 }}
    >
      <span aria-hidden>{p.avatar}</span>
      <span className="sr-only">{p.name}</span>
    </span>
  );
}

// ---------- the board ----------

function Board({ view, me, byId, isPlayer, act, serverNow, accent }: Props & { view: PollView }) {
  const who: Who = (id) => byId[id] ?? { id, name: "Someone", color: "#94a3b8", avatar: "❔", connected: false };
  const roundKey = `${view.game}:${view.round}`;
  const mySeat = view.seats.find((s) => s.id === me) ?? null;
  const playing = isPlayer && !!mySeat && !!view.mine;
  const info = KIND_INFO[view.kind];
  const left = useSecondsLeft(view.phase === "final" ? null : view.endsAt, serverNow);

  // Optimistic local picks, keyed by round so they never leak into the next poll.
  const [pick, setPick] = useState<{ key: string; vote?: number; read?: number; locked?: boolean } | null>(null);
  const local = pick?.key === roundKey ? pick : null;
  const myVote = view.phase === "vote" ? (local?.vote ?? view.mine?.vote ?? null) : (view.mine?.vote ?? null);
  const myRead = local?.read ?? view.mine?.read ?? null;
  const iLocked = !!(view.mine?.locked || (view.phase === "predict" && local?.locked));
  const amSpot = view.spot === me;

  const vote = (o: number) => {
    if (!playing || view.phase !== "vote" || myVote === o) return;
    setPick({ ...(local ?? {}), key: roundKey, vote: o });
    act({ type: "vote", o });
  };
  const read = (o: number) => {
    if (!playing || view.phase !== "predict" || view.kind !== "room" || amSpot || myRead === o) return;
    setPick({ ...(local ?? {}), key: roundKey, read: o, locked: true });
    act({ type: "read", o });
  };
  const markLocked = () => setPick({ ...(local ?? {}), key: roundKey, locked: true });

  // Keyboard: 1-4 or A-D picks an answer while voting / reading the room.
  const keyRef = useRef<(i: number) => void>(() => {});
  useEffect(() => {
    keyRef.current = (i: number) => {
      if (view.phase === "vote") vote(i);
      else if (view.phase === "predict" && view.kind === "room") read(i);
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      let i = "1234".indexOf(k);
      if (i < 0) i = "abcd".indexOf(k);
      if (i < 0 || k === "") return;
      keyRef.current(i);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const here = view.seats.filter((s) => !s.away);
  const waiting = (done: (s: PollSeat) => boolean) => here.filter((s) => !done(s)).length;

  let banner: ReactNode;
  if (view.phase === "vote") {
    if (!playing) banner = "Everyone's voting in secret…";
    else if (myVote === null) banner = "Cast your vote!";
    else banner = `Voted ✓ Waiting for ${plural(waiting((s) => s.voted || s.id === me), "more vote")}`;
  } else if (view.phase === "predict") {
    if (view.kind === "room") {
      const spotName = view.spot ? who(view.spot).name : "them";
      if (amSpot) banner = iLocked ? "Locked ✓ Let's see who knows you" : "All eyes on you! How many will read you?";
      else if (!playing) banner = `Can they guess ${spotName}'s vote?`;
      else banner = myRead === null ? `What did ${spotName} pick?` : `Locked ✓ (tap another to change)`;
    } else if (!playing) banner = "Players are predicting the split…";
    else banner = iLocked ? "Locked ✓ Waiting for the others" : `How did the ${plural(view.voters, "voter")} split?`;
  } else if (view.phase === "reveal") {
    banner = view.kind === "room" ? "Did you read the room?" : "The results are in!";
  } else {
    banner = view.abandoned ? "Game over: not enough players left" : "Final standings";
  }

  return (
    <div className="@container mx-auto flex w-full max-w-2xl flex-col gap-3">
      <style>{STYLES}</style>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-line bg-panel px-3 py-1 text-sm font-bold">
            📊 Poll {Math.min(view.round, view.rounds)} / {view.rounds}
          </span>
          {info && view.phase !== "final" ? (
            <span
              className="rounded-full px-3 py-1 text-sm font-bold text-ink"
              style={{ background: view.kind === "room" ? "#facc15" : "#f472b6" }}
            >
              {info.badge}
            </span>
          ) : null}
        </div>
        {view.phase !== "final" ? (
          <span className="font-mono text-sm font-bold tabular-nums text-muted" aria-hidden>
            {left}s
          </span>
        ) : null}
      </div>

      {view.phase !== "final" ? (
        <TimerBar endsAt={view.endsAt} total={view.phaseMs} serverNow={serverNow} color={accent} />
      ) : null}

      <div aria-live="polite">
        <StatusBanner key={`${roundKey}-${view.phase}`} accent={accent}>
          {banner}
        </StatusBanner>
      </div>

      {view.endingAt ? (
        <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-center text-sm">
          Too few players connected. The game ends soon unless someone comes back.
        </p>
      ) : null}

      {view.phase !== "final" ? (
        <div
          key={`q-${roundKey}`}
          className={`card poll-in px-4 text-center ${view.phase === "reveal" ? "py-2.5" : "py-4"}`}
          style={{ borderColor: accent + "55" }}
        >
          <h2
            className={`font-display font-extrabold leading-snug ${view.phase === "reveal" ? "text-lg" : "text-xl @lg:text-2xl"}`}
          >
            {view.q}
          </h2>
          {info && view.phase === "vote" ? <p className="mt-1.5 text-sm text-muted">{info.tip}</p> : null}
        </div>
      ) : null}

      {view.phase === "vote" ? (
        <OptionButtons opts={view.opts} chosen={myVote} disabled={!playing} onPick={vote} labelPrefix="Vote" />
      ) : null}

      {view.phase === "predict" && view.kind !== "room" && !playing ? <ReadOnlyOptions opts={view.opts} /> : null}

      {view.phase === "predict" && view.kind !== "room" && playing ? (
        <Predictor
          key={`pred-${roundKey}`}
          view={view}
          playing={playing}
          locked={iLocked}
          act={act}
          onLock={markLocked}
        />
      ) : null}

      {view.phase === "predict" && view.kind === "room" && view.spot ? (
        amSpot ? (
          <SelfGuess key={`self-${roundKey}`} view={view} locked={iLocked} act={act} onLock={markLocked} />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-center gap-2 text-sm text-muted">
              <span>Spotlight:</span>
              <PlayerChip player={who(view.spot)} />
            </div>
            <OptionButtons
              opts={view.opts}
              chosen={myRead}
              disabled={!playing}
              onPick={read}
              labelPrefix={`Guess ${who(view.spot).name} picked`}
            />
          </div>
        )
      ) : null}

      {view.phase === "reveal" && view.reveal ? (
        <Reveal view={view} reveal={view.reveal} me={me} who={who} playing={playing} act={act} accent={accent} />
      ) : null}

      {view.phase === "final" ? <Final view={view} me={me} who={who} byId={byId} /> : null}

      {view.phase === "vote" || view.phase === "predict" ? <SeatStrip view={view} who={who} me={me} /> : null}

      {!isPlayer && (view.phase === "vote" || view.phase === "predict") ? (
        <Note>You&apos;re spectating. Votes stay secret until the reveal.</Note>
      ) : null}
      {!isPlayer && view.phase === "reveal" ? <Note>You&apos;re spectating.</Note> : null}
    </div>
  );
}

// ---------- vote / read buttons ----------

function OptionButtons({
  opts,
  chosen,
  disabled,
  onPick,
  labelPrefix,
}: {
  opts: string[];
  chosen: number | null;
  disabled: boolean;
  onPick: (i: number) => void;
  labelPrefix: string;
}) {
  return (
    <div className={`grid gap-2 ${opts.length > 2 ? "@lg:grid-cols-2" : ""}`}>
      {opts.map((o, i) => {
        const on = chosen === i;
        const c = OPTION_COLORS[i];
        return (
          <button
            key={i}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            aria-label={`${labelPrefix} ${OPTION_LETTERS[i]}: ${splitOption(o).label}`}
            onClick={() => onPick(i)}
            className="poll-in flex min-h-[56px] items-center gap-3 rounded-2xl border-2 px-3 py-2.5 text-left font-semibold transition-[transform,background-color,border-color] duration-150 active:scale-[.97] disabled:cursor-default"
            style={{
              animationDelay: `${i * 50}ms`,
              borderColor: on ? c : c + "40",
              background: on ? c + "33" : "var(--color-panel)",
              boxShadow: on ? `0 0 0 3px ${c}33` : undefined,
            }}
          >
            <Letter i={i} />
            <OptionText text={o} className="flex-1" />
            {on ? (
              <span className="poll-bump shrink-0 text-lg" aria-hidden>
                ✅
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ---------- predict ----------

function Predictor({
  view,
  playing,
  locked,
  act,
  onLock,
}: {
  view: PollView;
  playing: boolean;
  locked: boolean;
  act: Props["act"];
  onLock: () => void;
}) {
  const n = view.opts.length;
  const total = view.voters;
  const [c, setC] = useState<number[]>(() => view.mine?.pred ?? evenSplit(total, n));
  const [flash, setFlash] = useState<{ i: number; seq: number } | null>(null);
  const [touched, setTouched] = useState(false);
  const placed = c.reduce((a, b) => a + b, 0);
  const pool = total - placed;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editable = playing && !locked;

  // Complete drafts are saved quietly so a forgotten lock still counts.
  useEffect(() => {
    if (!touched || locked || !playing || pool !== 0) return;
    const draft = c.slice();
    timer.current = setTimeout(() => act({ type: "pred", c: draft }), DRAFT_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [c, touched, locked, playing, pool, act]);

  const set = (next: number[]) => {
    setC(next);
    setTouched(true);
  };
  // Handlers read the latest counts from a ref, so press-and-hold repeats never go stale.
  const cRef = useRef(c);
  useLayoutEffect(() => {
    cRef.current = c;
  }, [c]);
  const plus = (i: number) => {
    const cur = cRef.current;
    if (!editable || cur[i] >= total) return;
    const next = cur.slice();
    next[i]++;
    if (cur.reduce((a, b) => a + b, 0) >= total) {
      // Full: borrow one from the biggest other answer.
      let j = -1;
      for (let k = 0; k < n; k++) if (k !== i && next[k] > 0 && (j < 0 || next[k] >= next[j])) j = k;
      if (j < 0) return;
      next[j]--;
      setFlash((f) => ({ i: j, seq: (f?.seq ?? 0) + 1 }));
    }
    cRef.current = next;
    set(next);
  };
  const minus = (i: number) => {
    const cur = cRef.current;
    if (!editable || cur[i] <= 0) return;
    const next = cur.slice();
    next[i]--;
    cRef.current = next;
    set(next);
  };
  const lock = () => {
    if (!editable || pool !== 0) return;
    if (timer.current) clearTimeout(timer.current);
    onLock();
    act({ type: "pred", c: c.slice(), lock: true });
  };

  // One segment per voter, coloured by where you placed them.
  const segs: number[] = [];
  c.forEach((k, i) => {
    for (let x = 0; x < k; x++) segs.push(i);
  });
  while (segs.length < total) segs.push(-1);

  return (
    <div className="card flex flex-col gap-3 p-3 sm:p-4">
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
          <span className="font-semibold">
            {view.mine?.vote !== null && view.mine?.vote !== undefined ? (
              <span className="text-muted">
                You voted <b style={{ color: OPTION_COLORS[view.mine.vote] }}>{OPTION_LETTERS[view.mine.vote]}</b>
              </span>
            ) : (
              <span className="text-muted">You didn&apos;t vote</span>
            )}
          </span>
          <span className={`font-bold tabular-nums ${pool ? "text-amber-300" : "text-emerald-300"}`} aria-live="polite">
            {pool > 0 ? `Place ${pool} more` : `All ${total} placed ✓`}
          </span>
        </div>
        <div className="flex h-4 gap-[3px]" aria-hidden>
          {segs.map((o, k) => (
            <span
              key={k}
              className="flex-1 rounded-sm transition-colors duration-150"
              style={{ background: o < 0 ? "var(--color-panel-2)" : OPTION_COLORS[o] }}
            />
          ))}
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {view.opts.map((o, i) => (
          <li
            key={`${i}-${flash?.i === i ? flash.seq : 0}`}
            className={`flex items-center gap-2 rounded-xl border border-line px-2 py-1.5 ${flash?.i === i ? "poll-flash" : ""}`}
          >
            <Letter i={i} size={26} />
            <OptionText text={o} className="flex-1 text-sm font-semibold" compact />
            <div className="flex shrink-0 items-center gap-1" role="group" aria-label={`Voters on ${OPTION_LETTERS[i]}`}>
              <HoldButton
                label={`One fewer on ${OPTION_LETTERS[i]}`}
                disabled={!editable || c[i] <= 0}
                onStep={() => minus(i)}
              >
                −
              </HoldButton>
              <span className="w-8 text-center font-display text-2xl font-black tabular-nums" style={{ color: OPTION_COLORS[i] }}>
                <span key={c[i]} className="poll-bump">
                  {c[i]}
                </span>
              </span>
              <HoldButton
                label={`One more on ${OPTION_LETTERS[i]}`}
                disabled={!editable || c[i] >= total}
                onStep={() => plus(i)}
              >
                +
              </HoldButton>
            </div>
          </li>
        ))}
      </ul>

      {playing ? (
        locked ? (
          <p className="text-center text-sm font-semibold text-emerald-300">🔒 Prediction locked</p>
        ) : (
          <div className="flex gap-2">
            <button type="button" className="btn flex-1 whitespace-nowrap !px-3" onClick={() => set(evenSplit(total, n))}>
              ⚖️ Even split
            </button>
            <button type="button" className="btn btn-primary flex-[2]" disabled={pool !== 0} onClick={lock}>
              🔒 Lock it in
            </button>
          </div>
        )
      ) : null}
      {editable ? (
        <p className="text-center text-xs text-muted">
          Tap or hold + and −. When all {total} are placed, + borrows from the biggest other answer. −{MISS_COST} per voter you
          misplace{view.kind === "majority" ? `; only the majority side scores, ×${MAJORITY_MULT}` : ""}.
        </p>
      ) : null}
    </div>
  );
}

function SelfGuess({
  view,
  locked,
  act,
  onLock,
}: {
  view: PollView;
  locked: boolean;
  act: Props["act"];
  onLock: () => void;
}) {
  const readers = view.seats.length - 1;
  const [n, setN] = useState<number>(() => view.mine?.self ?? Math.ceil(readers / 2));
  const change = (d: number) => {
    if (locked) return;
    const next = Math.max(0, Math.min(readers, n + d));
    if (next === n) return;
    setN(next);
    act({ type: "self", n: next });
  };
  const lock = () => {
    if (locked) return;
    onLock();
    act({ type: "self", n, lock: true });
  };
  return (
    <div className="card flex flex-col items-center gap-3 p-4 text-center">
      <p className="text-sm text-muted">
        Everyone else is guessing what you voted
        {view.mine?.vote !== null && view.mine?.vote !== undefined ? (
          <>
            {" "}
            (you picked <b style={{ color: OPTION_COLORS[view.mine.vote] }}>{OPTION_LETTERS[view.mine.vote]}</b>)
          </>
        ) : null}
        . How many of the {readers} will get it right?
      </p>
      <div className="flex items-center gap-3" role="group" aria-label="Players who will read you right">
        <button type="button" className="btn h-12 w-12 !p-0 text-2xl" aria-label="Fewer" disabled={locked || n <= 0} onClick={() => change(-1)}>
          −
        </button>
        <span className="w-20 font-display text-5xl font-black tabular-nums text-brand">
          <span key={n} className="poll-bump">
            {n}
          </span>
        </span>
        <button type="button" className="btn h-12 w-12 !p-0 text-2xl" aria-label="More" disabled={locked || n >= readers} onClick={() => change(1)}>
          +
        </button>
      </div>
      <p className="text-xs text-muted">
        out of {readers} · −{SELF_COST} per one you&apos;re off
      </p>
      {locked ? (
        <p className="text-sm font-semibold text-emerald-300">🔒 Locked</p>
      ) : (
        <button type="button" className="btn btn-primary w-full max-w-xs" onClick={lock}>
          🔒 Lock it in
        </button>
      )}
    </div>
  );
}

function SeatStrip({ view, who, me }: { view: PollView; who: Who; me: string }) {
  return (
    <div className="flex flex-wrap justify-center gap-1.5" aria-label="Who's done">
      {view.seats.map((s) => {
        const done =
          view.phase === "vote" ? s.voted : view.kind === "room" && s.id === view.spot ? s.locked : s.locked;
        return (
          <PlayerChip key={s.id} player={who(s.id)} size="sm" dim={s.away}>
            <span aria-label={done ? "done" : "thinking"} className={s.id === me ? "font-bold" : ""}>
              {s.away ? "💤" : done ? "✅" : <span className="poll-dot">…</span>}
            </span>
          </PlayerChip>
        );
      })}
    </div>
  );
}

// ---------- reveal ----------

function Bars({
  opts,
  counts,
  top,
  voters,
  who,
  delay = 0,
  highlight,
}: {
  opts: string[];
  counts: number[];
  top: number[];
  voters?: string[][];
  who?: Who;
  delay?: number;
  highlight?: number | null;
}) {
  const total = Math.max(1, counts.reduce((a, b) => a + b, 0));
  return (
    <ul className="flex flex-col gap-2.5">
      {opts.map((o, i) => {
        const pct = (counts[i] / total) * 100;
        const isTop = top.includes(i);
        const d = delay + i * 140;
        return (
          <li
            key={i}
            className={`rounded-xl border px-2.5 py-2 ${isTop ? "poll-top" : ""}`}
            style={{
              borderColor: isTop ? OPTION_COLORS[i] : "var(--color-line)",
              outline: highlight === i ? `2px dashed ${OPTION_COLORS[i]}` : undefined,
              outlineOffset: 2,
            }}
          >
            <div className="flex items-center gap-2">
              <Letter i={i} size={24} />
              <OptionText text={o} className="flex-1 text-sm font-semibold" />
              {isTop ? (
                <span className="shrink-0 text-sm" title="Most popular" aria-label="Most popular">
                  👑
                </span>
              ) : null}
              <span className="w-8 shrink-0 text-right font-display text-xl font-black tabular-nums" style={{ color: OPTION_COLORS[i] }}>
                <CountUp to={counts[i]} delay={d} />
              </span>
            </div>
            <div className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-panel-2">
              <div
                className="poll-bar h-full rounded-full"
                style={{ width: `${pct}%`, background: OPTION_COLORS[i], animationDelay: `${d}ms` } as CSSProperties}
              />
            </div>
            {voters && who && voters[i].length ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {voters[i].map((id, k) => (
                  <span key={id} className="animate-pop" style={{ animationDelay: `${d + 500 + k * 60}ms` }}>
                    <Avatar p={who(id)} size={24} />
                  </span>
                ))}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function Reveal({
  view,
  reveal,
  me,
  who,
  playing,
  act,
  accent,
}: {
  view: PollView;
  reveal: PollReveal;
  me: string;
  who: Who;
  playing: boolean;
  act: Props["act"];
  accent: string;
}) {
  const [readyLocal, setReadyLocal] = useState(false);
  const voters = view.opts.map(() => [] as string[]);
  reveal.votes.forEach((v, i) => {
    if (v !== null) voters[v].push(view.seats[i].id);
  });
  const myIdx = view.seats.findIndex((s) => s.id === me);
  const mine = myIdx >= 0 ? reveal.rows[myIdx] : null;
  const ready = readyLocal || (myIdx >= 0 && view.seats[myIdx].ready);
  const readyCount = view.seats.filter((s) => s.ready).length;
  const spot = reveal.spot;
  const order = view.seats
    .map((s, i) => ({
      id: s.id,
      pts: reveal.rows[i].pts,
      row: reveal.rows[i],
      // Read the room: show each reader's guess; otherwise their vote.
      shown: view.kind === "room" ? (s.id === spot?.id ? null : reveal.rows[i].read) : reveal.votes[i],
    }))
    .sort((a, b) => b.pts - a.pts);
  const nobody = reveal.counts.every((c) => c === 0);

  return (
    <div className="flex flex-col gap-3">
      {spot ? (
        <div className="card poll-in flex flex-col items-center gap-2 p-4 text-center">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <PlayerChip player={who(spot.id)} />
            <span className="text-muted">picked</span>
          </div>
          <div className="flex items-center gap-2 font-display text-xl font-extrabold">
            <Letter i={spot.vote} />
            <OptionText text={view.opts[spot.vote]} />
          </div>
          <p className="text-sm">
            <b className="text-brand">
              <CountUp to={spot.right} delay={500} />
            </b>{" "}
            of {spot.readers} read them right
            {spot.guess !== null ? (
              <>
                {" "}
                · they guessed {spot.guess} → <b>+{spot.pts}</b>
              </>
            ) : (
              " · they didn't guess"
            )}
          </p>
        </div>
      ) : null}

      <div className="card p-3 sm:p-4">
        <div className="label mb-2">{nobody ? "Nobody voted this time" : `How ${plural(view.voters, "voter")} split`}</div>
        <Bars opts={view.opts} counts={reveal.counts} top={reveal.top} voters={voters} who={who} />
      </div>

      {mine && myIdx >= 0 ? <MyResult view={view} reveal={reveal} idx={myIdx} accent={accent} /> : null}

      <div className="card p-3">
        <div className="label mb-2">This poll</div>
        <ol className={`grid gap-1 ${order.length > 6 ? "@sm:grid-cols-2 @sm:gap-x-3" : ""}`}>
          {order.map(({ id, pts, row, shown }, k) => (
            <li
              key={id}
              className={`poll-in flex items-center justify-between gap-2 rounded-lg px-2 py-1 ${id === me ? "bg-panel-2" : ""}`}
              style={{ animationDelay: `${900 + k * 70}ms` }}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {shown !== null ? (
                  <Letter i={shown} size={18} />
                ) : (
                  <span className="w-[18px] text-center text-xs text-muted">{id === spot?.id ? "🔦" : "–"}</span>
                )}
                <PlayerChip player={who(id)} size="sm" />
                {row.wolf ? <span title="Lone wolf">🐺</span> : null}
                {row.side ? <span title="Majority side">👑</span> : null}
                {view.kind === "room" && id !== spot?.id ? <span aria-label={pts > 0 ? "read right" : "missed"}>{pts > 0 ? "✅" : "❌"}</span> : null}
              </span>
              <span className={`shrink-0 font-mono font-bold tabular-nums ${pts > 0 ? "text-emerald-300" : "text-muted"}`}>
                +{pts}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {playing ? (
        <button
          type="button"
          className="btn btn-primary w-full"
          disabled={ready}
          onClick={() => {
            setReadyLocal(true);
            act({ type: "ready" });
          }}
        >
          {ready
            ? `Waiting… ${readyCount + (readyLocal && !view.seats[myIdx]?.ready ? 1 : 0)} / ${view.seats.filter((s) => !s.away).length} ready`
            : view.round >= view.rounds
              ? "🏁 Final standings"
              : "Next poll ▶"}
        </button>
      ) : null}
    </div>
  );
}

function MyResult({ view, reveal, idx, accent }: { view: PollView; reveal: PollReveal; idx: number; accent: string }) {
  const row = reveal.rows[idx];
  const vote = reveal.votes[idx];
  let body: ReactNode;
  if (view.kind === "room") {
    const spot = reveal.spot;
    if (!spot) body = "No spotlight this time.";
    else if (spot.id === view.seats[idx].id)
      body = spot.guess === null ? "You didn't guess how many would read you." : `You guessed ${spot.guess}, and ${spot.right} read you right.`;
    else if (row.read === null) body = "You didn't guess.";
    else
      body =
        row.read === spot.vote ? (
          <>You read them perfectly! +{READ_PTS}</>
        ) : (
          <>
            You guessed <b style={{ color: OPTION_COLORS[row.read] }}>{OPTION_LETTERS[row.read]}</b>. Not this time.
          </>
        );
  } else if (!row.pred) {
    body = "You didn't lock a prediction, so no prediction points.";
  } else {
    body = (
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {view.opts.map((_, i) => {
            const diff = row.pred![i] - reveal.counts[i];
            return (
              <span key={i} className="inline-flex items-center gap-1 text-sm tabular-nums">
                <Letter i={i} size={18} />
                <span>{row.pred![i]}</span>
                <span className="text-muted">→ {reveal.counts[i]}</span>
                {diff === 0 ? <span className="text-emerald-300">✓</span> : null}
              </span>
            );
          })}
        </div>
        <span className="text-sm">
          {row.miss === 0 ? "Perfect prediction! " : `Off by ${plural(row.miss ?? 0, "voter")}: `}+{row.base}
          {row.wolf ? <b className="text-amber-300"> · 🐺 Lone wolf +{WOLF_BONUS}</b> : null}
          {row.side === true ? <b className="text-amber-300"> · 👑 Majority ×{MAJORITY_MULT}</b> : null}
          {row.side === false ? (
            <span className="text-rose-300"> · {vote === null ? "no vote" : "minority"}, so it doesn&apos;t count</span>
          ) : null}
        </span>
      </div>
    );
  }
  return (
    <div className="card poll-in flex items-center gap-3 p-3" style={{ borderColor: accent + "66", animationDelay: "700ms" }}>
      <div className="min-w-0 flex-1 text-sm">{body}</div>
      <div className="shrink-0 text-right">
        <div className="font-display text-3xl font-black tabular-nums" style={{ color: row.pts ? accent : undefined }}>
          +<CountUp to={row.pts} delay={900} />
        </div>
        <div className="text-xs text-muted">total {view.seats[idx].score}</div>
      </div>
    </div>
  );
}

// ---------- final ----------

function Final({ view, me, who, byId }: { view: PollView; me: string; who: Who; byId: Record<string, Player> }) {
  const scores = Object.fromEntries(view.seats.map((s) => [s.id, s.score]));
  return (
    <div className="flex flex-col gap-3">
      <Scoreboard scores={scores} byId={byId} order={view.seats.map((s) => s.id)} highlight={me} title="Final scores" />
      {view.awards.length ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
          {view.awards.map((a: PollAward, k) => (
            <div key={a.title} className="card poll-in flex flex-col items-center gap-1 p-3 text-center" style={{ animationDelay: `${k * 120}ms` }}>
              <span className="text-3xl" aria-hidden>
                {a.icon}
              </span>
              <span className="font-display font-extrabold">{a.title}</span>
              <span className="text-sm font-semibold">{names(a.ids, who)}</span>
              <span className="text-xs text-muted">{a.note}</span>
            </div>
          ))}
        </div>
      ) : null}
      {view.recap.length ? (
        <div className="card p-3">
          <div className="label mb-2">The polls</div>
          <ol className="flex flex-col gap-3">
            {view.recap.map((r: PollRecap, k) => (
              <RecapItem key={k} r={r} n={k + 1} who={who} />
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function RecapItem({ r, n, who }: { r: PollRecap; n: number; who: Who }) {
  const total = Math.max(1, r.counts.reduce((a, b) => a + b, 0));
  const max = Math.max(...r.counts);
  const win = max > 0 ? r.counts.indexOf(max) : -1;
  const tied = r.counts.filter((c) => c === max).length > 1;
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-start gap-2 text-sm">
        <span className="shrink-0 text-xs font-bold text-muted tabular-nums">{n}.</span>
        <span className="font-semibold leading-snug">
          {r.q}
          {KIND_INFO[r.kind] ? <span className="ml-1 text-xs text-muted">({KIND_INFO[r.kind]!.badge})</span> : null}
        </span>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-panel-2" aria-hidden>
        {r.counts.map((c, i) => (c ? <span key={i} style={{ width: `${(c / total) * 100}%`, background: OPTION_COLORS[i] }} /> : null))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2 text-xs text-muted">
        <span>
          {win < 0
            ? "No votes"
            : tied
              ? `Split decision (${max} each)`
              : `Winner: ${r.opts[win]} (${r.counts[win]})`}
        </span>
        {r.best ? (
          <span>
            Top: {names(r.best.ids, who)} +{r.best.pts}
          </span>
        ) : null}
      </div>
    </li>
  );
}

function ReadOnlyOptions({ opts }: { opts: string[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {opts.map((o, i) => (
        <li key={i} className="flex items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 text-sm font-semibold">
          <Letter i={i} size={24} />
          <OptionText text={o} />
        </li>
      ))}
    </ul>
  );
}

/** A stepper button: one step per tap, repeating while held (keyboard: one step per press). */
function HoldButton({
  label,
  disabled,
  onStep,
  children,
}: {
  label: string;
  disabled: boolean;
  onStep: () => void;
  children: ReactNode;
}) {
  const stepRef = useRef(onStep);
  const timers = useRef<{ t: ReturnType<typeof setTimeout> | null; iv: ReturnType<typeof setInterval> | null }>({
    t: null,
    iv: null,
  });
  useLayoutEffect(() => {
    stepRef.current = onStep;
  });
  const stop = () => {
    const x = timers.current;
    if (x.t) clearTimeout(x.t);
    if (x.iv) clearInterval(x.iv);
    x.t = null;
    x.iv = null;
  };
  useEffect(() => {
    if (disabled) stop();
  }, [disabled]);
  useEffect(() => stop, []);
  return (
    <button
      type="button"
      className="btn h-10 w-10 touch-manipulation select-none !p-0 text-xl"
      aria-label={label}
      disabled={disabled}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        stop();
        stepRef.current();
        timers.current.t = setTimeout(() => {
          timers.current.iv = setInterval(() => stepRef.current(), 110);
        }, 380);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        if (e.detail === 0) stepRef.current(); // keyboard activation
      }}
    >
      {children}
    </button>
  );
}

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { Note, PlayerChip, Scoreboard, TimerBar, useSecondsLeft } from "@/components/game-ui";
import { Avatar } from "@/components/Avatar";
import { Confetti } from "@/components/Confetti";
import { feedback, sfx } from "@/lib/feedback";
import { LONE_BONUS, OPTION_COLORS, OPTION_LETTERS, READ_PTS, splitOption, type HotAction, type HotReveal, type HotView } from "./shared";

type Props = GameClientProps<HotView, HotAction>;
type Who = (id: string) => Player;

const STYLES = `
@keyframes hs-in { from { opacity: 0; transform: translateY(10px) scale(.97); } }
@keyframes hs-flame { 0%, 100% { box-shadow: 0 0 0 3px #fb7185, 0 0 22px 2px #fb718588; } 50% { box-shadow: 0 0 0 3px #f59e0b, 0 0 34px 6px #f59e0b88; } }
@keyframes hs-drum { 0%, 100% { transform: rotate(-8deg) scale(1); } 50% { transform: rotate(8deg) scale(1.12); } }
@keyframes hs-win { 0% { transform: scale(.9); } 50% { transform: scale(1.04); } 100% { transform: scale(1); } }
@keyframes hs-dots { 0%, 70%, 100% { opacity: .25; } 35% { opacity: 1; } }
.hs-in { animation: hs-in .35s ease both; }
.hs-flame { animation: hs-flame 1.4s ease-in-out infinite; }
.hs-drum { animation: hs-drum .25s ease-in-out infinite; display: inline-block; }
.hs-win { animation: hs-win .6s cubic-bezier(.2,.9,.25,1) both; }
.hs-dot { animation: hs-dots 1.2s infinite; }
@media (prefers-reduced-motion: reduce) { .hs-in, .hs-flame, .hs-drum, .hs-win, .hs-dot { animation: none; } }
`;

export default function HotSeat(props: Props) {
  if (!props.view) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Note>Warming up the seat…</Note>
      </div>
    );
  }
  return <Board {...props} view={props.view} />;
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

function Letter({ i, size = 34 }: { i: number; size?: number }) {
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

function Face({ p, size = 28, ring }: { p: Player; size?: number; ring?: string }) {
  return (
    <span
      title={p.name}
      className="grid shrink-0 place-items-center rounded-full border-2 bg-panel-2 leading-none"
      style={{ width: size, height: size, borderColor: ring ?? p.color, fontSize: size * 0.55 }}
    >
      <span aria-hidden>
        <Avatar id={p.avatar} />
      </span>
      <span className="sr-only">{p.name}</span>
    </span>
  );
}

function Board({ view, me, byId, isPlayer, act, serverNow, accent }: Props & { view: HotView }) {
  const who: Who = (id) => byId[id] ?? { id, name: "Someone", color: "#94a3b8", avatar: "❔", connected: false };
  const left = useSecondsLeft(view.phase === "final" ? null : view.endsAt, serverNow);
  const roundKey = `${view.game}:${view.round}`;
  const hot = who(view.hot);
  const amHot = view.hot === me;
  const playing = isPlayer && view.seats.some((s) => s.id === me);

  // Optimistic pick so taps feel instant.
  const [local, setLocal] = useState<{ key: string; o: number } | null>(null);
  const mine = view.phase === "pick" && local?.key === roundKey ? local.o : view.mine;
  const pick = (o: number) => {
    if (!playing || view.phase !== "pick" || mine === o) return;
    setLocal({ key: roundKey, o });
    sfx("pop");
    act({ type: "pick", o });
  };

  const keyRef = useRef(pick);
  useEffect(() => {
    keyRef.current = pick;
  });
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      let i = "1234".indexOf(k);
      if (i < 0) i = "abcd".indexOf(k);
      if (i >= 0 && k) keyRef.current(i);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  // Cues: your turn to pick, drumroll ticks, the reveal.
  const phaseKey = `${roundKey}:${view.phase}`;
  const lastPhase = useRef("");
  useEffect(() => {
    if (phaseKey === lastPhase.current) return;
    lastPhase.current = phaseKey;
    if (view.phase === "pick" && playing) feedback("turn");
    if (view.phase === "reveal" && view.reveal) {
      const g = view.reveal.guesses[me];
      if (view.reveal.answer !== null && g === view.reveal.answer) feedback("score");
      else if (amHot && view.reveal.right > 0) feedback("score");
      else sfx("go");
    }
  }, [phaseKey, view.phase, view.reveal, playing, me, amHot]);
  useEffect(() => {
    if (view.phase === "drum") sfx("tick");
  }, [left, view.phase]);

  let banner: ReactNode;
  if (view.phase === "pick") {
    if (amHot) banner = mine === null ? "Pick your honest answer. Nobody sees it yet!" : "Locked in 🤫 (tap another to change)";
    else if (playing) banner = mine === null ? `What will ${hot.name} pick?` : "Prediction in ✓ (tap another to change)";
    else banner = `Everyone's predicting ${hot.name}'s answer…`;
  } else if (view.phase === "drum") banner = "Drumroll…";
  else if (view.phase === "reveal") banner = `🎤 ${amHot ? "Explain yourself!" : `${hot.name}, explain yourself!`}`;
  else banner = view.abandoned ? "Game over: not enough players left" : "Final scores";

  return (
    <div className="@container mx-auto flex w-full max-w-3xl flex-col gap-3">
      <style>{STYLES}</style>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full border border-line bg-panel px-3 py-1 text-sm font-bold">
          {view.phase === "final" ? "🏁 Final" : `🔥 Round ${Math.min(view.round, view.rounds)} / ${view.rounds}`}
        </span>
        {view.phase !== "final" ? <span className="font-mono text-lg font-bold tabular-nums text-muted">{left}s</span> : null}
      </div>
      {view.phase !== "final" ? <TimerBar endsAt={view.endsAt} total={view.phaseMs} serverNow={serverNow} color={accent} /> : null}

      {view.endingAt ? (
        <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-center text-sm">
          Too few players connected. The game ends soon unless someone comes back.
        </p>
      ) : null}

      {view.phase !== "final" ? (
        <>
          <div
            key={roundKey}
            className="card hs-in flex flex-col items-center gap-3 px-4 py-5 text-center"
            style={{ borderColor: accent + "66", background: `radial-gradient(120% 90% at 50% 0%, ${accent}22, transparent 70%), var(--color-panel)` }}
          >
            <div className="flex items-center gap-3">
              <span className="hs-flame grid h-14 w-14 place-items-center rounded-full bg-panel-2 text-3xl @md:h-16 @md:w-16 @md:text-4xl">
                <Avatar id={hot.avatar} />
              </span>
              <div className="text-left">
                <div className="label" style={{ color: accent }}>
                  In the hot seat
                </div>
                <div className="font-display text-2xl font-black @md:text-3xl" style={{ color: hot.color }}>
                  {amHot ? "You!" : hot.name}
                </div>
              </div>
            </div>
            <h2 className="font-display text-2xl font-extrabold leading-snug @md:text-4xl">{view.q}</h2>
          </div>
          <div aria-live="polite" className="text-center font-display text-xl font-bold @md:text-2xl">
            {view.phase === "drum" ? (
              <span>
                <span className="hs-drum">🥁</span> Drumroll<span className="hs-dot">.</span>
                <span className="hs-dot" style={{ animationDelay: ".2s" }}>
                  .
                </span>
                <span className="hs-dot" style={{ animationDelay: ".4s" }}>
                  .
                </span>
              </span>
            ) : (
              banner
            )}
          </div>
        </>
      ) : null}

      {view.phase === "pick" || view.phase === "drum" ? (
        <Options view={view} chosen={mine} onPick={pick} disabled={!playing || view.phase !== "pick"} amHot={amHot} />
      ) : null}

      {view.phase === "reveal" && view.reveal ? <Reveal view={view} reveal={view.reveal} me={me} who={who} act={act} playing={playing} amHot={amHot} /> : null}

      {view.phase === "pick" || view.phase === "drum" ? <SeatStrip view={view} who={who} me={me} /> : null}
      {view.phase === "final" ? <Final view={view} me={me} who={who} byId={byId} /> : null}
      {!isPlayer && view.phase !== "final" ? <Note>You&apos;re spectating. Picks stay secret until the reveal.</Note> : null}
    </div>
  );
}

function OptionLabel({ text, big }: { text: string; big?: boolean }) {
  const { emoji, label } = splitOption(text);
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {emoji ? <span className={`shrink-0 leading-none ${big ? "text-3xl @md:text-4xl" : "text-2xl"}`}>{emoji}</span> : null}
      <span className={`min-w-0 break-words font-display font-bold leading-tight ${big ? "text-xl @md:text-2xl" : "text-lg"}`}>{label}</span>
    </span>
  );
}

function Options({
  view,
  chosen,
  onPick,
  disabled,
  amHot,
}: {
  view: HotView;
  chosen: number | null;
  onPick: (o: number) => void;
  disabled: boolean;
  amHot: boolean;
}) {
  const two = view.opts.length === 2;
  return (
    <div className={`grid gap-2.5 ${two ? "@md:grid-cols-2" : "@md:grid-cols-2"}`}>
      {view.opts.map((o, i) => {
        const on = chosen === i;
        return (
          <button
            key={i}
            className={`btn hs-in flex items-center justify-start gap-3 px-4 text-left ${two ? "py-6 @md:py-10" : "py-4 @md:py-6"} ${on ? "select-ring" : ""}`}
            style={{
              animationDelay: `${i * 60}ms`,
              borderColor: on ? OPTION_COLORS[i] : undefined,
              background: on ? `linear-gradient(180deg, ${OPTION_COLORS[i]}33, ${OPTION_COLORS[i]}12)` : undefined,
            }}
            disabled={disabled}
            aria-pressed={on}
            aria-label={`${amHot ? "My answer" : "Predict"}: ${o}`}
            onClick={() => onPick(i)}
          >
            <Letter i={i} />
            <OptionLabel text={o} big />
            {on ? <span className="ml-auto shrink-0 text-xl">{amHot ? "🤫" : "✓"}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function SeatStrip({ view, who, me }: { view: HotView; who: Who; me: string }) {
  return (
    <div className="flex flex-wrap justify-center gap-1.5">
      {view.seats.map((s) => (
        <PlayerChip key={s.id} player={who(s.id)} size="sm" dim={s.away}>
          {s.id === view.hot ? <span title="hot seat">🔥</span> : null}
          <span className={s.done ? "text-[#34d399]" : "text-muted"}>{s.done ? "✓" : "…"}</span>
          {s.id === me ? <span className="text-xs text-muted">you</span> : null}
        </PlayerChip>
      ))}
    </div>
  );
}

function Reveal({
  view,
  reveal,
  me,
  who,
  act,
  playing,
  amHot,
}: {
  view: HotView;
  reveal: HotReveal;
  me: string;
  who: Who;
  act: Props["act"];
  playing: boolean;
  amHot: boolean;
}) {
  const hot = who(view.hot);
  const byOpt: string[][] = view.opts.map(() => []);
  for (const [id, g] of Object.entries(reveal.guesses)) if (g !== null && byOpt[g]) byOpt[g].push(id);
  const myGuess = reveal.guesses[me];
  const iReady = view.seats.find((s) => s.id === me)?.ready;
  const readyCount = view.seats.filter((s) => s.ready).length;
  const here = view.seats.filter((s) => !s.away).length;

  let verdict: string;
  if (reveal.answer === null) verdict = `${hot.name} never picked. No points this round.`;
  else if (reveal.predictors === 0) verdict = "Nobody made a prediction!";
  else if (reveal.right === reveal.predictors) verdict = `Everyone read ${amHot ? "you" : hot.name} perfectly! 📖`;
  else if (reveal.right === 0) verdict = `Nobody saw that coming! 🤯`;
  else verdict = `${reveal.right} of ${reveal.predictors} read ${amHot ? "you" : hot.name} right`;

  let mineLine: string | null = null;
  if (amHot) mineLine = `You score +${reveal.pts[me] ?? 0}`;
  else if (myGuess !== undefined && reveal.answer !== null) {
    mineLine = myGuess === reveal.answer ? `You read it! +${reveal.pts[me]}${reveal.lone === me ? " (only one!)" : ""}` : myGuess === null ? "You didn't predict" : "Not quite…";
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2.5 @md:grid-cols-2">
        {view.opts.map((o, i) => {
          const win = reveal.answer === i;
          return (
            <div
              key={i}
              className={`card flex flex-col gap-2 px-4 py-3 ${win ? "hs-win" : "opacity-60"}`}
              style={win ? { borderColor: OPTION_COLORS[i], boxShadow: `0 0 36px -6px ${OPTION_COLORS[i]}`, background: `linear-gradient(180deg, ${OPTION_COLORS[i]}2e, transparent), var(--color-panel)` } : undefined}
            >
              <div className="flex items-center gap-3">
                <Letter i={i} />
                <OptionLabel text={o} big={win} />
                {win ? (
                  <span className="ml-auto shrink-0 rounded-full px-2.5 py-1 text-xs font-black text-ink" style={{ background: OPTION_COLORS[i] }}>
                    🔥 {amHot ? "YOUR" : hot.name.toUpperCase() + "'S"} PICK
                  </span>
                ) : null}
              </div>
              <div className="flex min-h-7 flex-wrap items-center gap-1">
                {byOpt[i].length ? (
                  byOpt[i].map((id) => <Face key={id} p={who(id)} size={28} ring={win ? "#34d399" : undefined} />)
                ) : (
                  <span className="text-xs text-muted">no predictions</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card hs-in px-4 py-4 text-center">
        <div className="font-display text-2xl font-black @md:text-3xl">{verdict}</div>
        {mineLine ? <div className="mt-1 text-lg font-semibold text-muted">{mineLine}</div> : null}
        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          {Object.entries(reveal.pts)
            .filter(([, p]) => p > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([id, p]) => (
              <PlayerChip key={id} player={who(id)} size="sm">
                <b className="text-[#34d399]">+{p}</b>
              </PlayerChip>
            ))}
        </div>
      </div>

      <p className="text-center text-base text-muted @md:text-lg">
        💬 Talk it out: {amHot ? "why that one? Anyone surprised?" : `ask ${hot.name} why! Who was way off?`}
      </p>

      {playing ? (
        <button className={`btn ${amHot ? "btn-primary" : ""} mx-auto px-8 py-3 text-lg font-bold`} disabled={!!iReady} onClick={() => act({ type: "next" })}>
          {iReady ? `Waiting… ${readyCount}/${here}` : amHot ? (view.next ? "Done talking: next hot seat ▶" : "Done talking: final scores ▶") : "Ready for the next one ▶"}
        </button>
      ) : null}
      {view.next && view.phase === "reveal" ? (
        <p className="text-center text-sm text-muted">
          Next in the hot seat: <b style={{ color: who(view.next).color }}>{view.next === me ? "you!" : who(view.next).name}</b>
        </p>
      ) : null}
    </div>
  );
}

function Final({ view, me, who, byId }: { view: HotView; me: string; who: Who; byId: Record<string, Player> }) {
  const scores = Object.fromEntries(view.seats.map((s) => [s.id, s.score]));
  const best = Math.max(0, ...view.seats.map((s) => s.score));
  const winners = best > 0 ? view.seats.filter((s) => s.score === best).map((s) => s.id) : [];
  const won = winners.includes(me);
  const played = useRef(false);
  useEffect(() => {
    if (played.current) return;
    played.current = true;
    feedback(won ? "win" : "end");
  }, [won]);
  return (
    <div className="relative flex flex-col gap-3">
      {won ? <Confetti /> : null}
      <div className="card hs-in px-4 py-6 text-center">
        <div className="text-5xl">🔥</div>
        <h2 className="mt-1 font-display text-3xl font-black @md:text-5xl">
          {winners.length === 0 ? "Total strangers!" : winners.length === 1 ? `${who(winners[0]).name} knows this crew best` : "A tie at the top!"}
        </h2>
        {winners.length ? (
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {winners.map((id) => (
              <PlayerChip key={id} player={who(id)} />
            ))}
          </div>
        ) : null}
        {view.abandoned ? <p className="mt-2 text-sm text-muted">Ended early: not enough players left.</p> : null}
      </div>
      {view.awards.length ? (
        <div className="grid gap-2 @md:grid-cols-3">
          {view.awards.map((a) => (
            <div key={a.title} className="card hs-in flex items-center gap-3 p-3 @md:flex-col @md:text-center">
              <span className="text-4xl">{a.icon}</span>
              <div className="min-w-0">
                <div className="font-display text-lg font-bold">{a.title}</div>
                <div className="flex flex-wrap items-center gap-1 @md:justify-center">
                  {a.ids.map((id) => (
                    <PlayerChip key={id} player={who(id)} size="sm" />
                  ))}
                </div>
                <div className="text-sm text-muted">{a.note}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <Scoreboard scores={scores} byId={byId} highlight={me} title="Final scores" />
      <p className="text-center text-xs text-muted">
        Right read +{READ_PTS} · only one right +{LONE_BONUS} · hot seat scores the share of friends who read them
      </p>
    </div>
  );
}

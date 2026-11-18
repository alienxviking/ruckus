"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { Note, PlayerChip, Scoreboard, TimerBar, useSecondsLeft } from "@/components/game-ui";
import { Avatar } from "@/components/Avatar";
import { Confetti } from "@/components/Confetti";
import { feedback, sfx } from "@/lib/feedback";
import {
  FOOL_PTS,
  MAX_LEN,
  SPOT_PTS,
  STATEMENT_COLORS,
  setProblem,
  type TruthAction,
  type TruthReveal,
  type TruthView,
} from "./shared";

type Props = GameClientProps<TruthView, TruthAction>;
type Who = (id: string) => Player;

const STYLES = `
@keyframes tb-in { from { opacity: 0; transform: translateY(10px) scale(.97); } }
@keyframes tb-boom { 0% { transform: scale(.85) rotate(-2deg); } 35% { transform: scale(1.06) rotate(1.5deg); } 60% { transform: scale(.98) rotate(-1deg); } 100% { transform: none; } }
@keyframes tb-fuse { 0%, 100% { transform: translateY(0) scale(1); opacity: 1; } 50% { transform: translateY(-3px) scale(1.25); opacity: .7; } }
@keyframes tb-shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-4px) rotate(-1deg); } 75% { transform: translateX(4px) rotate(1deg); } }
.tb-in { animation: tb-in .35s ease both; }
.tb-boom { animation: tb-boom .7s cubic-bezier(.2,.9,.25,1) both; }
.tb-fuse { animation: tb-fuse .5s ease-in-out infinite; display: inline-block; }
.tb-shake { animation: tb-shake .18s linear infinite; }
@keyframes tb-nudge { 0%, 100% { box-shadow: 0 0 0 0 #ff5d7300; } 50% { box-shadow: 0 0 0 5px #ff5d7340; } }
.tb-nudge { animation: tb-nudge 1.6s ease-in-out infinite; }
@keyframes tb-stamp { from { opacity: 0; transform: scale(1.8) rotate(-10deg); } }
.tb-stamp { animation: tb-stamp .3s cubic-bezier(.2,.9,.25,1.3) both; }
@media (prefers-reduced-motion: reduce) { .tb-in, .tb-boom, .tb-fuse, .tb-shake, .tb-nudge, .tb-stamp { animation: none; } }
`;

/** Starters for the writing screen: tap one to drop it into a statement. */
const IDEAS: { label: string; text: string }[] = [
  { label: "🌍 A place I've been", text: "I've been to " },
  { label: "🍜 A weird food", text: "I once ate " },
  { label: "⭐ Someone I met", text: "I once met " },
  { label: "🏆 A hidden talent", text: "I can " },
  { label: "😱 A fear", text: "I'm scared of " },
  { label: "💼 An odd job", text: "I once worked as " },
  { label: "🩹 An injury story", text: "I once hurt myself by " },
  { label: "🎂 A childhood memory", text: "When I was little, I " },
  { label: "🐾 A pet", text: "I once had a pet " },
  { label: "🏅 An award", text: "I once won " },
  { label: "🚫 Never ever", text: "I have never " },
  { label: "🎤 On stage", text: "I once performed " },
  { label: "🧳 Lost item", text: "I once lost " },
  { label: "📺 Was on TV / news", text: "I was once on " },
  { label: "🎮 A record", text: "My record for " },
  { label: "🍕 Food habit", text: "I always eat " },
  { label: "🛌 Sleep habit", text: "I sleep with " },
  { label: "🏫 School story", text: "At school I " },
  { label: "🚗 Travel mishap", text: "On a trip I " },
  { label: "🎸 An instrument", text: "I can play " },
  { label: "📚 A collection", text: "I collect " },
  { label: "🧪 A strange skill", text: "I know how to " },
  { label: "🤝 A famous relative", text: "I'm related to " },
  { label: "🌶️ A dare I did", text: "I once dared myself to " },
  { label: "🏊 A sport", text: "I used to compete in " },
  { label: "🧊 Coldest / hottest", text: "The coldest place I've been is " },
  { label: "🎬 A movie I've seen 10×", text: "I've watched " },
  { label: "🔧 Something I broke", text: "I once broke " },
  { label: "🦴 A body fact", text: "I have " },
  { label: "🗣️ A language", text: "I can say a whole sentence in " },
  { label: "🌙 Up all night", text: "I once stayed up all night to " },
  { label: "🐝 Animal encounter", text: "I was once chased by " },
  { label: "🏠 Where I lived", text: "I once lived " },
  { label: "🎁 Best gift", text: "The best gift I ever got was " },
  { label: "😬 Embarrassing moment", text: "I once accidentally " },
  { label: "🔢 A number", text: "I have exactly " },
];

export default function TruthBombs(props: Props) {
  if (!props.view) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Note>Lighting the fuses…</Note>
      </div>
    );
  }
  return <Board {...props} view={props.view} />;
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

function Num({ i, size = 36 }: { i: number; size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-xl font-display font-black text-ink"
      style={{ width: size, height: size, background: STATEMENT_COLORS[i], fontSize: size * 0.5 }}
    >
      {i + 1}
    </span>
  );
}

function Board({ view, me, byId, isPlayer, act, serverNow, accent }: Props & { view: TruthView }) {
  const who: Who = (id) => byId[id] ?? { id, name: "Someone", color: "#94a3b8", avatar: "❔", connected: false };
  const left = useSecondsLeft(view.phase === "final" ? null : view.endsAt, serverNow);
  const playing = isPlayer && view.seats.some((s) => s.id === me);
  const turnKey = `${view.game}:${view.turn}:${view.phase}`;

  const lastKey = useRef("");
  useEffect(() => {
    if (turnKey === lastKey.current) return;
    lastKey.current = turnKey;
    if (view.phase === "write" && playing) feedback("turn");
    if (view.phase === "vote") feedback(view.presenter === me ? "turn" : "go");
    if (view.phase === "reveal" && view.reveal) {
      const v = view.reveal.votes[me];
      if ((v !== undefined && v === view.reveal.lie) || (view.presenter === me && view.reveal.fooled > 0)) feedback("score");
      else feedback("hit");
    }
  }, [turnKey, view.phase, view.presenter, view.reveal, playing, me]);
  useEffect(() => {
    if (view.phase === "drum") sfx("tick");
  }, [left, view.phase]);

  const header =
    view.phase === "write" ? "✍️ Writing" : view.phase === "final" ? "🏁 Final" : `💣 ${Math.max(1, view.turn)} / ${view.turns}`;

  return (
    <div className="@container mx-auto flex w-full max-w-3xl flex-col gap-3">
      <style>{STYLES}</style>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full border border-line bg-panel px-3 py-1 text-sm font-bold">{header}</span>
        {view.phase !== "final" ? (
          <span className="font-mono text-lg font-bold tabular-nums text-muted">
            {left >= 60 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : `${left}s`}
          </span>
        ) : null}
      </div>
      {view.phase !== "final" ? <TimerBar endsAt={view.endsAt} total={view.phaseMs} serverNow={serverNow} color={accent} /> : null}
      {view.endingAt ? (
        <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-center text-sm">
          Too few players connected. The game ends soon unless someone comes back.
        </p>
      ) : null}

      {view.phase === "write" ? (
        playing ? (
          <Writer view={view} act={act} accent={accent} />
        ) : (
          <div className="card px-4 py-8 text-center font-display text-2xl font-bold">✍️ Everyone is writing two truths and a lie…</div>
        )
      ) : null}
      {view.phase === "write" ? <SeatStrip view={view} who={who} me={me} doneIcon="🔒" /> : null}

      {(view.phase === "vote" || view.phase === "drum" || view.phase === "reveal") && view.presenter ? (
        <Presenting view={view} me={me} who={who} act={act} playing={playing} accent={accent} />
      ) : null}

      {view.phase === "final" ? <Final view={view} me={me} who={who} byId={byId} /> : null}
    </div>
  );
}

// ---------- writing ----------

function Writer({ view, act, accent }: { view: TruthView; act: Props["act"]; accent: string }) {
  const init = view.draft;
  const [lines, setLines] = useState<[string, string, string]>(() => init?.s ?? ["", "", ""]);
  const [lie, setLie] = useState(init?.lie ?? -1);
  const done = !!view.draft?.done;
  const [focus, setFocus] = useState(0);
  const [ideaSeed, setIdeaSeed] = useState(0);
  const refs = [useRef<HTMLTextAreaElement>(null), useRef<HTMLTextAreaElement>(null), useRef<HTMLTextAreaElement>(null)];
  const problem = setProblem(lines, lie);

  // Autosave the draft (private) so the clock never eats someone's work.
  const actRef = useRef(act);
  useEffect(() => {
    actRef.current = act;
  });
  const dirty = useRef(false);
  useEffect(() => {
    if (done || !dirty.current) return;
    const t = setTimeout(() => actRef.current({ type: "save", s: lines, lie, done: false }), 700);
    return () => clearTimeout(t);
  }, [lines, lie, done]);

  const setLine = (i: number, v: string) => {
    const next = [...lines] as [string, string, string];
    next[i] = v.replace(/\n/g, " ").slice(0, MAX_LEN);
    dirty.current = true;
    setLines(next);
  };
  const applyIdea = (text: string) => {
    if (done) return;
    let i = focus;
    if (lines[i].trim()) {
      const empty = lines.findIndex((l) => !l.trim());
      if (empty >= 0) i = empty;
    }
    setLine(i, text);
    sfx("pop");
    requestAnimationFrame(() => {
      const el = refs[i].current;
      if (el) {
        el.focus();
        el.setSelectionRange(text.length, text.length);
      }
    });
  };
  const lock = () => {
    if (problem) return;
    feedback("pop");
    act({ type: "save", s: lines, lie, done: true });
  };

  const ideas = Array.from({ length: 6 }, (_, k) => IDEAS[(ideaSeed * 6 + k * 7 + ideaSeed) % IDEAS.length]);

  return (
    <div className="flex flex-col gap-3">
      <div className="card tb-in px-4 py-4 text-center" style={{ borderColor: accent + "55" }}>
        <h2 className="font-display text-2xl font-black @md:text-3xl">Two truths and one lie about you</h2>
        <p className="mt-1 text-muted">Make the lie believable and the truths surprising. Then mark the lie 💣.</p>
      </div>

      {!done ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="label">Need ideas? Tap one</span>
            <button className="text-sm font-semibold text-muted hover:text-text" onClick={() => setIdeaSeed((x) => x + 1)}>
              🎲 More ideas
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ideas.map((idea) => (
              <button key={idea.label} className="btn tb-in px-2.5 py-1 text-sm" onClick={() => applyIdea(idea.text)}>
                {idea.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {lines.map((line, i) => {
        const isLie = lie === i;
        return (
          <div
            key={i}
            className="card relative flex flex-col gap-2 p-3"
            style={{
              borderColor: isLie ? "#ff5d73" : STATEMENT_COLORS[i] + "55",
              borderWidth: isLie ? 3 : undefined,
              background: isLie ? "linear-gradient(180deg, #ff5d7330, #ff5d7308), var(--color-panel)" : undefined,
            }}
          >
            {isLie && (
              <span
                aria-hidden
                className="tb-stamp absolute -top-3 right-3 rotate-6 rounded-lg border-2 border-ink bg-[#ff5d73] px-2 py-0.5 font-hero text-xs font-extrabold tracking-widest text-ink shadow-[2px_3px_0_rgb(0_0_0/0.5)]"
              >
                LIE
              </span>
            )}
            <div className="flex items-start gap-2.5">
              <Num i={i} />
              <textarea
                ref={refs[i]}
                className="input min-h-[3.2rem] flex-1 resize-none text-lg"
                style={{ fieldSizing: "content" } as React.CSSProperties}
                rows={2}
                maxLength={MAX_LEN}
                value={line}
                disabled={done}
                placeholder={i === 0 ? "I've been to Iceland twice" : i === 1 ? "I can juggle four oranges" : "I once met a famous chef"}
                aria-label={`Statement ${i + 1}`}
                onFocus={() => setFocus(i)}
                onChange={(e) => setLine(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (i < 2) refs[i + 1].current?.focus();
                    else if (!problem) lock();
                  }
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-2 pl-[46px]">
              <button
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl border-2 px-3.5 py-1.5 text-sm font-extrabold transition active:scale-95 ${
                  isLie
                    ? "-rotate-2 border-ink bg-[#ff5d73] text-ink shadow-[3px_4px_0_rgb(0_0_0/0.55)]"
                    : `border-dashed border-[#ff5d73]/80 text-[#ff8a9a] hover:bg-[#ff5d73]/15 ${lie < 0 && !done ? "tb-nudge" : ""}`
                }`}
                disabled={done}
                aria-pressed={isLie}
                onClick={() => {
                  dirty.current = true;
                  setLie(i);
                }}
              >
                <span aria-hidden className="text-base">💣</span>
                {isLie ? "This is my lie" : "Mark as the lie"}
              </button>
              <span className="font-mono text-xs text-muted tabular-nums">
                {[...line].length}/{MAX_LEN}
              </span>
            </div>
          </div>
        );
      })}

      {done ? (
        <div className="flex flex-col items-center gap-2">
          <div className="font-display text-xl font-bold">🔒 Locked in! Waiting for the others…</div>
          <button className="btn px-4 py-2 text-sm" onClick={() => act({ type: "save", s: lines, lie, done: false })}>
            ✏️ Edit
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1.5">
          <button className="btn btn-primary px-8 py-3.5 text-lg font-black" disabled={!!problem} onClick={lock}>
            🔒 Lock in my truth bombs
          </button>
          {problem ? <span className="text-sm text-muted">{problem}</span> : null}
        </div>
      )}
    </div>
  );
}

function SeatStrip({ view, who, me, doneIcon }: { view: TruthView; who: Who; me: string; doneIcon: string }) {
  return (
    <div className="flex flex-wrap justify-center gap-1.5">
      {view.seats
        .filter((s) => view.phase === "write" || s.id !== view.presenter)
        .map((s) => (
          <PlayerChip key={s.id} player={who(s.id)} size="sm" dim={s.away}>
            <span className={s.done ? "" : "text-muted"}>{s.done ? doneIcon : "…"}</span>
            {s.id === me ? <span className="text-xs text-muted">you</span> : null}
          </PlayerChip>
        ))}
    </div>
  );
}

// ---------- presenting ----------

function Presenting({
  view,
  me,
  who,
  act,
  playing,
  accent,
}: {
  view: TruthView;
  me: string;
  who: Who;
  act: Props["act"];
  playing: boolean;
  accent: string;
}) {
  const p = who(view.presenter!);
  const amP = view.presenter === me;
  const canVote = playing && !amP && view.phase === "vote";
  const [local, setLocal] = useState<{ key: string; o: number } | null>(null);
  const key = `${view.game}:${view.turn}`;
  const myVote = view.phase === "vote" && local?.key === key ? local.o : view.myVote;
  const voters = view.seats.filter((s) => s.id !== view.presenter && !s.away);
  const voted = voters.filter((s) => s.done).length;
  const allVoted = voted >= voters.length;
  const reveal = view.phase === "reveal" ? view.reveal : null;

  const vote = (o: number) => {
    if (!canVote || myVote === o) return;
    setLocal({ key, o });
    sfx("pop");
    act({ type: "vote", o });
  };

  let line: ReactNode;
  if (view.phase === "vote") {
    if (amP) line = "🎤 Read them out loud and defend every one!";
    else if (canVote) line = myVote === null ? "Grill them, then tap the one you think is the lie" : "Vote in 💣 (you can still change it)";
    else line = `Which one is ${p.name}'s lie?`;
  } else if (view.phase === "drum") line = "Lighting the fuse…";
  else if (reveal) {
    if (reveal.fooled === 0 && reveal.spotted > 0) line = `Busted! Everyone saw through ${amP ? "you" : p.name}.`;
    else if (reveal.spotted === 0 && reveal.fooled > 0) line = `${amP ? "You" : p.name} fooled everyone! 🎭`;
    else line = `${reveal.spotted} spotted it · ${reveal.fooled} got fooled`;
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        key={key}
        className="card tb-in flex items-center gap-3 px-4 py-3"
        style={{ borderColor: accent + "66", background: `radial-gradient(120% 120% at 0% 0%, ${accent}22, transparent 70%), var(--color-panel)` }}
      >
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full border-4 bg-panel-2 text-3xl" style={{ borderColor: p.color }}>
          <Avatar id={p.avatar} />
        </span>
        <div className="min-w-0">
          <div className="label" style={{ color: accent }}>
            Truth bombs from
          </div>
          <div className="truncate font-display text-2xl font-black @md:text-3xl" style={{ color: p.color }}>
            {amP ? "You" : p.name}
          </div>
        </div>
      </div>

      <div aria-live="polite" className="text-center font-display text-xl font-bold @md:text-2xl">
        {view.phase === "drum" ? <span className="tb-fuse">🧨</span> : null} {line}
      </div>

      <div className="flex flex-col gap-2.5">
        {view.statements.map((st, i) => (
          <Statement
            key={`${key}-${i}`}
            i={i}
            text={st}
            mine={myVote === i}
            canVote={canVote}
            onVote={() => vote(i)}
            drum={view.phase === "drum"}
            reveal={reveal}
            who={who}
          />
        ))}
      </div>

      {view.phase === "vote" ? (
        <div className="flex flex-col items-center gap-2">
          <div className="text-sm text-muted">
            {voted}/{voters.length} voted
          </div>
          {amP ? (
            <button className="btn btn-primary px-8 py-3 text-lg font-black" disabled={!allVoted} onClick={() => act({ type: "reveal" })}>
              {allVoted ? "💥 Reveal my lie" : "Waiting for votes…"}
            </button>
          ) : null}
          <SeatStrip view={view} who={who} me={me} doneIcon="🗳️" />
        </div>
      ) : null}

      {reveal ? <RevealFooter view={view} reveal={reveal} me={me} who={who} act={act} playing={playing} amP={amP} /> : null}
      {!playing && view.phase === "vote" ? <Note>You&apos;re spectating. Votes are revealed after the bomb goes off.</Note> : null}
    </div>
  );
}

function Statement({
  i,
  text,
  mine,
  canVote,
  onVote,
  drum,
  reveal,
  who,
}: {
  i: number;
  text: string;
  mine: boolean;
  canVote: boolean;
  onVote: () => void;
  drum: boolean;
  reveal: TruthReveal | null;
  who: Who;
}) {
  const isLie = reveal?.lie === i;
  const voters = reveal ? Object.entries(reveal.votes).filter(([, v]) => v === i).map(([id]) => id) : [];
  const color = STATEMENT_COLORS[i];
  const style = reveal
    ? isLie
      ? { borderColor: "#ff5d73", background: "radial-gradient(120% 140% at 50% 0%, #ff5d7340, transparent 70%), var(--color-panel)", boxShadow: "0 0 40px -8px #ff5d73" }
      : { borderColor: "#34d39966" }
    : mine
      ? { borderColor: "#ff5d73", background: "linear-gradient(180deg, #ff5d7322, transparent), var(--color-panel)" }
      : { borderColor: color + "55" };
  const body = (
    <>
      <div className="flex items-start gap-3">
        <Num i={i} size={40} />
        <p className="min-w-0 flex-1 break-words text-left font-display text-xl font-bold leading-snug @md:text-3xl">{text}</p>
        {reveal ? (
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-black ${isLie ? "bg-[#ff5d73] text-ink" : "bg-[#34d399]/20 text-[#34d399]"}`}>
            {isLie ? "💣 LIE" : "✓ TRUE"}
          </span>
        ) : mine ? (
          <span className="shrink-0 rounded-full bg-[#ff5d73] px-2.5 py-1 text-xs font-black text-ink">💣 my pick</span>
        ) : null}
      </div>
      {reveal ? (
        <div className="mt-2 flex min-h-7 flex-wrap items-center gap-1 pl-[52px]">
          {voters.length ? voters.map((id) => <Face key={id} p={who(id)} ring={isLie ? "#34d399" : "#ff5d73"} />) : <span className="text-xs text-muted">no votes</span>}
        </div>
      ) : null}
    </>
  );
  const cls = `card w-full px-4 py-4 text-left transition ${reveal && isLie ? "tb-boom" : ""} ${reveal && !isLie ? "opacity-75" : ""} ${drum ? "tb-shake" : ""}`;
  if (canVote) {
    return (
      <button className={`${cls} hover:brightness-110`} style={style} aria-pressed={mine} aria-label={`Vote statement ${i + 1} is the lie: ${text}`} onClick={onVote}>
        {body}
      </button>
    );
  }
  return (
    <div className={cls} style={{ ...style, animationDelay: drum ? `${i * 60}ms` : undefined }}>
      {body}
    </div>
  );
}

function RevealFooter({
  view,
  reveal,
  me,
  who,
  act,
  playing,
  amP,
}: {
  view: TruthView;
  reveal: TruthReveal;
  me: string;
  who: Who;
  act: Props["act"];
  playing: boolean;
  amP: boolean;
}) {
  const ready = view.seats.find((s) => s.id === me)?.done;
  const here = view.seats.filter((s) => !s.away).length;
  const n = view.seats.filter((s) => s.done).length;
  const last = view.turn >= view.turns;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap justify-center gap-1.5">
        {Object.entries(reveal.pts)
          .filter(([, p]) => p > 0)
          .sort((a, b) => b[1] - a[1])
          .map(([id, p]) => (
            <PlayerChip key={id} player={who(id)} size="sm">
              <b className="text-[#34d399]">+{p}</b>
            </PlayerChip>
          ))}
      </div>
      <p className="text-center text-muted">💬 {amP ? "Tell the story behind the truths!" : `Ask ${who(view.presenter!).name} for the stories behind the truths!`}</p>
      {playing ? (
        <button className={`btn ${amP ? "btn-primary" : ""} px-8 py-3 text-lg font-bold`} disabled={!!ready} onClick={() => act({ type: "next" })}>
          {ready ? `Waiting… ${n}/${here}` : amP ? (last ? "Done: final scores ▶" : "Done: next player ▶") : "Ready ▶"}
        </button>
      ) : null}
    </div>
  );
}

// ---------- final ----------

function Final({ view, me, who, byId }: { view: TruthView; me: string; who: Who; byId: Record<string, Player> }) {
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
      <div className="card tb-in px-4 py-6 text-center">
        <div className="text-5xl">💣</div>
        <h2 className="mt-1 font-display text-3xl font-black @md:text-5xl">
          {view.turns === 0 ? "No truth bombs this time" : winners.length === 0 ? "Nobody scored!" : winners.length === 1 ? `${who(winners[0]).name} wins!` : "A tie at the top!"}
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
            <div key={a.title} className="card tb-in flex items-center gap-3 p-3 @md:flex-col @md:text-center">
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
        Spot the lie +{SPOT_PTS} · each friend your lie fools +{FOOL_PTS}
      </p>
    </div>
  );
}

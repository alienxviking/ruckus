"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { Note, PlayerChip, TimerBar, useSecondsLeft } from "@/components/game-ui";
import { Avatar } from "@/components/Avatar";
import { Confetti } from "@/components/Confetti";
import { feedback, sfx } from "@/lib/feedback";
import { TEAMS } from "@/shared/teams";
import type { SmuggleAction, SmuggleEvent, SmuggleLogEntry, SmuggleTurnSummary, SmuggleView } from "./shared";

type Props = GameClientProps<SmuggleView, SmuggleAction>;
type Who = (id: string) => Player;

const STYLES = `
@keyframes sm-in { from { opacity: 0; transform: translateY(10px) scale(.96); } }
@keyframes sm-card { 0% { opacity: 0; transform: rotateX(70deg) scale(.9); } 100% { opacity: 1; transform: none; } }
@keyframes sm-flash { 0% { opacity: 0; transform: scale(.6); } 15% { opacity: 1; transform: scale(1.08); } 70% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(1); } }
@keyframes sm-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }
@keyframes sm-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-6px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(4px); } }
.sm-in { animation: sm-in .35s ease both; }
.sm-card { animation: sm-card .4s cubic-bezier(.2,.9,.25,1) both; transform-origin: 50% 0; }
.sm-flash { animation: sm-flash 1.3s ease both; }
.sm-pulse { animation: sm-pulse 1.6s ease-in-out infinite; }
.sm-shake { animation: sm-shake .4s ease; }
@media (prefers-reduced-motion: reduce) { .sm-in, .sm-card, .sm-flash, .sm-pulse, .sm-shake { animation: none; } }
`;

export default function WordSmuggler(props: Props) {
  if (!props.view) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Note>Packing the contraband…</Note>
      </div>
    );
  }
  return <Board {...props} view={props.view} />;
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

const teamColor = (t: number) => TEAMS[t]?.color ?? "#94a3b8";
const teamName = (t: number) => TEAMS[t]?.name ?? "?";

type Flash = { id: number; kind: "got" | "skip" | "buzz" | "time"; text: string; sub?: string };

function Board({ view, me, byId, isPlayer, act, serverNow, onEvent, accent }: Props & { view: SmuggleView }) {
  const who: Who = (id) => byId[id] ?? { id, name: "Someone", color: "#94a3b8", avatar: "❔", connected: false };
  const left = useSecondsLeft(view.phase === "final" ? null : view.endsAt, serverNow);
  const [flash, setFlash] = useState<Flash | null>(null);
  const flashId = useRef(0);
  const myTeam = view.teams[0].includes(me) ? 0 : view.teams[1].includes(me) ? 1 : -1;

  // One-shot cues from the server.
  const roleRef = useRef(view.role);
  useEffect(() => {
    roleRef.current = view.role;
  });
  useEffect(
    () =>
      onEvent((raw) => {
        const e = raw as SmuggleEvent;
        if (!e || typeof e !== "object") return;
        const id = ++flashId.current;
        if (e.k === "got") {
          feedback("score");
          setFlash({ id, kind: "got", text: "Smuggled!", sub: e.w });
        } else if (e.k === "skip") {
          sfx("pop");
          setFlash({ id, kind: "skip", text: "Skipped", sub: e.w });
        } else if (e.k === "buzz") {
          feedback(roleRef.current === "buzzer" ? "pop" : "hit");
          setFlash({ id, kind: "buzz", text: "BUZZ!", sub: `${who(e.by).name} caught a banned word` });
        } else if (e.k === "time") {
          feedback("go");
          setFlash({ id, kind: "time", text: "Time!" });
        } else if (e.k === "start") {
          feedback("go");
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onEvent],
  );
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash((f) => (f?.id === flash.id ? null : f)), 1300);
    return () => clearTimeout(t);
  }, [flash]);

  // Countdown ticks in the last five seconds of a turn.
  const lastTick = useRef(-1);
  useEffect(() => {
    if (view.phase === "turn" && left > 0 && left <= 5 && left !== lastTick.current) sfx("tick");
    lastTick.current = left;
  }, [left, view.phase]);

  // "You're up" chime when you become the describer.
  const upKey = view.phase === "ready" && view.describer === me ? `${view.game}:${view.turn}` : "";
  const lastUp = useRef("");
  useEffect(() => {
    if (upKey && upKey !== lastUp.current) feedback("turn");
    lastUp.current = upKey;
  }, [upKey]);

  const tc = teamColor(view.team);

  return (
    <div className="@container relative mx-auto flex w-full max-w-3xl flex-col gap-3">
      <style>{STYLES}</style>
      <ScoreHeader view={view} myTeam={myTeam} left={left} />
      {view.phase !== "final" ? <TimerBar endsAt={view.endsAt} total={view.phaseMs} serverNow={serverNow} color={view.phase === "turn" ? tc : accent} /> : null}

      {view.endingAt ? (
        <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-center text-sm">
          Too few players connected. The game ends soon unless someone comes back.
        </p>
      ) : null}

      {view.phase === "ready" ? <UpNext view={view} me={me} who={who} act={act} myTeam={myTeam} isPlayer={isPlayer} left={left} /> : null}
      {view.phase === "turn" ? <Turn view={view} me={me} who={who} act={act} left={left} /> : null}
      {view.phase === "final" ? <Final view={view} me={me} who={who} myTeam={myTeam} /> : null}

      {view.phase !== "final" ? <Rosters view={view} who={who} me={me} /> : null}

      {flash ? <FlashOverlay key={flash.id} flash={flash} /> : null}
    </div>
  );
}

function ScoreHeader({ view, myTeam, left }: { view: SmuggleView; myTeam: number; left: number }) {
  return (
    <div className="flex items-stretch gap-2">
      {[0, 1].map((t) => (
        <div
          key={t}
          className={`card flex min-w-0 flex-1 items-center justify-between gap-1 px-2.5 py-2 @md:px-3 ${view.phase === "turn" && view.team === t ? "lit-edge" : ""}`}
          style={
            {
              "--accent": teamColor(t),
              borderColor: teamColor(t) + (view.team === t && view.phase !== "final" ? "aa" : "44"),
              background: `linear-gradient(180deg, ${teamColor(t)}1f, transparent 80%), var(--color-panel)`,
              order: t === 0 ? 0 : 2,
            } as CSSProperties
          }
        >
          <div className="min-w-0">
            <div className="truncate text-xs font-bold uppercase tracking-wider" style={{ color: teamColor(t) }}>
              {teamName(t)}
              <span className="hidden @md:inline"> team</span>
            </div>
            <div className="truncate text-[11px] text-muted">
              {[myTeam === t ? "your team" : "", view.phase === "turn" && view.team === t ? "describing" : ""].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div key={view.score[t]} className="sm-in font-display text-3xl font-black tabular-nums @md:text-4xl" style={{ color: teamColor(t) }}>
            {view.score[t]}
          </div>
        </div>
      ))}
      <div className="card flex w-[4.5rem] shrink-0 flex-col items-center justify-center px-2 py-1 text-center @md:w-24" style={{ order: 1 }}>
        {view.phase === "final" ? (
          <span className="text-2xl">🏁</span>
        ) : (
          <>
            <span className={`font-display text-2xl font-black tabular-nums @md:text-3xl ${view.phase === "turn" && left <= 10 ? "text-brand" : ""}`}>{left}s</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              turn {view.turn}/{view.turns}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- up next ----------

function UpNext({
  view,
  me,
  who,
  act,
  myTeam,
  isPlayer,
  left,
}: {
  view: SmuggleView;
  me: string;
  who: Who;
  act: Props["act"];
  myTeam: number;
  isPlayer: boolean;
  left: number;
}) {
  const d = who(view.describer);
  const tc = teamColor(view.team);
  const mine = view.describer === me;
  let role: ReactNode;
  if (mine) role = "You're describing! Only you will see the word. Don't share your screen during your turn.";
  else if (myTeam === view.team) role = `You're guessing for ${teamName(view.team)}. Shout out answers on the call!`;
  else if (myTeam >= 0) role = "You're on watch: you'll see the word and its banned words. Buzz if they slip!";
  else role = isPlayer ? "Get ready!" : "You're spectating.";

  return (
    <div className="flex flex-col gap-3">
      <div
        key={`${view.turn}-${view.describer}`}
        className="card sm-in flex flex-col items-center gap-3 px-4 py-6 text-center"
        style={{ borderColor: tc + "77", background: `radial-gradient(120% 90% at 50% 0%, ${tc}26, transparent 70%), var(--color-panel)` }}
      >
        <div className="label" style={{ color: tc }}>
          Up next · {teamName(view.team)} team
        </div>
        <div className="grid h-20 w-20 place-items-center rounded-full border-4 bg-panel-2 text-5xl" style={{ borderColor: tc }}>
          <Avatar id={d.avatar} />
        </div>
        <h2 className="font-display text-3xl font-black tracking-tight @md:text-5xl">{mine ? "You're up!" : `${d.name} describes`}</h2>
        <p className="max-w-lg text-base text-muted @md:text-lg">{role}</p>
        {mine ? (
          <button
            className="btn btn-primary sm-pulse mt-1 px-8 py-4 text-xl font-black"
            onClick={() => {
              act({ type: "start" });
            }}
          >
            Start my turn ▶
          </button>
        ) : (
          <p className="text-sm text-muted">Starts when {d.name} is ready (or in {left}s).</p>
        )}
        {mine ? <p className="text-xs text-muted">Starts by itself in {left}s.</p> : null}
      </div>
      {view.last ? <LastTurn last={view.last} who={who} /> : <HowTo custom={view.custom} />}
    </div>
  );
}

function HowTo({ custom }: { custom: boolean }) {
  const steps = [
    ["🗣️", "Describer", "Talk your team to the secret word. Tap Got it when they say it, Skip if stuck."],
    ["🙉", "Teammates", "See only the clock. Shout guesses out loud!"],
    ["🚨", "Other team", custom ? "Sees the word. Buzz if the describer says it (or part of it)." : "Sees the word and 5 banned words. Buzz if one slips out: that word is lost, −1."],
  ];
  return (
    <div className="grid gap-2 @md:grid-cols-3">
      {steps.map(([icon, title, text]) => (
        <div key={title} className="card sm-in flex gap-3 p-3 @md:flex-col @md:text-center">
          <span className="text-3xl">{icon}</span>
          <div>
            <div className="font-display font-bold">{title}</div>
            <div className="text-sm text-muted">{text}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

const RESULT: Record<SmuggleLogEntry["r"], { icon: string; color: string; label: string }> = {
  got: { icon: "✓", color: "#34d399", label: "got it" },
  skip: { icon: "↷", color: "#8a91a7", label: "skipped" },
  buzz: { icon: "🚨", color: "#ff5d73", label: "buzzed" },
  time: { icon: "⌛", color: "#facc15", label: "out of time" },
};

function LogChips({ log, who }: { log: SmuggleLogEntry[]; who: Who }) {
  if (!log.length) return null;
  return (
    <div className="flex flex-wrap justify-center gap-1.5">
      {log.map((e, i) => {
        const r = RESULT[e.r];
        return (
          <span
            key={i}
            className="sm-in inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm font-semibold"
            style={{ borderColor: r.color + "66", background: r.color + "18", textDecoration: e.r === "got" ? undefined : "line-through", textDecorationColor: r.color }}
            title={e.r === "buzz" && e.by ? `Buzzed by ${who(e.by).name}` : r.label}
          >
            <span style={{ color: r.color }}>{r.icon}</span>
            {e.w}
          </span>
        );
      })}
    </div>
  );
}

function LastTurn({ last, who }: { last: SmuggleTurnSummary; who: Who }) {
  const tc = teamColor(last.team);
  const got = last.log.filter((e) => e.r === "got").length;
  const buzzed = last.log.filter((e) => e.r === "buzz").length;
  return (
    <div className="card sm-in flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="label">Last turn</span>
        <span className="text-sm">
          <b style={{ color: who(last.describer).color }}>{who(last.describer).name}</b> smuggled <b>{got}</b>
          {buzzed ? <>, buzzed {buzzed}×</> : null} →{" "}
          <b style={{ color: tc }}>
            {last.pts >= 0 ? "+" : ""}
            {last.pts}
          </b>
        </span>
      </div>
      <LogChips log={last.log} who={who} />
    </div>
  );
}

// ---------- live turn ----------

function Turn({ view, me, who, act, left }: { view: SmuggleView; me: string; who: Who; act: Props["act"]; left: number }) {
  if (view.role === "describer" && view.card) return <DescriberCard view={view} act={act} />;
  if (view.role === "buzzer" && view.card) return <BuzzerCard view={view} who={who} act={act} me={me} />;
  return <GuesserScreen view={view} who={who} left={left} />;
}

function useCardKeys(handler: (e: KeyboardEvent) => void) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      ref.current(e);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
}

function BigCard({ word, ban, color, n, dimWord }: { word: string; ban: string[]; color: string; n: number; dimWord?: boolean }) {
  return (
    <div
      key={n}
      className="card sm-card overflow-hidden text-center"
      style={{ borderColor: color + "99", boxShadow: `0 0 40px -10px ${color}88`, perspective: 800 }}
    >
      <div className="px-4 pb-4 pt-5" style={{ background: `linear-gradient(180deg, ${color}2e, transparent)` }}>
        <div className="label mb-1" style={{ color }}>
          Secret word
        </div>
        <div
          className={`font-display font-black leading-none tracking-tight break-words ${dimWord ? "text-3xl @md:text-5xl" : "text-5xl @md:text-7xl"}`}
          style={{ textShadow: `0 0 24px ${color}66` }}
        >
          {word}
        </div>
      </div>
      {ban.length ? (
        <div className="border-t border-line px-3 pb-4 pt-3">
          <div className="label mb-2 text-[#ff5d73]">🚫 Banned words</div>
          <ul className="grid grid-cols-1 gap-1.5 @sm:grid-cols-2 @lg:grid-cols-5">
            {ban.map((b) => (
              <li key={b} className="rounded-lg border border-[#ff5d73]/40 bg-[#ff5d73]/10 px-2 py-1.5 font-display text-xl font-bold @md:text-2xl">
                {b}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="border-t border-line px-3 py-3 text-sm text-muted">Custom word: saying the word itself (or part of it) gets buzzed.</div>
      )}
    </div>
  );
}

function DescriberCard({ view, act }: { view: SmuggleView; act: Props["act"] }) {
  const card = view.card!;
  const [sent, setSent] = useState(-1);
  const busy = sent === card.n;
  const send = (type: "got" | "skip") => {
    if (busy) return;
    setSent(card.n);
    act({ type, n: card.n });
  };
  useCardKeys((e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      send("got");
    } else if (e.key.toLowerCase() === "s") send("skip");
  });
  const tc = teamColor(view.team);
  const got = view.log.filter((e) => e.r === "got").length;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-center text-base font-semibold @md:text-lg">
        🗣️ Describe it out loud, don&apos;t say the banned words! <span className="text-muted">({got} smuggled)</span>
      </p>
      <BigCard word={card.w} ban={card.ban} color={tc} n={card.n} />
      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <button className="btn py-5 text-lg font-bold" disabled={busy} onClick={() => send("skip")} aria-keyshortcuts="S">
          ↷ Skip
        </button>
        <button
          className="btn py-5 text-2xl font-black text-ink"
          style={{ background: "#34d399", borderColor: "#34d399" }}
          disabled={busy}
          onClick={() => send("got")}
          aria-keyshortcuts="Enter"
        >
          ✓ Got it!
        </button>
      </div>
      <p className="hidden text-center text-xs text-muted @md:block">Keyboard: Enter / Space = Got it · S = Skip</p>
    </div>
  );
}

function BuzzerCard({ view, who, act, me }: { view: SmuggleView; who: Who; act: Props["act"]; me: string }) {
  const card = view.card!;
  const [sent, setSent] = useState(-1);
  const busy = sent === card.n;
  const myColor = teamColor(view.team === 0 ? 1 : 0);
  const buzz = () => {
    if (busy) return;
    setSent(card.n);
    act({ type: "buzz", n: card.n });
  };
  useCardKeys((e) => {
    if (e.key.toLowerCase() === "b") buzz();
  });
  const d = who(view.describer);
  void me;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-center text-base font-semibold @md:text-lg">
        👂 Listen to <span style={{ color: d.color }}>{d.name}</span>. Banned word said? Buzz!
      </p>
      <BigCard word={card.w} ban={card.ban} color={teamColor(view.team)} n={card.n} dimWord />
      <button
        className="btn py-6 text-3xl font-black tracking-widest text-ink @md:py-8 @md:text-4xl"
        style={{ background: "radial-gradient(circle at 50% 30%, #ff8a9b, #ff4769)", borderColor: myColor, boxShadow: "0 8px 30px -8px #ff5d73" }}
        disabled={busy}
        onClick={buzz}
        aria-keyshortcuts="B"
      >
        🚨 BUZZ
      </button>
      <p className="text-center text-xs text-muted">
        Only buzz for a banned word{view.custom ? " (or the word itself)" : ""}. It costs them the word and a point. <span className="hidden @md:inline">Keyboard: B</span>
      </p>
    </div>
  );
}

function GuesserScreen({ view, who, left }: { view: SmuggleView; who: Who; left: number }) {
  const d = who(view.describer);
  const tc = teamColor(view.team);
  const got = view.log.filter((e) => e.r === "got").length;
  const guessing = view.role === "guesser";
  return (
    <div className="flex flex-col gap-3">
      <div
        className="card flex flex-col items-center gap-2 px-4 py-6 text-center"
        style={{ borderColor: tc + "77", background: `radial-gradient(100% 80% at 50% 0%, ${tc}22, transparent 70%), var(--color-panel)` }}
      >
        <div className="flex items-center gap-2 text-lg font-semibold">
          <span className="text-3xl">
            <Avatar id={d.avatar} />
          </span>
          <span style={{ color: d.color }}>{d.name}</span>
          <span className="text-muted">is describing</span>
        </div>
        <div className={`font-display text-8xl font-black tabular-nums leading-none @md:text-9xl ${left <= 10 ? "text-brand sm-pulse" : ""}`}>{left}</div>
        <div className="font-display text-2xl font-black @md:text-3xl">
          {guessing ? "📣 Shout your guesses!" : view.role === "watch" ? "🍿 Watching" : "Get ready…"}
        </div>
        <div key={view.cardNo} className="sm-in mt-1 rounded-full border border-line bg-panel-2 px-4 py-1.5 text-lg">
          <b className="font-display text-2xl" style={{ color: tc }}>
            {got}
          </b>{" "}
          smuggled · card #{Math.max(1, view.log.length + 1)}
        </div>
      </div>
      <LogChips log={view.log} who={who} />
      {view.role === "watch" ? <Note>You&apos;re spectating, so the secret word stays hidden from you.</Note> : null}
    </div>
  );
}

// ---------- rosters ----------

function Rosters({ view, who, me }: { view: SmuggleView; who: Who; me: string }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {[0, 1].map((t) => (
        <div key={t} className="card p-2.5" style={{ borderColor: teamColor(t) + "44" }}>
          <div className="label mb-1.5" style={{ color: teamColor(t) }}>
            {teamName(t)}
          </div>
          <div className="flex flex-wrap gap-1">
            {view.teams[t].map((id) => (
              <PlayerChip key={id} player={who(id)} size="sm" dim={view.away.includes(id)}>
                {id === view.describer && view.phase !== "final" ? <span title="describer">🗣️</span> : null}
                {id === me ? <span className="text-[10px] text-muted">you</span> : null}
              </PlayerChip>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- final ----------

function Final({ view, me, who, myTeam }: { view: SmuggleView; me: string; who: Who; myTeam: number }) {
  const w = view.winner;
  const won = w !== null && w === myTeam;
  const played = useRef(false);
  useEffect(() => {
    if (played.current) return;
    played.current = true;
    feedback(won ? "win" : "end");
  }, [won]);
  const color = w === null ? "#facc15" : teamColor(w);
  void me;
  return (
    <div className="relative flex flex-col gap-3">
      {won ? <Confetti /> : null}
      <div
        className="card sm-in px-4 py-8 text-center"
        style={{ borderColor: color + "88", background: `radial-gradient(120% 100% at 50% 0%, ${color}30, transparent 70%), var(--color-panel)` }}
      >
        <div className="text-5xl">{w === null ? "🤝" : "🏆"}</div>
        <h2 className="mt-2 font-display text-4xl font-black tracking-tight @md:text-6xl" style={{ color }}>
          {w === null ? "It's a tie!" : `${teamName(w)} team wins!`}
        </h2>
        <p className="mt-2 font-display text-3xl font-black tabular-nums">
          <span style={{ color: teamColor(0) }}>{view.score[0]}</span>
          <span className="mx-3 text-muted">–</span>
          <span style={{ color: teamColor(1) }}>{view.score[1]}</span>
        </p>
        {view.abandoned ? <p className="mt-2 text-sm text-muted">Ended early: not enough players left.</p> : null}
      </div>
      {view.awards.length ? (
        <div className="grid gap-2 @md:grid-cols-2">
          {view.awards.map((a) => (
            <div key={a.title} className="card sm-in flex items-center gap-3 p-3">
              <span className="text-4xl">{a.icon}</span>
              <div className="min-w-0">
                <div className="font-display text-lg font-bold">{a.title}</div>
                <div className="flex flex-wrap items-center gap-1">
                  {a.ids.map((id) => (
                    <PlayerChip key={id} player={who(id)} size="sm" />
                  ))}
                  <span className="text-sm text-muted">{a.note}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {view.last ? <LastTurn last={view.last} who={who} /> : null}
      <Rosters view={view} who={who} me={me} />
    </div>
  );
}

// ---------- flash ----------

function FlashOverlay({ flash }: { flash: Flash }) {
  const color = flash.kind === "got" ? "#34d399" : flash.kind === "buzz" ? "#ff5d73" : flash.kind === "time" ? "#facc15" : "#8a91a7";
  return (
    <div aria-live="assertive" className="pointer-events-none fixed inset-x-0 top-24 z-40 flex justify-center px-4">
      <div
        className={`sm-flash rounded-3xl border-2 px-8 py-5 text-center backdrop-blur ${flash.kind === "buzz" ? "sm-shake" : ""}`}
        style={{ borderColor: color, background: color + "26", boxShadow: `0 0 60px -10px ${color}` }}
      >
        <div className="font-display text-5xl font-black tracking-tight @md:text-6xl" style={{ color }}>
          {flash.text}
        </div>
        {flash.sub ? <div className="mt-1 text-lg font-semibold">{flash.sub}</div> : null}
      </div>
    </div>
  );
}

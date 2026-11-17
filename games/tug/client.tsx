"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { TEAMS } from "@/shared/teams";
import { Note, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import { Avatar } from "@/components/Avatar";
import { feedback, sfx } from "@/lib/feedback";
import type { TugAction, TugView } from "./server";
import { COUNTDOWN_MS, FIRST_COUNTDOWN_MS, KIND_INFO, LINE, ROUND_OVER_MS, isSnap, type AnswerEvent, type Prompt } from "./shared";
import { RopeScene, type Kick, type SceneData } from "./scene";
import { ChoicePanel, MashPanel, RhythmPanel, TypePanel } from "./panels";

type Props = GameClientProps<TugView, TugAction>;

const CSS = `
.tw-scene { height: clamp(170px, 46vw, 270px); }
.tw-big { animation: tw-big 1s cubic-bezier(.2,1.5,.4,1) both; }
@keyframes tw-big { 0% { opacity: 0; transform: scale(.3) rotate(-5deg); } 35% { opacity: 1; transform: scale(1.12) rotate(2deg); } 55% { transform: scale(1); } 100% { opacity: 1; transform: scale(1); } }
.tw-shake { animation: tw-shake .35s ease both; }
@keyframes tw-shake { 20% { transform: translateX(-6px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(3px); } }
.tw-bump { display: inline-block; animation: tw-bump .45s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes tw-bump { 0% { transform: scale(1.6); } 100% { transform: scale(1); } }
.tw-press { animation: tw-press .14s ease-out both; }
@keyframes tw-press { 0% { transform: scale(.88); } 100% { transform: scale(1); } }
.tw-mash:active { transform: scale(.97); }
.tw-frenzy { animation: tw-frenzy .5s ease-in-out infinite alternate; }
@keyframes tw-frenzy { from { transform: scale(1) rotate(-2deg); } to { transform: scale(1.08) rotate(2deg); } }
@media (prefers-reduced-motion: reduce) { .tw-big, .tw-shake, .tw-bump, .tw-press, .tw-frenzy { animation: none; } }
`;

const TEAM_DOT = ["🔴", "🔵"];

function subscribeReducedMotion(cb: () => void) {
  const m = window.matchMedia("(prefers-reduced-motion: reduce)");
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

function isView(v: unknown): v is TugView {
  if (!v || typeof v !== "object") return false;
  const x = v as Partial<TugView>;
  return Array.isArray(x.ids) && Array.isArray(x.team) && Array.isArray(x.wins) && typeof x.kind === "string" && isSnap(x.snap);
}

export default function TugOfWar(props: Props) {
  if (!isView(props.view)) {
    return (
      <div className="card grid min-h-[40vh] place-items-center p-6">
        <Note>Stretching the rope…</Note>
      </div>
    );
  }
  return <Game {...props} view={props.view} />;
}

function Game({ view, me, byId, isPlayer, act, serverNow, onEvent, accent }: Omit<Props, "view"> & { view: TugView }) {
  const reduced = useReducedMotion();
  const secs = useSecondsLeft(view.endsAt, serverNow);
  const { phase, round, ids, team, kind } = view;
  const info = KIND_INFO[kind];
  const mySlot = isPlayer ? ids.indexOf(me) : -1;
  const myTeam = mySlot >= 0 ? team[mySlot] : -1;
  const lastRound = view.history[view.history.length - 1];
  const winner = phase === "final" ? (view.champion ?? -1) : phase === "roundOver" ? (lastRound?.w ?? -1) : -1;
  const kickRef = useRef<Kick>({ n: 0, team: 0 });

  // ----- live rope position (for the banner), private answer events -----
  const [pos, setPos] = useState(view.snap.p / 10);
  const [answer, setAnswer] = useState<AnswerEvent | null>(null);
  const posAt = useRef(0);
  useEffect(
    () =>
      onEvent((e) => {
        if (isSnap(e)) {
          const now = performance.now();
          if (now - posAt.current > 250) {
            posAt.current = now;
            setPos(e.p / 10);
          }
          return;
        }
        if (!e || typeof e !== "object") return;
        const ev = e as { k?: unknown };
        if (ev.k === "a") {
          const a = e as AnswerEvent;
          setAnswer(a);
          if (a.ok) feedback(a.streak >= 3 ? "score" : "pop");
          else feedback("error");
        }
      }),
    [onEvent],
  );
  const [snapSeen, setSnapSeen] = useState(view.snap);
  if (snapSeen !== view.snap) {
    setSnapSeen(view.snap);
    setPos(view.snap.p / 10);
  }

  // Your current question: whichever is newer, the view's or the last answer's follow-up.
  const vp = view.me?.prompt ?? null;
  const ep = answer?.next ?? null;
  const prompt: Prompt | null = phase !== "pull" ? null : vp && ep ? (ep.q > vp.q ? ep : vp) : vp;
  const streak = answer && prompt && answer.next?.q === prompt.q ? answer.streak : (view.me?.streak ?? 0);
  const lock = Math.max(view.me?.lock ?? 0, answer?.lock ?? 0);

  // ----- sounds for the big moments -----
  useEffect(() => {
    if (phase === "countdown" && secs > 0 && secs <= 3) sfx("tick");
  }, [phase, secs]);
  const prevPhase = useRef(phase);
  const frenzyNow = phase === "pull" && view.endsAt - view.frenzyMs <= serverNow();
  const [frenzy, setFrenzy] = useState(false);
  useEffect(() => {
    if (phase !== "pull") return;
    const tick = () => setFrenzy(view.endsAt - view.frenzyMs <= serverNow());
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [phase, view.endsAt, view.frenzyMs, serverNow]);
  const inFrenzy = phase === "pull" && (frenzy || frenzyNow);
  useEffect(() => {
    if (inFrenzy) sfx("go");
  }, [inFrenzy]);
  // Round MVP: rope pulled during this round.
  const roundStart = useRef<number[]>(view.pulled);
  useEffect(() => {
    const was = prevPhase.current;
    prevPhase.current = phase;
    if (was === phase) return;
    if (phase === "pull") {
      roundStart.current = view.pulled;
      if (mySlot >= 0) feedback("go");
      else sfx("go");
    } else if (phase === "roundOver" || phase === "final") {
      const w = phase === "final" ? view.champion : view.history[view.history.length - 1]?.w;
      if (phase === "final") feedback(myTeam >= 0 && w === myTeam ? "win" : "end");
      else if (myTeam >= 0 && w === myTeam) feedback("score");
      else if (myTeam >= 0 && typeof w === "number" && w >= 0) feedback("out");
      else sfx("pop");
    }
  }, [phase, view.pulled, view.history, view.champion, mySlot, myTeam]);

  const name = (slot: number) => byId[ids[slot]]?.name ?? "Someone";
  const roundMvp = (() => {
    if (phase !== "roundOver" || !lastRound || lastRound.w < 0) return null;
    let best = -1;
    let bv = 0;
    ids.forEach((_, i) => {
      if (team[i] !== lastRound.w) return;
      const d = (view.pulled[i] ?? 0) - (roundStart.current[i] ?? 0);
      if (d > bv) [best, bv] = [i, d];
    });
    return best >= 0 ? { slot: best, v: bv } : null;
  })();

  // ----- status copy -----
  const lead: number = pos < -2 ? 0 : pos > 2 ? 1 : -1;
  const pct = Math.round((Math.abs(pos) / LINE) * 100);
  let head: ReactNode;
  let sub: ReactNode;
  const youAre = myTeam >= 0 ? `You're ${TEAM_DOT[myTeam]} ${TEAMS[myTeam].name}: pull ${myTeam === 0 ? "⟵ left" : "right ⟶"}` : null;
  if (phase === "countdown") {
    head = round === 1 ? "🪢 Tug of War!" : `Round ${round}: ${info.icon} ${info.label}`;
    sub = round === 1 ? (youAre ?? `${TEAMS[0].name} vs ${TEAMS[1].name}: drag the flag over your line`) : info.blurb;
  } else if (phase === "pull") {
    head = inFrenzy ? "🔥 FRENZY! Every pull counts 1.6×" : `${info.icon} ${info.verb}`;
    sub =
      lead < 0
        ? "Dead even. Somebody PULL!"
        : `${TEAM_DOT[lead]} ${TEAMS[lead].name} ${pct > 70 ? "is almost over the line!" : pct > 35 ? "is dragging it!" : "edges ahead"} (${pct}%)`;
  } else if (phase === "roundOver") {
    head =
      !lastRound || lastRound.w < 0
        ? "🤝 Dead level: nobody scores"
        : lastRound.how === "line"
          ? `${TEAM_DOT[lastRound.w]} ${TEAMS[lastRound.w].name} drags it over!`
          : `⏱ ${TEAM_DOT[lastRound.w]} ${TEAMS[lastRound.w].name} ahead at the buzzer!`;
    sub = view.nextKind ? `Next: ${KIND_INFO[view.nextKind].icon} ${KIND_INFO[view.nextKind].label} in ${secs}s` : `Next round in ${secs}s`;
  } else {
    const w = view.champion ?? -1;
    head = w >= 0 ? `🏆 ${TEAMS[w].name} team wins the tug!` : "🤝 It's a draw";
    sub = view.forfeit ? "The other side let go of the rope" : `Final score ${view.wins[0]}–${view.wins[1]}`;
  }
  if (view.abandonAt && phase !== "final") {
    const left = Math.max(0, Math.ceil((view.abandonAt - serverNow()) / 1000));
    sub = `⏳ A whole team dropped out: the match ends in ${left}s unless someone comes back`;
  }

  // ----- timer row -----
  let timerEnds = 0;
  let timerTotal = 0;
  let timerColor = accent;
  let clock = "";
  if (phase === "countdown") {
    timerEnds = view.endsAt;
    timerTotal = round === 1 ? FIRST_COUNTDOWN_MS : COUNTDOWN_MS;
    clock = `go in ${secs}`;
  } else if (phase === "pull") {
    timerEnds = view.endsAt;
    timerTotal = view.roundMs;
    timerColor = inFrenzy ? "#f87171" : accent;
    clock = `${secs}s`;
  } else if (phase === "roundOver") {
    timerEnds = view.endsAt;
    timerTotal = ROUND_OVER_MS;
    clock = `next in ${secs}`;
  }

  const sceneData: SceneData = {
    phase,
    round,
    ids,
    team,
    avatars: ids.map((id) => byId[id]?.avatar ?? "🙂"),
    offline: ids.map((id) => byId[id]?.connected === false),
    mySlot,
    frenzy: inFrenzy,
    reduced,
    winner,
    accent,
    snap: view.snap,
  };
  const label = `Tug of war rope, round ${round}. The flag is ${lead < 0 ? "in the middle" : `${pct}% of the way to ${TEAMS[lead].name}'s line`}.`;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3" style={{ "--tw-accent": accent } as React.CSSProperties}>
      <style href="ruckus-tug" precedence="default">
        {CSS}
      </style>
      <StatusBanner accent={myTeam >= 0 ? TEAMS[myTeam].color : accent}>
        <div className="truncate" aria-live="polite">
          {head}
        </div>
        <div className="truncate font-sans text-sm font-normal text-muted">{sub}</div>
      </StatusBanner>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2 text-sm">
          <Pips team={0} wins={view.wins[0]} need={view.winsNeeded} mine={myTeam === 0} />
          <span className="min-w-0 truncate text-center text-muted">
            <b className="text-text">R{round}</b> · {info.icon} {info.label}
            {clock && <span className="tabular-nums"> · {clock}</span>}
          </span>
          <Pips team={1} wins={view.wins[1]} need={view.winsNeeded} mine={myTeam === 1} />
        </div>
        <TimerBar endsAt={timerEnds} total={timerTotal} serverNow={serverNow} color={timerColor} />
      </div>

      <div className="relative">
        <RopeScene data={sceneData} onEvent={onEvent} kickRef={kickRef} label={label} />
        <SceneOverlay view={view} secs={secs} frenzy={inFrenzy} myTeam={myTeam} mvp={roundMvp ? `💪 ${name(roundMvp.slot)} pulled hardest` : null} />
      </div>

      {phase !== "final" && (
        <div className="card p-3 sm:p-4" style={{ borderColor: myTeam >= 0 ? TEAMS[myTeam].color + "55" : undefined }}>
          {mySlot < 0 ? (
            <Note>👀 You&apos;re watching. Cheer for a team!</Note>
          ) : phase === "countdown" ? (
            <GetReady view={view} myTeam={myTeam} secs={secs} />
          ) : phase === "roundOver" ? (
            <BetweenRounds view={view} myTeam={myTeam} />
          ) : kind === "mash" ? (
            <MashPanel key={round} act={act} team={myTeam} kickRef={kickRef} active />
          ) : kind === "rhythm" ? (
            <RhythmPanel key={round} act={act} pullAt={view.pullAt} endsAt={view.endsAt} serverNow={serverNow} team={myTeam} kickRef={kickRef} onEvent={onEvent} active />
          ) : kind === "type" ? (
            <TypePanel act={act} prompt={prompt} streak={streak} lock={lock} serverNow={serverNow} team={myTeam} kickRef={kickRef} last={answer} />
          ) : (
            <ChoicePanel act={act} prompt={prompt} streak={streak} lock={lock} serverNow={serverNow} team={myTeam} kickRef={kickRef} last={answer} />
          )}
        </div>
      )}

      {phase === "final" ? <Final view={view} byId={byId} me={me} /> : <Rosters view={view} byId={byId} me={me} />}
    </div>
  );
}

function Pips({ team, wins, need, mine }: { team: number; wins: number; need: number; mine: boolean }) {
  const col = TEAMS[team].color;
  return (
    <span className={`flex shrink-0 items-center gap-1 ${team === 1 ? "flex-row-reverse" : ""}`}>
      <span className="font-display text-xs font-black tracking-wide uppercase" style={{ color: col }}>
        {TEAMS[team].name}
        {mine && <span className="text-text"> (you)</span>}
      </span>
      {Array.from({ length: need }, (_, i) => (
        <span
          key={i}
          className={`size-3 rounded-full border-2 ${i < wins ? "tw-bump" : ""}`}
          style={{ borderColor: col, background: i < wins ? col : "transparent", boxShadow: i < wins ? `0 0 8px ${col}` : undefined }}
        />
      ))}
    </span>
  );
}

function SceneOverlay({ view, secs, frenzy, myTeam, mvp }: { view: TugView; secs: number; frenzy: boolean; myTeam: number; mvp: string | null }) {
  const info = KIND_INFO[view.kind];
  if (view.phase === "countdown") {
    return (
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="flex flex-col items-center rounded-2xl bg-ink/55 px-5 py-2 backdrop-blur-[2px]">
          <span className="text-xs font-semibold tracking-wide text-white/80 uppercase">
            Round {view.round} · {info.icon} {info.label}
          </span>
          <span key={secs} className="animate-pop font-display text-6xl font-black text-white drop-shadow-[0_4px_14px_rgba(0,0,0,0.75)]">
            {Math.max(1, secs)}
          </span>
        </div>
      </div>
    );
  }
  if (view.phase === "pull" && frenzy) {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
        <span className="tw-frenzy rounded-full bg-red-600/90 px-3 py-1 font-display text-sm font-black tracking-wider text-white shadow-[0_0_20px_rgba(239,68,68,.7)]">
          🔥 FRENZY ×1.6
        </span>
      </div>
    );
  }
  if (view.phase === "roundOver" || view.phase === "final") {
    const w = view.phase === "final" ? (view.champion ?? -1) : (view.history[view.history.length - 1]?.w ?? -1);
    const text = w < 0 ? "DRAW" : myTeam < 0 ? `${TEAMS[w].name.toUpperCase()}!` : w === myTeam ? (view.phase === "final" ? "CHAMPIONS!" : "YOU PULLED IT!") : view.phase === "final" ? "DEFEATED" : "LOST IT!";
    return (
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="tw-big flex flex-col items-center">
          <span
            className="font-display text-4xl font-black tracking-tight drop-shadow-[0_4px_14px_rgba(0,0,0,0.85)] sm:text-6xl"
            style={{ color: w >= 0 ? TEAMS[w].color : "#fff", WebkitTextStroke: "1.5px rgba(0,0,0,.5)" }}
          >
            {text}
          </span>
          {mvp && <span className="mt-1 rounded-full bg-ink/70 px-3 py-0.5 text-sm font-semibold text-white">{mvp}</span>}
        </div>
      </div>
    );
  }
  return null;
}

function GetReady({ view, myTeam, secs }: { view: TugView; myTeam: number; secs: number }) {
  const info = KIND_INFO[view.kind];
  const col = TEAMS[myTeam]?.color ?? "#fff";
  const how: Record<string, string> = {
    mash: "Tap the big PULL button as fast as you can (two fingers help). On a keyboard, hammer Space.",
    type: "A word appears: type it. It sends itself the moment it's right.",
    sums: "Tap the right answer (keys 1–4). A wrong one slips the rope back and freezes you for a moment.",
    colour: "Tap the colour the word is PAINTED in, not what it says (keys 1–4).",
    rhythm: "Beats slide into the ring. Tap HEAVE (or Space) right as each one lands.",
  };
  return (
    <div className="flex flex-col items-center gap-2 py-2 text-center">
      {view.round === 1 && myTeam >= 0 && (
        <span className="rounded-full px-3 py-1 text-sm font-black tracking-wide text-ink uppercase" style={{ background: col }}>
          You&apos;re team {TEAMS[myTeam].name}: pull {myTeam === 0 ? "⟵ left" : "right ⟶"}
        </span>
      )}
      <span key={view.kind} className="tw-big font-display text-5xl font-black" style={{ color: col }}>
        {info.icon} {info.verb}
      </span>
      <p className="max-w-md text-sm text-muted">{how[view.kind]}</p>
      <span className="text-xs text-muted">Get ready… {secs}</span>
    </div>
  );
}

function BetweenRounds({ view, myTeam }: { view: TugView; myTeam: number }) {
  const last = view.history[view.history.length - 1];
  const next = view.nextKind ? KIND_INFO[view.nextKind] : null;
  const behind = myTeam >= 0 && view.wins[myTeam] < view.wins[1 - myTeam];
  return (
    <div className="flex flex-col items-center gap-1.5 py-2 text-center">
      <span className="font-display text-3xl font-black">
        <span style={{ color: TEAMS[0].color }}>{view.wins[0]}</span>
        <span className="text-muted"> – </span>
        <span style={{ color: TEAMS[1].color }}>{view.wins[1]}</span>
      </span>
      {last && last.w >= 0 && myTeam >= 0 && (
        <span className="text-sm text-muted">{last.w === myTeam ? "Nice heave! Keep it up." : behind ? "Behind? Pulling back from your side is up to 30% stronger. Comeback time." : "Shake it off."}</span>
      )}
      {next && (
        <span className="mt-1 rounded-xl border border-line bg-panel-2 px-3 py-1.5 text-sm">
          Next up: <b>{next.icon} {next.label}</b> · <span className="text-muted">{next.blurb}</span>
        </span>
      )}
    </div>
  );
}

function Rosters({ view, byId, me }: { view: TugView; byId: Record<string, Player>; me: string }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {[0, 1].map((t) => (
        <div key={t} className="card p-2.5" style={{ borderColor: TEAMS[t].color + "55", background: `linear-gradient(180deg, ${TEAMS[t].color}14, transparent 70%), var(--color-panel)` }}>
          <div className="mb-1.5 font-display text-sm font-black tracking-wide uppercase" style={{ color: TEAMS[t].color }}>
            {TEAM_DOT[t]} {TEAMS[t].name}
          </div>
          <ul className="space-y-1">
            {view.ids.map((id, i) =>
              view.team[i] !== t ? null : (
                <li key={id} className={`flex items-center justify-between gap-1 rounded-md px-1 text-sm ${id === me ? "bg-panel-2" : ""} ${byId[id]?.connected === false ? "opacity-40" : ""}`}>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Avatar id={byId[id]?.avatar} />
                    <span className="truncate">{byId[id]?.name ?? "Someone"}</span>
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted tabular-nums">{view.pulled[i] ?? 0}</span>
                </li>
              ),
            )}
          </ul>
        </div>
      ))}
      <p className="col-span-2 text-center text-[11px] text-muted">Rope pulled this match (updates after each round). Bigger teams pull a share each, so size doesn&apos;t decide it.</p>
    </div>
  );
}

function Final({ view, byId, me }: { view: TugView; byId: Record<string, Player>; me: string }) {
  const w = view.champion ?? -1;
  return (
    <div className="flex flex-col gap-3">
      <div className="card flex flex-wrap items-center justify-center gap-1.5 p-3">
        <span className="label mr-1">Rounds</span>
        {view.history.map((h, i) => (
          <span
            key={i}
            className="rounded-lg border px-2 py-0.5 text-sm font-semibold"
            style={{ borderColor: h.w >= 0 ? TEAMS[h.w].color : "var(--color-line)", color: h.w >= 0 ? TEAMS[h.w].color : undefined }}
            title={h.how === "line" ? "dragged over the line" : h.how === "time" ? "ahead at the buzzer" : "draw"}
          >
            {KIND_INFO[h.kind].icon} {h.w >= 0 ? TEAMS[h.w].name : "Draw"}
            {h.how === "time" ? " ⏱" : ""}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {[0, 1].map((t) => {
          const members = view.ids.map((id, i) => ({ id, i })).filter((m) => view.team[m.i] === t);
          members.sort((a, b) => (view.pulled[b.i] ?? 0) - (view.pulled[a.i] ?? 0));
          return (
            <div
              key={t}
              className={`card p-3 ${w === t ? "lit-edge" : ""}`}
              style={{ borderColor: TEAMS[t].color + (w === t ? "" : "55"), background: `linear-gradient(180deg, ${TEAMS[t].color}${w === t ? "30" : "10"}, transparent 70%), var(--color-panel)` }}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="font-display text-lg font-black uppercase" style={{ color: TEAMS[t].color }}>
                  {w === t ? "🏆 " : ""}
                  {TEAMS[t].name}
                </span>
                <span className="font-display text-2xl font-black">{view.wins[t]}</span>
              </div>
              <ol className="space-y-1">
                {members.map((m, rank) => (
                  <li key={m.id} className={`flex items-center justify-between gap-2 rounded-md px-1.5 py-0.5 ${m.id === me ? "bg-panel-2" : ""}`}>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Avatar id={byId[m.id]?.avatar} />
                      <span className="truncate font-semibold">{byId[m.id]?.name ?? "Someone"}</span>
                      {rank === 0 && (view.pulled[m.i] ?? 0) > 0 && <span title="Pulled hardest">💪</span>}
                    </span>
                    <span className="shrink-0 font-mono text-sm tabular-nums">
                      {view.pulled[m.i] ?? 0}
                      <span className="text-xs text-muted"> pulled</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    </div>
  );
}

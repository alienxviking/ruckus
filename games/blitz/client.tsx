"use client";

import { useCallback, useEffect, useEffectEvent, useState, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { Note, TimerBar, useSecondsLeft } from "@/components/game-ui";
import type { BlitzAction, BlitzView } from "./server";
import { Board } from "./boards";
import { feedback, sfx } from "@/lib/feedback";
import { DOUBLE_LAST, META, MICRO_TYPES, RANKED, fmtPoints, fmtSecs, type Pick, type ResLine, type RoundResult } from "./shared";
import { BlitzStyles, Face, GOLD, GREEN, MEDALS, ROSE, Sparks, cssVars, keyboard, ordinal, personOf } from "./ui";

type Props = GameClientProps<BlitzView, BlitzAction>;

export default function Blitz({ view, me, byId, isPlayer, act, serverNow, accent }: Props) {
  // My answer shows instantly; the server's copy takes over when it arrives.
  const [pending, setPending] = useState<{
    r: number;
    pick: Pick | null;
  } | null>(null);
  const submit = useCallback(
    (a: BlitzAction, pick: Pick | null) => {
      setPending({ r: a.r, pick });
      sfx("pop");
      act(a);
    },
    [act],
  );
  // Phase cues: a new microgame, the go, and how my answer landed (once per phase change).
  const phaseNow = view?.phase ?? null;
  const roundNow = view?.round ?? 0;
  const onPhase = useEffectEvent(() => {
    if (!view) return;
    if (phaseNow === "ready") sfx("pop");
    else if (phaseNow === "play") {
      if (isPlayer) feedback("go");
      else sfx("go");
    } else if (phaseNow === "result" && isPlayer) {
      const line = view.last?.res.find((l) => l.id === me);
      if (line && line.pts > 0) feedback("score");
      else if (line?.ok === false) feedback("error");
    }
  });
  useEffect(() => onPhase(), [phaseNow, roundNow]);

  const claimKeyboard = () => {
    keyboard.owner = me;
  };

  if (!view) {
    return (
      <div className="card mx-auto w-full max-w-4xl p-6 text-center text-muted">
        <span aria-hidden>⚡</span> Warming up the microgames…
      </div>
    );
  }

  const phase = view.phase;
  const playing = phase === "play";
  const answered = playing && (!!view.you?.answered || pending?.r === view.round);
  let myPick: Pick | null = null;
  if (playing) myPick = view.you?.answered ? view.you.pick : pending?.r === view.round ? pending.pick : null;
  if (phase === "result") myPick = view.last?.res.find((l) => l.id === me)?.pick ?? null;
  const pz = view.puzzle;
  const open = !!pz && (pz.t === "count" ? pz.options !== null : pz.t === "memory" ? pz.seq === null : true);
  const canAnswer = isPlayer && playing && open && !answered;
  const meta = view.micro ? META[view.micro.type] : null;

  return (
    <div
      className="blz-root @container mx-auto flex w-full max-w-4xl flex-col gap-3 pb-16 sm:pb-2"
      onPointerDown={claimKeyboard}
      onFocusCapture={claimKeyboard}
    >
      <BlitzStyles />
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {liveText(view, me, isPlayer, answered)}
      </p>

      <TopBar view={view} me={me} isPlayer={isPlayer} accent={accent} />

      <div className="grid items-start gap-3 @2xl:grid-cols-[minmax(0,1fr)_14.5rem]">
        <section
          className={`card @container/stage relative flex min-h-[22rem] min-w-0 flex-col gap-3 overflow-hidden p-3 @sm:p-4 ${
            phase === "final" ? "@2xl:col-span-2" : ""
          }`}
          style={meta ? { borderColor: meta.color + "55" } : undefined}
          aria-label="Microgame"
        >
          {phase === "intro" && <Intro view={view} serverNow={serverNow} accent={accent} />}
          {phase === "ready" && view.micro && <ReadyCard key={view.round} view={view} serverNow={serverNow} />}
          {(phase === "play" || phase === "result") && view.micro && meta && pz && (
            <div key={view.round} className="flex flex-1 flex-col gap-3">
              <StageHeader view={view} serverNow={serverNow} answered={answered} isPlayer={isPlayer} byId={byId} />
              {phase === "result" && view.last && <Outcome result={view.last} me={me} isPlayer={isPlayer} byId={byId} />}
              <div className="flex flex-1 flex-col justify-center">
                <Board
                  pz={pz}
                  view={view}
                  phase={phase}
                  color={meta.color}
                  myPick={myPick}
                  canAnswer={canAnswer}
                  answered={answered}
                  isPlayer={isPlayer}
                  submit={submit}
                  act={act}
                  result={phase === "result" ? view.last : null}
                  byId={byId}
                  me={me}
                  serverNow={serverNow}
                />
              </div>
            </div>
          )}
          {phase === "final" && <Final view={view} byId={byId} me={me} />}
        </section>

        <Standings view={view} byId={byId} me={me} answered={answered} />
      </div>

      {!isPlayer && phase !== "final" && <Note>👀 You&apos;re watching. Only players can answer.</Note>}
    </div>
  );
}

// ---------- top bar ----------

function TopBar({ view, me, isPlayer, accent }: { view: BlitzView; me: string; isPlayer: boolean; accent: string }) {
  const current = view.phase === "ready" || view.phase === "play" ? view.round - 1 : -1;
  const doubleFrom = view.total - DOUBLE_LAST;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-display text-lg font-black">
          <span aria-hidden>⚡</span>
          <span style={{ color: accent }}>Blitz</span>
          {view.round > 0 && view.phase !== "final" && (
            <span className="font-mono text-sm font-bold text-muted tabular-nums">
              {view.round}/{view.total}
            </span>
          )}
          {view.micro?.double && view.phase !== "final" && (
            <span
              className="blz-pop rounded-full px-2 py-0.5 font-sans text-[11px] font-black tracking-wide uppercase"
              style={{ background: "#f9731633", color: "#fb923c" }}
            >
              🔥 ×2
            </span>
          )}
        </span>
        {isPlayer && (
          <span className="flex items-baseline gap-1.5">
            <span className="label">You</span>
            <span key={view.scores[me]} className="blz-pop font-mono text-lg font-black tabular-nums">
              {fmtPoints(view.scores[me] ?? 0)}
            </span>
          </span>
        )}
      </div>
      <ol className="grid grid-cols-12 gap-1" aria-label="Progress">
        {Array.from({ length: view.total }, (_, i) => {
          const done = view.recap[i];
          const isCur = i === current;
          const type = done?.type ?? (isCur ? view.micro?.type : undefined);
          const dbl = i >= doubleFrom;
          return (
            <li
              key={i}
              className={`grid h-7 place-items-center rounded-md border text-[13px] leading-none ${isCur ? "blz-glow" : ""}`}
              style={{
                ...cssVars({ "--c": type ? META[type].color + "aa" : accent }),
                borderColor: type ? META[type].color + (isCur ? "" : "66") : dbl ? "#fb923c66" : "var(--color-line)",
                background: type ? META[type].color + (isCur ? "33" : "1a") : "transparent",
                opacity: !type && !dbl ? 0.6 : 1,
              }}
            >
              <span aria-hidden className={!type && dbl ? "text-[10px] opacity-70" : ""}>
                {type ? META[type].icon : dbl ? "🔥" : "·"}
              </span>
              <span className="sr-only">
                {type ? `${i + 1}: ${META[type].title}` : `${i + 1}: still to come${dbl ? ", double points" : ""}`}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------- intro / ready ----------

function Intro({ view, serverNow, accent }: { view: BlitzView; serverNow: () => number; accent: string }) {
  const secs = useSecondsLeft(view.endsAt, serverNow);
  return (
    <div
      className="blz-in -m-3 flex flex-1 flex-col items-center justify-center gap-4 p-5 text-center @sm:-m-4"
      style={{
        background: `radial-gradient(120% 80% at 50% 0%, ${accent}2e, transparent 65%)`,
      }}
    >
      <span className="label">{view.total} microgames · a few seconds each</span>
      <h2 className="font-display text-4xl font-black tracking-tight @md:text-5xl">Get ready to blitz!</h2>
      <div
        key={secs}
        aria-hidden
        className="blz-count grid size-20 place-items-center rounded-full border-4 font-display text-4xl font-black tabular-nums"
        style={{
          borderColor: accent,
          color: accent,
          boxShadow: `0 0 44px -10px ${accent}`,
        }}
      >
        {secs > 0 ? secs : "Go!"}
      </div>
      <ul className="grid gap-x-6 gap-y-1.5 text-left text-sm text-muted @lg:grid-cols-3">
        {[
          ["✅", "Right + fast scores up to 200"],
          ["🔥", `The last ${DOUBLE_LAST} count double`],
          ["⌨️", "Keys: 1–9, arrows, Space"],
        ].map(([icon, text]) => (
          <li key={icon} className="flex gap-2">
            <span aria-hidden className="w-5 shrink-0 text-center">
              {icon}
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-center gap-1.5" aria-label="Tonight's microgames">
        {MICRO_TYPES.map((t, i) => (
          <span
            key={t}
            title={META[t].title}
            className="blz-pop grid size-9 place-items-center rounded-xl border text-lg"
            style={{
              borderColor: META[t].color + "66",
              background: META[t].color + "1a",
              ...cssVars({ "--d": `${200 + i * 50}ms` }),
            }}
          >
            <span aria-hidden>{META[t].icon}</span>
            <span className="sr-only">{META[t].title}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function ReadyCard({ view, serverNow }: { view: BlitzView; serverNow: () => number }) {
  const micro = view.micro!;
  const m = META[micro.type];
  return (
    <div
      className="-m-3 flex flex-1 flex-col items-center justify-center gap-3 p-5 text-center @sm:-m-4"
      style={{
        background: `radial-gradient(110% 85% at 50% 15%, ${m.color}38, transparent 70%)`,
      }}
    >
      <span className="label blz-in">
        Microgame {view.round} of {view.total}
      </span>
      <span className="blz-card">
        <span
          aria-hidden
          className="blz-wiggle grid size-24 place-items-center rounded-full text-6xl @md:size-28 @md:text-7xl"
          style={{
            background: m.color + "2e",
            boxShadow: `0 0 0 3px ${m.color}66, 0 0 50px -6px ${m.color}`,
          }}
        >
          {m.icon}
        </span>
      </span>
      <h2 className="blz-slide font-display text-4xl font-black tracking-tight @md:text-5xl" style={{ color: m.color }}>
        {m.title}
      </h2>
      <p className="blz-slide max-w-md text-lg font-semibold text-balance" style={cssVars({ "--d": "90ms" })}>
        {m.how}
      </p>
      {micro.double && (
        <span
          className="blz-pop rounded-full border px-3 py-1 text-sm font-black tracking-wide uppercase"
          style={{
            borderColor: "#fb923c",
            color: "#fdba74",
            background: "#f9731622",
            ...cssVars({ "--d": "200ms" }),
          }}
        >
          🔥 Double points!
        </span>
      )}
      <div className="mt-1 w-full max-w-xs">
        <TimerBar endsAt={view.endsAt} total={view.phaseMs} serverNow={serverNow} color={m.color} />
      </div>
    </div>
  );
}

// ---------- play / result ----------

function StageHeader({
  view,
  serverNow,
  answered,
  isPlayer,
  byId,
}: {
  view: BlitzView;
  serverNow: () => number;
  answered: boolean;
  isPlayer: boolean;
  byId: Record<string, Player>;
}) {
  const micro = view.micro!;
  const m = META[micro.type];
  const secs = useSecondsLeft(view.endsAt, serverNow);
  const result = view.phase === "result";
  const waiting = view.ids.filter((id) => !view.answered.includes(id) && byId[id]?.connected !== false).length;
  let side: ReactNode;
  if (result) side = view.round >= view.total ? "Final scores next" : `Next up in ${secs}s`;
  else if (micro.type === "tap") side = `${secs}s`;
  else if (isPlayer && answered && view.ids.length > 1) side = waiting > 0 ? `🔒 Waiting for ${waiting}` : "🔒 Locked";
  else if (isPlayer && answered) side = "🔒 Locked";
  else side = `${secs}s`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-lg text-lg"
            style={{ background: m.color + "2e" }}
          >
            {m.icon}
          </span>
          <span className="truncate font-display text-lg font-black" style={{ color: m.color }}>
            {m.title}
          </span>
        </span>
        <span
          className={`shrink-0 text-sm font-bold tabular-nums ${!result && secs <= 2 && !answered ? "blz-pulse text-rose-300" : "text-muted"}`}
        >
          {side}
        </span>
      </div>
      <TimerBar endsAt={view.endsAt} total={view.phaseMs} serverNow={serverNow} color={result ? "#a39dc8" : m.color} />
    </div>
  );
}

function crowdLine(result: RoundResult, byId: Record<string, Player>): string {
  const n = result.res.length;
  const scored = result.res.filter((l) => l.pts > 0);
  if (n === 1) return "";
  if (result.type === "clock") {
    const best = result.res.filter((l) => l.rank === 1).map((l) => personOf(byId, l.id).name);
    return best.length ? `🎯 Closest: ${best.join(" & ")}` : "Nobody got within 1.5s";
  }
  if (result.type === "tap") {
    const best = result.res.filter((l) => l.rank === 1);
    return best.length
      ? `⚡ Fastest: ${best.map((l) => personOf(byId, l.id).name).join(" & ")} (${best[0].v})`
      : "Nobody tapped!";
  }
  if (!scored.length) return "Nobody got it";
  const fastest = scored.reduce((a, b) => ((b.ms ?? 1e9) < (a.ms ?? 1e9) ? b : a));
  const who = scored.length === n ? "Everyone got it" : `${scored.length}/${n} got it`;
  return `${who} · ⚡ ${personOf(byId, fastest.id).name} ${fmtSecs(fastest.ms ?? 0)}`;
}

function Outcome({
  result,
  me,
  isPlayer,
  byId,
}: {
  result: RoundResult;
  me: string;
  isPlayer: boolean;
  byId: Record<string, Player>;
}) {
  const line = result.res.find((l) => l.id === me) ?? null;
  const crowd = crowdLine(result, byId);
  const ranked = RANKED.includes(result.type);
  let head: ReactNode;
  let detail: string | null = null;
  let tone = "var(--color-line)";
  let good = false;
  if (isPlayer && line) {
    if (line.pts > 0) {
      good = true;
      tone = GREEN;
      const medal = line.rank && line.rank <= 3 ? MEDALS[line.rank - 1] : "✅";
      const pts = (
        <span style={{ color: GREEN }}>
          +{fmtPoints(line.pts)}
          {result.double && (
            <span className="ml-1 align-middle text-xs font-black" style={{ color: "#fb923c" }} title="Double points">
              🔥×2
            </span>
          )}
        </span>
      );
      head = ranked ? (
        <>
          {medal} {ordinal(line.rank ?? 1)} · {pts}
        </>
      ) : (
        <>✅ Correct! {pts}</>
      );
      if (result.type === "clock" && line.v !== null) detail = `You stopped at ${fmtSecs(line.v)}`;
      else if (result.type === "tap") detail = `${line.v} taps`;
      else if (line.ms !== null) detail = `in ${fmtSecs(line.ms)}`;
    } else if (line.ok === false) {
      tone = ROSE;
      head = result.type === "clock" ? "😬 Way off!" : "❌ Not quite!";
      if (result.type === "clock" && line.v !== null) detail = `You stopped at ${fmtSecs(line.v)}`;
    } else {
      head = result.type === "tap" ? "😴 No taps!" : result.type === "clock" ? "⌛ Never stopped!" : "⌛ Too slow!";
    }
  } else {
    head = <>💡 Results</>;
  }
  return (
    <div
      className={`relative flex flex-col items-center rounded-2xl border-2 px-3 py-2 text-center ${good ? "blz-pop" : tone === ROSE ? "blz-shake" : "blz-in"}`}
      style={{
        borderColor: tone,
        background: good ? GREEN + "14" : tone === ROSE ? ROSE + "12" : "transparent",
      }}
    >
      {good && <Sparks color={GREEN} />}
      <span className="font-display text-2xl font-black">{head}</span>
      {(detail || crowd) && (
        <span className="text-sm font-semibold text-muted">{[detail, crowd].filter(Boolean).join(" · ")}</span>
      )}
    </div>
  );
}

// ---------- standings ----------

/** Competition ranks (1, 1, 3) by score. */
function ranksOf(ids: string[], scores: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = 1 + ids.filter((o) => (scores[o] ?? 0) > (scores[id] ?? 0)).length;
  return out;
}

function Standings({
  view,
  byId,
  me,
  answered,
}: {
  view: BlitzView;
  byId: Record<string, Player>;
  me: string;
  answered: boolean;
}) {
  const ids = [...view.ids].sort((a, b) => (view.scores[b] ?? 0) - (view.scores[a] ?? 0));
  const ranks = ranksOf(view.ids, view.scores);
  const lines: Record<string, ResLine> = {};
  if (view.phase === "result" && view.last) for (const l of view.last.res) lines[l.id] = l;
  const tap = view.micro?.type === "tap";
  if (view.phase === "final") return null;
  return (
    <aside className="card p-2.5" aria-label="Scores">
      <div className="label mb-1.5 px-1">Scores</div>
      <ol className={`grid gap-x-2 gap-y-2 @2xl:grid-cols-1 ${view.ids.length > 2 ? "grid-cols-2" : "grid-cols-1"}`}>
        {ids.map((id) => {
          const p = personOf(byId, id);
          const line = lines[id];
          const done = view.phase === "play" && !tap && (view.answered.includes(id) || (id === me && answered));
          // Status sits on the avatar and the points on the row's corner, so names keep their room on phones.
          const mark = done
            ? { t: "✓", c: GREEN, label: "answered" }
            : line && line.pts <= 0
              ? line.ok === false
                ? { t: "✗", c: ROSE, label: "missed" }
                : { t: "–", c: "#6b6590", label: "no answer" }
              : null;
          return (
            <li
              key={id}
              className={`relative flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 ${id === me ? "bg-panel-2" : ""}`}
            >
              <span className="w-3.5 shrink-0 text-right text-[11px] text-muted tabular-nums">{ranks[id]}</span>
              <span className="relative shrink-0">
                <Face player={p} size="xs" />
                {mark && (
                  <span
                    key={mark.t}
                    aria-label={mark.label}
                    className="blz-pop absolute -right-1 -bottom-1 grid size-3.5 place-items-center rounded-full text-[9px] leading-none font-black text-ink"
                    style={{ background: mark.c }}
                  >
                    {mark.t}
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-semibold" style={{ color: p.color }}>
                {p.name}
              </span>
              <span
                key={view.scores[id]}
                className={`shrink-0 font-mono text-xs font-bold tabular-nums ${line && line.pts > 0 ? "blz-pop" : ""}`}
              >
                {fmtPoints(view.scores[id] ?? 0)}
              </span>
              {line && line.pts > 0 && (
                <span
                  key={`d${view.round}`}
                  className="blz-pop absolute -top-2 right-0.5 rounded-full px-1 text-[10px] leading-tight font-black text-ink tabular-nums"
                  style={{ background: GREEN }}
                >
                  +{line.pts}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

// ---------- final ----------

function Final({ view, byId, me }: { view: BlitzView; byId: Record<string, Player>; me: string }) {
  const ids = [...view.ids].sort((a, b) => (view.scores[b] ?? 0) - (view.scores[a] ?? 0));
  const ranks = ranksOf(view.ids, view.scores);
  const top = Math.max(0, ...ids.map((id) => view.scores[id] ?? 0));
  return (
    <div className="blz-in grid items-start gap-4 @2xl/stage:grid-cols-2">
      <div>
        <div className="label mb-2 text-center">Final standings</div>
        <ol className="flex flex-col gap-1">
          {ids.map((id, i) => {
            const p = personOf(byId, id);
            const r = ranks[id];
            const win = top > 0 && view.scores[id] === top;
            return (
              <li
                key={id}
                className="blz-slide flex items-center gap-2 rounded-xl border px-2 py-1.5"
                style={{
                  borderColor: win ? GOLD + "99" : "var(--color-line)",
                  background: win ? GOLD + "14" : id === me ? "var(--color-panel-2)" : "transparent",
                  ...cssVars({ "--d": `${i * 50}ms` }),
                }}
              >
                <span className="w-6 shrink-0 text-center text-base">
                  {r <= 3 && (view.scores[id] ?? 0) > 0 ? MEDALS[r - 1] : <span className="text-sm text-muted">{r}</span>}
                </span>
                <Face player={p} size={view.ids.length > 6 ? "sm" : "md"} />
                <span className="min-w-0 flex-1 truncate font-bold" style={{ color: p.color }}>
                  {p.name}
                  {id === me && <span className="font-semibold text-muted"> (you)</span>}
                </span>
                <span className="shrink-0 text-xs font-semibold text-muted tabular-nums" title="Microgames scored in">
                  ✓{view.hits[id] ?? 0}/{view.total}
                </span>
                <span className="w-14 shrink-0 text-right font-mono text-lg font-black tabular-nums">
                  {fmtPoints(view.scores[id] ?? 0)}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <div>
        <div className="label mb-2 text-center">Microgame by microgame</div>
        <ol className="grid grid-cols-3 gap-1.5 @md/stage:grid-cols-4 @2xl/stage:grid-cols-3">
          {view.recap.map((r, i) => {
            const m = META[r.type];
            const best = r.best.map((id) => personOf(byId, id));
            return (
              <li
                key={i}
                className="blz-pop flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-center"
                style={{
                  borderColor: m.color + "55",
                  background: m.color + "12",
                  ...cssVars({ "--d": `${300 + i * 45}ms` }),
                }}
              >
                <span className="flex items-center gap-1 text-[11px] font-bold">
                  <span aria-hidden>{m.icon}</span>
                  <span className="truncate" style={{ color: m.color }}>
                    {m.title}
                  </span>
                </span>
                {best.length ? (
                  <span className="flex items-center gap-1">
                    <span className="flex -space-x-1.5">
                      {best.slice(0, 3).map((p) => (
                        <Face key={p.id} player={p} size="xs" />
                      ))}
                    </span>
                    <span className="font-mono text-[11px] font-bold text-muted">
                      {r.pts}
                      {r.double ? " 🔥" : ""}
                    </span>
                  </span>
                ) : (
                  <span className="text-[11px] text-muted">nobody</span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

// ---------- screen reader announcements ----------

function liveText(view: BlitzView, me: string, isPlayer: boolean, answered: boolean): string {
  const m = view.micro ? META[view.micro.type] : null;
  switch (view.phase) {
    case "intro":
      return `Blitz is about to start: ${view.total} microgames.`;
    case "ready":
      return m
        ? `Microgame ${view.round} of ${view.total}: ${m.title}. ${m.how}.${view.micro?.double ? " Double points." : ""}`
        : "";
    case "play":
      return answered ? "Locked in." : m ? `Go! ${m.title}.` : "";
    case "result": {
      const line = view.last?.res.find((l) => l.id === me);
      if (!isPlayer || !line) return "Results are in.";
      return line.pts > 0 ? `You scored ${line.pts} points.` : "No points this time.";
    }
    case "final":
      return `Blitz is over. You scored ${view.scores[me] ?? 0} points.`;
  }
}

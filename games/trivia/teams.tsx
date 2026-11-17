"use client";

// Red vs Blue: the "You're on Red" intro, the live team score strip and the final team card.

import { TEAMS } from "@/shared/teams";
import type { Player } from "@/shared/types";
import type { PlayerLine, TeamLine } from "./server";
import { fmt } from "./shared";
import { CountUp, Face, cssVars, personOf } from "./ui";

/** Players wear their team's colour everywhere (chips, faces, names, podium) in team mode. */
export function teamColored(byId: Record<string, Player>, teams: readonly TeamLine[] | null): Record<string, Player> {
  if (!teams) return byId;
  const out: Record<string, Player> = { ...byId };
  teams.forEach((t, i) => {
    for (const id of t.ids) out[id] = { ...personOf(byId, id), color: TEAMS[i].color };
  });
  return out;
}

export function teamIndex(teams: readonly TeamLine[] | null, id: string): number {
  return teams ? teams.findIndex((t) => t.ids.includes(id)) : -1;
}

/** Smaller team's total is scaled up when the teams are uneven; say so in plain words. */
export function fairnessNote(teams: readonly TeamLine[]): string | null {
  const [a, b] = teams.map((t) => t.ids.length);
  if (a === b) return null;
  const small = a < b ? 0 : 1;
  const big = 1 - small;
  const factor = Math.max(a, b) / Math.max(1, Math.min(a, b));
  const x = Number.isInteger(factor) ? String(factor) : factor.toFixed(2).replace(/0$/, "");
  return `Team score = members' points added up. ${TEAMS[small].name} has ${teams[small].ids.length} vs ${teams[big].ids.length}, so ${TEAMS[small].name}'s total counts ×${x} to keep it fair.`;
}

export function TeamIntro({
  teams,
  me,
  byId,
}: {
  teams: [TeamLine, TeamLine];
  me: string;
  byId: Record<string, Player>;
}) {
  const mine = teamIndex(teams, me);
  const color = mine === -1 ? null : TEAMS[mine].color;
  const mates = mine === -1 ? [] : teams[mine].ids.filter((id) => id !== me).map((id) => personOf(byId, id).name);
  const note = fairnessNote(teams);
  return (
    <div
      className="card animate-rise flex flex-col items-center gap-3 px-4 py-4 text-center"
      style={
        color
          ? { borderColor: color + "88", background: `radial-gradient(120% 90% at 50% 0%, ${color}33, transparent 70%), var(--color-panel)` }
          : undefined
      }
    >
      {mine === -1 ? (
        <h2 className="font-display text-2xl font-black">
          <span style={{ color: TEAMS[0].color }}>Red</span> vs <span style={{ color: TEAMS[1].color }}>Blue</span>
        </h2>
      ) : (
        <>
          <h2 className="font-display text-2xl font-black whitespace-nowrap @lg:text-3xl">
            You&apos;re on <span style={{ color: color! }}>{TEAMS[mine].name}</span>
          </h2>
          <p className="-mt-1.5 text-sm text-muted">
            {mates.length ? <>with {mates.join(", ")}</> : note ? "Just you, so your points count extra." : "One on one!"}
          </p>
        </>
      )}
      <div className="grid w-full max-w-xl grid-cols-2 gap-2">
        {teams.map((t, i) => (
          <TeamMembers key={i} team={i} line={t} byId={byId} me={me} />
        ))}
      </div>
      <p className="text-xs text-muted">{note ?? "Team score = all your members' points added up."}</p>
    </div>
  );
}

function TeamMembers({ team, line, byId, me }: { team: number; line: TeamLine; byId: Record<string, Player>; me: string }) {
  const { color, name } = TEAMS[team];
  return (
    <div className="rounded-xl p-2 text-left" style={{ background: color + "14", boxShadow: `inset 0 0 0 1px ${color}44` }}>
      <div className="mb-1.5 text-xs font-black tracking-wide uppercase" style={{ color }}>
        {name} · {line.ids.length}
      </div>
      <ul className="flex flex-col gap-1">
        {line.ids.map((id) => {
          const p = personOf(byId, id);
          return (
            <li key={id} className="flex min-w-0 items-center gap-1.5 text-sm">
              <Face player={p} />
              <span className="truncate font-semibold">
                {p.name}
                {id === me && <span className="font-normal text-muted"> (you)</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Live Red vs Blue totals. During a question it shows who has locked in; at the reveal the gains count up. */
export function TeamStrip({
  teams,
  lines,
  me,
  byId,
  revealing,
}: {
  teams: [TeamLine, TeamLine];
  lines: PlayerLine[];
  me: string;
  byId: Record<string, Player>;
  revealing: boolean;
}) {
  const total = teams[0].score + teams[1].score;
  const share = total > 0 ? teams[0].score / total : 0.5;
  const mine = teamIndex(teams, me);
  const answered = new Set(lines.filter((l) => l.answered).map((l) => l.id));
  return (
    <div className="card p-2.5" aria-label="Team scores">
      <div className="grid grid-cols-2 gap-2">
        {teams.map((t, i) => {
          const { color, name } = TEAMS[i];
          const lead = t.score > teams[1 - i].score;
          return (
            <div key={i} className={`flex min-w-0 flex-col gap-1 ${i === 1 ? "items-end text-right" : ""}`}>
              <div className={`flex items-baseline gap-1.5 ${i === 1 ? "flex-row-reverse" : ""}`}>
                <span className="text-xs font-black tracking-wide uppercase" style={{ color }}>
                  {lead && <span aria-hidden>👑 </span>}
                  {name}
                  {i === mine && <span className="font-semibold text-muted normal-case"> (you)</span>}
                </span>
                {revealing && t.gain > 0 && (
                  <span className="trv-pop font-mono text-xs font-bold text-green-300" style={cssVars({ "--d": "200ms" })}>
                    +{fmt(t.gain)}
                  </span>
                )}
              </div>
              <CountUp
                value={t.score}
                from={t.score - t.gain}
                delay={380}
                duration={700}
                className="font-display text-2xl leading-none font-black tabular-nums @lg:text-3xl"
                style={{ color }}
              />
              <ul className={`flex flex-wrap gap-1 ${i === 1 ? "justify-end" : ""}`}>
                {t.ids.map((id) => {
                  const p = personOf(byId, id);
                  const locked = answered.has(id);
                  return (
                    <li key={`${id}-${locked}`} className={locked ? "trv-pop" : ""} title={p.name}>
                      <span className={`block rounded-full ${locked ? "" : "opacity-45"}`}>
                        <Face player={p} />
                      </span>
                      <span className="sr-only">
                        {p.name}
                        {locked ? " locked in" : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-panel-2" aria-hidden>
        <div className="transition-[width] duration-700" style={{ width: `${share * 100}%`, background: TEAMS[0].color }} />
        <div className="flex-1" style={{ background: TEAMS[1].color }} />
      </div>
    </div>
  );
}

export function TeamFinal({ teams, me }: { teams: [TeamLine, TeamLine]; me: string }) {
  const [a, b] = teams.map((t) => t.score);
  const tie = a === b;
  const w = a >= b ? 0 : 1;
  const mine = teamIndex(teams, me);
  const color = tie ? "#a39dc8" : TEAMS[w].color;
  const note = fairnessNote(teams);
  const title = a === 0 && b === 0 ? "Nobody scored" : tie ? "Red and Blue tie!" : `${TEAMS[w].name} team wins!`;
  const sub = tie || mine === -1 ? null : mine === w ? "Your team won 🎉" : "Your team lost. Next time!";
  return (
    <div
      className="card animate-rise flex flex-col items-center gap-3 p-5 text-center"
      style={{ borderColor: color + "88", background: `radial-gradient(120% 90% at 50% 0%, ${color}2e, transparent 65%), var(--color-panel)` }}
    >
      <h3 className="font-display text-3xl font-black" style={{ color }}>
        {title}
      </h3>
      {sub && <p className="-mt-2 text-sm text-muted">{sub}</p>}
      <div className="flex items-center gap-4 font-display text-4xl font-black tabular-nums">
        <CountUp value={a} from={0} delay={200} duration={1000} style={{ color: TEAMS[0].color }} />
        <span className="text-xl text-muted">vs</span>
        <CountUp value={b} from={0} delay={200} duration={1000} style={{ color: TEAMS[1].color }} />
      </div>
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}

"use client";

// The second half of a round: the reveal show, the vote, the round results,
// and the final standings with a hall of fame and a gallery.

import { useState } from "react";
import type { Player } from "@/shared/types";
import { PlayerChip, Scoreboard, StatusBanner } from "@/components/game-ui";
import type { FinalView, MashupAction, MashupView, MonsterMeta, ResultMonster, RoundResult } from "./server";
import { MonsterArt, useFetchMonsters, useMonster, type MonsterCache } from "./art";
import { NAME_PTS, STAR_PTS } from "./shared";
import { Credits, PhaseClock, Tracker, who } from "./ui";

interface PhaseProps {
  view: MashupView;
  me: string;
  players: Player[];
  byId: Record<string, Player>;
  isPlayer: boolean;
  act: (a: MashupAction) => void;
  serverNow: () => number;
  accent: string;
  cache: MonsterCache;
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

// ---------- reveal ----------

export function RevealPhase({ view, me, players, byId, isPlayer, act, serverNow, accent, cache }: PhaseProps) {
  const rv = view.reveal;
  const at = rv ? rv.at : 0;
  const parts = useMonster(cache, view.round, at);
  useFetchMonsters(cache, view.round, rv ? [at] : [], act, 900);
  if (!rv) return null;
  const mo = rv.monster;
  const done = view.done.includes(me);
  const live = players.filter((p) => p.connected);
  const mine = mo.creators.includes(me);
  const names = mo.names;
  return (
    <>
      <div aria-live="polite" aria-atomic="true">
        <StatusBanner key={at} accent={accent}>
          🎭 Monster {at + 1} of {view.count}
          {mine && <span className="block text-sm font-semibold text-muted">You drew part of this one!</span>}
        </StatusBanner>
      </div>
      <PhaseClock endsAt={view.endsAt} total={view.phaseMs} serverNow={serverNow} accent={accent} />
      <div key={`${view.round}-${at}`} className="grid items-center gap-4 @2xl:grid-cols-[auto_minmax(0,1fr)]">
        <div className="mx-auto" style={{ width: "min(100%, 29vh, 300px)" }}>
          <MonsterArt parts={parts} blank={mo.blank} assemble label={`Monster ${at + 1}, assembled`} className="mm-wobble" />
        </div>
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="label mm-rise" style={{ animationDelay: "700ms" }}>
            {names.length > 1 ? "Ladies and gentlemen, it goes by…" : "Ladies and gentlemen, meet…"}
          </span>
          <ul className="flex flex-col items-center gap-1.5">
            {names.map((n, i) => (
              <li key={i} className="flex flex-col items-center">
                {i > 0 && (
                  <span className="mm-name text-xs text-muted" style={{ animationDelay: `${950 + i * 450}ms` }}>
                    or
                  </span>
                )}
                <span
                  className="mm-name font-display text-2xl leading-tight font-extrabold break-words @md:text-3xl"
                  style={{ animationDelay: `${1000 + i * 450}ms`, color: i === 0 ? accent : undefined }}
                >
                  “{n.text}”
                </span>
                {(n.mine || n.auto) && (
                  <span className="mm-name text-xs text-muted" style={{ animationDelay: `${1100 + i * 450}ms` }}>
                    {n.mine ? "your name" : "🎲 named by the game"}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="mm-rise" style={{ animationDelay: `${1200 + names.length * 450}ms` }}>
            <Credits creators={mo.creators} byId={byId} />
          </div>
          {isPlayer && (
            <button
              type="button"
              className="btn min-h-11 px-5"
              disabled={done}
              aria-label={done ? "Waiting for the others to skip" : "Next monster"}
              onClick={() => act({ type: "next" })}
            >
              {done ? (
                <>
                  ⏳ {view.done.length}/{live.length} ready
                </>
              ) : (
                <>
                  Next <span aria-hidden>⏩</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// ---------- vote ----------

export function VotePhase({ view, me, players, isPlayer, act, serverNow, accent, cache }: PhaseProps) {
  const vote = view.vote;
  const count = vote ? vote.monsters.length : 0;
  useFetchMonsters(cache, view.round, range(count), act, 300);
  // Picks show at once; the server's copy only matters after a refresh.
  const [local, setLocal] = useState<{ m?: number; mi?: number; ni?: number }>({});
  if (!vote) return null;
  const myM = local.m ?? vote.mine.m;
  const myMi = local.mi ?? vote.mine.mi;
  const myNi = local.ni ?? vote.mine.ni;
  const eligible = new Set(vote.eligible);
  const anyName = vote.monsters.some((mo) => mo.names.some((n) => !n.mine && !n.auto));
  const done = view.done.includes(me);

  const star = (m: number) => {
    if (!eligible.has(m)) return;
    setLocal((l) => ({ ...l, m }));
    act({ type: "star", m });
  };
  const pick = (m: number, i: number) => {
    setLocal((l) => ({ ...l, mi: m, ni: i }));
    act({ type: "pick", m, i });
  };

  return (
    <>
      <div aria-live="polite" aria-atomic="true">
        <StatusBanner accent={accent}>
          {isPlayer ? (done ? "✅ Votes in! You can still change them" : "⭐ Vote for your favourites!") : "⭐ The players are voting…"}
        </StatusBanner>
      </div>
      <PhaseClock endsAt={view.endsAt} total={view.phaseMs} serverNow={serverNow} accent={accent} />
      {isPlayer && (
        <div className="flex flex-wrap justify-center gap-2 text-sm">
          <Check ok={myM >= 0} label={`⭐ Favourite monster (+${STAR_PTS} to each artist)`} />
          {anyName && <Check ok={myMi >= 0} label={`🏷️ Favourite name (+${NAME_PTS} to its author)`} />}
        </div>
      )}
      <ul className="grid grid-cols-2 gap-2 @2xl:grid-cols-3 @4xl:grid-cols-4">
        {vote.monsters.map((mo, m) => (
          <VoteCard
            key={m}
            round={view.round}
            m={m}
            mo={mo}
            cache={cache}
            accent={accent}
            isPlayer={isPlayer}
            canStar={eligible.has(m)}
            drew={mo.creators.includes(me)}
            starred={myM === m}
            picked={myMi === m ? myNi : -1}
            onStar={() => star(m)}
            onPick={(i) => pick(m, i)}
          />
        ))}
      </ul>
      <Tracker players={players} done={view.done} accent={accent} label="Voted" />
    </>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`rounded-full border px-2.5 py-1 font-semibold transition-colors ${ok ? "border-emerald-400/60 bg-emerald-500/15" : "border-line text-muted"}`}>
      <span aria-hidden>{ok ? "✓ " : "○ "}</span>
      {label}
      <span className="sr-only">{ok ? " (done)" : " (not yet)"}</span>
    </span>
  );
}

function VoteCard({
  round,
  m,
  mo,
  cache,
  accent,
  isPlayer,
  canStar,
  drew,
  starred,
  picked,
  onStar,
  onPick,
}: {
  round: number;
  m: number;
  mo: MonsterMeta;
  cache: MonsterCache;
  accent: string;
  isPlayer: boolean;
  canStar: boolean;
  drew: boolean;
  starred: boolean;
  picked: number;
  onStar: () => void;
  onPick: (i: number) => void;
}) {
  const parts = useMonster(cache, round, m);
  return (
    <li
      className="card mm-rise flex min-w-0 flex-col gap-2 p-2 transition-shadow"
      style={{
        animationDelay: `${Math.min(m, 8) * 50}ms`,
        borderColor: starred ? accent : undefined,
        boxShadow: starred ? `0 0 0 2px ${accent}, 0 0 22px ${accent}55` : undefined,
      }}
    >
      <div className="relative">
        <MonsterArt parts={parts} blank={mo.blank} label={`Monster #${m + 1}${mo.names[0] ? `, ${mo.names[0].text}` : ""}`} />
        <span className="absolute top-1 left-1 rounded-md bg-black/60 px-1.5 text-xs font-bold text-white">
          #{m + 1}
          {drew && isPlayer && (
            <span title="You drew part of this monster">
              {" "}
              · 🎨<span className="sr-only"> you drew part of this</span>
            </span>
          )}
        </span>
        {starred && (
          <span aria-hidden className="mm-stamp absolute top-1 right-1 text-2xl drop-shadow">
            ⭐
          </span>
        )}
      </div>
      {isPlayer && (
        <button
          type="button"
          aria-pressed={starred}
          disabled={!canStar}
          onClick={onStar}
          className={`btn min-h-10 w-full px-2 text-sm ${starred ? "btn-primary" : ""}`}
          aria-label={canStar ? `Favourite monster #${m + 1}` : `You drew part of monster #${m + 1}`}
        >
          {canStar ? (starred ? "⭐ Your favourite" : "☆ Favourite") : "🎨 Yours"}
        </button>
      )}
      <ul className="flex flex-col gap-1" aria-label={`Names for monster #${m + 1}`}>
        {mo.names.map((n, i) => {
          const on = picked === i;
          const can = isPlayer && !n.mine && !n.auto;
          return (
            <li key={i}>
              <button
                type="button"
                aria-pressed={on}
                disabled={!can}
                onClick={() => onPick(i)}
                aria-label={`Favourite name: ${n.text}${n.mine ? " (yours)" : n.auto ? " (named by the game)" : ""}`}
                className={`flex min-h-10 w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-left text-sm font-semibold break-words transition-colors disabled:cursor-default ${
                  on ? "border-transparent text-ink" : "border-line bg-panel-2 enabled:hover:border-muted"
                }`}
                style={on ? { background: accent } : undefined}
              >
                <span aria-hidden className="shrink-0">
                  {on ? "🏷️" : n.auto ? "🎲" : n.mine ? "✍️" : "🏷️"}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  {n.text}
                  {n.mine && <span className="text-xs font-normal text-muted">your name</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

// ---------- round results ----------

function ranked(r: RoundResult): number[] {
  return range(r.monsters.length).sort((a, b) => r.monsters[b].stars - r.monsters[a].stars || a - b);
}

export function ResultsPhase({ view, me, players, byId, isPlayer, act, serverNow, accent, cache }: PhaseProps) {
  const res = view.results;
  const count = res ? res.monsters.length : 0;
  useFetchMonsters(cache, view.round, range(count), act, 300);
  if (!res) return null;
  const order = ranked(res);
  const champ = res.top.length ? order[0] : -1;
  const gains = Object.entries(res.gains)
    .filter(([, g]) => g > 0)
    .sort((a, b) => b[1] - a[1]);
  const done = view.done.includes(me);
  const last = view.round + 1 >= view.rounds;
  const live = players.filter((p) => p.connected);
  return (
    <>
      <div aria-live="polite" aria-atomic="true">
        <StatusBanner accent={accent}>
          🏁 Round {view.round + 1} results
          {isPlayer && (
            <span className="block text-sm font-semibold text-muted">
              You scored +{res.gains[me] ?? 0} this round
            </span>
          )}
        </StatusBanner>
      </div>
      <PhaseClock endsAt={view.endsAt} total={view.phaseMs} serverNow={serverNow} accent={accent} />
      <div className="grid items-start gap-3 @2xl:grid-cols-[minmax(0,1fr)_16rem]">
        {champ >= 0 ? (
          <Spotlight round={view.round} m={champ} mo={res.monsters[champ]} cache={cache} byId={byId} accent={accent} title="Monster of the round" />
        ) : (
          <p className="card p-4 text-center text-muted">No stars this round. The monsters are heartbroken 💔</p>
        )}
        <div className="flex flex-col gap-3 @2xl:col-start-2 @2xl:row-span-2 @2xl:row-start-1">
          {gains.length > 0 && (
            <section className="card p-3" aria-label="Points this round">
              <h3 className="label mb-2">This round</h3>
              <ul className="flex flex-wrap gap-1.5">
                {gains.map(([id, g], i) => (
                  <li key={id} className="animate-pop" style={{ animationDelay: `${i * 60}ms` }}>
                    <PlayerChip player={who(byId, id)} size="sm">
                      <span className="font-mono font-black" style={{ color: accent }}>
                        +{g}
                      </span>
                    </PlayerChip>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {isPlayer && (
            <button type="button" className="btn btn-primary min-h-11" disabled={done} onClick={() => act({ type: "next" })}>
              {done ? `⏳ ${view.done.length}/${live.length} ready` : last ? "See final scores ⏩" : "Next round ⏩"}
            </button>
          )}
          <Scoreboard scores={view.scores} byId={byId} order={view.players} highlight={me} title="Total" />
        </div>
        <section className="card flex flex-col gap-1 p-2" aria-label="Every monster this round">
          <h3 className="label px-1 pt-1">Every monster</h3>
          <ol className="flex flex-col gap-1">
            {order.map((m) => (
              <ResultRow key={m} round={view.round} m={m} mo={res.monsters[m]} cache={cache} byId={byId} />
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}

function Spotlight({
  round,
  m,
  mo,
  cache,
  byId,
  accent,
  title,
}: {
  round: number;
  m: number;
  mo: ResultMonster;
  cache: MonsterCache;
  byId: Record<string, Player>;
  accent: string;
  title: string;
}) {
  const parts = useMonster(cache, round, m);
  const name = mo.names[mo.best];
  return (
    <section className="card mm-rise flex flex-col items-center gap-3 p-3 @md:flex-row @md:items-center" style={{ borderColor: `${accent}77` }} aria-label={title}>
      <div className="relative shrink-0" style={{ width: "min(60%, 24vh, 200px)" }}>
        <span aria-hidden className="mm-crown absolute -top-5 left-1/2 z-10 -translate-x-1/2 text-3xl">
          👑
        </span>
        <MonsterArt parts={parts} blank={mo.blank} assemble label={`${title}: ${name?.text ?? `monster #${m + 1}`}`} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
        <span className="label">{title}</span>
        {name && (
          <span className="mm-name font-display text-2xl leading-tight font-extrabold break-words" style={{ color: accent, animationDelay: "400ms" }}>
            “{name.text}”
          </span>
        )}
        {name?.by && (
          <span className="text-xs text-muted">
            named by <b style={{ color: who(byId, name.by).color }}>{who(byId, name.by).name}</b>
          </span>
        )}
        <span className="text-lg font-bold">
          {"⭐".repeat(Math.min(mo.stars, 8))}
          <span className="ml-1 font-mono text-sm text-muted">
            {mo.stars} star{mo.stars === 1 ? "" : "s"}
          </span>
        </span>
        <Credits creators={mo.creators} byId={byId} />
      </div>
    </section>
  );
}

function ResultRow({ round, m, mo, cache, byId }: { round: number; m: number; mo: ResultMonster; cache: MonsterCache; byId: Record<string, Player> }) {
  const parts = useMonster(cache, round, m);
  return (
    <li className="flex items-center gap-2 rounded-lg bg-panel-2/60 p-1.5">
      <div className="w-12 shrink-0 @md:w-14">
        <MonsterArt parts={parts} blank={mo.blank} label={`Monster #${m + 1}`} className="rounded-md" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <ul className="flex flex-col gap-0.5">
          {mo.names.map((n, i) => (
            <li key={i} className="flex min-w-0 items-baseline gap-1.5 text-sm">
              <span className={`min-w-0 break-words ${i === mo.best ? "font-bold" : "text-muted"}`}>“{n.text}”</span>
              <span className="shrink-0 text-xs text-muted">
                {n.by ? (
                  <>
                    by <span style={{ color: who(byId, n.by).color }}>{who(byId, n.by).name}</span>
                  </>
                ) : (
                  "🎲 game"
                )}
                {n.votes > 0 && ` · 🏷️${n.votes}`}
              </span>
            </li>
          ))}
        </ul>
        <span className="truncate text-xs text-muted">
          {mo.creators.map((id) => who(byId, id).name).join(" + ")}
        </span>
      </div>
      <span className="shrink-0 px-1 font-mono text-sm font-bold tabular-nums" aria-label={`${mo.stars} stars`}>
        ⭐{mo.stars}
      </span>
    </li>
  );
}

// ---------- final ----------

export function FinalPhase({ view, me, byId, isPlayer, act, accent, cache }: PhaseProps) {
  const f = view.final;
  if (!f) return null;
  const mine = f.scores[me] ?? 0;
  return (
    <>
      <div aria-live="polite">
        <StatusBanner accent={accent}>
          🧪 The lab is closing!
          {isPlayer && <span className="block text-sm font-semibold text-muted">You finished with {mine} points</span>}
        </StatusBanner>
      </div>
      <div className="grid items-start gap-3 @2xl:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex flex-col gap-3">
          {f.hall.length > 0 && <Hall f={f} byId={byId} accent={accent} cache={cache} act={act} />}
          <Awards f={f} byId={byId} accent={accent} />
        </div>
        <Scoreboard scores={f.scores} byId={byId} order={view.players} highlight={me} title="Final scores" />
      </div>
      {f.rounds.length > 0 && <Gallery f={f} byId={byId} cache={cache} act={act} />}
    </>
  );
}

function Hall({ f, byId, accent, cache, act }: { f: FinalView; byId: Record<string, Player>; accent: string; cache: MonsterCache; act: (a: MashupAction) => void }) {
  return (
    <section className="card flex flex-col gap-2 p-3" aria-label="Hall of fame">
      <h3 className="label text-center">Hall of fame</h3>
      <ul className="grid grid-cols-2 gap-3">
        {f.hall.map((h) => (
          <HallCard key={h.round} h={h} byId={byId} accent={accent} cache={cache} act={act} />
        ))}
      </ul>
    </section>
  );
}

function HallCard({
  h,
  byId,
  accent,
  cache,
  act,
}: {
  h: FinalView["hall"][number];
  byId: Record<string, Player>;
  accent: string;
  cache: MonsterCache;
  act: (a: MashupAction) => void;
}) {
  const parts = useMonster(cache, h.round, h.m);
  useFetchMonsters(cache, h.round, [h.m], act, 200);
  return (
    <li className="mm-rise flex min-w-0 flex-col items-center gap-1.5 text-center" style={{ animationDelay: `${h.round * 150}ms` }}>
      <span className="text-xs font-bold text-muted">
        <span aria-hidden>👑 </span>Round {h.round + 1}
      </span>
      <div style={{ width: "min(100%, 24vh, 180px)" }}>
        <MonsterArt parts={parts} blank={h.blank} label={`Round ${h.round + 1} champion: ${h.name}`} className="mm-wobble" />
      </div>
      <span className="font-display text-lg leading-tight font-extrabold break-words" style={{ color: accent }}>
        “{h.name}”
      </span>
      <span className="text-xs text-muted">⭐ {h.stars}</span>
      <Credits creators={h.creators} byId={byId} />
    </li>
  );
}

function Awards({ f, byId, accent }: { f: FinalView; byId: Record<string, Player>; accent: string }) {
  const rows = [
    { icon: "🎨", title: "Star artist", unit: "⭐ on their monsters", a: f.artist },
    { icon: "🏷️", title: "Best namer", unit: "🏷️ votes for their names", a: f.namer },
  ].filter((r) => r.a);
  if (!rows.length) return null;
  return (
    <ul className="grid grid-cols-1 gap-2 @xl:grid-cols-2" aria-label="Awards">
      {rows.map((r, i) => (
        <li
          key={r.title}
          className="mm-rise flex items-center gap-2.5 rounded-xl border bg-panel-2 px-3 py-2"
          style={{ animationDelay: `${200 + i * 100}ms`, borderColor: `${accent}44` }}
        >
          <span aria-hidden className="text-3xl leading-none">
            {r.icon}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs font-bold text-muted">{r.title}</span>
            <span className="flex flex-wrap gap-1">
              {r.a!.ids.map((id) => (
                <PlayerChip key={id} player={who(byId, id)} size="sm" />
              ))}
            </span>
          </div>
          <span className="shrink-0 text-right font-mono text-lg font-bold tabular-nums">
            {r.a!.n}
            <span className="sr-only"> {r.unit}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Gallery({ f, byId, cache, act }: { f: FinalView; byId: Record<string, Player>; cache: MonsterCache; act: (a: MashupAction) => void }) {
  const [tab, setTab] = useState(() => f.rounds.length - 1);
  const r = f.rounds[Math.min(tab, f.rounds.length - 1)];
  useFetchMonsters(cache, r.round, range(r.monsters.length), act, 200);
  return (
    <section className="card flex flex-col gap-2 p-2" aria-label="Monster gallery">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1">
        <h3 className="label">Gallery</h3>
        {f.rounds.length > 1 && (
          <div className="flex gap-1" role="tablist" aria-label="Round">
            {f.rounds.map((x, i) => (
              <button
                key={x.round}
                type="button"
                role="tab"
                aria-selected={i === tab}
                onClick={() => setTab(i)}
                className={`btn min-h-10 px-3 text-sm ${i === tab ? "btn-primary" : ""}`}
              >
                Round {x.round + 1}
              </button>
            ))}
          </div>
        )}
      </div>
      <ul className="grid grid-cols-3 gap-2 @2xl:grid-cols-4 @4xl:grid-cols-6">
        {ranked(r).map((m) => (
          <GalleryItem key={`${r.round}-${m}`} round={r.round} m={m} mo={r.monsters[m]} cache={cache} byId={byId} />
        ))}
      </ul>
    </section>
  );
}

function GalleryItem({ round, m, mo, cache, byId }: { round: number; m: number; mo: ResultMonster; cache: MonsterCache; byId: Record<string, Player> }) {
  const parts = useMonster(cache, round, m);
  const name = mo.names[mo.best]?.text ?? `#${m + 1}`;
  return (
    <li className="flex min-w-0 flex-col gap-1">
      <MonsterArt parts={parts} blank={mo.blank} label={`${name}, drawn by ${mo.creators.map((id) => who(byId, id).name).join(", ")}`} />
      <span className="text-center text-xs leading-tight font-bold break-words">{name}</span>
      <span className="text-center text-xs text-muted">⭐ {mo.stars}</span>
    </li>
  );
}

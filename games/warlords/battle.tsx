"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { CASTLES, DRAGON_VERDICT_DELAY, VERDICT_DELAY, type CastleView, type WlView } from "./shared";
import { RoundTable } from "./records";
import { DRAGON, Name, Pts, joinNames, medal, ranks, type Who } from "./ui";
import { Avatar } from "@/components/Avatar";

interface BattleProps {
  view: WlView;
  who: Who;
  accent: string;
}

/** Points the castle on screen hands out, per seat. */
function castleGain(c: CastleView | undefined, n: number): number[] {
  const g = Array.from({ length: n }, () => 0);
  if (c) for (const w of c.winners) g[w] += c.points;
  return g;
}

/** The reveal: armies march out, then castle by castle, then the round summary. */
export function Battle({ view, who, accent }: BattleProps) {
  const r = view.reveal!;
  const summary = r.step > CASTLES;
  const current = !summary && r.step >= 1 ? r.step - 1 : null;
  const c = current !== null ? r.castles[current] : undefined;
  const delay = c ? (c.dragon !== null ? DRAGON_VERDICT_DELAY : VERDICT_DELAY) : 0;

  // Scores tick up when the verdict lands, not when the castle appears.
  const stepKey = `${view.round}-${r.step}`;
  const [landedKey, setLandedKey] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setLandedKey(stepKey), delay);
    return () => clearTimeout(id);
  }, [stepKey, delay]);
  const landed = landedKey === stepKey || !c;
  const gain = castleGain(c, view.order.length);
  const shownScores = view.scores.map((s, i) => (landed ? s : s - gain[i]));

  return (
    <div className="flex flex-col gap-3">
      <CastleStrip view={view} who={who} current={current} accent={accent} />
      <div className="grid gap-3 @3xl:grid-cols-[minmax(0,1fr)_15rem] @3xl:items-start">
        <div className="min-w-0">
          {r.step === 0 ? (
            <MarchOut view={view} who={who} accent={accent} />
          ) : summary ? (
            <RoundTable rec={view.history[view.history.length - 1]} who={who} me={view.me?.seat ?? -1} accent={accent} sortByGain title={`Round ${view.round} results`} />
          ) : c && current !== null ? (
            <CastleBattle key={current} idx={current} c={c} view={view} who={who} accent={accent} delay={delay} />
          ) : null}
        </div>
        <LiveScores
          view={view}
          who={who}
          scores={shownScores}
          gain={landed ? gain : null}
          stepKey={stepKey}
          roundGain={summary ? r.gained : null}
          accent={accent}
        />
      </div>
    </div>
  );
}

// ---------- the five castles across the top ----------

function CastleStrip({ view, who, current, accent }: { view: WlView; who: Who; current: number | null; accent: string }) {
  const r = view.reveal!;
  const mine = view.me?.alloc ?? null;
  return (
    <ol className="grid grid-cols-5 gap-1.5" aria-label="Castles this round">
      {view.values.map((value, i) => {
        const c = r.castles[i];
        const isCur = i === current;
        const done = !!c && !isCur;
        const kept = !!c && c.winners.length === 0 && c.dragon !== null;
        const tint = done && c.winners.length ? who(c.winners[0]).color : kept ? DRAGON : null;
        let face: React.ReactNode = <span className="text-muted">?</span>;
        let label = "not yet revealed";
        if (isCur) {
          face = <span aria-hidden>⚔️</span>;
          label = "battle in progress";
        } else if (done) {
          if (c.winners.length) {
            face = (
              <span className="flex items-center -space-x-1.5">
                {c.winners.slice(0, 2).map((w) => (
                  <span key={w}><Avatar id={who(w).avatar} /></span>
                ))}
                {c.winners.length > 2 && <span className="pl-2 text-[10px] font-bold text-muted">+{c.winners.length - 2}</span>}
              </span>
            );
            label = `taken by ${joinNames(c.winners.map((w) => who(w).name))}`;
          } else if (kept) {
            face = <span>🐉</span>;
            label = "the dragon kept it";
          } else {
            face = <span className="text-muted">·</span>;
            label = "nobody came";
          }
        }
        return (
          <li
            key={i}
            className={`relative flex min-w-0 flex-col items-center gap-0.5 rounded-xl border px-1 py-1.5 text-center transition-[background-color,border-color,transform] duration-300 ${
              isCur ? "wl-glow -translate-y-0.5" : ""
            } ${!c && !isCur ? "opacity-60" : ""}`}
            style={
              {
                "--wl-c": accent,
                borderColor: isCur ? accent : tint ? `${tint}88` : "var(--color-line)",
                background: tint ? `${tint}1f` : "var(--color-panel)",
              } as CSSProperties
            }
          >
            <Pts v={value} accent={accent} className="text-sm" />
            <span key={done ? "d" : isCur ? "c" : "u"} className={`text-xl leading-tight ${done ? "wl-pop" : ""}`} aria-hidden>
              {face}
            </span>
            <span className="hidden w-full truncate text-[10px] text-muted @md:block">{view.names[i]}</span>
            {mine && (
              <span className="text-[10px] leading-none font-semibold text-muted tabular-nums">
                you {mine[i]}
              </span>
            )}
            <span className="sr-only">
              {view.names[i]}, {value} points, {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------- step 0 ----------

function MarchOut({ view, who, accent }: { view: WlView; who: Who; accent: string }) {
  const src = view.reveal!.src;
  return (
    <section className="card wl-in flex flex-col items-center gap-3 p-4 text-center" aria-label="Armies marching out">
      <div className="font-display text-2xl font-extrabold" style={{ color: accent }}>
        ⚔️ The armies march out!
      </div>
      <ul className="flex flex-wrap justify-center gap-1.5">
        {view.order.map((id, seat) => {
          const p = who(seat);
          const how = src[seat] === "auto" ? "⏰ even split" : src[seat] === "draft" ? "✎ unlocked draft" : null;
          return (
            <li
              key={id}
              className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold"
              style={{ borderColor: `${p.color}66`, background: `${p.color}17` }}
            >
              <span className="wl-march" style={{ animationDelay: `${(seat % 4) * 0.12}s` }} aria-hidden>
                <Avatar id={p.avatar} />
              </span>
              <span className="max-w-[7rem] truncate" style={{ color: p.color }}>
                {p.name}
              </span>
              {how && <span className="font-medium text-muted">{how}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------- one castle's battle ----------

function CastleBattle({
  idx,
  c,
  view,
  who,
  accent,
  delay,
}: {
  idx: number;
  c: CastleView;
  view: WlView;
  who: Who;
  accent: string;
  delay: number;
}) {
  const name = view.names[idx];
  const value = view.values[idx];
  const me = view.me?.seat ?? -1;
  const rows = c.troops.map((t, seat) => ({ seat, t })).sort((a, b) => b.t - a.t || a.seat - b.seat);
  const top = rows[0]?.t ?? 0;
  const dragon = c.dragon;
  const scale = Math.max(10, top, dragon ?? 0) * 1.06;
  const pct = (v: number) => `${(v / scale) * 100}%`;
  const DRAGON_AT = 620; // ms: the dragon bursts in after the armies
  const many = rows.length > 8;
  const rowH = many ? "h-5" : "h-6";
  const won = new Set(c.winners);
  const kept = c.winners.length === 0 && dragon !== null;

  let verdict: React.ReactNode;
  if (c.winners.length === 1) {
    const p = who(c.winners[0]);
    verdict = (
      <>
        👑 <Name p={p} you={c.winners[0] === me} /> {c.winners[0] === me ? "take" : "takes"} {name}{" "}
        <b style={{ color: accent }}>+{c.points}</b>
      </>
    );
  } else if (c.winners.length > 1) {
    verdict = (
      <>
        🤝 {joinNames(c.winners.map((w) => (w === me ? "You" : who(w).name)))} split {name}{" "}
        <b style={{ color: accent }}>+{c.points} each</b>
      </>
    );
  } else if (kept) {
    verdict = (
      <>
        🐉 <span style={{ color: DRAGON }}>{top > 0 ? `The dragon keeps ${name}!` : `Nobody dared face the dragon`}</span>
      </>
    );
  } else {
    verdict = <>🏚️ Nobody marched on {name}</>;
  }

  return (
    <section
      className={`card relative overflow-hidden p-3 ${dragon !== null ? "wl-shake" : ""}`}
      style={dragon !== null ? { animationDelay: `${DRAGON_AT}ms`, borderColor: `${DRAGON}88` } : undefined}
      aria-label={`Battle for ${name}`}
    >
      <header className="wl-in mb-2 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="text-2xl">
            🏰
          </span>
          <span className="min-w-0">
            <span className="block truncate font-display text-lg leading-tight font-extrabold">{name}</span>
            <span className="block text-xs text-muted">
              Castle {idx + 1} of {CASTLES}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-sm text-muted">
          worth <Pts v={value} accent={accent} className="py-0.5 text-lg" />
        </span>
      </header>

      <div className="flex flex-col">
        {dragon !== null && (
          <Row
            label={
              <span className="wl-dragon flex items-center gap-1 font-bold" style={{ animationDelay: `${DRAGON_AT}ms`, color: DRAGON }}>
                <span aria-hidden className="text-lg leading-none">
                  🐉
                </span>
                Dragon
              </span>
            }
            h={rowH}
            bar={<Bar w={pct(dragon)} color={DRAGON} delay={DRAGON_AT} stripes />}
            line={null}
            num={
              <span className="wl-fadein font-bold tabular-nums" style={{ animationDelay: `${DRAGON_AT}ms`, color: DRAGON }}>
                {dragon}
              </span>
            }
          />
        )}
        {rows.map(({ seat, t }, rank) => {
          const p = who(seat);
          const win = won.has(seat);
          return (
            <Row
              key={seat}
              dim={!win}
              dimDelay={delay}
              label={
                <span className="flex min-w-0 items-center gap-1">
                  <span aria-hidden><Avatar id={p.avatar} /></span>
                  <span className="truncate font-semibold" style={{ color: p.color }}>
                    {seat === me ? "You" : p.name}
                  </span>
                </span>
              }
              h={rowH}
              bar={t > 0 ? <Bar w={pct(t)} color={p.color} delay={Math.min(rank * 45, 380)} /> : null}
              line={dragon !== null ? pct(dragon) : null}
              num={
                <span className="flex items-center gap-1">
                  <span className={`tabular-nums ${t === 0 ? "text-muted" : "font-bold"}`}>{t}</span>
                  {win && (
                    <span className="wl-crown text-sm" style={{ animationDelay: `${delay}ms` }} aria-label="winner">
                      👑
                    </span>
                  )}
                  {win && (
                    <span
                      aria-hidden
                      className="wl-float pointer-events-none absolute right-0 -top-1 font-display text-sm font-extrabold"
                      style={{ animationDelay: `${delay + 80}ms`, color: accent }}
                    >
                      +{c.points}
                    </span>
                  )}
                </span>
              }
            />
          );
        })}
      </div>

      <p
        className="wl-in mt-2 min-h-7 text-center font-display text-base font-bold @md:text-lg"
        style={{ animationDelay: `${delay}ms` }}
        aria-live="polite"
      >
        {verdict}
      </p>
    </section>
  );
}

function Row({
  label,
  bar,
  line,
  num,
  h,
  dim,
  dimDelay = 0,
}: {
  label: React.ReactNode;
  bar: React.ReactNode;
  line: string | null;
  num: React.ReactNode;
  h: string;
  dim?: boolean;
  dimDelay?: number;
}) {
  return (
    <div
      className={`grid grid-cols-[minmax(0,5.5rem)_minmax(0,1fr)_3.25rem] items-center gap-2 py-[3px] text-sm @md:grid-cols-[minmax(0,8rem)_minmax(0,1fr)_3.5rem] ${dim ? "wl-dim" : ""}`}
      style={dim ? { animationDelay: `${dimDelay}ms` } : undefined}
    >
      <div className="min-w-0">{label}</div>
      <div className={`relative ${h} rounded-md bg-panel-2`}>
        {bar}
        {line && (
          <span
            aria-hidden
            className="wl-line absolute -inset-y-[3px] w-0 border-l-2 border-dashed"
            style={{ left: line, borderColor: DRAGON, animationDelay: "620ms" }}
          />
        )}
      </div>
      <div className="relative flex justify-end">{num}</div>
    </div>
  );
}

function Bar({ w, color, delay, stripes }: { w: string; color: string; delay: number; stripes?: boolean }) {
  return (
    <span
      className="wl-bar absolute inset-y-0 left-0 rounded-md"
      style={{
        width: w,
        animationDelay: `${delay}ms`,
        background: stripes
          ? `repeating-linear-gradient(135deg, ${color}, ${color} 6px, ${color}bb 6px, ${color}bb 12px)`
          : `linear-gradient(90deg, ${color}aa, ${color})`,
      }}
    />
  );
}

// ---------- live scoreboard ----------

function LiveScores({
  view,
  who,
  scores,
  gain,
  stepKey,
  roundGain,
  accent,
}: {
  view: WlView;
  who: Who;
  scores: number[];
  gain: number[] | null;
  stepKey: string;
  roundGain: number[] | null;
  accent: string;
}) {
  const order = view.order.map((_, i) => i).sort((a, b) => scores[b] - scores[a] || a - b);
  const rank = ranks(scores, order);
  const me = view.me?.seat ?? -1;
  const compact = order.length > 6;
  return (
    <section className="card p-3" aria-label="Scores">
      <div className="label mb-2">{roundGain ? `Scores after round ${view.round}` : "Scores"}</div>
      {/* Big groups: two compact columns everywhere (the battle card is tall already). */}
      <ol className={`grid gap-x-2 ${compact ? "grid-cols-2 gap-y-1.5" : "grid-cols-1 gap-y-1 @lg:grid-cols-2 @3xl:grid-cols-1"}`}>
        {order.map((seat) => {
          const p = who(seat);
          const g = gain?.[seat] ?? 0;
          const rg = roundGain?.[seat] ?? 0;
          const pill = g > 0 && (
            <span
              key={stepKey}
              className={`wl-pop rounded-full font-bold ${compact ? "absolute -top-2 right-0 px-1 text-[10px] leading-tight" : "px-1.5 text-xs"}`}
              style={{ background: compact ? `color-mix(in oklab, ${accent} 30%, var(--color-panel))` : `${accent}2e`, color: accent }}
            >
              +{g}
            </span>
          );
          return (
            <li
              key={view.order[seat]}
              className={`flex min-w-0 items-center justify-between gap-1.5 rounded-lg ${compact ? "px-1.5 py-0.5" : "px-2 py-1"} ${seat === me ? "bg-panel-2" : ""} ${
                p.connected ? "" : "opacity-60"
              }`}
            >
              <span className="flex min-w-0 items-center gap-1.5 text-sm">
                {!compact && (
                  <span className="w-5 shrink-0 text-center text-xs text-muted tabular-nums">{scores[seat] > 0 ? medal(rank.get(seat) ?? 0) : "–"}</span>
                )}
                <span aria-hidden><Avatar id={p.avatar} /></span>
                <span className="truncate font-semibold" style={{ color: p.color }}>
                  {p.name}
                </span>
              </span>
              <span className="relative flex shrink-0 items-center gap-1.5">
                {!compact && pill}
                {roundGain && !compact && (
                  <span className="text-xs text-muted tabular-nums" title="this round">
                    +{rg}
                  </span>
                )}
                <span key={`${scores[seat]}`} className={`text-right font-mono font-bold tabular-nums ${compact ? "w-6" : "w-8"} ${g > 0 ? "wl-pop" : ""}`}>
                  {scores[seat]}
                </span>
                {compact && pill}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

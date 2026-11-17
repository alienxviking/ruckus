"use client";

import { useState, type CSSProperties } from "react";
import type { RoundRecord, WlView } from "./shared";
import { allocText, plural } from "./shared";
import { DRAGON, Pts, joinNames, medal, ranks, type Who } from "./ui";
import { Avatar } from "@/components/Avatar";

const LOST = "#5d5689";

function srcMark(src: RoundRecord["src"][number]) {
  if (src === "auto") return { icon: "⏰", text: "no plan: even split" };
  if (src === "draft") return { icon: "✎", text: "unlocked draft" };
  return null;
}

/** One round, every warlord's army per castle: winners' cells light up in their colour. */
export function RoundTable({
  rec,
  who,
  me,
  accent,
  sortByGain,
  title,
  bare,
}: {
  rec: RoundRecord;
  who: Who;
  me: number;
  accent: string;
  sortByGain?: boolean;
  title?: string;
  /** Without its own card (inside another one). */
  bare?: boolean;
}) {
  const seats = rec.alloc.map((_, i) => i);
  if (sortByGain) seats.sort((a, b) => rec.gained[b] - rec.gained[a] || a - b);
  return (
    <section className={bare ? "" : "card wl-in p-3"} aria-label={title ?? `Round ${rec.round}`}>
      {title && <div className="label mb-2">{title}</div>}
      <table className="w-full table-fixed border-separate border-spacing-x-0.5 border-spacing-y-0.5 text-sm">
        <colgroup>
          <col className="w-[34%] @lg:w-[30%]" />
          {rec.values.map((_, c) => (
            <col key={c} />
          ))}
          <col className="w-10" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="text-left text-xs font-semibold text-muted">
              Castle →
            </th>
            {rec.values.map((v, c) => {
              const dragonHere = rec.dragon.castle === c;
              return (
                <th scope="col" key={c} className="pb-1 align-bottom font-normal">
                  <span className="flex flex-col items-center gap-0.5">
                    {dragonHere && (
                      <span className="text-[10px] leading-none font-bold whitespace-nowrap" style={{ color: DRAGON }} title={`Dragon, strength ${rec.dragon.strength}`}>
                        🐉{rec.dragon.strength}
                      </span>
                    )}
                    <Pts v={v} accent={accent} className="text-xs" />
                    <span className="sr-only">
                      {rec.names[c]}
                      {dragonHere ? `, dragon ${rec.dragon.strength}` : ""}
                    </span>
                  </span>
                </th>
              );
            })}
            <th scope="col" className="text-right align-bottom text-xs font-semibold text-muted">
              pts
            </th>
          </tr>
        </thead>
        <tbody>
          {seats.map((seat) => {
            const p = who(seat);
            const mark = srcMark(rec.src[seat]);
            return (
              <tr key={seat} className={seat === me ? "bg-panel-2/60" : undefined}>
                <th scope="row" className="rounded-l-md py-0.5 pr-1 text-left font-normal">
                  <span className="flex min-w-0 items-center gap-1">
                    <span aria-hidden><Avatar id={p.avatar} /></span>
                    <span className="truncate text-xs font-semibold @md:text-sm" style={{ color: p.color }}>
                      {p.name}
                    </span>
                    {mark && (
                      <span className="shrink-0 text-[11px] text-muted" title={mark.text}>
                        {mark.icon}
                        <span className="sr-only"> ({mark.text})</span>
                      </span>
                    )}
                  </span>
                </th>
                {rec.alloc[seat].map((t, c) => {
                  const win = rec.castles[c].winners.includes(seat);
                  return (
                    <td
                      key={c}
                      className={`rounded-md py-0.5 text-center text-xs tabular-nums @md:text-sm ${win ? "font-extrabold" : t === 0 ? "text-muted/60" : ""}`}
                      style={win ? { background: `${p.color}2e`, color: p.color, boxShadow: `inset 0 0 0 1px ${p.color}66` } : undefined}
                    >
                      {t}
                      {win && <span className="sr-only"> (took it)</span>}
                    </td>
                  );
                })}
                <td className="rounded-r-md py-0.5 text-right font-mono text-xs font-bold tabular-nums @md:text-sm">
                  {rec.gained[seat] > 0 ? <span style={{ color: accent }}>+{rec.gained[seat]}</span> : <span className="text-muted">0</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** Tiny bar chart of one army: one bar per castle, lit when that castle was taken. */
function MiniBars({ alloc, wins, color }: { alloc: number[]; wins: boolean[]; color: string }) {
  return (
    <span className="inline-flex h-7 items-end gap-[2px]" aria-hidden>
      {alloc.map((t, c) => (
        <span
          key={c}
          className="w-[6px] rounded-t-[2px]"
          style={{ height: t ? `${Math.max(10, t)}%` : "2px", background: wins[c] ? color : LOST }}
        />
      ))}
    </span>
  );
}

/** Everyone's past moves, every round at once: the tendencies view. */
function TendencyGrid({ history, who, me }: { history: RoundRecord[]; who: Who; me: number }) {
  const n = history[0]?.alloc.length ?? 0;
  const totals = Array.from({ length: n }, (_, seat) => history.reduce((t, r) => t + r.gained[seat], 0));
  return (
    <table className="w-full table-fixed border-separate border-spacing-y-0.5 text-sm">
      <colgroup>
        <col className="w-[34%] @lg:w-[26%]" />
        {history.map((r) => (
          <col key={r.round} />
        ))}
        <col className="w-10" />
      </colgroup>
      <thead>
        <tr className="text-xs text-muted">
          <th scope="col" className="text-left font-semibold">
            Warlord
          </th>
          {history.map((r) => (
            <th scope="col" key={r.round} className="font-semibold">
              R{r.round}
            </th>
          ))}
          <th scope="col" className="text-right font-semibold">
            pts
          </th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: n }, (_, seat) => {
          const p = who(seat);
          return (
            <tr key={seat} className={seat === me ? "bg-panel-2/60" : undefined}>
              <th scope="row" className="rounded-l-md py-1 pr-1 text-left font-normal">
                <span className="flex min-w-0 items-center gap-1">
                  <span aria-hidden><Avatar id={p.avatar} /></span>
                  <span className="truncate text-xs font-semibold @md:text-sm" style={{ color: p.color }}>
                    {p.name}
                  </span>
                </span>
              </th>
              {history.map((r) => {
                const wins = r.castles.map((c) => c.winners.includes(seat));
                const text = allocText(r.alloc[seat]);
                return (
                  <td key={r.round} className="py-1 text-center" title={`Round ${r.round}: ${text} (+${r.gained[seat]})`}>
                    <span className="flex flex-col items-center gap-0.5">
                      <MiniBars alloc={r.alloc[seat]} wins={wins} color={p.color} />
                      <span className="hidden font-mono text-[10px] leading-none text-muted @2xl:block">{text}</span>
                    </span>
                    <span className="sr-only">
                      Round {r.round}: {text}, {plural(r.gained[seat], "point")}
                    </span>
                  </td>
                );
              })}
              <td className="rounded-r-md py-1 text-right font-mono text-xs font-bold tabular-nums">{totals[seat]}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Public record of every finished round: one tab per round plus an "all rounds" overview. */
export function WarRecords({ history, who, me, accent }: { history: RoundRecord[]; who: Who; me: number; accent: string }) {
  // null = follow the latest round.
  const [tab, setTab] = useState<number | "all" | null>(null);
  if (!history.length) return null;
  const active = tab ?? history.length - 1;
  const rec = active === "all" ? null : (history[active] ?? history[history.length - 1]);
  const tabs: { key: number | "all"; label: string }[] = [
    ...history.map((r, i) => ({ key: i, label: `R${r.round}` })),
    ...(history.length > 1 ? [{ key: "all" as const, label: "All" }] : []),
  ];
  return (
    <section className="card p-3" aria-label="War records">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="label">📜 War records</div>
          <p className="text-xs text-muted">Everyone&apos;s past armies. Spot the patterns.</p>
        </div>
        <div className="flex gap-1" role="tablist" aria-label="Round">
          {tabs.map((t) => {
            const on = t.key === active;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(t.key)}
                className="h-10 min-w-10 rounded-lg border px-2 text-xs font-bold transition-colors"
                style={on ? { borderColor: accent, background: `${accent}26`, color: accent } : { borderColor: "var(--color-line)" }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
      <div role="tabpanel">
        {rec ? (
          <RoundTable rec={rec} who={who} me={me} accent={accent} bare />
        ) : (
          <TendencyGrid history={history} who={who} me={me} />
        )}
      </div>
    </section>
  );
}

// ---------- final ----------

interface Stat {
  castles: number;
  dragons: number;
}

function computeStats(history: RoundRecord[], n: number) {
  const stats: Stat[] = Array.from({ length: n }, () => ({ castles: 0, dragons: 0 }));
  let photo = null as { seat: number; margin: number; name: string; round: number } | null;
  let haul = null as { seat: number; pts: number; round: number } | null;
  for (const r of history) {
    r.castles.forEach((c, ci) => {
      for (const w of c.winners) {
        stats[w].castles += 1;
        if (r.dragon.castle === ci) stats[w].dragons += 1;
      }
      if (c.winners.length === 1) {
        const w = c.winners[0];
        const troops = r.alloc.map((a) => a[ci]);
        const second = Math.max(0, ...troops.filter((_, i) => i !== w), r.dragon.castle === ci ? r.dragon.strength : 0);
        const margin = troops[w] - second;
        if (!photo || margin < photo.margin) photo = { seat: w, margin, name: r.names[ci], round: r.round };
      }
    });
    r.gained.forEach((g, seat) => {
      if (g > 0 && (!haul || g > haul.pts)) haul = { seat, pts: g, round: r.round };
    });
  }
  return { stats, photo, haul };
}

export function Final({ view, who, accent }: { view: WlView; who: Who; accent: string }) {
  const n = view.order.length;
  const me = view.me?.seat ?? -1;
  const { stats, photo, haul } = computeStats(view.history, n);
  const order = view.order.map((_, i) => i).sort((a, b) => view.scores[b] - view.scores[a] || a - b);
  const rank = ranks(view.scores, order);
  const best = view.scores[order[0]] ?? 0;
  const compact = n > 6;

  const badges: { icon: string; title: string; text: string }[] = [];
  const maxD = Math.max(0, ...stats.map((s) => s.dragons));
  if (maxD > 0) {
    const who2 = stats.flatMap((s, i) => (s.dragons === maxD ? [who(i).name] : []));
    badges.push({ icon: "🐉", title: "Dragonslayer", text: `${joinNames(who2)} · ${plural(maxD, "dragon")}` });
  }
  const maxC = Math.max(0, ...stats.map((s) => s.castles));
  if (maxC > 0) {
    const who2 = stats.flatMap((s, i) => (s.castles === maxC ? [who(i).name] : []));
    badges.push({ icon: "🏰", title: "Land grabber", text: `${joinNames(who2)} · ${plural(maxC, "castle")}` });
  }
  if (photo) {
    badges.push({
      icon: "🎯",
      title: "Photo finish",
      text: `${who(photo.seat).name} took ${photo.name} by ${plural(photo.margin, "troop")}`,
    });
  }
  if (haul) badges.push({ icon: "💰", title: "Biggest haul", text: `${who(haul.seat).name}: +${haul.pts} in round ${haul.round}` });

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 @3xl:grid-cols-2 @3xl:items-start">
        <section className="card wl-in p-3" aria-label="Final standings">
          <div className="label mb-2">Final standings</div>
          <ol className={`flex flex-col ${compact ? "gap-1" : "gap-1.5"}`}>
            {order.map((seat) => {
              const p = who(seat);
              const r = rank.get(seat) ?? 0;
              const top = view.scores[seat] === best && best > 0;
              const statText = `${plural(stats[seat].castles, "castle")}${stats[seat].dragons > 0 ? ` · 🐉 ×${stats[seat].dragons}` : ""}`;
              return (
                <li
                  key={seat}
                  className={`flex items-center gap-2 rounded-xl border px-2.5 ${compact ? "py-1" : "py-1.5"} ${p.connected ? "" : "opacity-60"}`}
                  style={{
                    borderColor: top ? p.color : "var(--color-line)",
                    background: top ? `${p.color}1c` : seat === me ? "var(--color-panel-2)" : "transparent",
                  }}
                >
                  <span className={`w-6 shrink-0 text-center leading-none ${compact ? "text-sm" : "text-lg"}`}>{medal(r)}</span>
                  <span aria-hidden className={`relative leading-none ${compact ? "text-lg" : "text-2xl"}`}>
                    <Avatar id={p.avatar} />
                    {top && <span className="wl-crown absolute -top-3 left-1/2 -ml-2 text-sm">👑</span>}
                  </span>
                  {compact ? (
                    <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                      <span className="truncate text-sm font-bold" style={{ color: p.color }}>
                        {p.name}
                        {seat === me && p.name.trim().toLowerCase() !== "you" && <span className="font-medium text-muted"> (you)</span>}
                      </span>
                      <span className="hidden shrink-0 text-xs text-muted @sm:inline">{statText}</span>
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold" style={{ color: p.color }}>
                        {p.name}
                        {seat === me && p.name.trim().toLowerCase() !== "you" && <span className="font-medium text-muted"> (you)</span>}
                      </span>
                      <span className="block truncate text-xs text-muted">{statText}</span>
                    </span>
                  )}
                  <span className={`font-display font-extrabold tabular-nums ${compact ? "text-lg" : "text-2xl"}`}>{view.scores[seat]}</span>
                </li>
              );
            })}
          </ol>
          {view.endedEarly && <p className="mt-2 text-center text-xs text-muted">Ended early: too few warlords were online.</p>}
        </section>

        <ConquestMap view={view} who={who} accent={accent} />
      </div>

      {badges.length > 0 && (
        <ul className="grid grid-cols-1 gap-2 @md:grid-cols-2" aria-label="Awards">
          {badges.map((b, i) => (
            <li key={b.title} className="card wl-in flex items-center gap-2.5 px-3 py-2" style={{ animationDelay: `${120 + i * 90}ms` }}>
              <span aria-hidden className="text-2xl">
                {b.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-bold" style={{ color: accent }}>
                  {b.title}
                </span>
                <span className="block truncate text-sm">{b.text}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <WarRecords history={view.history} who={who} me={me} accent={accent} />
    </div>
  );
}

/** Rounds x castles: who took what. */
function ConquestMap({ view, who, accent }: { view: WlView; who: Who; accent: string }) {
  return (
    <section className="card wl-in p-3" aria-label="Who took which castles" style={{ animationDelay: "80ms" }}>
      <div className="label mb-2">🗺️ Conquests</div>
      <div className="flex flex-col gap-1">
        {view.history.map((r) => (
          <div key={r.round} className="grid grid-cols-[1.75rem_repeat(5,minmax(0,1fr))] items-center gap-1">
            <span className="text-xs font-bold text-muted">R{r.round}</span>
            {r.castles.map((c, ci) => {
              const dragonHere = r.dragon.castle === ci;
              const kept = !c.winners.length && dragonHere;
              const tint = c.winners.length ? who(c.winners[0]).color : kept ? DRAGON : null;
              const label = c.winners.length
                ? `${joinNames(c.winners.map((w) => who(w).name))} (+${c.points}${c.winners.length > 1 ? " each" : ""})`
                : kept
                  ? "the dragon kept it"
                  : "nobody";
              return (
                <div
                  key={ci}
                  className="flex h-12 min-w-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg border"
                  style={
                    {
                      borderColor: tint ? `${tint}77` : "var(--color-line)",
                      background: tint ? `${tint}22` : "transparent",
                    } as CSSProperties
                  }
                  title={`${r.names[ci]} (${r.values[ci]}): ${label}`}
                >
                  <span className="flex items-center gap-0.5 text-[10px] leading-none font-bold" style={{ color: accent }}>
                    {r.values[ci]}
                    {dragonHere && c.winners.length > 0 && (
                      <span aria-hidden title="dragon slain">
                        🐉
                      </span>
                    )}
                  </span>
                  <span aria-hidden className="flex items-center text-base leading-none">
                    {c.winners.length ? (
                      <>
                        <span className="flex -space-x-1.5">
                          {c.winners.slice(0, 2).map((w) => (
                            <span key={w}><Avatar id={who(w).avatar} /></span>
                          ))}
                        </span>
                        {c.winners.length > 2 && <span className="ml-0.5 text-[10px] font-bold text-muted">+{c.winners.length - 2}</span>}
                      </>
                    ) : kept ? (
                      "🐉"
                    ) : (
                      <span className="text-muted">·</span>
                    )}
                  </span>
                  <span className="sr-only">
                    Round {r.round}, {r.names[ci]} worth {r.values[ci]}: {label}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

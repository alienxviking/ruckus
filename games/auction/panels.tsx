"use client";

// Side panels: the lots strip (with your peeks), the cash leaderboard, the peek
// grid shown before the auction, and the final standings with the crate recap.

import type { CSSProperties, ReactNode } from "react";
import type { AuView, CrateView } from "./server";
import { STAMPS, contents, money, signed } from "./shared";
import { EASE, GAIN, GOLD, LOSS, Name, Panel, kindColor, pnlColor, type Who } from "./ui";

// ---------- money ----------

export interface Standing {
  slot: number;
  cash: number;
  /** Crate values (gift applied once it is public). */
  vault: number;
  crates: number;
  hasGift: boolean;
  /** Gift multiplier once public (null = not the owner or not yet revealed). */
  giftX: boolean | null;
  worth: number;
}

export const giftOf = (view: AuView) => view.crates.find((c) => c.gift) ?? null;
export const giftPublic = (view: AuView) => view.phase === "final" || (view.phase === "gift" && view.giftShown);

export function standings(view: AuView): Standing[] {
  const gift = giftOf(view);
  const pub = giftPublic(view);
  return view.ids.map((_, slot) => {
    let raw = 0;
    let crates = 0;
    for (const c of view.crates) {
      if (c.status !== "sold" || c.buyer !== slot) continue;
      crates += 1;
      if (!c.gift && c.value !== null) raw += c.value;
    }
    const hasGift = !!gift && gift.status === "sold" && gift.buyer === slot;
    const giftX = hasGift && pub && gift!.x2 !== null ? gift!.x2 : null;
    const vault = giftX === null ? raw : giftX ? raw * 2 : 0;
    const cash = view.cash[slot] ?? 0;
    const worth = view.scores?.[slot] ?? cash + vault;
    return { slot, cash, vault, crates, hasGift, giftX, worth };
  });
}

/** Ranks with ties sharing a place. */
function ranked(rows: Standing[]) {
  const sorted = rows.slice().sort((a, b) => b.worth - a.worth || b.cash - a.cash || a.slot - b.slot);
  return sorted.map((r) => ({ ...r, rank: sorted.findIndex((x) => x.worth === r.worth) + 1 }));
}

// ---------- lots strip ----------

function lotFace(c: CrateView, giftPub: boolean): { emoji: string; text: string; color: string; secret: boolean } {
  if (c.gift) {
    if (c.x2 !== null) return { emoji: "🎁", text: c.x2 ? "×2" : "×0", color: c.x2 ? GAIN : LOSS, secret: !giftPub };
    return { emoji: "🎁", text: "×?", color: "var(--color-muted)", secret: false };
  }
  if (c.value === null) return { emoji: "📦", text: "?", color: "var(--color-muted)", secret: false };
  const shown = c.status !== "up";
  return { emoji: shown ? contents(c.value).emoji : "📦", text: signed(c.value), color: kindColor(c.value), secret: !shown };
}

export function LotsStrip({ view, who, live }: { view: AuView; who: Who; live: boolean }) {
  const peeks = view.crates.filter((c) => c.peeked).length;
  return (
    <Panel
      title="Lots"
      aside={view.me >= 0 ? <span>👁 = your peek{peeks === 1 ? "" : "s"} ({peeks})</span> : <span>{view.crates.length} crates</span>}
      label="Lots"
    >
      <ol className="grid grid-cols-4 gap-1.5">
        {view.crates.map((c, i) => {
          const now = live && i === view.lot && (view.phase === "lot" || view.phase === "sold");
          const face = lotFace(c, giftPublic(view));
          const buyer = c.status === "sold" ? who(c.buyer) : null;
          return (
            <li
              key={i}
              className="relative flex min-w-0 flex-col items-center rounded-xl border px-1 pt-3.5 pb-1 text-center"
              style={{
                borderColor: now ? GOLD : face.secret ? `${face.color}88` : "var(--color-line)",
                borderStyle: face.secret && !now ? "dashed" : "solid",
                background: now ? `${GOLD}1a` : c.status === "unsold" ? "transparent" : "var(--color-panel-2)",
                opacity: c.status === "unsold" ? 0.6 : 1,
                transition: `border-color .3s ${EASE}, background-color .3s ${EASE}`,
              }}
              aria-current={now ? "true" : undefined}
            >
              <span className="absolute top-0.5 left-1.5 text-[10px] font-bold text-muted tabular-nums">#{i + 1}</span>
              {face.secret && (
                <span className="absolute top-0.5 right-1 text-[10px]" title="You peeked">
                  👁
                </span>
              )}
              <span className="text-xl leading-none" aria-hidden>
                {face.emoji}
              </span>
              <span className="mt-0.5 font-mono text-xs font-bold tabular-nums" style={{ color: face.color }}>
                {face.text}
              </span>
              <span className="block h-4 max-w-full truncate text-[10px] leading-4 text-muted">
                {buyer ? (
                  <>
                    <span aria-hidden>{buyer.avatar}</span> ${c.price}
                  </>
                ) : c.status === "unsold" ? (
                  "no sale"
                ) : now ? (
                  <b style={{ color: GOLD }}>NOW</b>
                ) : (
                  ""
                )}
              </span>
              <span className="sr-only">
                {c.gift ? "Double-or-nothing gift" : "Crate"} {i + 1}
                {face.secret ? `, you peeked ${face.text}` : ""}
                {buyer ? `, sold to ${buyer.name} for $${c.price}` : c.status === "unsold" ? ", no sale" : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

// ---------- leaderboard ----------

export function Leaderboard({
  view,
  who,
  leader,
  flash,
}: {
  view: AuView;
  who: Who;
  /** Slot currently leading the bidding (-1 = nobody). */
  leader: number;
  /** Slot to flash (just bought something), with a key so it replays. */
  flash: { slot: number; key: string; color: string } | null;
}) {
  const rows = ranked(standings(view));
  return (
    <Panel title="Bidders" aside={<span>cash · vault · worth</span>} label="Leaderboard">
      <ol className="flex flex-col gap-1">
        {rows.map((r) => {
          const p = who(r.slot);
          const isMe = r.slot === view.me;
          const lit = flash && flash.slot === r.slot;
          return (
            <li
              key={lit ? `${r.slot}-${flash.key}` : r.slot}
              className={`flex min-h-8 items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm ${lit ? "au-flash" : ""}`}
              style={
                {
                  background: isMe ? "var(--color-panel-2)" : undefined,
                  outline: r.slot === leader ? `1.5px solid ${p.color}` : undefined,
                  "--au-c": flash?.color,
                  opacity: p.connected ? 1 : 0.55,
                } as CSSProperties
              }
            >
              <span className="w-3.5 shrink-0 text-right text-xs text-muted tabular-nums">{r.rank}</span>
              <Name p={p} className="flex-1" />
              {r.slot === leader && (
                <span className="shrink-0 text-xs" title="Top bidder on this lot" aria-label="top bidder">
                  🔨
                </span>
              )}
              {r.hasGift && (
                <span className="shrink-0 text-xs" title="Holds the double-or-nothing gift">
                  🎁{r.giftX === null ? "" : r.giftX ? "×2" : "×0"}
                </span>
              )}
              <span className="w-9 shrink-0 text-right font-mono text-xs text-muted tabular-nums" title="Cash">
                ${r.cash}
              </span>
              <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums" style={{ color: pnlColor(r.vault) }} title="Vault">
                {r.crates ? signed(r.vault) : "–"}
              </span>
              <span className="w-10 shrink-0 text-right font-mono font-bold tabular-nums">{money(r.worth)}</span>
              <span className="sr-only">
                {p.name}: cash ${r.cash}, vault {r.vault}, worth {r.worth}
              </span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

// ---------- the peek grid (before the auction) ----------

export function PeekGrid({ view }: { view: AuView }) {
  return (
    <ol className="grid grid-cols-2 gap-2 @2xl:grid-cols-4" aria-label="Crates and your peeks">
      {view.crates.map((c, i) => {
        const peeked = c.peeked;
        let emoji = "📦";
        let name: ReactNode = <span className="text-muted">🔒 Not peeked</span>;
        let right = "?";
        let color = "var(--color-line)";
        if (c.gift) {
          emoji = "🎁";
          name = c.x2 === null ? <span className="text-muted">Double or nothing</span> : <>{c.x2 ? "Doubles the vault!" : "Wipes the vault!"}</>;
          right = c.x2 === null ? "×?" : c.x2 ? "×2" : "×0";
          if (c.x2 !== null) color = c.x2 ? GAIN : LOSS;
        } else if (c.value !== null) {
          const it = contents(c.value);
          emoji = it.emoji;
          name = it.name;
          right = signed(c.value);
          color = kindColor(c.value);
        }
        return (
          <li
            key={i}
            className="au-in relative flex min-w-0 flex-col rounded-xl border-2 px-2.5 py-1.5"
            style={{
              animationDelay: `${i * 45}ms`,
              borderColor: peeked ? color : "var(--color-line)",
              borderStyle: peeked ? "solid" : "dashed",
              background: peeked ? `color-mix(in oklab, ${color} 12%, var(--color-panel))` : "var(--color-panel)",
            }}
          >
            <span className="block truncate text-[10px] font-semibold tracking-wide text-muted uppercase">
              #{i + 1} · {c.gift ? "gift" : STAMPS[c.stamp]}
            </span>
            <span className="flex items-center justify-between gap-1">
              <span className="text-2xl leading-tight" aria-hidden>
                {emoji}
              </span>
              <span className="font-display text-xl font-extrabold tabular-nums" style={{ color: peeked ? color : "var(--color-muted)" }}>
                {right}
              </span>
            </span>
            <span className="block truncate text-xs font-semibold">{name}</span>
            {peeked && <span className="sr-only">(you peeked)</span>}
          </li>
        );
      })}
    </ol>
  );
}

// ---------- final ----------

const MEDALS = ["🥇", "🥈", "🥉"];

export function FinalStandings({ view, who }: { view: AuView; who: Who }) {
  const rows = ranked(standings(view));
  const best = rows[0]?.worth ?? 0;
  return (
    <Panel title="Final standings" aside={<span>cash + vault = score</span>} label="Final standings">
      <ol className="flex flex-col gap-1.5">
        {rows.map((r, i) => {
          const p = who(r.slot);
          const top = r.worth === best;
          return (
            <li
              key={r.slot}
              className="au-in flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl border px-2.5 py-2"
              style={{
                animationDelay: `${i * 70}ms`,
                borderColor: top ? GOLD : "var(--color-line)",
                background: top ? `${GOLD}14` : r.slot === view.me ? "var(--color-panel-2)" : "transparent",
              }}
            >
              <span className="w-6 shrink-0 text-center text-lg leading-none">{MEDALS[r.rank - 1] ?? r.rank}</span>
              <Name p={p} you={r.slot === view.me} className="min-w-0 flex-1 text-base" />
              <span className="order-last w-full pl-8 text-xs text-muted tabular-nums @md:order-none @md:w-auto @md:pl-0">
                ${r.cash} cash {r.vault < 0 ? "−" : "+"} {Math.abs(r.vault)} vault
                {r.hasGift && (
                  <b style={{ color: r.giftX ? GAIN : LOSS }}> {r.giftX ? "(🎁 ×2)" : "(🎁 ×0)"}</b>
                )}
              </span>
              <span className="shrink-0 font-display text-xl font-extrabold tabular-nums" style={{ color: top ? GOLD : undefined }}>
                {money(r.worth)}
              </span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

export function Recap({ view, who }: { view: AuView; who: Who }) {
  const gift = giftOf(view);
  const giftOwner = gift && gift.status === "sold" ? gift.buyer : -1;
  // Profit per sold crate (gift excluded: it has no value of its own).
  const deals = view.crates
    .map((c, i) => ({ c, i, pnl: c.status === "sold" && !c.gift && c.value !== null ? c.value - c.price : null }))
    .filter((d) => d.pnl !== null) as { c: CrateView; i: number; pnl: number }[];
  const bestDeal = deals.length ? deals.reduce((a, b) => (b.pnl > a.pnl ? b : a)) : null;
  const worstDeal = deals.length ? deals.reduce((a, b) => (b.pnl < a.pnl ? b : a)) : null;
  return (
    <Panel title="What was inside" aside={<span>👁 = who peeked</span>} label="Crate recap">
      {(bestDeal || worstDeal) && (
        <div className="mb-2 flex flex-wrap gap-1.5 text-xs">
          {bestDeal && bestDeal.pnl > 0 && (
            <Award icon="🤑" title="Steal of the night" who={who(bestDeal.c.buyer)} text={`${signed(bestDeal.pnl)} on #${bestDeal.i + 1}`} color={GAIN} />
          )}
          {worstDeal && worstDeal.pnl < 0 && (
            <Award icon="🤡" title="Worst buy" who={who(worstDeal.c.buyer)} text={`${signed(worstDeal.pnl)} on #${worstDeal.i + 1}`} color={LOSS} />
          )}
        </div>
      )}
      <ol className="flex flex-col gap-1">
        {view.crates.map((c, i) => {
          const it = c.gift ? null : c.value !== null ? contents(c.value) : null;
          const buyer = c.status === "sold" ? who(c.buyer) : null;
          const pnl = buyer && !c.gift && c.value !== null ? c.value - c.price : null;
          return (
            <li key={i} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-panel-2/60 px-2 py-1.5 text-sm">
              <span className="w-5 shrink-0 text-xs font-bold text-muted tabular-nums">#{i + 1}</span>
              <span className="shrink-0 text-lg leading-none" aria-hidden>
                {c.gift ? "🎁" : (it?.emoji ?? "📦")}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {c.gift ? (
                  <>
                    Gift <b style={{ color: c.x2 ? GAIN : LOSS }}>{c.x2 ? "×2" : "×0"}</b>
                  </>
                ) : (
                  <>
                    {it?.name}{" "}
                    <b className="tabular-nums" style={{ color: c.value !== null ? kindColor(c.value) : undefined }}>
                      {c.value !== null ? signed(c.value) : "?"}
                    </b>
                  </>
                )}
              </span>
              <span className="shrink-0 text-xs text-muted">
                {buyer ? (
                  <>
                    <Name p={buyer} className="max-w-[6rem] align-bottom" /> ${c.price}
                    {pnl !== null && (
                      <b className="ml-1 tabular-nums" style={{ color: pnlColor(pnl) }}>
                        {signed(pnl)}
                      </b>
                    )}
                    {c.gift && giftOwner >= 0 && <b className="ml-1" style={{ color: c.x2 ? GAIN : LOSS }}>{c.x2 ? "doubled" : "wiped"}</b>}
                  </>
                ) : (
                  "no sale"
                )}
              </span>
              {c.peekers && (
                <span className="w-full pl-12 text-[11px] text-muted @md:w-auto @md:pl-0" title="Peeked by">
                  👁 {c.peekers.map((s) => who(s).avatar).join("")}
                  <span className="sr-only"> peeked by {c.peekers.map((s) => who(s).name).join(" and ")}</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function Award({ icon, title, who: p, text, color }: { icon: string; title: string; who: { name: string; color: string; avatar: string }; text: string; color: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-1" style={{ borderColor: `${color}66`, background: `${color}14` }}>
      <span aria-hidden>{icon}</span>
      <span className="text-muted">{title}:</span>
      <b className="truncate" style={{ color: p.color }}>
        {p.avatar} {p.name}
      </b>
      <b className="tabular-nums" style={{ color }}>
        {text}
      </b>
    </span>
  );
}

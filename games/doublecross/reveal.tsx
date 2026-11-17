"use client";

import { useState } from "react";
import type { Player } from "@/shared/types";
import { msgText } from "./chat";
import { HEIST_STAGGER_MS, HEIST_VERDICT_MS, PAIR_VERDICT_MS, type Choice, type DcView, type Msg, type Outcome, type TableRec, type TableView } from "./shared";
import { BUST, CHOICE_META, Card, Coin, GOLD, SPLIT, STEAL, vars, type Who } from "./ui";
import { Avatar } from "@/components/Avatar";

/** Server time when this round's flip started (only meaningful in reveal step 1). */
export const flipStart = (view: DcView) => (view.endsAt ?? 0) - view.phaseMs;

/** Server time when the verdict lands: stamps, payouts and the score update. Null before the flip. */
export function verdictAt(view: DcView): number | null {
  if (view.phase !== "reveal" || view.step !== 1) return null;
  const crew = view.tables[0]?.seats.length ?? 0;
  return flipStart(view) + (view.heist ? crew * HEIST_STAGGER_MS + HEIST_VERDICT_MS : PAIR_VERDICT_MS);
}

export const OUTCOME_META: Record<Outcome, { label: string; color: string; emoji: string }> = {
  deal: { label: "Deal", color: SPLIT, emoji: "🤝" },
  steal: { label: "Double cross!", color: STEAL, emoji: "🗡️" },
  bust: { label: "Bust", color: BUST, emoji: "💥" },
};

type CardSize = "lg" | "md" | "sm" | "mini";
const SIZES: Record<CardSize, { r: string; q: string; emoji: string; label: string | null; avatar: string | null }> = {
  lg: { r: "rounded-2xl", q: "text-4xl @lg:text-5xl", emoji: "text-4xl @lg:text-5xl", label: "text-base @lg:text-lg", avatar: "text-sm @lg:text-base" },
  md: { r: "rounded-xl", q: "text-3xl", emoji: "text-3xl", label: "text-sm", avatar: "text-xs" },
  sm: { r: "rounded-xl", q: "text-2xl", emoji: "text-2xl", label: "text-[11px]", avatar: null },
  mini: { r: "rounded-lg", q: "text-base", emoji: "text-lg", label: null, avatar: null },
};

/** A face-down card that flips to SPLIT or STEAL. Delays are relative to mount, so a late joiner sees it settled. */
function FlipCard({ p, choice, flipped, delay, drum, size }: { p: Player; choice: Choice | null; flipped: boolean; delay: number; drum: boolean; size: CardSize }) {
  const m = choice ? CHOICE_META[choice] : null;
  const z = SIZES[size];
  return (
    <div className={`dc-card aspect-[3/4] w-full ${z.r}`} style={vars({ "--dc-a": p.color })}>
      <div
        className={`dc-inner ${z.r} ${flipped && m ? "dc-flipped" : drum ? "dc-wobble" : ""}`}
        style={vars({ "--d": `${flipped ? delay : Math.round(delay / 3)}ms` })}
      >
        <div className={`dc-face dc-back grid place-items-center border-2 ${z.r}`} style={{ borderColor: `${p.color}aa` }}>
          <span className={`font-display font-black text-white/85 ${z.q}`}>?</span>
          {z.avatar && (
            <span aria-hidden className={`absolute top-1 left-1.5 ${z.avatar}`}>
              <Avatar id={p.avatar} />
            </span>
          )}
        </div>
        {m && (
          <div
            className={`dc-face dc-front grid place-items-center border-2 ${z.r}`}
            style={{ borderColor: m.color, background: `linear-gradient(180deg, ${m.color}45, ${m.color}12), var(--color-panel)` }}
          >
            <span className="flex flex-col items-center gap-1">
              <span aria-hidden className={`leading-none ${z.emoji}`}>
                {m.emoji}
              </span>
              {z.label && (
                <span className={`font-display font-extrabold tracking-wide uppercase ${z.label}`} style={{ color: m.color }}>
                  {m.label}
                </span>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** The verdict stamp. `overlay` sits across the bottom edge of the cards; otherwise it's in the flow. */
function Stamp({ out, delay, overlay }: { out: Outcome; delay: number; overlay?: boolean }) {
  const m = OUTCOME_META[out];
  return (
    <div className={overlay ? "pointer-events-none absolute inset-x-0 -bottom-3 z-10 flex justify-center" : "mt-3 mb-1 flex justify-center"} aria-hidden>
      <div
        className="dc-stamp rounded-xl border-[3px] px-3 py-0.5 font-display text-lg font-black tracking-wider whitespace-nowrap uppercase @lg:text-xl"
        style={{ color: m.color, borderColor: m.color, background: "rgb(14 12 29 / .9)", boxShadow: `0 0 30px ${m.color}55`, ...vars({ "--d": `${delay}ms` }) }}
      >
        {m.label} {m.emoji}
      </div>
    </div>
  );
}

function Gain({ v, delay, victim, big }: { v: number; delay: number; victim: boolean; big?: boolean }) {
  return (
    <span
      className={`dc-float font-display font-extrabold tabular-nums ${big ? "text-xl" : "text-sm"}`}
      style={{ color: v > 0 ? GOLD : victim ? STEAL : "var(--color-muted)", ...vars({ "--d": `${delay}ms` }) }}
    >
      {victim ? "💔 0" : `+${v}`}
    </span>
  );
}

/** What happened to one seat at the flip. */
function fx(rec: TableRec | null, i: number) {
  if (!rec) return { victim: false, thief: false };
  return {
    victim: rec.out === "steal" && rec.c[i] === "split",
    thief: rec.out === "steal" && rec.c[i] === "steal",
  };
}

function lastWords(msgs: Msg[], seat: number): string | null {
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].s === seat) return msgText(msgs[i]);
  return null;
}

/** A card plus its effects layer: the thief glows, victims get a broken heart, a bust explodes. */
function SeatCard({ p, rec, i, start, verdict, size, drum }: { p: Player; rec: TableRec | null; i: number; start: number; verdict: number; size: CardSize; drum: boolean }) {
  const { victim, thief } = fx(rec, i);
  return (
    <div className="relative w-full">
      <div
        className={`${SIZES[size].r} ${thief ? "dc-glow" : ""}`}
        style={thief ? { ...vars({ "--dc-c": STEAL }), animationDelay: `${verdict}ms` } : undefined}
      >
        <FlipCard p={p} choice={rec ? rec.c[i] : null} flipped={!!rec} delay={start} drum={drum} size={size} />
      </div>
      {victim && (
        <span aria-hidden className={`dc-pop absolute -top-2 -right-2 ${size === "lg" ? "text-3xl" : "text-xl"}`} style={vars({ "--d": `${verdict + 150}ms` })}>
          💔
        </span>
      )}
      {rec?.out === "bust" && (
        <span
          aria-hidden
          className={`dc-boom pointer-events-none absolute inset-0 grid place-items-center ${size === "lg" ? "text-6xl" : "text-4xl"}`}
          style={vars({ "--d": `${verdict}ms` })}
        >
          💥
        </span>
      )}
    </div>
  );
}

/** Your table, big: face-down cards that wobble, then flip together. You're always on the left. */
function BigTable({
  view,
  who,
  mySeat,
  table,
  rec,
  msgs,
  t0,
}: {
  view: DcView;
  who: Who;
  mySeat: number;
  table: TableView;
  rec: TableRec | null;
  msgs: Msg[];
  /** Server time this component mounted (for settling animations on a late join). */
  t0: number;
}) {
  const start = rec ? flipStart(view) - t0 : 0;
  const verdict = start + PAIR_VERDICT_MS;
  const width = table.seats.length === 2 ? "w-[38%] max-w-40" : "w-[30%] max-w-36";
  const order = table.seats.map((_, i) => i).sort((a, b) => Number(table.seats[b] === mySeat) - Number(table.seats[a] === mySeat));
  const shake = rec && rec.out !== "deal";
  return (
    <Card label="Your table's flip" className="relative overflow-hidden">
      {!rec && (
        <div
          aria-hidden
          className="dc-spot pointer-events-none absolute inset-0"
          style={{ background: `radial-gradient(60% 70% at 50% 45%, ${GOLD}22, transparent 70%)` }}
        />
      )}
      <div className={`relative ${shake ? "dc-thud" : ""}`} style={vars({ "--d": `${verdict}ms` })}>
        <div className="relative flex items-center justify-center gap-[6%]">
          {order.map((i, k) => (
            <div key={table.seats[i]} className={width}>
              <SeatCard p={who(table.seats[i])} rec={rec} i={i} start={start + k * 40} verdict={verdict} size="lg" drum={!rec} />
            </div>
          ))}
          {rec ? (
            <Stamp out={rec.out} delay={verdict} overlay />
          ) : (
            <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center text-4xl">
              <span className="dc-drum">🥁</span>
            </span>
          )}
        </div>
        <div className={`flex items-start justify-center gap-[6%] ${rec ? "mt-7" : "mt-2"}`}>
          {order.map((i) => {
            const s = table.seats[i];
            const p = who(s);
            const words = lastWords(msgs, s);
            return (
              <div key={s} className={`flex min-w-0 flex-col items-center gap-0.5 text-center ${width}`}>
                <span className="max-w-full truncate text-sm font-bold" style={{ color: p.color }}>
                  {s === mySeat ? "You" : p.name}
                </span>
                {rec ? (
                  <Gain v={rec.gain[i]} delay={verdict + 200} victim={fx(rec, i).victim} big />
                ) : s === mySeat && view.me?.choice ? (
                  <span className="text-xs text-muted">
                    your pick: {CHOICE_META[view.me.choice].emoji} {CHOICE_META[view.me.choice].label}
                  </span>
                ) : (
                  <span className="text-xs text-muted">{p.connected ? "face down" : "offline"}</span>
                )}
                {words && rec && (
                  <q className="dc-fade line-clamp-2 max-w-full text-xs text-muted italic" style={vars({ "--d": `${verdict + 500}ms` })}>
                    {words}
                  </q>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {rec && (
        <p className="sr-only">
          {table.seats.map((s, i) => `${s === mySeat ? "You" : who(s).name}: ${rec.c[i]}${rec.auto[i] ? " (timed out)" : ""}, +${rec.gain[i]}`).join(". ")}
        </p>
      )}
    </Card>
  );
}

/** Every other table, compact, flipping in the same moment. */
function OtherTables({
  view,
  who,
  mySeat,
  skip,
  recs,
  t0,
  big,
}: {
  view: DcView;
  who: Who;
  mySeat: number;
  skip: number;
  recs: TableRec[] | null;
  t0: number;
  big: boolean;
}) {
  const shown = view.tables.map((t, g) => ({ t, g })).filter(({ g }) => g !== skip);
  if (!shown.length) return null;
  const start = recs ? flipStart(view) - t0 : 0;
  return (
    <Card label={big ? "Every table" : "Other tables"}>
      <div className="label mb-2">{big ? "Every table" : "Other tables"}</div>
      <ul className="grid gap-1.5 @lg:grid-cols-2">
        {shown.map(({ t, g }, k) => {
          const rec = recs?.[g] ?? null;
          const delay = start + 150 + k * 110;
          return (
            <li key={g} className="relative flex items-center gap-2 rounded-xl bg-panel-2/70 px-2 py-2">
              <div className="flex min-w-0 flex-1 items-start gap-2">
                {t.seats.map((s, i) => {
                  const p = who(s);
                  return (
                    <div key={s} className={`flex min-w-0 flex-col items-center gap-0.5 ${big ? "w-16" : "w-12"}`}>
                      <div className={big ? "w-11" : "w-9"}>
                        <FlipCard p={p} choice={rec ? rec.c[i] : null} flipped={!!rec} delay={delay} drum={!rec} size="mini" />
                      </div>
                      <span className="max-w-full truncate text-xs font-semibold" style={{ color: p.color }}>
                        {s === mySeat ? "You" : p.name}
                      </span>
                      {rec && (
                        <span
                          className="dc-float text-xs font-bold tabular-nums"
                          style={{ color: rec.gain[i] > 0 ? GOLD : "var(--color-muted)", ...vars({ "--d": `${delay + 900}ms` }) }}
                        >
                          +{rec.gain[i]}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Coin v={t.pot} className="text-xs" />
                {rec && (
                  <span
                    className="dc-pop rounded-full px-2 py-0.5 text-xs font-extrabold uppercase"
                    style={{ color: OUTCOME_META[rec.out].color, background: `${OUTCOME_META[rec.out].color}22`, ...vars({ "--d": `${delay + 800}ms` }) }}
                  >
                    {OUTCOME_META[rec.out].emoji} {rec.out === "steal" ? "stolen" : OUTCOME_META[rec.out].label}
                  </span>
                )}
              </div>
              {rec && <p className="sr-only">{t.seats.map((s, i) => `${who(s).name}: ${rec.c[i]}, +${rec.gain[i]}`).join(". ")}</p>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Columns for the heist grid, so rows come out even (5 → 3+2, 7 → 4+3, 10 → 5+5). */
const heistCols = (crew: number) => (crew <= 4 ? Math.max(2, crew) : crew <= 6 ? 3 : crew <= 8 ? 4 : 5);

/** The heist: every card face down, flipped one at a time, then the verdict. */
function HeistTable({ view, who, mySeat, rec, t0 }: { view: DcView; who: Who; mySeat: number; rec: TableRec | null; t0: number }) {
  const table = view.tables[0];
  if (!table) return null;
  const crew = table.seats.length;
  const start = rec ? flipStart(view) - t0 : 0;
  const verdict = start + crew * HEIST_STAGGER_MS + HEIST_VERDICT_MS;
  const cols = heistCols(crew);
  const size: CardSize = cols <= 2 ? "lg" : cols <= 4 ? "md" : "sm";
  const shake = rec && rec.out !== "deal";
  return (
    <Card
      label="The Heist flip"
      className="relative overflow-hidden pb-4"
      style={{ borderColor: `${GOLD}66`, background: `linear-gradient(180deg, ${GOLD}14, transparent 60%), var(--color-panel)` }}
    >
      {!rec && (
        <div aria-hidden className="dc-spot pointer-events-none absolute inset-0" style={{ background: `radial-gradient(60% 60% at 50% 50%, ${GOLD}26, transparent 70%)` }} />
      )}
      <div className="relative mb-3 flex items-center justify-center gap-2">
        <span aria-hidden className="text-2xl">
          🏦
        </span>
        <span className="font-display text-lg font-extrabold" style={{ color: GOLD }}>
          The Heist
        </span>
        <Coin v={table.pot} />
      </div>
      <div className={`relative ${shake ? "dc-thud" : ""}`} style={vars({ "--d": `${verdict}ms` })}>
        <div className="relative mx-auto flex max-w-xl flex-wrap justify-center gap-x-2 gap-y-3">
          {table.seats.map((s, i) => {
            const p = who(s);
            return (
              <div
                key={s}
                className="flex min-w-0 flex-col items-center gap-0.5"
                style={{ width: `calc((100% - ${cols - 1} * 0.5rem) / ${cols})`, maxWidth: cols <= 2 ? "9rem" : "6.5rem" }}
              >
                <SeatCard p={p} rec={rec} i={i} start={start + i * HEIST_STAGGER_MS} verdict={verdict} size={size} drum={!rec} />
                <span className="mt-0.5 max-w-full truncate text-xs font-bold" style={{ color: p.color }}>
                  {s === mySeat ? "You" : p.name}
                </span>
                {rec && <Gain v={rec.gain[i]} delay={verdict + 200} victim={fx(rec, i).victim} />}
              </div>
            );
          })}
          {!rec && (
            <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center text-5xl">
              <span className="dc-drum">🥁</span>
            </span>
          )}
        </div>
        {rec && <Stamp out={rec.out} delay={verdict} />}
      </div>
      {rec && <p className="sr-only">{table.seats.map((s, i) => `${s === mySeat ? "You" : who(s).name}: ${rec.c[i]}, +${rec.gain[i]}`).join(". ")}</p>}
    </Card>
  );
}

export function RevealStage({
  view,
  who,
  mySeat,
  tableIdx,
  msgs,
  serverNow,
}: {
  view: DcView;
  who: Who;
  mySeat: number;
  tableIdx: number;
  msgs: Msg[];
  serverNow: () => number;
}) {
  // Measured once per step (the parent keys this on the step), like TimerBar does.
  const [t0] = useState(() => serverNow());
  const rec = view.step === 1 ? (view.history.find((r) => r.round === view.round) ?? null) : null;
  if (view.heist) return <HeistTable view={view} who={who} mySeat={mySeat} rec={rec?.tables[0] ?? null} t0={t0} />;
  const mine = tableIdx >= 0 ? view.tables[tableIdx] : null;
  return (
    <>
      {mine && <BigTable view={view} who={who} mySeat={mySeat} table={mine} rec={rec?.tables[tableIdx] ?? null} msgs={msgs} t0={t0} />}
      <OtherTables view={view} who={who} mySeat={mySeat} skip={tableIdx} recs={rec?.tables ?? null} t0={t0} big={!mine} />
    </>
  );
}

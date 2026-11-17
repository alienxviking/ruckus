"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { Note, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import type { BookRow, MkAction, MkView, RoundRecord } from "./server";
import {
  CARD_MEAN,
  FLIP_MS,
  HOUSE_SPREAD,
  POS_LIMIT,
  SETTLE_MS,
  SIZE_MAX,
  STREET,
  TRADE_MS,
  cardValue,
  isMkEvent,
  signed,
} from "./shared";
import { CSS, ASK, BID, CountUp, EASE, LOSS, GAIN, Name, Panel, makeWho, pnlColor, posWord, useLatest, type WhoFn } from "./ui";
import { PlayingCard, ValuePill, cardShort } from "./cards";
import { OrderBook } from "./book";
import { PriceChart, Tape, pnlLine } from "./chart";
import { Avatar } from "@/components/Avatar";

type Props = GameClientProps<MkView, MkAction>;

export default function MarketMaker(props: Props) {
  if (!props.view) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Note>Opening the market…</Note>
      </div>
    );
  }
  // Spectators get slot -1 from the server, which is also the House's slot: use a slot nobody has.
  const view = props.view.me >= 0 ? props.view : { ...props.view, me: NOBODY };
  return <Floor {...props} view={view} />;
}

const NOBODY = -99;

// ---------- derived numbers ----------

interface Derived {
  n: number;
  flipped: number;
  streetKnown: number;
  /** Cards nobody (publicly) has seen yet. */
  unseen: number;
  fair: number;
  /** My card's value, or null for spectators. */
  own: number | null;
  /** My best guess at the settlement: what I know plus ~7 per card I can't see. */
  estimate: number;
  myBid: BookRow | null;
  myAsk: BookRow | null;
  /** Other traders' quotes: what I can trade against. */
  oBids: BookRow[];
  oAsks: BookRow[];
  pos: number;
  cash: number;
  bought: number;
  sold: number;
  boughtValue: number;
  soldValue: number;
  roomBuy: number;
  roomSell: number;
}

function derive(view: MkView): Derived {
  const n = view.ids.length;
  let streetKnown = 0;
  let flipped = 0;
  for (const c of view.street) {
    if (c === null) continue;
    streetKnown += cardValue(c);
    flipped += 1;
  }
  const unseen = n + STREET - flipped;
  const own = view.card !== null ? cardValue(view.card) : null;
  const estimate = own === null ? view.fair : view.fair - CARD_MEAN + own;
  const [bought, boughtValue, sold, soldValue] = view.mine ?? [0, 0, 0, 0];
  const pos = bought - sold;
  return {
    n,
    flipped,
    streetKnown,
    unseen,
    fair: view.fair,
    own,
    estimate,
    myBid: view.bids.find((r) => r[0] === view.me) ?? null,
    myAsk: view.asks.find((r) => r[0] === view.me) ?? null,
    oBids: view.bids.filter((r) => r[0] !== view.me),
    oAsks: view.asks.filter((r) => r[0] !== view.me),
    pos,
    cash: soldValue - boughtValue,
    bought,
    sold,
    boughtValue,
    soldValue,
    roomBuy: POS_LIMIT - pos,
    roomSell: POS_LIMIT + pos,
  };
}

/** Lots available at exactly the best price (what BUY/SELL takes). */
const atBest = (rows: BookRow[]) => (rows.length ? rows.filter((r) => r[1] === rows[0][1]).reduce((a, r) => a + r[2], 0) : 0);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const fmt1 = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

// ---------- the trading floor ----------

type Editor = { round: number; bid: number | null; ask: number | null };
type News = { id: number; text: ReactNode; tone: "buy" | "sell" | "warn" | "info"; at: string };
const newsKey = (view: MkView) => `${view.phase}:${view.round}`;

function Floor({ view, byId, isPlayer, act, serverNow, onEvent, accent }: Props & { view: MkView }) {
  const who = makeWho(view.ids, byId);
  const d = derive(view);
  const meP: Player | null = view.me >= 0 ? who(view.me) : null;
  const trading = view.phase === "trade";
  const canTrade = isPlayer && trading && view.me >= 0;

  const [size, setSize] = useState(2);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);

  // Quote editor: until you touch it this round, it sits 3 either side of your estimate.
  const ed = editor && editor.round === view.round ? editor : null;
  const bidPx = ed ? ed.bid : (d.myBid?.[1] ?? clamp(Math.min(d.estimate - 3, (d.myAsk?.[1] ?? Infinity) - 1), 1, view.maxPrice - 1));
  const askPx = ed ? ed.ask : (d.myAsk?.[1] ?? clamp(Math.max(d.estimate + 3, (d.myBid?.[1] ?? -Infinity) + 1), 2, view.maxPrice));

  const send = (a: MkAction) => act(a);

  const bestAsk = d.oAsks[0] ?? null;
  const bestBid = d.oBids[0] ?? null;
  const buyQty = bestAsk ? Math.min(size, atBest(d.oAsks), d.roomBuy) : 0;
  const sellQty = bestBid ? Math.min(size, atBest(d.oBids), d.roomSell) : 0;
  const buy = () => {
    if (canTrade && bestAsk && buyQty > 0) send({ type: "trade", side: "buy", qty: buyQty, price: bestAsk[1] });
  };
  const sell = () => {
    if (canTrade && bestBid && sellQty > 0) send({ type: "trade", side: "sell", qty: sellQty, price: bestBid[1] });
  };
  const validPx = (v: number | null): v is number => v !== null && Number.isInteger(v) && v >= 1 && v <= view.maxPrice;
  const postSide = (side: "bid" | "ask") => {
    if (!canTrade) return;
    const px = side === "bid" ? bidPx : askPx;
    if (!validPx(px)) return setFormErr(`Prices go from 1 to ${view.maxPrice}.`);
    if (side === "bid" && d.myAsk && px >= d.myAsk[1]) return setFormErr(`Your bid must be below your ask (${d.myAsk[1]}).`);
    if (side === "ask" && d.myBid && px <= d.myBid[1]) return setFormErr(`Your ask must be above your bid (${d.myBid[1]}).`);
    setFormErr(null);
    send({ type: "quote", side, price: px, size });
  };
  const postBoth = () => {
    if (!canTrade) return;
    if (!validPx(bidPx) || !validPx(askPx)) return setFormErr(`Prices go from 1 to ${view.maxPrice}.`);
    if (bidPx >= askPx) return setFormErr("Your bid has to be below your ask.");
    setFormErr(null);
    const bid: MkAction = { type: "quote", side: "bid", price: bidPx, size };
    const ask: MkAction = { type: "quote", side: "ask", price: askPx, size };
    // Order matters so the new pair never crosses the old one.
    if (d.myAsk && bidPx >= d.myAsk[1]) {
      send(ask);
      send(bid);
    } else {
      send(bid);
      send(ask);
    }
  };
  const cancel = (side: "bid" | "ask" | "both") => {
    if (canTrade) send({ type: "cancel", side });
  };
  const setPx = (side: "bid" | "ask", v: number | null) => {
    setFormErr(null);
    setEditor({ round: view.round, bid: side === "bid" ? v : bidPx, ask: side === "ask" ? v : askPx });
  };
  const take = (side: "buy" | "sell", qty: number, price: number) => {
    if (canTrade && qty > 0) send({ type: "trade", side, qty, price });
  };

  // Keyboard: B buy · S sell · 1-5 size · Q quote both · X pull quotes.
  const keys = useLatest({ canTrade, buy, sell, postBoth, cancel });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? "")) return;
      const k = keys.current;
      if (!k.canTrade) return;
      const key = e.key.toLowerCase();
      if (key === "b") k.buy();
      else if (key === "s") k.sell();
      else if (key === "q") k.postBoth();
      else if (key === "x") k.cancel("both");
      else if (/^[1-5]$/.test(key)) setSize(Number(key));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keys]);

  const latestNews = useNews(onEvent, { view, who, d });
  const news = latestNews && latestNews.at === newsKey(view) ? latestNews : null;
  const settle = view.phase !== "trade" ? (view.history[view.history.length - 1]?.settle ?? null) : null;

  return (
    <div className="@container mx-auto flex w-full max-w-5xl flex-col gap-3 pb-20 lg:pb-2" style={{ ["--mk-accent" as string]: accent }}>
      <style href="ruckus-market" precedence="default">
        {CSS}
      </style>

      <Header view={view} serverNow={serverNow} accent={accent} settle={settle} />
      {view.closeAt !== null && view.phase !== "final" && <CloseNote closeAt={view.closeAt} serverNow={serverNow} />}
      {view.phase === "trade" && <NewsLine news={news} view={view} d={d} />}

      {view.phase === "trade" && (
        <>
          <Table view={view} d={d} accent={accent} serverNow={serverNow} />
          <div className="mk-floor">
            <div className="mk-col">
              <div className="order-2 min-w-0">
                <OrderBook
                  bids={view.bids}
                  asks={view.asks}
                  me={view.me}
                  who={who}
                  onTake={canTrade ? take : null}
                  onCancel={canTrade ? cancel : null}
                  room={{ buy: d.roomBuy, sell: d.roomSell }}
                  size={size}
                  fair={view.fair}
                />
              </div>
              <div className="order-4 min-w-0">
                <PriceChart chart={view.chart} street={view.street} players={d.n} own={d.own} ownColor={meP?.color ?? accent} settle={null} accent={accent} />
              </div>
              <div className="order-5 min-w-0">
                <Tape tape={view.tape} nt={view.nt} me={view.me} who={who} accent={accent} />
              </div>
            </div>
            <div className="mk-col">
              {canTrade ? (
                <>
                  <div className="order-1 min-w-0">
                    <TradePanel
                      d={d}
                      size={size}
                      setSize={setSize}
                      buy={buy}
                      sell={sell}
                      buyQty={buyQty}
                      sellQty={sellQty}
                      bestAsk={bestAsk}
                      bestBid={bestBid}
                    />
                  </div>
                  <div className="order-3 min-w-0">
                    <QuotePanel
                      d={d}
                      size={size}
                      bidPx={bidPx}
                      askPx={askPx}
                      maxPrice={view.maxPrice}
                      setPx={setPx}
                      postSide={postSide}
                      postBoth={postBoth}
                      cancel={cancel}
                      err={formErr}
                    />
                  </div>
                </>
              ) : (
                <div className="order-1 min-w-0">
                  <Panel title="Watching">
                    <Note>👀 You&apos;re watching. Traders&apos; cards and positions stay hidden until the bell.</Note>
                  </Panel>
                </div>
              )}
            </div>
          </div>
          <Traders view={view} who={who} />
          {canTrade && (
            <p className="hidden text-center text-xs text-muted @2xl:block">
              Keys: <b>B</b> buy · <b>S</b> sell · <b>1–5</b> size · <b>Q</b> post both quotes · <b>X</b> pull your quotes
            </p>
          )}
        </>
      )}

      {view.phase === "settle" && (
        <>
          <Settlement view={view} who={who} accent={accent} serverNow={serverNow} />
          <div className="grid gap-3 @2xl:grid-cols-2">
            <PriceChart chart={view.chart} street={view.street} players={d.n} own={d.own} ownColor={meP?.color ?? accent} settle={settle} accent={accent} />
            <Tape tape={view.tape} nt={view.nt} me={view.me} who={who} accent={accent} />
          </div>
        </>
      )}

      {view.phase === "final" && <Final view={view} who={who} accent={accent} />}

      {!isPlayer && view.phase !== "trade" && <Note>👀 You&apos;re watching.</Note>}
    </div>
  );
}

// ---------- header, timeline, news ----------

function Header({ view, serverNow, accent, settle }: { view: MkView; serverNow: () => number; accent: string; settle: number | null }) {
  let text: ReactNode;
  if (view.phase === "trade") {
    text = (
      <>
        <span aria-hidden>📈 </span>Round {view.round} of {view.rounds} · market open
      </>
    );
  } else if (view.phase === "settle") {
    text = (
      <>
        <span aria-hidden className="mk-bell">
          🔔
        </span>{" "}
        Round {view.round} settles at <span style={{ color: accent }}>{settle}</span>
      </>
    );
  } else {
    text = (
      <>
        <span aria-hidden>🏁 </span>Final standings
      </>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div aria-live="polite" aria-atomic="true">
        <StatusBanner key={`${view.phase}-${view.round}`} accent={accent}>
          <span className="block truncate">{text}</span>
        </StatusBanner>
      </div>
      {view.phase === "trade" && <Timeline view={view} serverNow={serverNow} accent={accent} />}
      {view.phase === "settle" && (
        <div className="flex items-center gap-2 px-1 text-xs text-muted">
          <span className="shrink-0">{view.round < view.rounds && !view.abandoned ? `Round ${view.round + 1} deals in` : "Final standings in"}</span>
          <div className="flex-1">
            <TimerBar endsAt={view.endsAt} total={SETTLE_MS} serverNow={serverNow} color={accent} />
          </div>
        </div>
      )}
    </div>
  );
}

function Timeline({ view, serverNow, accent }: { view: MkView; serverNow: () => number; accent: string }) {
  const flipped = view.street.filter((c) => c !== null).length;
  const nextFlip = flipped < STREET ? view.flipAt[flipped] : null;
  const flipSecs = useSecondsLeft(nextFlip, serverNow);
  const bellSecs = useSecondsLeft(view.endsAt, serverNow);
  return (
    <div className="card px-3 pt-2 pb-2.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate text-muted">
          {nextFlip !== null ? (
            <>
              Street card {flipped + 1} flips in <b className="text-text tabular-nums">{flipSecs}s</b>
            </>
          ) : (
            <>All street cards are up</>
          )}
        </span>
        <span className="shrink-0 text-muted">
          <span aria-hidden>🔔 </span>Bell in{" "}
          <b className={`tabular-nums ${bellSecs <= 10 ? "text-rose-300" : "text-text"}`}>{bellSecs}s</b>
        </span>
      </div>
      <div className="relative mt-2 h-2.5 rounded-full bg-panel-2" role="progressbar" aria-label="Round time" aria-valuemin={0} aria-valuemax={90} aria-valuenow={90 - bellSecs}>
        <div className="absolute inset-0 overflow-hidden rounded-full">
          <GrowFill key={`${view.roundStart}-${flipped}`} start={view.roundStart} total={TRADE_MS} serverNow={serverNow} color={`${accent}aa`} />
        </div>
        {FLIP_MS.map((ms, i) => {
          const up = view.street[i] !== null;
          return (
            <span
              key={i}
              aria-hidden
              className="absolute top-1/2 h-4 w-3 -translate-x-1/2 -translate-y-1/2 rounded-[3px] border"
              style={{
                left: `${(ms / TRADE_MS) * 100}%`,
                borderColor: up ? "#fff" : accent,
                background: up ? "#fff" : "var(--color-panel)",
                transition: `background-color .4s ${EASE}`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

/** A bar that fills from the round's start to the bell (one compositor animation). */
function GrowFill({ start, total, serverNow, color }: { start: number; total: number; serverNow: () => number; color: string }) {
  const [init] = useState(() => {
    const el = Math.min(total, Math.max(0, serverNow() - start));
    return { from: el / total, left: total - el };
  });
  return (
    <div
      className={`h-full w-full rounded-full ${init.left > 0 ? "mk-grow" : ""}`}
      style={
        {
          background: color,
          transform: `scaleX(${init.left > 0 ? init.from : 1})`,
          transformOrigin: "left",
          animationDuration: `${init.left}ms`,
          "--from": init.from,
        } as React.CSSProperties
      }
    />
  );
}

function CloseNote({ closeAt, serverNow }: { closeAt: number; serverNow: () => number }) {
  const secs = useSecondsLeft(closeAt, serverNow);
  return (
    <p role="status" className="card animate-rise border-amber-400/50 px-3 py-2 text-center text-sm">
      <span aria-hidden>📡 </span>Only one trader is still connected. The market closes in <b className="tabular-nums">{secs}s</b> unless someone
      comes back.
    </p>
  );
}

function useNews(
  onEvent: Props["onEvent"],
  live: { view: MkView; who: WhoFn; d: Derived },
): News | null {
  const [news, setNews] = useState<News | null>(null);
  const ref = useLatest(live);
  useEffect(() => {
    let id = 0;
    return onEvent((e) => {
      if (!isMkEvent(e)) return;
      const { view, who, d } = ref.current;
      let item: Omit<News, "id" | "at"> | null = null;
      if (e.k === "t") {
        const [b, s, price, qty] = e.tr;
        const mine = e.a === view.me;
        if (b === view.me) {
          item = {
            tone: "buy",
            text: mine ? (
              <>
                ✅ You bought <b>{qty}</b> @ <b>{price}</b> from <Name p={who(s)} />
              </>
            ) : (
              <>
                ⚡ <Name p={who(s)} /> hit your bid: you bought <b>{qty}</b> @ <b>{price}</b>
              </>
            ),
          };
        } else if (s === view.me) {
          item = {
            tone: "sell",
            text: mine ? (
              <>
                ✅ You sold <b>{qty}</b> @ <b>{price}</b> to <Name p={who(b)} />
              </>
            ) : (
              <>
                ⚡ <Name p={who(b)} /> lifted your ask: you sold <b>{qty}</b> @ <b>{price}</b>
              </>
            ),
          };
        }
      } else if (e.k === "flip") {
        const v = cardValue(e.c);
        const before = d.fair;
        const after = before - CARD_MEAN + v;
        item = {
          tone: "info",
          text: (
            <>
              🃏 Street card {e.i + 1} is <b>{cardShort(e.c)}</b> (worth {v}): fair value {before} → <b>{after}</b>
            </>
          ),
        };
      } else if (e.k === "msg") {
        item = { tone: "warn", text: <>⚠️ {e.m}</> };
      }
      if (item) setNews({ id: ++id, at: newsKey(view), ...item });
    });
  }, [onEvent, ref]);
  // News fades back to the standing hint after a while.
  useEffect(() => {
    if (!news) return;
    const t = setTimeout(() => setNews((n) => (n?.id === news.id ? null : n)), 6000);
    return () => clearTimeout(t);
  }, [news]);
  return news;
}

const TONE: Record<News["tone"], string> = { buy: BID, sell: ASK, warn: "#fbbf24", info: "var(--mk-accent)" };

function NewsLine({ news, view, d }: { news: News | null; view: MkView; d: Derived }) {
  const hint =
    view.phase === "trade" ? (
      <>
        💡 It pays the <b>sum of all {d.n + STREET} cards</b>. Think it ends higher than a price? <b style={{ color: BID }}>Buy</b>. Lower?{" "}
        <b style={{ color: ASK }}>Sell</b>.
      </>
    ) : null;
  if (!news && !hint) return null;
  return (
    <div aria-live="polite" className="min-h-10">
      <p
        key={news?.id ?? "hint"}
        className="mk-in rounded-xl border px-3 py-2 text-center text-sm leading-snug"
        style={{
          borderColor: news ? TONE[news.tone] : "var(--color-line)",
          background: news ? "var(--color-panel-2)" : "transparent",
          color: news ? undefined : "var(--color-muted)",
        }}
      >
        {news ? news.text : hint}
      </p>
    </div>
  );
}

// ---------- cards on the table ----------

function Table({ view, d, accent, serverNow }: { view: MkView; d: Derived; accent: string; serverNow: () => number }) {
  return (
    <section className="card p-3" aria-label="Cards">
      <div className="flex flex-wrap items-stretch gap-x-5 gap-y-3">
        <div className="flex gap-4">
          {view.card !== null && (
            <div className="flex flex-col items-center gap-1">
              <span className="label">Your card</span>
              <PlayingCard key={view.round} code={view.card} size="lg" accent={accent} className="mk-deal" />
              <ValuePill code={view.card} />
            </div>
          )}
          <div className="flex flex-col items-center gap-1">
            <span className="label">Street</span>
            <div className="flex h-[106px] items-center gap-2">
              {view.street.map((c, i) => (
                <div key={`${view.round}-${i}`} className="flex flex-col items-center gap-1">
                  <div
                    className={`rounded-[10px] ${c === null && i === d.flipped ? "mk-next" : ""}`}
                    style={{ ["--mk-accent" as string]: accent }}
                  >
                    <PlayingCard code={c} size="md" accent={accent} className="mk-deal" style={{ animationDelay: `${120 + i * 90}ms` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              {view.street.map((c, i) => (
                <span key={i} className="flex w-14 justify-center">
                  {c === null && i === d.flipped ? (
                    <FlipIn at={view.flipAt[i]} serverNow={serverNow} />
                  ) : (
                    <ValuePill code={c} muted={`0:${FLIP_MS[i] / 1000}`} />
                  )}
                </span>
              ))}
            </div>
          </div>
        </div>
        <Estimate d={d} accent={accent} />
      </div>
    </section>
  );
}

function FlipIn({ at, serverNow }: { at: number; serverNow: () => number }) {
  const secs = useSecondsLeft(at, serverNow);
  return (
    <span className="rounded-full px-1.5 py-px font-mono text-[11px] leading-4 font-bold tabular-nums" style={{ background: "var(--mk-accent)", color: "#06201d" }}>
      {secs}s
    </span>
  );
}

function Estimate({ d, accent }: { d: Derived; accent: string }) {
  const unseenMine = d.own === null ? d.unseen : d.unseen - 1;
  const known = d.streetKnown + (d.own ?? 0);
  return (
    <div className="flex min-w-[13rem] flex-1 flex-col justify-center rounded-xl bg-panel-2 px-3 py-2">
      <span className="flex items-baseline gap-2">
        <span className="label">{d.own === null ? "Public fair value" : "Your estimate"}</span>
        <span key={d.estimate} className="mk-pop font-display text-2xl leading-tight font-extrabold tabular-nums @2xl:text-4xl" style={{ color: accent }}>
          ≈ {d.estimate}
        </span>
      </span>
      <span className="text-xs leading-snug text-muted">
        Known <b className="text-text">{known}</b>
        {d.own !== null && (
          <>
            {" "}
            (you {d.own}
            {d.flipped > 0 ? ` + street ${d.streetKnown}` : ""})
          </>
        )}
        {d.own === null && d.flipped > 0 && <> (street)</>} + <b className="text-text">{unseenMine}</b> unseen × ~{CARD_MEAN} ={" "}
        <b className="text-text">{unseenMine * CARD_MEAN}</b>
      </span>
      <RangeBar lo={known + unseenMine} hi={known + unseenMine * 13} at={d.estimate} accent={accent} />
    </div>
  );
}

/** Where the total can still end up (every unseen card an ace … every one a king), with the estimate marked. */
function RangeBar({ lo, hi, at, accent }: { lo: number; hi: number; at: number; accent: string }) {
  const pct = hi > lo ? ((at - lo) / (hi - lo)) * 100 : 50;
  return (
    <div className="mt-1.5" aria-label={`The total can still end anywhere from ${lo} to ${hi}`}>
      <div className="relative h-1.5 rounded-full bg-ink">
        <span
          aria-hidden
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${pct}%`, background: accent, transition: `left .4s ${EASE}` }}
        />
      </div>
      <div className="mt-0.5 flex justify-between font-mono text-[10px] text-muted tabular-nums" aria-hidden>
        <span>{lo} min</span>
        <span>can end anywhere in here</span>
        <span>max {hi}</span>
      </div>
    </div>
  );
}

// ---------- trade now ----------

function TradePanel({
  d,
  size,
  setSize,
  buy,
  sell,
  buyQty,
  sellQty,
  bestAsk,
  bestBid,
}: {
  d: Derived;
  size: number;
  setSize: (n: number) => void;
  buy: () => void;
  sell: () => void;
  buyQty: number;
  sellQty: number;
  bestAsk: BookRow | null;
  bestBid: BookRow | null;
}) {
  return (
    <Panel title="Trade now" label="Trade now" aside={<span>takes the best price</span>}>
      <div className="grid grid-cols-2 gap-2">
        <BigButton
          kind="buy"
          qty={buyQty}
          price={bestAsk?.[1] ?? null}
          blocked={d.roomBuy <= 0 ? `Long limit (${POS_LIMIT})` : !bestAsk ? "No sellers yet" : null}
          onClick={buy}
        />
        <BigButton
          kind="sell"
          qty={sellQty}
          price={bestBid?.[1] ?? null}
          blocked={d.roomSell <= 0 ? `Short limit (${POS_LIMIT})` : !bestBid ? "No buyers yet" : null}
          onClick={sell}
        />
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <span className="shrink-0 text-xs text-muted" id="mk-size">
          Size
        </span>
        <div role="radiogroup" aria-labelledby="mk-size" className="grid flex-1 grid-cols-5 gap-1">
          {Array.from({ length: SIZE_MAX }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={size === n}
              aria-label={`Size ${n}`}
              onClick={() => setSize(n)}
              className="h-10 rounded-lg border font-mono text-sm font-bold transition-colors"
              style={
                size === n
                  ? { borderColor: "var(--mk-accent)", background: "color-mix(in oklab, var(--mk-accent) 22%, transparent)" }
                  : { borderColor: "var(--color-line)", color: "var(--color-muted)" }
              }
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <Hint d={d} />
      <Position d={d} />
    </Panel>
  );
}

function BigButton({
  kind,
  qty,
  price,
  blocked,
  onClick,
}: {
  kind: "buy" | "sell";
  qty: number;
  price: number | null;
  blocked: string | null;
  onClick: () => void;
}) {
  const color = kind === "buy" ? BID : ASK;
  const verb = kind === "buy" ? "BUY" : "SELL";
  const disabled = blocked !== null || price === null || qty <= 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-keyshortcuts={kind === "buy" ? "B" : "S"}
      aria-label={disabled ? `${verb}: ${blocked ?? "unavailable"}` : `${kind === "buy" ? "Buy" : "Sell"} now, ${qty} at ${price}`}
      className="flex min-h-16 flex-col items-center justify-center rounded-xl border-2 px-2 py-1.5 transition-[transform,filter] duration-100 enabled:hover:brightness-110 enabled:active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-50"
      style={{ borderColor: color, background: `${color}22` }}
    >
      <span className="font-display text-lg leading-tight font-extrabold whitespace-nowrap" style={{ color }}>
        {disabled ? verb : `${verb} ${qty} @ ${price}`}
      </span>
      <span className="text-[11px] leading-tight text-muted">
        {disabled ? blocked : kind === "buy" ? `wins if total > ${price}` : `wins if total < ${price}`}
      </span>
    </button>
  );
}

function Hint({ d }: { d: Derived }) {
  const est = d.estimate;
  const ba = d.oAsks[0]?.[1];
  const bb = d.oBids[0]?.[1];
  let text: ReactNode;
  if (d.roomBuy <= 0) text = <>You&apos;re long the maximum ({POS_LIMIT}). Sell to free up room.</>;
  else if (d.roomSell <= 0) text = <>You&apos;re short the maximum ({POS_LIMIT}). Buy to free up room.</>;
  else if (ba !== undefined && ba < est)
    text = (
      <>
        Someone sells at <b style={{ color: ASK }}>{ba}</b>, below your estimate (~{est}). <b>Buying looks cheap.</b>
      </>
    );
  else if (bb !== undefined && bb > est)
    text = (
      <>
        Someone pays <b style={{ color: BID }}>{bb}</b>, above your estimate (~{est}). <b>Selling looks rich.</b>
      </>
    );
  else
    text = (
      <>
        Prices look fair to you. Post a bid below ~{est} and an ask above it, and let others trade with you.
      </>
    );
  return (
    <p className="mt-2.5 rounded-lg bg-panel-2 px-2.5 py-2 text-xs leading-snug text-muted">
      <span aria-hidden>💡 </span>
      {text}
    </p>
  );
}

function Position({ d }: { d: Derived }) {
  const { pos, cash } = d;
  const atEst = cash + pos * d.estimate;
  const breakEven = pos !== 0 ? -cash / pos : null;
  const color = pos > 0 ? GAIN : pos < 0 ? LOSS : "var(--color-muted)";
  return (
    <div className="mt-2.5 border-t border-line pt-2.5" aria-label="Your position">
      <div className="flex items-center gap-2">
        <span className="label shrink-0">Position</span>
        <span key={pos} className="mk-pop font-display text-lg font-extrabold uppercase" style={{ color }}>
          {posWord(pos)}
        </span>
        <PosBar pos={pos} />
      </div>
      <p className="mt-1 text-xs leading-snug text-muted">
        {pos > 0 && breakEven !== null ? (
          <>
            You gain <b className="text-text">{pos}</b> for every point the total ends above <b className="text-text">{fmt1(breakEven)}</b>.
          </>
        ) : pos < 0 && breakEven !== null ? (
          <>
            You gain <b className="text-text">{-pos}</b> for every point the total ends below <b className="text-text">{fmt1(breakEven)}</b>.
          </>
        ) : d.bought + d.sold > 0 ? (
          <>You&apos;re flat: whatever the cards say, this round&apos;s result is fixed.</>
        ) : (
          <>No trades yet this round.</>
        )}
        {d.bought > 0 && (
          <>
            {" "}
            Bought {d.bought} (avg {fmt1(d.boughtValue / d.bought)}).
          </>
        )}
        {d.sold > 0 && (
          <>
            {" "}
            Sold {d.sold} (avg {fmt1(d.soldValue / d.sold)}).
          </>
        )}
      </p>
      {pos === 0 && d.bought + d.sold > 0 && (
        <p className="mt-1 text-sm">
          Locked in this round:{" "}
          <b key={cash} className="mk-pop inline-block font-mono tabular-nums" style={{ color: pnlColor(cash) }}>
            {signed(cash)}
          </b>
        </p>
      )}
      {pos !== 0 && (
        <p className="mt-1 text-sm">
          If it settles at your estimate ({d.estimate}):{" "}
          <b key={atEst} className="mk-pop inline-block font-mono tabular-nums" style={{ color: pnlColor(atEst) }}>
            {signed(atEst)}
          </b>
        </p>
      )}
    </div>
  );
}

function PosBar({ pos }: { pos: number }) {
  const pct = (Math.abs(pos) / POS_LIMIT) * 50;
  return (
    <span className="relative ml-auto h-2 w-24 shrink-0 rounded-full bg-panel-2" aria-hidden title={`Position ${pos} (limit ±${POS_LIMIT})`}>
      <span className="absolute inset-y-[-3px] left-1/2 w-px bg-muted/60" />
      <span
        className="absolute inset-y-0 rounded-full"
        style={{
          left: pos >= 0 ? "50%" : `${50 - pct}%`,
          width: `${pct}%`,
          background: pos >= 0 ? GAIN : LOSS,
          transition: `left .3s ${EASE}, width .3s ${EASE}`,
        }}
      />
    </span>
  );
}

// ---------- your quotes ----------

function QuotePanel({
  d,
  size,
  bidPx,
  askPx,
  maxPrice,
  setPx,
  postSide,
  postBoth,
  cancel,
  err,
}: {
  d: Derived;
  size: number;
  bidPx: number | null;
  askPx: number | null;
  maxPrice: number;
  setPx: (side: "bid" | "ask", v: number | null) => void;
  postSide: (side: "bid" | "ask") => void;
  postBoth: () => void;
  cancel: (side: "bid" | "ask" | "both") => void;
  err: string | null;
}) {
  return (
    <Panel title="Make a market" label="Your quotes" aside={<span>others trade against these</span>}>
      <div className="flex flex-col gap-2">
        <PriceRow side="bid" value={bidPx} maxPrice={maxPrice} setPx={setPx} post={() => postSide("bid")} />
        <PriceRow side="ask" value={askPx} maxPrice={maxPrice} setPx={setPx} post={() => postSide("ask")} />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <button type="button" className="btn h-10 px-2 text-sm" onClick={() => postSide("bid")} style={{ borderColor: `${BID}88` }}>
          Post bid
        </button>
        <button type="button" className="btn h-10 px-2 text-sm" onClick={() => postSide("ask")} style={{ borderColor: `${ASK}88` }}>
          Post ask
        </button>
        <button
          type="button"
          className="btn h-10 px-2 text-sm font-bold"
          aria-keyshortcuts="Q"
          onClick={postBoth}
          style={{ borderColor: "var(--mk-accent)", background: "color-mix(in oklab, var(--mk-accent) 18%, transparent)" }}
        >
          Post both
        </button>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-muted">
        Size {size} each. A bid at or above someone&apos;s ask trades right away at their price.
      </p>
      {err && (
        <p role="alert" className="mt-1.5 text-xs font-semibold text-amber-300">
          ⚠️ {err}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2 text-xs">
        <span className="text-muted">Live:</span>
        <LiveQuote side="bid" row={d.myBid} cancel={() => cancel("bid")} />
        <LiveQuote side="ask" row={d.myAsk} cancel={() => cancel("ask")} />
        {(d.myBid || d.myAsk) && (
          <button type="button" className="ml-auto h-10 rounded-lg px-2 text-xs text-muted underline-offset-2 hover:text-text hover:underline" onClick={() => cancel("both")} aria-keyshortcuts="X">
            Pull all
          </button>
        )}
      </div>
    </Panel>
  );
}

function PriceRow({
  side,
  value,
  maxPrice,
  setPx,
  post,
}: {
  side: "bid" | "ask";
  value: number | null;
  maxPrice: number;
  setPx: (side: "bid" | "ask", v: number | null) => void;
  post: () => void;
}) {
  const color = side === "bid" ? BID : ASK;
  const label = side === "bid" ? "Bid price" : "Ask price";
  const bump = (delta: number) => setPx(side, clamp((value ?? 1) + delta, 1, maxPrice));
  const step = (delta: number) => (
    <button
      type="button"
      aria-label={`${delta > 0 ? "Raise" : "Lower"} ${side} by ${Math.abs(delta)}`}
      onClick={() => bump(delta)}
      className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-panel-2 font-mono text-xs font-bold text-muted transition-colors hover:text-text active:scale-95"
    >
      {delta > 0 ? `+${delta}` : `−${-delta}`}
    </button>
  );
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={`mk-${side}`} className="w-9 shrink-0 text-[11px] leading-tight font-bold uppercase" style={{ color }}>
        {side}
        <span className="sr-only"> price</span>
        <span aria-hidden className="block text-[9px] font-medium text-muted normal-case">
          {side === "bid" ? "I buy at" : "I sell at"}
        </span>
      </label>
      {step(-5)}
      {step(-1)}
      <input
        id={`mk-${side}`}
        aria-label={label}
        type="number"
        inputMode="numeric"
        min={1}
        max={maxPrice}
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value === "" ? null : Math.round(Number(e.target.value));
          setPx(side, v === null || Number.isNaN(v) ? null : clamp(v, 1, maxPrice));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            post();
          }
        }}
        className="mk-num h-10 w-14 shrink-0 rounded-lg border bg-ink text-center font-mono text-base font-extrabold tabular-nums outline-none focus:border-[var(--mk-accent)]"
        style={{ borderColor: `${color}88`, color }}
      />
      {step(1)}
      {step(5)}
    </div>
  );
}

function LiveQuote({ side, row, cancel }: { side: "bid" | "ask"; row: BookRow | null; cancel: () => void }) {
  const color = side === "bid" ? BID : ASK;
  if (!row) {
    return (
      <span className="inline-flex min-h-10 items-center rounded-full border border-dashed border-line px-2.5 text-muted">
        no {side}
      </span>
    );
  }
  return (
    <span key={`${row[1]}:${row[2]}`} className="mk-pop inline-flex min-h-10 items-center gap-1 rounded-full border pr-0.5 pl-2.5" style={{ borderColor: `${color}88`, background: `${color}14` }}>
      <span style={{ color }} className="font-bold uppercase">
        {side}
      </span>
      <span className="font-mono font-bold tabular-nums">
        {row[2]} @ {row[1]}
      </span>
      <button type="button" onClick={cancel} aria-label={`Cancel your ${side}`} className="grid size-9 place-items-center rounded-full text-muted hover:bg-white/10 hover:text-text">
        ✕
      </button>
    </span>
  );
}

// ---------- traders ----------

function Traders({ view, who }: { view: MkView; who: WhoFn }) {
  const started = view.history.length > 0;
  return (
    <Panel title="Traders" label="Traders" aside={started ? "total so far" : "positions stay secret until the bell"}>
      <ul className="grid gap-1.5 @lg:grid-cols-2">
        {view.ids.map((id, slot) => {
          const p = who(slot);
          const bid = view.bids.find((r) => r[0] === slot);
          const ask = view.asks.find((r) => r[0] === slot);
          return (
            <li
              key={id}
              className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 ${slot === view.me ? "bg-panel-2" : ""} ${p.connected ? "" : "opacity-50"}`}
            >
              <span className="min-w-0 flex-1 truncate text-sm">
                <Name p={p} />
                {slot === view.me && <span className="ml-1 text-[11px] text-muted">(you)</span>}
                {!p.connected && <span className="ml-1 text-[11px] text-muted">offline</span>}
              </span>
              <span className="flex shrink-0 gap-1 text-[10px] font-bold">
                {bid && (
                  <span className="rounded px-1" style={{ color: BID, background: `${BID}1a` }} title="has a bid">
                    B {bid[1]}
                  </span>
                )}
                {ask && (
                  <span className="rounded px-1" style={{ color: ASK, background: `${ASK}1a` }} title="has an ask">
                    A {ask[1]}
                  </span>
                )}
              </span>
              <span className="w-14 shrink-0 text-right text-[11px] text-muted tabular-nums">
                {view.counts[slot] ?? 0} fill{view.counts[slot] === 1 ? "" : "s"}
              </span>
              {started && (
                <span className="w-12 shrink-0 text-right font-mono text-sm font-bold tabular-nums" style={{ color: pnlColor(view.totals[slot] ?? 0) }}>
                  {signed(view.totals[slot] ?? 0)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

// ---------- the bell ----------

function Settlement({ view, who, accent }: { view: MkView; who: WhoFn; accent: string; serverNow: () => number }) {
  const r = view.history[view.history.length - 1];
  if (!r) return null;
  const terms = [...r.cards, ...r.street].map(cardValue);
  const order = view.ids.map((_, i) => i).sort((a, b) => r.pnl[b] - r.pnl[a] || a - b);
  const mine = view.me >= 0 ? r.pnl[view.me] : null;
  const cardsDone = 120 * (r.cards.length + r.street.length) + 400;
  // Big tables get smaller cards so the reveal stays on one screen.
  const cs = r.cards.length >= 5 ? "sm" : "md";
  const cw = r.cards.length >= 5 ? 48 : 58;
  return (
    <section className="card flex flex-col gap-3 p-3 @md:p-4" aria-label={`Round ${view.round} settlement`} style={{ borderColor: `${accent}66` }}>
      <div className="flex flex-wrap items-end justify-center gap-x-2 gap-y-3">
        <div className="flex flex-wrap items-end justify-center gap-x-2 gap-y-2">
          {r.cards.map((c, i) => {
            const p = who(i);
            return (
              <div key={i} className="flex flex-col items-center gap-1" style={{ width: cw }}>
                <PlayingCard code={c} size={cs} accent={accent} className="mk-reveal" style={{ animationDelay: `${i * 120}ms` }} label={`${p.name}'s card`} />
                <span className="flex max-w-full items-center gap-0.5 text-[11px]">
                  <span aria-hidden><Avatar id={p.avatar} /></span>
                  <span className="truncate font-semibold" style={{ color: p.color }}>
                    {i === view.me ? "You" : p.name}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
        <div className="flex items-end gap-2">
          <span aria-hidden className="self-center pb-4 text-2xl text-muted">
            +
          </span>
          {r.street.map((c, i) => (
            <div key={`s${i}`} className="flex flex-col items-center gap-1" style={{ width: cw }}>
              <PlayingCard code={c} size={cs} accent={accent} className="mk-reveal" style={{ animationDelay: `${(r.cards.length + i) * 120}ms` }} />
              <span className="text-[11px] text-muted">street</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mk-in text-center" style={{ animationDelay: `${cardsDone - 300}ms` }}>
        <p className="font-mono text-sm break-words text-muted tabular-nums">
          {terms.join(" + ")} =
        </p>
        <p className="font-display text-5xl leading-none font-black tabular-nums" style={{ color: accent }}>
          <CountUp value={r.settle} from={0} delay={cardsDone - 300} duration={700} sign={false} />
        </p>
        <p className="mt-1 text-xs text-muted">the contract settles at the sum of every card</p>
      </div>

      {mine !== null && (
        <p className="mk-pop text-center font-display text-xl font-extrabold" style={{ animationDelay: `${cardsDone + 300}ms` }}>
          {mine > 0 ? "🎉 You made " : mine < 0 ? "😬 You lost " : "You broke even "}
          {mine !== 0 && (
            <CountUp value={mine} delay={cardsDone + 300} className="tabular-nums" style={{ color: pnlColor(mine) }} sign />
          )}
          {mine !== 0 && " this round"}
        </p>
      )}

      <ol className="grid gap-1 @lg:grid-cols-2">
        {order.map((slot, rank) => {
          const p = who(slot);
          return (
            <li
              key={slot}
              className={`mk-in flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 ${slot === view.me ? "bg-panel-2" : ""}`}
              style={{ animationDelay: `${cardsDone + 150 + rank * 80}ms` }}
            >
              <span className="min-w-0 flex-1 truncate text-sm">
                <Name p={p} you={slot === view.me} />
              </span>
              <span className="shrink-0 text-[11px] text-muted">{pnlLine(r.pos[slot], r.settle, r.pnl[slot])}</span>
              <CountUp
                value={r.pnl[slot]}
                delay={cardsDone + 300}
                className="w-14 shrink-0 text-right font-mono text-base font-extrabold tabular-nums"
                style={{ color: pnlColor(r.pnl[slot]) }}
              />
            </li>
          );
        })}
      </ol>
      <p className="text-center text-xs text-muted">
        <span aria-hidden>🏦 </span>The House {r.house >= 0 ? "made" : "lost"} <b className="font-mono">{signed(r.house)}</b> on {r.trades} trade
        {r.trades === 1 ? "" : "s"} this round (it isn&apos;t scored).
      </p>
    </section>
  );
}

// ---------- the end ----------

function bestRoundOf(rounds: RoundRecord[]): { slot: number; pnl: number; round: number } | null {
  let best: { slot: number; pnl: number; round: number } | null = null;
  for (let ri = 0; ri < rounds.length; ri++) {
    const pnl = rounds[ri].pnl;
    for (let slot = 0; slot < pnl.length; slot++) {
      if (!best || pnl[slot] > best.pnl) best = { slot, pnl: pnl[slot], round: ri + 1 };
    }
  }
  return best;
}

function Final({ view, who, accent }: { view: MkView; who: WhoFn; accent: string }) {
  const slots = view.ids.map((_, i) => i);
  const order = slots.slice().sort((a, b) => view.totals[b] - view.totals[a] || a - b);
  const best = Math.max(...view.totals);
  const rounds = view.history;
  // Fun facts.
  const br = bestRoundOf(rounds);
  const fills = slots.map((s) => rounds.reduce((a, r) => a + (r.fills[s] ?? 0), 0));
  const busiest = slots.reduce((a, s) => (fills[s] > fills[a] ? s : a), 0);
  const house = rounds.reduce((a, r) => a + r.house, 0);

  return (
    <section className="card flex flex-col gap-3 p-3 @md:p-4" aria-label="Final standings" style={{ borderColor: `${accent}66` }}>
      <ol className="flex flex-col gap-1.5">
        {order.map((slot, rank) => {
          const p = who(slot);
          const top = view.totals[slot] === best;
          return (
            <li
              key={slot}
              className="mk-in flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2"
              style={{
                animationDelay: `${rank * 90}ms`,
                borderColor: top ? p.color : "var(--color-line)",
                background: top ? `${p.color}14` : slot === view.me ? "var(--color-panel-2)" : "transparent",
              }}
            >
              <span className="w-5 shrink-0 text-center text-sm font-bold text-muted tabular-nums">{top ? <span className="mk-crown">👑</span> : rank + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  <Name p={p} />
                  {slot === view.me && <span className="ml-1 text-[11px] text-muted">(you)</span>}
                </span>
                <span className="flex flex-wrap gap-1 pt-0.5">
                  {rounds.map((r, i) => (
                    <span key={i} className="rounded bg-panel-2 px-1 font-mono text-[10px] tabular-nums" style={{ color: pnlColor(r.pnl[slot]) }}>
                      R{i + 1} {signed(r.pnl[slot])}
                    </span>
                  ))}
                </span>
              </span>
              <CountUp
                value={view.totals[slot]}
                delay={300 + rank * 90}
                className="shrink-0 font-display text-2xl font-extrabold tabular-nums"
                style={{ color: pnlColor(view.totals[slot]) }}
              />
            </li>
          );
        })}
      </ol>
      <ul className="grid gap-1.5 text-xs text-muted @md:grid-cols-3">
        {br && br.pnl > 0 && (
          <li className="rounded-lg bg-panel-2 px-2.5 py-2">
            🎯 Best round: <Name p={who(br.slot)} /> <b style={{ color: GAIN }}>{signed(br.pnl)}</b> in round {br.round}
          </li>
        )}
        {fills[busiest] > 0 && (
          <li className="rounded-lg bg-panel-2 px-2.5 py-2">
            🔁 Busiest trader: <Name p={who(busiest)} /> with {fills[busiest]} fills
          </li>
        )}
        <li className="rounded-lg bg-panel-2 px-2.5 py-2">
          📊 Settled at {rounds.map((r) => r.settle).join(" · ") || "—"} · 🏦 House {signed(house)}
        </li>
      </ul>
      {house > 0 && (
        <p className="text-center text-xs text-muted">
          💡 The House quotes {HOUSE_SPREAD} away from fair value, so trading with it costs you that edge. Trade with each other to keep it.
        </p>
      )}
      {view.abandoned && <Note>The market closed early: too few traders stayed connected.</Note>}
    </section>
  );
}

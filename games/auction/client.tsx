"use client";

import { useEffect, useReducer, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { Note, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import type { AuAction, AuView } from "./server";
import { HIST, INTRO_MS, NO_BID_MS, STAGE_MS, STAMPS, STEPS, contents, isAuEvent, kindOf, signed, type Bid } from "./shared";
import { AuStyles, GAIN, GOLD, LOSS, Name, kindColor, makeWho, pnlColor, useLatest, usePassed, type Who } from "./ui";
import { CrateArt, Burst, Contents, Rays, RevealBack, RevealFront, Smoke, Stamp } from "./crate";
import { FinalStandings, Leaderboard, LotsStrip, PeekGrid, Recap, giftOf, standings } from "./panels";
import { Avatar } from "@/components/Avatar";
import { feedback, sfx } from "@/lib/feedback";

type Props = GameClientProps<AuView, AuAction>;

export default function Auction(props: Props) {
  if (!props.view) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Note>Stacking the crates…</Note>
      </div>
    );
  }
  return <Game {...props} view={props.view} />;
}

// ---------- live bidding: events merged onto the view, plus my pending bid ----------

const PENDING_MS = 3_000;
const NOTICE_MS = 2_800;

interface Pending {
  lot: number;
  a: number;
}
interface Notice {
  id: number;
  text: string;
}

/**
 * Bids arrive as tiny events between full views. The freshest of (view, events)
 * wins, keyed by the per-lot bid number, so nothing ever goes backwards.
 */
function useBidding(view: AuView, onEvent: Props["onEvent"], act: Props["act"]) {
  const me = view.me;
  const [feed, setFeed] = useState<{ lot: number; bids: Bid[] }>({ lot: -1, bids: [] });
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** Bumps on every bid that should shake the crate (others' bids and my own taps). */
  const [bumps, setBumps] = useState(0);

  useEffect(
    () =>
      onEvent((e) => {
        if (!isAuEvent(e)) return;
        if (e.k === "bid") {
          const b: Bid = { n: e.n, p: e.p, a: e.a, at: e.at };
          setFeed((f) => (f.lot === e.lot ? { lot: e.lot, bids: [...f.bids, b].slice(-HIST - 2) } : { lot: e.lot, bids: [b] }));
          if (e.p !== me) {
            setBumps((x) => x + 1);
            sfx("bump");
          }
        } else {
          feedback("error"); // the server turned our bid down
          setPending((p) => (p && p.lot === e.lot && p.a === e.a ? null : p));
          setNotice((n) => ({ id: (n?.id ?? 0) + 1, text: e.m }));
        }
      }),
    [onEvent, me],
  );

  useEffect(() => {
    if (!pending) return;
    const id = setTimeout(() => setPending((p) => (p === pending ? null : p)), PENDING_MS);
    return () => clearTimeout(id);
  }, [pending]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice((n) => (n === notice ? null : n)), NOTICE_MS);
    return () => clearTimeout(id);
  }, [notice]);

  const extra = feed.lot === view.lot ? feed.bids.filter((b) => b.n > view.n) : [];
  const lead: Bid | null = extra.length ? extra[extra.length - 1] : view.lead;
  const base = view.n - view.hist.length + 1;
  const hist: Bid[] = [
    ...view.hist.map(([p, a], i) => ({ n: base + i, p, a, at: 0 })),
    ...extra,
  ].slice(-HIST);
  // A pending bid resolves the moment any bid at or above it shows up (mine = confirmed, theirs = beaten).
  const pend = pending && pending.lot === view.lot && view.phase === "lot" && !(lead && lead.a >= pending.a) ? pending : null;

  const say = (text: string) => setNotice((n) => ({ id: (n?.id ?? 0) + 1, text }));
  const place = (amount: number) => {
    if (pend) return;
    setPending({ lot: view.lot, a: amount });
    setBumps((x) => x + 1);
    act({ type: "bid", lot: view.lot, amount });
  };
  return { lead, hist, pend, notice, bumps, place, say };
}

// ---------- the game ----------

function Game({ view, byId, isPlayer, act, serverNow, onEvent, accent }: Props & { view: AuView }) {
  const who = makeWho(view.ids, byId);
  const me = view.me;
  const playing = isPlayer && me >= 0;
  const bidding = useBidding(view, onEvent, act);
  const open = usePassed(view.openAt, serverNow);
  const { lead } = bidding;

  // Cues: bidding opens, someone outbids us, a crate is sold to us.
  const lot = view.lot;
  const bidOpen = view.phase === "lot" && open;
  const iLead = view.phase === "lot" && !!lead && lead.p === me && me >= 0;
  const wonLot = view.phase === "sold" && view.crates[lot]?.status === "sold" && view.crates[lot].buyer === me && me >= 0 ? lot : -1;
  const ledRef = useRef({ lot: -1, lead: false });
  useEffect(() => {
    if (bidOpen) sfx("go");
  }, [bidOpen, lot]);
  useEffect(() => {
    const was = ledRef.current;
    if (was.lot === lot && was.lead && !iLead && view.phase === "lot") feedback("bump"); // outbid
    ledRef.current = { lot, lead: iLead };
  }, [iLead, lot, view.phase]);
  useEffect(() => {
    if (wonLot >= 0) feedback("score");
  }, [wonLot]);

  if (view.phase === "peek") {
    return (
      <Shell>
        <PeekPhase view={view} who={who} act={act} serverNow={serverNow} playing={playing} accent={accent} />
        {!isPlayer && <SpectatorNote />}
      </Shell>
    );
  }

  if (view.phase === "final") {
    return (
      <Shell>
        <p className="label text-center">🏁 Going, going… all gone!</p>
        <FinalStandings view={view} who={who} />
        <Recap view={view} who={who} />
        {!isPlayer && <SpectatorNote />}
      </Shell>
    );
  }

  const crate = view.crates[view.lot];
  const st = status(view, who, lead, open);
  const leader = view.phase === "lot" && lead ? lead.p : -1;
  const flash =
    view.phase === "sold" && crate.status === "sold"
      ? { slot: crate.buyer, key: `lot${view.lot}`, color: crate.gift ? GOLD : crate.value !== null ? kindColor(crate.value) : GOLD }
      : null;

  return (
    <Shell>
      <div aria-live="polite" aria-atomic="true">
        <StatusBanner key={st.key} accent={st.color ?? accent}>
          <span className="block truncate">{st.node}</span>
        </StatusBanner>
      </div>
      {view.closeAt !== null && <CloseNote closeAt={view.closeAt} serverNow={serverNow} />}

      <div className="grid gap-3 @2xl:grid-cols-[minmax(0,1fr)_18rem] @2xl:items-start">
        <div className="flex min-w-0 flex-col gap-3">
          {view.phase === "gift" ? (
            <GiftStage view={view} who={who} serverNow={serverNow} accent={accent} />
          ) : (
            <LotStage view={view} who={who} bidding={bidding} open={open} serverNow={serverNow} playing={playing} />
          )}
          {playing && view.phase !== "gift" && <BidPad view={view} who={who} bidding={bidding} open={open} accent={accent} />}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <LotsStrip view={view} who={who} live />
          <Leaderboard view={view} who={who} leader={leader} flash={flash} />
        </div>
      </div>
      {!isPlayer && <SpectatorNote />}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="@container mx-auto flex w-full max-w-4xl flex-col gap-3 pb-20 @2xl:pb-2">
      <AuStyles />
      {children}
    </div>
  );
}

function SpectatorNote() {
  return <Note>👀 You&apos;re watching. Everyone peeked inside a few crates; watch who bids on what.</Note>;
}

function Who_({ p, you }: { p: Player; you?: boolean }) {
  return (
    <>
      <span aria-hidden><Avatar id={p.avatar} /> </span>
      <span style={{ color: p.color }}>{you ? "you" : p.name}</span>
    </>
  );
}

function status(view: AuView, who: Who, lead: Bid | null, open: boolean): { key: string; node: ReactNode; color?: string } {
  const lot = view.lot;
  const crate = view.crates[lot];
  const tag = `Lot ${lot + 1}/${view.crates.length}`;
  if (view.phase === "lot") {
    if (!open) return { key: `intro${lot}`, node: <>{crate.gift ? "🎁 " : "📦 "}{tag} is up!</> };
    if (!lead) return { key: `open${lot}`, node: <>{tag}: bidding is open!</> };
    const p = who(lead.p);
    if (lead.p === view.me) return { key: `lead${lot}-${lead.n}`, node: <>You lead at ${lead.a}! Hold tight…</>, color: p.color };
    return {
      key: `lead${lot}-${lead.n}`,
      node: (
        <>
          <Who_ p={p} /> leads at ${lead.a}
        </>
      ),
      color: p.color,
    };
  }
  if (view.phase === "sold") {
    if (crate.status !== "sold") return { key: `nosale${lot}`, node: <>No sale! Nobody bid on lot {lot + 1}</>, color: "#94a3b8" };
    const p = who(crate.buyer);
    return {
      key: `sold${lot}`,
      node: (
        <>
          <span className="au-gavel">🔨</span> SOLD to <Who_ p={p} you={crate.buyer === view.me} /> for ${crate.price}!
        </>
      ),
      color: p.color,
    };
  }
  // gift
  const gift = giftOf(view);
  const owner = gift && gift.buyer >= 0 ? who(gift.buyer) : null;
  const you = gift?.buyer === view.me;
  if (!view.giftShown || !gift || gift.x2 === null)
    return {
      key: "gift-drum",
      node: <>🎁 Double or nothing for {owner ? <Who_ p={owner} you={you} /> : "…"}</>,
      color: GOLD,
    };
  return {
    key: "gift-shown",
    node: gift.x2 ? (
      <>×2! {you ? "Your" : `${owner?.name}'s`} vault doubles! 🎉</>
    ) : (
      <>×0! {you ? "Your" : `${owner?.name}'s`} vault is wiped! 💨</>
    ),
    color: gift.x2 ? GAIN : LOSS,
  };
}

// ---------- peek phase ----------

function PeekPhase({
  view,
  who,
  act,
  serverNow,
  playing,
  accent,
}: {
  view: AuView;
  who: Who;
  act: Props["act"];
  serverNow: () => number;
  playing: boolean;
  accent: string;
}) {
  const [pressed, setPressed] = useState(false);
  const ready = playing && (view.ready[view.me] || pressed);
  const waiting = view.ids.filter((_, i) => !view.ready[i] && who(i).connected).length;
  const peeks = view.crates.filter((c) => c.peeked).length;
  const secs = useSecondsLeft(view.endsAt, serverNow);
  return (
    <>
      <div aria-live="polite">
        <StatusBanner key="peek" accent={accent}>
          <span className="block truncate">👁 {playing ? `Peek time! ${peeks} secret peeks` : "Bidders are peeking…"}</span>
        </StatusBanner>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="shrink-0">Auction starts in {secs}s</span>
        <div className="flex-1">
          <TimerBar endsAt={view.endsAt} total={view.phaseMs} serverNow={serverNow} color={accent} />
        </div>
      </div>
      <PeekGrid view={view} />
      {playing && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            className={`btn min-h-12 min-w-40 ${ready ? "" : "btn-primary"}`}
            disabled={ready}
            onClick={() => {
              setPressed(true);
              act({ type: "ready" });
            }}
          >
            {ready ? "✓ Ready" : "I've seen enough"}
          </button>
          <span className="text-sm text-muted" role="status">
            {ready ? (waiting > 0 ? `Waiting for ${waiting} more…` : "Starting…") : `${view.ready.filter(Boolean).length}/${view.ids.length} ready`}
          </span>
        </div>
      )}
      <ul className="card grid gap-1.5 p-3 text-sm @xl:grid-cols-2" aria-label="How it works">
        <Rule icon="💵">Everyone has $100. Score = cash left + what&apos;s in your crates.</Rule>
        <Rule icon="👁">Each crate was peeked by 2 players. Nobody knows who.</Rule>
        <Rule icon="🔨">Every bid restarts &ldquo;going once… twice… GONE!&rdquo;</Rule>
        <Rule icon="🎁">The gift doubles (or wipes) its winner&apos;s whole vault at the end.</Rule>
        <Rule icon="🎭">Bluff! Bid junk up to bait the others, then let go.</Rule>
      </ul>
    </>
  );
}

function Rule({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <li className="flex gap-2">
      <span aria-hidden className="shrink-0">
        {icon}
      </span>
      <span className="text-muted">{children}</span>
    </li>
  );
}

// ---------- the auction stage ----------

type Bidding = ReturnType<typeof useBidding>;

function LotStage({
  view,
  who,
  bidding,
  open,
  serverNow,
  playing,
}: {
  view: AuView;
  who: Who;
  bidding: Bidding;
  open: boolean;
  serverNow: () => number;
  playing: boolean;
}) {
  const { lead, hist, pend, bumps } = bidding;
  const crate = view.crates[view.lot];
  const sold = view.phase === "sold";
  const opened = sold && !crate.gift && crate.value !== null;
  const meP = view.me >= 0 ? who(view.me) : null;

  return (
    <section className="card relative overflow-hidden p-3" aria-label={`Lot ${view.lot + 1}`}>
      {playing && !sold && <PeekLine view={view} />}
      <div key={view.lot} className="au-slide flex items-center gap-3">
        <div className="relative w-[42%] max-w-[13.5rem] shrink-0">
          <div className="relative aspect-[200/170]">
            {opened && <RevealBack value={crate.value!} />}
            <div key={bumps} className={`size-full ${bumps ? "au-shake" : ""}`}>
              {lead && !sold ? (
                <Tremble key={lead.n} at={lead.at} serverNow={serverNow}>
                  <CrateArt wood={crate.wood} stamp={crate.stamp} gift={crate.gift} open={false} />
                </Tremble>
              ) : (
                <CrateArt wood={crate.wood} stamp={crate.stamp} gift={crate.gift} open={opened} />
              )}
            </div>
            {opened && <RevealFront value={crate.value!} />}
            {opened && <Contents value={crate.value!} />}
            {sold && <Stamp text={crate.status === "sold" ? "Sold!" : "No sale"} color={crate.status === "sold" ? "#f43f5e" : "#94a3b8"} />}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="label">
            Lot {view.lot + 1} of {view.crates.length}
          </div>
          <div className="truncate text-sm font-semibold">{crate.gift ? "🎁 Double or nothing" : `“${STAMPS[crate.stamp] ?? "Crate"}” crate`}</div>
          <div className="mt-2 min-h-[5.5rem]">
            {sold ? (
              <SoldInfo view={view} who={who} />
            ) : lead ? (
              <>
                <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">Top bid</div>
                <div key={lead.n} className="au-pop font-display text-4xl leading-none font-black tabular-nums" style={{ color: who(lead.p).color }}>
                  ${lead.a}
                </div>
                <div className="mt-1 truncate text-sm">
                  <Name p={who(lead.p)} you={lead.p === view.me} />
                </div>
              </>
            ) : (
              <div className="text-sm text-muted">
                {open ? "No bids yet." : "Get ready…"}
                <div className="font-display text-2xl font-extrabold text-text">Opening bid $1</div>
              </div>
            )}
            {pend && meP && (
              <div className="au-pulse mt-1 truncate text-xs font-semibold" style={{ color: meP.color }} role="status">
                ⏳ Your ${pend.a} bid…
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3">
        {sold ? (
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="shrink-0">{view.lot + 1 < view.crates.length ? "Next lot" : "Final reveal"}</span>
            <div className="flex-1">
              <TimerBar endsAt={view.endsAt} total={view.phaseMs} serverNow={serverNow} color="var(--color-muted)" />
            </div>
          </div>
        ) : (
          <Gavel view={view} lead={lead} open={open} serverNow={serverNow} />
        )}
      </div>
      {hist.length > 0 && <Ticker hist={hist} who={who} />}
    </section>
  );
}

/** The crate trembles through "last call" (CSS delay from the bid's server time; no re-renders). */
function Tremble({ at, serverNow, children }: { at: number; serverNow: () => number; children: ReactNode }) {
  const [delay] = useState(() => 2 * STAGE_MS - (serverNow() - at));
  return (
    <div className="au-tremble size-full" style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

function PeekLine({ view }: { view: AuView }) {
  const c = view.crates[view.lot];
  let body: ReactNode;
  let color = "var(--color-muted)";
  if (c.gift && c.x2 !== null) {
    color = c.x2 ? GAIN : LOSS;
    body = <>👁 You peeked: {c.x2 ? "×2, it doubles the vault!" : "×0, it wipes the vault!"}</>;
  } else if (!c.gift && c.value !== null) {
    const it = contents(c.value);
    color = kindColor(c.value);
    body = (
      <>
        👁 You peeked: {it.emoji} {it.name} <b className="tabular-nums">{signed(c.value)}</b>
      </>
    );
  } else body = <>🔒 You didn&apos;t peek this one. Two others did…</>;
  return (
    <div
      className="-mx-3 -mt-3 mb-3 truncate border-b px-3 py-1.5 text-xs font-semibold"
      style={{ color, borderColor: "var(--color-line)", background: `color-mix(in oklab, ${color} 10%, transparent)` }}
    >
      {body}
    </div>
  );
}

function SoldInfo({ view, who }: { view: AuView; who: Who }) {
  const c = view.crates[view.lot];
  if (c.status !== "sold") {
    if (c.gift) return <p className="text-sm text-muted">Nobody took the gamble. It stays sealed until the end.</p>;
    const it = c.value !== null ? contents(c.value) : null;
    const k = c.value !== null ? kindOf(c.value) : "junk";
    return (
      <div className="au-in text-sm" style={{ animationDelay: ".5s" }}>
        <div className="text-muted">It held:</div>
        <div className="truncate font-semibold">
          {it?.emoji} {it?.name}{" "}
          <b className="tabular-nums" style={{ color: c.value !== null ? kindColor(c.value) : undefined }}>
            {c.value !== null ? signed(c.value) : "?"}
          </b>
        </div>
        <div className="text-xs text-muted">{k === "treasure" ? "Nobody dared! 😱" : k === "cursed" ? "Phew, it was cursed." : "Just junk anyway."}</div>
      </div>
    );
  }
  const buyer = who(c.buyer);
  const you = c.buyer === view.me;
  if (c.gift) {
    return (
      <div className="text-sm">
        <div className="truncate">
          <Name p={buyer} you={you} /> <span className="text-muted">paid</span> <b>${c.price}</b>
        </div>
        <div className="mt-1 text-xs text-muted">Sealed until the end: ×2 or ×0 on {you ? "your" : "their"} whole vault!</div>
      </div>
    );
  }
  const value = c.value ?? 0;
  const pnl = value - c.price;
  const it = contents(value);
  const k = kindOf(value);
  const quip =
    k === "cursed" ? "CURSED! 💀" : k === "junk" ? (pnl < 0 ? "Junk! Hope it was a bluff." : "Junk, but cheap.") : pnl > 0 ? "What a steal! 🤑" : "Treasure… at a price.";
  return (
    <div className="text-sm">
      <div className="truncate">
        <Name p={buyer} you={you} /> <span className="text-muted">paid</span> <b>${c.price}</b>
      </div>
      <div className="au-in mt-1" style={{ animationDelay: ".6s" }}>
        <div className="truncate text-xs text-muted">
          {it.emoji} {it.name}
        </div>
        <div className="font-display text-xl leading-tight font-extrabold tabular-nums" style={{ color: pnlColor(pnl) }}>
          {pnl >= 0 ? "Profit" : "Loss"} {signed(pnl)}
        </div>
        <div className="text-xs text-muted">{quip}</div>
      </div>
    </div>
  );
}

// ---------- the gavel: synced from the last bid's server time ----------

const STAGE_TEXT = ["Going once…", "Going twice…", "Last call!", "🔨 Gavel's coming down…"];
const STAGE_COLORS = ["#fbbf24", "#fb923c", "#f43f5e"];
const SEGMENTS = ["ONCE", "TWICE", "GONE"];

/** Current countdown stage (0-2, 3 = time's up), re-rendering only at stage boundaries. */
function useStage(at: number, serverNow: () => number) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const stage = Math.max(0, Math.min(3, Math.floor((serverNow() - at) / STAGE_MS)));
  useEffect(() => {
    if (stage >= 3) return;
    const id = setTimeout(force, (stage + 1) * STAGE_MS - (serverNow() - at) + 10);
    return () => clearTimeout(id);
  }, [at, stage, serverNow]);
  return stage;
}

function Gavel({ view, lead, open, serverNow }: { view: AuView; lead: Bid | null; open: boolean; serverNow: () => number }) {
  if (!open) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="shrink-0">Bidding opens…</span>
        <div className="flex-1">
          <TimerBar endsAt={view.openAt} total={INTRO_MS} serverNow={serverNow} color={GOLD} />
        </div>
      </div>
    );
  }
  if (!lead) return <NoBidBar view={view} serverNow={serverNow} />;
  return <Meter key={lead.n} at={lead.at} serverNow={serverNow} />;
}

function NoBidBar({ view, serverNow }: { view: AuView; serverNow: () => number }) {
  const ends = view.openAt + NO_BID_MS;
  const secs = useSecondsLeft(ends, serverNow);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs text-muted">
        <span>Any takers?</span>
        <span className="tabular-nums">No sale in {secs}s</span>
      </div>
      <TimerBar endsAt={ends} total={NO_BID_MS} serverNow={serverNow} color="var(--color-muted)" />
    </div>
  );
}

function Meter({ at, serverNow }: { at: number; serverNow: () => number }) {
  // Elapsed time when this bid's meter mounted: each segment fills with a CSS animation from there.
  const [t0] = useState(() => serverNow() - at);
  const stage = useStage(at, serverNow);
  return (
    <div role="timer" aria-label={STAGE_TEXT[stage]}>
      <div key={stage} className="au-pop font-display text-lg leading-tight font-extrabold" style={{ color: STAGE_COLORS[Math.min(2, stage)] }}>
        {STAGE_TEXT[stage]}
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-1">
        {SEGMENTS.map((s, i) => (
          <div key={s}>
            <div className="h-2.5 overflow-hidden rounded-full bg-panel-2">
              <div
                className="au-seg h-full w-full rounded-full"
                style={{ background: STAGE_COLORS[i], animationDuration: `${STAGE_MS}ms`, animationDelay: `${i * STAGE_MS - t0}ms` }}
              />
            </div>
            <div
              className="mt-0.5 text-center text-[10px] font-bold tracking-widest"
              style={{ color: stage >= i ? STAGE_COLORS[i] : "var(--color-muted)" }}
            >
              {s}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Ticker({ hist, who }: { hist: Bid[]; who: Who }) {
  return (
    <ol className="mt-2.5 flex items-center justify-end gap-1 overflow-hidden" aria-label="Recent bids">
      {hist.map((b, i) => {
        const p = who(b.p);
        const last = i === hist.length - 1;
        return (
          <li
            key={b.n}
            className={`flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs tabular-nums ${last ? "au-pop font-bold" : "opacity-60"}`}
            style={{ borderColor: `${p.color}${last ? "aa" : "44"}`, background: `${p.color}${last ? "22" : "0d"}` }}
          >
            <span aria-hidden><Avatar id={p.avatar} /></span>
            <span style={{ color: p.color }}>${b.a}</span>
            <span className="sr-only">{p.name}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------- bid controls ----------

function BidPad({ view, who, bidding, open, accent }: { view: AuView; who: Who; bidding: Bidding; open: boolean; accent: string }) {
  const { lead, pend, notice, place, say } = bidding;
  const meP = who(view.me);
  const cash = view.cash[view.me] ?? 0;
  const live = view.phase === "lot" && open;
  const leading = !!lead && lead.p === view.me;
  const min = lead ? lead.a + 1 : 1;
  const base = lead ? lead.a : 0;
  const canBid = live && !leading && !pend && cash >= min;
  const [custom, setCustom] = useState({ lot: -1, text: "" });
  const text = custom.lot === view.lot ? custom.text : "";
  const [tap, setTap] = useState<{ id: number; i: number; label: string } | null>(null);

  const quick = (i: number) => {
    const amount = base + STEPS[i];
    if (!canBid || amount > cash) return;
    setTap((t) => ({ id: (t?.id ?? 0) + 1, i, label: `$${amount}` }));
    place(amount);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!live || pend) return;
    if (leading) return say("You're already the top bidder.");
    const amount = Number(text.trim().replace(/^\$/, ""));
    if (!Number.isInteger(amount) || amount < min) return say(`Bid a whole number of at least $${min}.`);
    if (amount > cash) return say(`You only have $${cash}.`);
    setCustom({ lot: view.lot, text: "" });
    place(amount);
  };

  // Keys 1 / 2 / 3 = +$1 / +$5 / +$10 (ignored while typing anywhere).
  const keys = useLatest(quick);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? "")) return;
      const i = ["1", "2", "3"].indexOf(e.key);
      if (i < 0) return;
      e.preventDefault();
      keys.current(i);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keys]);

  let hint: ReactNode;
  if (view.phase === "sold") hint = view.lot + 1 < view.crates.length ? "Next lot coming up…" : "That was the last lot!";
  else if (!open) hint = "Get ready…";
  else if (leading) hint = <b style={{ color: meP.color }}>You&apos;re on top! 🙌</b>;
  else if (pend) hint = <span style={{ color: meP.color }}>Sending ${pend.a}…</span>;
  else if (cash < min) hint = "Not enough cash for this one.";
  else hint = lead ? `Beat $${lead.a} to take the lead` : "Open the bidding!";

  return (
    <section className="card p-3" aria-label="Place a bid">
      <div className="mb-2 flex items-baseline justify-between gap-2 text-sm">
        <span className="shrink-0">
          <span className="text-muted">Cash</span> <b className="font-mono tabular-nums">${cash}</b>
        </span>
        <span className="min-w-0 truncate text-right text-xs text-muted">{hint}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {STEPS.map((step, i) => {
          const amount = base + step;
          const sending = !!pend && pend.a === amount;
          const disabled = !canBid || amount > cash;
          return (
            <div key={step} className="relative">
              <button
                type="button"
                className="btn h-14 w-full flex-col gap-0 px-1 leading-tight disabled:cursor-not-allowed"
                style={
                  sending
                    ? { borderColor: meP.color, background: `${meP.color}2a`, transform: "scale(.97)", opacity: 1 }
                    : !disabled
                      ? { borderColor: `${accent}88`, background: `${accent}14` }
                      : undefined
                }
                disabled={disabled}
                aria-keyshortcuts={String(i + 1)}
                aria-label={`+$${step}: bid $${amount}`}
                onClick={() => quick(i)}
              >
                <span className="font-display text-lg font-extrabold" style={{ color: disabled && !sending ? undefined : accent }}>
                  +${step}
                </span>
                <span className="text-[11px] text-muted tabular-nums">{sending ? "sending…" : `bid $${amount}`}</span>
              </button>
              {tap && tap.i === i && (
                <span
                  key={tap.id}
                  aria-hidden
                  className="au-float pointer-events-none absolute top-0 left-1/2 font-display text-sm font-extrabold whitespace-nowrap"
                  style={{ color: meP.color }}
                >
                  {tap.label}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <form className="mt-2 flex gap-2" onSubmit={submit}>
        <div className="relative min-w-0 flex-1">
          <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">
            $
          </span>
          <input
            className="input h-11 pl-7 font-mono tabular-nums"
            aria-label="Custom bid"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            placeholder={`${min}+`}
            value={text}
            disabled={!live}
            onChange={(e) => setCustom({ lot: view.lot, text: e.target.value.replace(/[^\d]/g, "").slice(0, 4) })}
          />
        </div>
        <button type="submit" className="btn btn-primary h-11 px-5" disabled={!live || leading || !!pend || !text}>
          Bid
        </button>
      </form>
      <div className="mt-1.5 flex min-h-5 items-center justify-between gap-2 text-xs">
        <span role="status" aria-live="polite" className="min-w-0 truncate font-semibold" style={{ color: LOSS }}>
          {notice ? (
            <span key={notice.id} className="au-pop inline-block">
              {notice.text}
            </span>
          ) : null}
        </span>
        <span className="hidden shrink-0 text-muted @lg:inline">Keys 1 · 2 · 3</span>
      </div>
    </section>
  );
}

// ---------- the double-or-nothing reveal ----------

function GiftStage({ view, who, serverNow, accent }: { view: AuView; who: Who; serverNow: () => number; accent: string }) {
  const gift = giftOf(view);
  if (!gift || gift.buyer < 0) return null;
  const owner = who(gift.buyer);
  const you = gift.buyer === view.me;
  const shown = view.giftShown && gift.x2 !== null;
  const raw = standings({ ...view, phase: "lot" })[gift.buyer]?.vault ?? 0; // vault before the gift
  const after = shown ? (gift.x2 ? raw * 2 : 0) : null;
  return (
    <section className="card relative overflow-hidden p-3" aria-label="Double or nothing">
      <div className="flex items-center gap-3">
        <div className="relative w-[42%] max-w-[13.5rem] shrink-0">
          <div className="relative aspect-[200/170]">
            {shown && gift.x2 && <Rays color={GOLD} />}
            <div className={`size-full ${shown ? "" : "au-tremble"}`}>
              <CrateArt wood={0} stamp={-1} gift open={shown} />
            </div>
            {shown && gift.x2 && <Burst count={18} />}
            {shown && !gift.x2 && <Smoke colors={["#94a3b8bb", "#64748bbb", "#cbd5e1aa"]} count={8} />}
            {shown && (
              <div className="au-rise pointer-events-none absolute inset-x-0 top-[4%] grid place-items-center">
                <span
                  className="rounded-2xl border-[3px] px-3 py-0.5 font-display text-4xl font-black shadow-lg"
                  style={{ color: gift.x2 ? GAIN : LOSS, borderColor: gift.x2 ? GAIN : LOSS, background: "#0e0c1dee" }}
                >
                  {gift.x2 ? "×2" : "×0"}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="label">Double or nothing</div>
          <div className="mt-1 truncate text-sm">
            <Name p={owner} you={you} /> <span className="text-muted">paid</span> <b>${gift.price}</b>
          </div>
          <div className="mt-2 text-xs text-muted">Vault</div>
          <div className="flex items-baseline gap-2 font-display text-2xl font-extrabold tabular-nums">
            <span style={{ color: pnlColor(raw), opacity: shown ? 0.5 : 1 }} className={shown ? "line-through decoration-2" : ""}>
              {signed(raw)}
            </span>
            {after !== null && (
              <span className="au-pop" style={{ color: gift.x2 ? GAIN : LOSS, animationDelay: ".5s" }}>
                → {signed(after)}
              </span>
            )}
          </div>
          {!shown && <div className="au-pulse mt-1 text-sm font-semibold" style={{ color: accent }}>Drum roll… 🥁</div>}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted">
        <span className="shrink-0">Final standings</span>
        <div className="flex-1">
          <TimerBar endsAt={view.endsAt} total={view.phaseMs} serverNow={serverNow} color={GOLD} />
        </div>
      </div>
    </section>
  );
}

// ---------- misc ----------

function CloseNote({ closeAt, serverNow }: { closeAt: number; serverNow: () => number }) {
  const secs = useSecondsLeft(closeAt, serverNow);
  return (
    <p role="status" className="card animate-rise border-amber-400/50 px-3 py-2 text-center text-sm">
      <span aria-hidden>📡 </span>
      Only one bidder is connected. The auction closes in <b className="tabular-nums">{secs}s</b> unless someone comes back.
    </p>
  );
}

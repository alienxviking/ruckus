"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { Note, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import type { Bid, LiarsAction, LiarsView, PlayerStats, Showdown, ShowdownSummary } from "./server";
import { AWAY_MS, FACES, MAX_FACE, MIN_FACE, isLegalBid, matches, minQtyFor, minRaise, revealTiming } from "./shared";
import { Cup, DICE_CSS, Die, FACE_NAME, FACE_PLURAL } from "./dice";
import { Avatar } from "@/components/Avatar";

type Props = GameClientProps<LiarsView, LiarsAction>;
type Lookup = (id: string) => Player;

export default function LiarsDice(props: Props) {
  return (
    <>
      <style href="ruckus-liars" precedence="default">
        {DICE_CSS}
      </style>
      {props.view ? <Table {...props} view={props.view} /> : <Note>Shaking the cups…</Note>}
    </>
  );
}

// ---------- maths for the helper text ----------

/** P(at least k successes in n trials), p = 1/3 (the face or a wild one). */
function chanceAtLeast(n: number, k: number, p = 1 / 3): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let sum = 0;
  let c = 1; // C(n, i)
  for (let i = 0; i <= n; i++) {
    if (i >= k) sum += c * p ** i * (1 - p) ** (n - i);
    c = (c * (n - i)) / (i + 1);
  }
  return Math.min(1, Math.max(0, sum));
}

function chanceExactly(n: number, k: number, p = 1 / 3): number {
  if (k < 0 || k > n) return 0;
  let c = 1;
  for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
  return c * p ** k * (1 - p) ** (n - k);
}

/** Most common non-one face in a hand (ties go to the higher face). */
function favourite(hand: number[]): number {
  const n = [0, 0, 0, 0, 0, 0, 0];
  for (const v of hand) n[v] = (n[v] ?? 0) + 1;
  let best = MAX_FACE;
  for (let f = MAX_FACE - 1; f >= MIN_FACE; f--) if (n[f] > n[best]) best = f;
  return best;
}

const holdOf = (hand: number[], face: number) => hand.filter((v) => matches(v, face)).length;
const lastOf = (bids: Bid[]): Bid | null => (bids.length ? bids[bids.length - 1] : null);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable;
}

function fallback(id: string): Player {
  return { id, name: "Someone", color: "#94a3b8", avatar: "🙂", connected: false };
}

// ---------- showdown clock ----------

/** Milliseconds since the showdown started, re-rendering while its animation runs. */
function useShowdownClock(at: number | null, until: number, serverNow: () => number): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    if (at === null) return;
    const id = setInterval(() => {
      const t = serverNow();
      setNow(t);
      if (t - at > until) clearInterval(id);
    }, 80);
    return () => clearInterval(id);
  }, [at, until, serverNow]);
  return at === null ? 0 : now - at;
}

interface Stage {
  sd: Showdown;
  /** Matching dice lit so far. */
  lit: number;
  /** The verdict has landed. */
  verdict: boolean;
  /** Dice face up yet. */
  flipped: boolean;
  /** Lighting order of each die (-1 = not matching), per player. */
  order: Record<string, number[]>;
}

function stageOf(view: LiarsView, elapsed: number): Stage | null {
  const sd = view.showdown;
  if (!sd) return null;
  const t = revealTiming(sd.count);
  const order: Record<string, number[]> = {};
  let k = 0;
  for (const id of view.order) {
    const hand = sd.hands[id];
    if (!hand) continue;
    order[id] = hand.map((v) => (matches(v, sd.face) ? k++ : -1));
  }
  const lit = elapsed < t.flip || t.step === 0 ? 0 : Math.min(sd.count, Math.floor((elapsed - t.flip) / t.step) + 1);
  return { sd, lit, verdict: elapsed >= t.verdict, flipped: elapsed >= t.flip * 0.4, order };
}

// ---------- the table ----------

function Table({ view, byId, isPlayer, act, serverNow, accent }: Props & { view: LiarsView }) {
  const P: Lookup = (id) => byId[id] ?? fallback(id);
  const you = isPlayer ? view.you : null;
  const mine = view.mine ?? [];
  const sd = view.showdown;
  const timing = sd ? revealTiming(sd.count) : null;
  const elapsed = useShowdownClock(sd?.at ?? null, (timing?.total ?? 0) + 500, serverNow);
  const stage = stageOf(view, elapsed);
  const myTurn = view.phase === "bid" && you !== null && view.turn === you;
  const over = view.phase === "over";
  // Knocked out at this showdown: keep your hand on screen until the next round.
  const outNow = you !== null && (view.counts[you] ?? 0) === 0 && mine.length === 0;

  return (
    <div className="@container mx-auto flex w-full max-w-[56rem] flex-col gap-3 pb-16 @2xl:pb-2">
      <div aria-live="polite" aria-atomic="true">
        <StatusBanner
          key={`${view.phase}-${view.round}-${view.turn}-${stage?.verdict ? 1 : 0}`}
          accent={bannerColor(view, P, stage, accent)}
        >
          <span className="block">
            <Status view={view} you={you} P={P} stage={stage} myTurn={myTurn} />
          </span>
        </StatusBanner>
      </div>

      {!over && <TimerRow view={view} P={P} you={you} serverNow={serverNow} accent={accent} />}

      {view.lonelyAt !== null && !over && <LonelyNote at={view.lonelyAt} serverNow={serverNow} />}

      <Seats view={view} P={P} you={you} stage={stage} accent={accent} />

      <div className="grid gap-3 @2xl:grid-cols-2 @2xl:items-start">
        {stage ? (
          <ShowdownPanel view={view} stage={stage} P={P} you={you} accent={accent} />
        ) : (
          <BidBoard view={view} P={P} you={you} mine={mine} accent={accent} />
        )}
        {over ? (
          <Final view={view} P={P} you={you} accent={accent} />
        ) : you !== null && !outNow ? (
          <HandPanel view={view} P={P} you={you} mine={mine} myTurn={myTurn} act={act} accent={accent} />
        ) : (
          <RoundLog view={view} P={P} you={you} accent={accent} />
        )}
      </div>

      {!over && you !== null && !outNow && <RoundLog view={view} P={P} you={you} accent={accent} />}

      {!over &&
        (you === null ? (
          <Note>👀 You&apos;re watching. Everyone&apos;s dice are shown at each showdown.</Note>
        ) : outNow ? (
          <Note>💀 You&apos;re out of dice. Stick around: dice show at every showdown.</Note>
        ) : myTurn ? (
          <p className="hidden text-center text-xs text-muted @xl:block">
            Keys: ↑/↓ quantity · ←/→ or 2–6 face · Enter bid · L liar{view.spotOk ? " · S spot on" : ""}
          </p>
        ) : null)}
    </div>
  );
}

function Who({ id, you, P, lower }: { id: string; you: string | null; P: Lookup; lower?: boolean }) {
  if (id === you) return <b className="font-bold">{lower ? "you" : "You"}</b>;
  const p = P(id);
  return (
    <span className="font-bold whitespace-nowrap">
      <span aria-hidden><Avatar id={p.avatar} /> </span>
      <span style={{ color: p.color }}>{p.name}</span>
    </span>
  );
}

/** "loses" or "lose", depending on whether it's you. */
const verb = (id: string | null, you: string | null, s: string, base: string) => (id === you ? base : s);

function BidText({ qty, face, size = 22, accent }: { qty: number; face: number; size?: number; accent?: string }) {
  return (
    <span className="inline-flex items-center gap-1 align-middle whitespace-nowrap">
      <b className="tabular-nums">{qty}</b>
      <span className="opacity-60">×</span>
      <Die value={face} size={size} accent={accent} label={FACE_PLURAL[face]} />
    </span>
  );
}

/** "…" that pulses, glued to the word before it so it never wraps alone. */
function Dots() {
  return (
    <span aria-hidden className="whitespace-nowrap">
      <span className="ld-dot">.</span>
      <span className="ld-dot" style={{ animationDelay: ".15s" }}>
        .
      </span>
      <span className="ld-dot" style={{ animationDelay: ".3s" }}>
        .
      </span>
    </span>
  );
}

function bannerColor(view: LiarsView, P: Lookup, stage: Stage | null, accent: string): string {
  if (view.phase === "over") return view.winners?.length === 1 ? P(view.winners[0]).color : accent;
  if (stage) {
    if (!stage.verdict) return "#f87171";
    const sd = stage.sd;
    return sd.loser ? P(sd.loser).color : accent;
  }
  if (view.turn) return P(view.turn).color;
  return accent;
}

function Status({
  view,
  you,
  P,
  stage,
  myTurn,
}: {
  view: LiarsView;
  you: string | null;
  P: Lookup;
  stage: Stage | null;
  myTurn: boolean;
}) {
  if (view.phase === "over") {
    const w = view.winners ?? [];
    if (!w.length) return <>Game over: everyone left</>;
    if (w.length > 1) return <>It&apos;s a tie!</>;
    const n = view.counts[w[0]] ?? 0;
    if (view.ending === "left") {
      return (
        <>
          <Who id={w[0]} you={you} P={P} /> {verb(w[0], you, "wins", "win")}: everyone else left
        </>
      );
    }
    return (
      <>
        <Who id={w[0]} you={you} P={P} /> {verb(w[0], you, "wins", "win")} with {plural(n, "die", "dice")} left!
      </>
    );
  }
  if (stage) {
    const sd = stage.sd;
    if (!stage.verdict) {
      return (
        <>
          <Who id={sd.caller} you={you} P={P} /> {verb(sd.caller, you, "calls", "call")}{" "}
          <span className="text-red-400">{sd.kind === "liar" ? "LIAR!" : "SPOT ON!"}</span>
        </>
      );
    }
    if (sd.out) {
      return (
        <>
          💀 <Who id={sd.out} you={you} P={P} /> {sd.out === you ? "are" : "is"} out!
        </>
      );
    }
    if (sd.kind === "spot" && sd.correct) {
      return (
        <>
          🎯 Spot on! <Who id={sd.caller} you={you} P={P} /> nailed it
        </>
      );
    }
    if (sd.kind === "liar" && sd.correct) {
      return (
        <>
          🤥 Caught! <Who id={sd.bidder} you={you} P={P} /> {verb(sd.bidder, you, "loses", "lose")} a die
        </>
      );
    }
    return (
      <>
        {sd.kind === "liar" ? "✅ True!" : "❌ Not exact!"} <Who id={sd.loser ?? sd.caller} you={you} P={P} />{" "}
        {verb(sd.loser ?? sd.caller, you, "loses", "lose")} a die
      </>
    );
  }
  if (view.phase === "roll") {
    return (
      <>
        🎲 Round {view.round}:{" "}
        <span className="whitespace-nowrap">
          rolling
          <Dots />
        </span>
      </>
    );
  }
  const first = view.bids.length === 0;
  if (myTurn) return <>{first ? "You open the bidding!" : "Your turn: raise it, or call Liar!"}</>;
  if (!view.turn) return <>…</>;
  if (view.autoAt !== null) {
    return (
      <>
        📡 <Who id={view.turn} you={you} P={P} /> is away…
      </>
    );
  }
  return (
    <>
      <Who id={view.turn} you={you} P={P} /> {first ? "opens the " : "is "}
      <span className="whitespace-nowrap">
        {first ? "bidding" : "thinking"}
        <Dots />
      </span>
    </>
  );
}

function TimerRow({
  view,
  P,
  you,
  serverNow,
  accent,
}: {
  view: LiarsView;
  P: Lookup;
  you: string | null;
  serverNow: () => number;
  accent: string;
}) {
  const deadline = view.autoAt ?? view.endsAt;
  const secs = useSecondsLeft(deadline, serverNow);
  const color = view.phase === "bid" && view.turn ? P(view.turn).color : view.phase === "reveal" ? "var(--color-muted)" : accent;
  let label: ReactNode;
  if (view.phase === "roll") label = "Rolling";
  else if (view.phase === "reveal") label = "Next round";
  else if (view.autoAt !== null) label = <>Auto in {secs}s</>;
  else label = view.turn === you ? <>{secs}s left</> : <>{secs}s</>;
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <div className="flex-1">
        <TimerBar
          endsAt={view.autoAt ?? view.endsAt}
          total={view.autoAt !== null ? AWAY_MS : view.timerMs}
          serverNow={serverNow}
          color={color}
        />
      </div>
      <span className={`w-20 shrink-0 text-right font-semibold tabular-nums ${view.phase === "bid" && secs <= 5 ? "text-red-400" : ""}`}>
        {label}
      </span>
    </div>
  );
}

function LonelyNote({ at, serverNow }: { at: number; serverNow: () => number }) {
  const secs = useSecondsLeft(at, serverNow);
  return (
    <p role="status" className="card animate-rise border-amber-400/50 px-3 py-2 text-center text-sm">
      <span aria-hidden>📡 </span>Not enough players here. The game ends in <b className="tabular-nums">{secs}s</b> unless
      someone comes back.
    </p>
  );
}

// ---------- seats ----------

function seatCols(n: number): string {
  if (n <= 2) return "grid-cols-2";
  if (n === 3) return "grid-cols-3";
  if (n === 4) return "grid-cols-2 @2xl:grid-cols-4";
  if (n <= 6) return "grid-cols-2 @xl:grid-cols-3";
  return "grid-cols-2 @2xl:grid-cols-4";
}

function Seats({
  view,
  P,
  you,
  stage,
  accent,
}: {
  view: LiarsView;
  P: Lookup;
  you: string | null;
  stage: Stage | null;
  accent: string;
}) {
  const compact = view.order.length === 3;
  return (
    <ul className={`grid gap-2 ${seatCols(view.order.length)}`} aria-label="Players">
      {view.order.map((id) => (
        <Seat key={id} id={id} view={view} P={P} you={you} stage={stage} accent={accent} compact={compact} />
      ))}
    </ul>
  );
}

function Seat({
  id,
  view,
  P,
  you,
  stage,
  accent,
  compact,
}: {
  id: string;
  view: LiarsView;
  P: Lookup;
  you: string | null;
  stage: Stage | null;
  accent: string;
  compact: boolean;
}) {
  const p = P(id);
  const count = view.counts[id] ?? 0;
  const active = view.phase === "bid" && view.turn === id;
  const opener = view.phase === "roll" && view.turn === id;
  const sd = stage?.sd ?? null;
  const hand = sd ? sd.hands[id] : undefined;
  const verdict = !!stage?.verdict;
  const lost = verdict && sd?.loser === id;
  const gained = verdict && sd?.gainer === id;
  const knockedOut = verdict && sd?.out === id;
  const isOut = count === 0 && !(hand && !verdict);
  const won = view.phase === "over" && !!view.winners?.includes(id);
  const myBid = !sd ? [...view.bids].reverse().find((b) => b.by === id) : undefined;
  const isMe = id === you;
  const size = compact ? 15 : 17;
  const role = sd ? (sd.caller === id ? "called" : sd.bidder === id ? "bid" : null) : null;

  let dice: ReactNode;
  if (hand) {
    const order = stage!.order[id] ?? [];
    dice = hand.map((v, i) => {
      const k = order[i] ?? -1;
      const lit = k >= 0 && k < stage!.lit;
      const isLost = lost && i === hand.length - 1;
      const die = (
        <Die
          key={`${sd!.round}-${i}`}
          value={stage!.flipped ? v : null}
          size={size + 2}
          color={p.color}
          accent={accent}
          tone={lit ? "lit" : verdict && k < 0 && !isLost ? "dim" : "plain"}
          className={isLost ? "ld-lost" : lit ? "ld-lit" : stage!.flipped ? "ld-flip" : ""}
          style={{ animationDelay: isLost || lit ? undefined : `${i * 60}ms` }}
        />
      );
      if (!isLost) return die;
      // The die that's lost: knocked over and crossed out.
      return (
        <span key={`${sd!.round}-${i}`} className="relative inline-grid place-items-center">
          {die}
          <span className="ld-cross absolute inset-0 grid place-items-center text-xl leading-none font-black text-red-500 [text-shadow:0_0_3px_#000,0_0_6px_#000]">
            ✕
          </span>
        </span>
      );
    });
    if (gained) dice = [...(dice as ReactNode[]), <Die key="gain" value={null} size={size + 2} color={accent} className="ld-gain" />];
  } else if (count > 0) {
    const shown = isMe && view.mine && view.phase !== "roll" ? view.mine : null;
    dice = Array.from({ length: count }, (_, i) => (
      <Die
        key={`${view.round}-${i}`}
        value={shown ? (shown[i] ?? null) : null}
        size={size}
        color={p.color}
        className={view.phase === "roll" ? "ld-wiggle" : shown ? "ld-tumble" : ""}
        style={{ animationDelay: `${i * 45}ms` }}
      />
    ));
  }

  const label = `${p.name}${isMe ? " (you)" : ""}: ${
    isOut ? "out" : hand && stage?.flipped ? `dice ${hand.join(", ")}` : plural(count, "die", "dice")
  }${active ? ", bidding now" : ""}${opener ? ", opens this round" : ""}${!p.connected ? ", away" : ""}${myBid ? `, bid ${myBid.qty} ${FACE_PLURAL[myBid.face]}` : ""}`;

  return (
    <li
      aria-label={label}
      aria-current={active ? "true" : undefined}
      className={`relative min-w-0 rounded-2xl border px-2.5 py-2 ${isOut && !knockedOut ? "opacity-55" : ""} ${lost ? "ld-thud" : ""}`}
      style={{
        borderColor: active || won ? p.color : "var(--color-line)",
        background: active || won ? `${p.color}1c` : "var(--color-panel)",
        transition: "border-color .3s, background-color .3s, opacity .4s",
      }}
    >
      {active && (
        <span
          aria-hidden
          className="ld-glow pointer-events-none absolute -inset-px rounded-2xl"
          style={{ boxShadow: `0 0 0 1px ${p.color}, 0 0 18px ${p.color}55` }}
        />
      )}
      <div aria-hidden className="flex min-w-0 items-center gap-1.5">
        <span className="relative shrink-0 text-lg leading-none">
          <Avatar id={p.avatar} />
          {won && <span className="ld-stamp absolute -top-3 -left-1 text-sm">👑</span>}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-bold" style={{ color: p.color }}>
          {p.name}
          {isMe && <span className="ml-1 text-[10px] font-semibold text-muted uppercase">you</span>}
        </span>
        {myBid ? (
          <span
            key={`${myBid.qty}-${myBid.face}`}
            className="animate-pop inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs font-bold"
            style={{ borderColor: `${p.color}88`, background: `${p.color}22` }}
          >
            {myBid.qty}
            <span className="text-[10px] text-muted">×</span>
            <Die value={myBid.face} size={13} />
          </span>
        ) : role ? (
          <span className="shrink-0 rounded-full bg-panel-2 px-1.5 py-0.5 text-[10px] font-bold text-muted uppercase">{role}</span>
        ) : null}
      </div>
      <div aria-hidden className="mt-1.5 flex min-h-[22px] items-center gap-1">
        {isOut && !hand ? (
          <span className="text-xs font-semibold text-muted">
            💀 out{view.outRound[id] ? ` · round ${view.outRound[id]}` : ""}
          </span>
        ) : (
          <span className="flex min-w-0 flex-wrap items-center gap-[3px]">{dice}</span>
        )}
        {/* Icon-only so five dice still fit on a phone; the seat's label says it in words. */}
        <span className="ml-auto shrink-0 text-xs leading-none font-bold" style={{ color: p.color }}>
          {!p.connected ? <span title="Away">📡</span> : active || opener ? <span className={active ? "ld-dot" : ""}>▶</span> : null}
        </span>
      </div>
      {lost && !knockedOut && (
        <span aria-hidden className="ld-float absolute right-2 bottom-1.5 text-sm font-extrabold text-red-400" style={{ animationDelay: ".2s" }}>
          −1
        </span>
      )}
      {gained && (
        <span aria-hidden className="ld-float absolute right-2 bottom-1.5 text-sm font-extrabold" style={{ color: accent, animationDelay: ".2s" }}>
          +1
        </span>
      )}
      {knockedOut && (
        <span
          aria-hidden
          className="ld-stamp pointer-events-none absolute right-2 bottom-1.5 rounded-md border-2 border-red-400 bg-ink/85 px-1.5 font-display text-sm leading-tight font-extrabold tracking-widest text-red-400"
          style={{ animationDelay: ".5s" }}
        >
          OUT
        </span>
      )}
    </li>
  );
}

// ---------- the bid on the table ----------

function BidBoard({
  view,
  P,
  you,
  mine,
  accent,
}: {
  view: LiarsView;
  P: Lookup;
  you: string | null;
  mine: number[];
  accent: string;
}) {
  const bid = lastOf(view.bids);
  const holding = you !== null && mine.length > 0;
  return (
    <section className="card flex flex-col gap-2 p-3" aria-label="Current bid">
      <div className="flex items-center justify-between gap-2">
        <span className="label">On the table</span>
        <span className="text-xs text-muted">
          <b className="text-text tabular-nums">{view.total}</b> dice in play · ones are wild
        </span>
      </div>
      {bid ? (
        <div key={view.bids.length} className="ld-in flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="min-w-0 truncate text-sm">
            <Who id={bid.by} you={you} P={P} /> {verb(bid.by, you, "bids", "bid")}
            {bid.auto && <span className="ml-1 rounded bg-panel-2 px-1 text-[10px] font-semibold text-muted uppercase">auto</span>}
          </span>
          <span className="flex items-center gap-2 font-display text-4xl leading-none font-extrabold">
            <span className="tabular-nums">{bid.qty}</span>
            <span className="text-2xl text-muted">×</span>
            <Die value={bid.face} size={40} accent={accent} label={FACE_PLURAL[bid.face]} />
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-3 py-1">
          <span aria-hidden className="text-3xl">
            🎲
          </span>
          <span className="text-sm text-muted">
            No bids yet.{" "}
            {view.turn && (
              <>
                <Who id={view.turn} you={you} P={P} /> {verb(view.turn, you, "opens", "open")} the bidding.
              </>
            )}
          </span>
        </div>
      )}
      {bid && <Helper bid={bid} total={view.total} mine={holding ? mine : null} you={you} P={P} accent={accent} />}
    </section>
  );
}

function Odds({ p, label }: { p: number; label: string }) {
  const pct = Math.round(p * 100);
  const color = pct >= 60 ? "#4ade80" : pct >= 30 ? "#fbbf24" : "#f87171";
  const word = pct >= 80 ? "very likely" : pct >= 60 ? "likely" : pct >= 30 ? "coin flip" : pct >= 10 ? "unlikely" : "long shot";
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="shrink-0 text-muted">{label}</span>
      <div className="h-1.5 min-w-10 flex-1 overflow-hidden rounded-full bg-panel-2" aria-hidden>
        <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.max(3, pct)}%`, background: color }} />
      </div>
      <span className="shrink-0 font-semibold tabular-nums" style={{ color }}>
        {pct}% <span className="font-normal text-muted">{word}</span>
      </span>
    </div>
  );
}

function Helper({
  bid,
  total,
  mine,
  you,
  P,
  accent,
}: {
  bid: Bid;
  total: number;
  mine: number[] | null;
  you: string | null;
  P: Lookup;
  accent: string;
}) {
  if (!mine) {
    const exp = total / 3;
    return (
      <p className="text-xs text-muted">
        About <b className="text-text tabular-nums">{exp.toFixed(1)}</b> of the {total} dice should show{" "}
        <Die value={bid.face} size={13} accent={accent} /> or a wild <Die value={1} size={13} />.
      </p>
    );
  }
  const held = holdOf(mine, bid.face);
  const unseen = total - mine.length;
  const exp = unseen / 3;
  const pTrue = chanceAtLeast(unseen, bid.qty - held);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted">
        You hold <b className="text-text tabular-nums">{held}</b> matching. Of the {unseen} dice you can&apos;t see, about{" "}
        <b className="text-text tabular-nums">{exp.toFixed(1)}</b> match, so ≈{" "}
        <b className="text-text tabular-nums">{(held + exp).toFixed(1)}</b> in all.
      </p>
      <Odds p={pTrue} label={bid.by === you ? "Your bid is true:" : `${P(bid.by).name}'s bid is true:`} />
    </div>
  );
}

// ---------- the showdown ----------

function ShowdownPanel({
  view,
  stage,
  P,
  you,
  accent,
}: {
  view: LiarsView;
  stage: Stage;
  P: Lookup;
  you: string | null;
  accent: string;
}) {
  const sd = stage.sd;
  const shown = stage.verdict ? sd.count : stage.lit;
  return (
    <section
      className="card flex flex-col gap-2 p-3"
      aria-label="Showdown"
      style={{ borderColor: stage.verdict ? (sd.loser ? `${P(sd.loser).color}99` : accent) : "#f8717199" }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="label">{view.phase === "over" ? "Final showdown" : `Showdown · round ${sd.round}`}</span>
        {sd.auto && <span className="rounded bg-panel-2 px-1.5 text-[10px] font-semibold text-muted uppercase">auto call</span>}
      </div>
      <p className="text-sm">
        <Who id={sd.caller} you={you} P={P} /> {verb(sd.caller, you, "calls", "call")}{" "}
        <b className="text-red-400">{sd.kind === "liar" ? "Liar" : "Spot on"}</b> on <Who id={sd.bidder} you={you} P={P} lower />
        {sd.bidder === you ? "r" : "'s"} bid of <BidText qty={sd.qty} face={sd.face} size={18} accent={accent} />
      </p>
      <div className="flex items-center gap-3 rounded-xl bg-ink/60 px-3 py-2">
        <span
          key={shown}
          className="ld-count w-14 text-center font-display text-5xl leading-none font-extrabold tabular-nums"
          style={{
            color:
              sd.kind === "spot" && shown > sd.qty ? "#f87171" : shown >= sd.qty ? accent : "var(--color-text)",
          }}
          aria-hidden
        >
          {shown}
        </span>
        <span className="flex min-w-0 flex-col text-xs text-muted">
          <span className="flex items-center gap-1">
            <Die value={sd.face} size={16} accent={accent} /> + wild <Die value={1} size={16} /> counted
          </span>
          <span>
            the bid needs <b className="text-text">{sd.qty}</b>
            {sd.kind === "spot" ? " exactly" : " or more"}
          </span>
        </span>
      </div>
      <div className="min-h-[3.25rem]" aria-live="polite">
        {stage.verdict && (
          <div className="animate-rise flex flex-col gap-0.5">
            <p className="font-display text-lg font-extrabold">
              <Verdict sd={sd} you={you} P={P} />
            </p>
            <p className="text-sm text-muted">
              <Consequence sd={sd} you={you} P={P} start={view.startDice} />
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function Verdict({ sd, you, P }: { sd: ShowdownSummary; you: string | null; P: Lookup }) {
  const n = plural(sd.count, FACE_NAME[sd.face], FACE_PLURAL[sd.face]);
  if (sd.kind === "liar") {
    return sd.correct ? (
      <>
        Only {n}! <Who id={sd.bidder} you={you} P={P} /> {sd.bidder === you ? "were" : "was"} bluffing.
      </>
    ) : (
      <>{sd.count === sd.qty ? `Exactly ${n}.` : `${n[0].toUpperCase()}${n.slice(1)}!`} The bid was true.</>
    );
  }
  const off = Math.abs(sd.count - sd.qty);
  return sd.correct ? (
    <>Exactly {n}. Bullseye! 🎯</>
  ) : (
    <>
      {`${n[0].toUpperCase()}${n.slice(1)}, not ${sd.qty}.`} {off === 1 ? "So close!" : "Way off."}
    </>
  );
}

function Consequence({ sd, you, P, start }: { sd: ShowdownSummary; you: string | null; P: Lookup; start: number }) {
  if (sd.out) {
    return (
      <>
        💀 <Who id={sd.out} you={you} P={P} /> {verb(sd.out, you, "loses", "lose")} the last die and {sd.out === you ? "are" : "is"} out.
      </>
    );
  }
  if (sd.loser) {
    return (
      <>
        <Who id={sd.loser} you={you} P={P} /> {verb(sd.loser, you, "loses", "lose")} a die and{" "}
        {verb(sd.loser, you, "opens", "open")} the next round.
      </>
    );
  }
  if (sd.gainer) {
    return (
      <>
        <Who id={sd.gainer} you={you} P={P} /> {verb(sd.gainer, you, "wins", "win")} a die back!
      </>
    );
  }
  return (
    <>
      <Who id={sd.caller} you={you} P={P} /> already {sd.caller === you ? "have" : "has"} {start} dice: bragging rights only.
    </>
  );
}

// ---------- your hand and the bid controls ----------

function HandPanel({
  view,
  P,
  you,
  mine,
  myTurn,
  act,
  accent,
}: {
  view: LiarsView;
  P: Lookup;
  you: string;
  mine: number[];
  myTurn: boolean;
  act: (a: LiarsAction) => void;
  accent: string;
}) {
  const me = P(you);
  const rolling = view.phase === "roll";
  const sd = view.showdown;
  const bid = lastOf(view.bids);
  const turnKey = `${view.round}:${view.bids.length}`;
  const [sel, setSel] = useState<{ key: string; qty: number; face: number } | null>(null);
  const prev = bid;
  const total = view.total;
  const def = (() => {
    if (!prev) return { qty: 1, face: favourite(mine) };
    return minRaise(prev, total) ?? { qty: prev.qty, face: prev.face };
  })();
  const cur = sel && sel.key === turnKey ? sel : { key: turnKey, ...def };
  const hintFace = myTurn ? cur.face : sd ? sd.face : bid?.face ?? null;

  return (
    <section className="card relative flex flex-col gap-3 overflow-hidden p-3" aria-label="Your dice">
      <div className="flex items-center justify-between gap-2">
        <span className="label">Your dice</span>
        <span className="text-xs text-muted">
          {plural(mine.length, "die", "dice")} · started with {view.startDice}
        </span>
      </div>
      <div className="relative flex min-h-[84px] items-center justify-center">
        <div
          role="group"
          aria-label={rolling ? "Your dice are being rolled" : `Your dice: ${mine.join(", ")}`}
          className="flex flex-wrap items-center justify-center gap-2"
          style={{ opacity: rolling ? 0 : 1 }}
        >
          {mine.map((v, i) => (
            <Die
              key={`${view.round}-${i}`}
              value={v}
              size={48}
              accent={accent}
              tone={hintFace !== null && matches(v, hintFace) ? "hint" : "plain"}
              className={rolling ? "" : "ld-tumble"}
              style={{ animationDelay: `${120 + i * 70}ms` }}
            />
          ))}
        </div>
        <span
          key={`cup-${view.round}-${rolling ? 1 : 0}`}
          className={`pointer-events-none absolute bottom-0 left-1/2 -ml-[50px] ${rolling ? "" : "ld-lift"}`}
        >
          <span className={rolling ? "ld-shake block" : "block"}>
            <Cup color={me.color} width={100} />
          </span>
        </span>
      </div>
      {myTurn ? (
        <BidControls
          view={view}
          mine={mine}
          prev={prev}
          cur={cur}
          turnKey={turnKey}
          setSel={setSel}
          act={act}
          accent={accent}
          P={P}
        />
      ) : (
        <p className="text-center text-sm text-muted">
          {rolling
            ? "Rolling… keep your dice secret!"
            : sd
              ? "Dice on the table: everyone can see them now."
              : view.turn
                ? <>Wait for your turn. <Who id={view.turn} you={you} P={P} /> is up.</>
                : null}
        </p>
      )}
    </section>
  );
}

function BidControls({
  view,
  mine,
  prev,
  cur,
  turnKey,
  setSel,
  act,
  accent,
  P,
}: {
  view: LiarsView;
  mine: number[];
  prev: Bid | null;
  cur: { key: string; qty: number; face: number };
  turnKey: string;
  setSel: (s: { key: string; qty: number; face: number }) => void;
  act: (a: LiarsAction) => void;
  accent: string;
  P: Lookup;
}) {
  const total = view.total;
  const [sent, setSent] = useState<string | null>(null);
  const waiting = sent === turnKey;
  const minQ = minQtyFor(cur.face, prev, total);
  const qty = minQ === null ? cur.qty : Math.max(cur.qty, minQ);
  const face = cur.face;
  const canBid = !waiting && minQ !== null && isLegalBid({ qty, face }, prev, total);
  const canCall = !waiting && !!prev;
  const canSpot = canCall && view.spotOk;
  const unseen = total - mine.length;
  const held = holdOf(mine, face);
  const pMine = chanceAtLeast(unseen, qty - held);
  const prevHeld = prev ? holdOf(mine, prev.face) : 0;
  const pExact = prev ? chanceExactly(unseen, prev.qty - prevHeld) : 0;
  const anyRaise = minRaise(prev, total) !== null;

  // A rejected or lost action must not lock the controls.
  useEffect(() => {
    if (!sent) return;
    const id = setTimeout(() => setSent(null), 1500);
    return () => clearTimeout(id);
  }, [sent]);

  const pickFace = (f: number) => {
    const oldMin = minQtyFor(face, prev, total);
    const newMin = minQtyFor(f, prev, total);
    if (newMin === null) return;
    // Still at the old minimum: follow the new face's minimum. Otherwise keep the quantity.
    const q = oldMin !== null && qty === oldMin ? newMin : Math.max(qty, newMin);
    setSel({ key: turnKey, face: f, qty: q });
  };
  const stepQty = (d: number) => {
    const q = qty + d;
    if (q < (minQ ?? 1) || q > total) return;
    setSel({ key: turnKey, face, qty: q });
  };
  const send = (a: LiarsAction) => {
    if (waiting) return;
    setSent(turnKey);
    act(a);
  };
  const doBid = () => canBid && send({ type: "bid", qty, face });
  const doLiar = () => canCall && send({ type: "liar" });
  const doSpot = () => canSpot && send({ type: "spot" });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const k = e.key;
      let handled = true;
      if (k === "ArrowUp" || k === "+" || k === "=") stepQty(1);
      else if (k === "ArrowDown" || k === "-") stepQty(-1);
      else if (k === "ArrowLeft" || k === "ArrowRight") {
        const dir = k === "ArrowLeft" ? -1 : 1;
        for (let f = face + dir; f >= MIN_FACE && f <= MAX_FACE; f += dir) {
          if (minQtyFor(f, prev, total) !== null) {
            pickFace(f);
            break;
          }
        }
      } else if (/^[2-6]$/.test(k)) pickFace(Number(k));
      else if (k === "Enter") {
        // Let a focused button handle its own Enter.
        if (e.target instanceof HTMLButtonElement) return;
        doBid();
      } else if (k === "l" || k === "L") doLiar();
      else if ((k === "s" || k === "S") && view.spotOk) doSpot();
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="ld-in flex flex-col gap-3 border-t border-line pt-3">
      {anyRaise ? (
        <>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-1.5" role="group" aria-label="Quantity">
              <button
                type="button"
                className="btn size-11 p-0 text-xl"
                aria-label="One fewer"
                aria-keyshortcuts="ArrowDown"
                disabled={waiting || qty - 1 < (minQ ?? 1)}
                onClick={() => stepQty(-1)}
              >
                −
              </button>
              <output
                aria-label="Quantity"
                aria-live="polite"
                className="w-12 text-center font-display text-3xl font-extrabold tabular-nums"
              >
                {qty}
              </output>
              <button
                type="button"
                className="btn size-11 p-0 text-xl"
                aria-label="One more"
                aria-keyshortcuts="ArrowUp"
                disabled={waiting || qty + 1 > total}
                onClick={() => stepQty(1)}
              >
                +
              </button>
            </div>
            <div className="flex items-center gap-1" role="radiogroup" aria-label="Face">
              {FACES.map((f) => {
                const ok = minQtyFor(f, prev, total) !== null;
                const on = f === face;
                return (
                  <button
                    key={f}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={FACE_PLURAL[f]}
                    aria-keyshortcuts={String(f)}
                    disabled={waiting || !ok}
                    onClick={() => pickFace(f)}
                    className="grid size-11 place-items-center rounded-xl border transition-[transform,background-color,border-color] duration-150 active:scale-95 disabled:opacity-30"
                    style={{
                      borderColor: on ? accent : "var(--color-line)",
                      background: on ? `${accent}26` : "var(--color-panel-2)",
                      transform: on ? "translateY(-2px)" : undefined,
                    }}
                  >
                    <Die value={f} size={28} accent={accent} />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-center text-xs text-muted">
              You hold <b className="text-text">{held}</b> of these; {qty - held > 0 ? <>you need <b className="text-text">{qty - held}</b> more among {unseen} hidden dice.</> : "your own dice already cover it."}
            </p>
            <Odds p={pMine} label="This bid is true:" />
          </div>
          <button
            type="button"
            className="btn h-12 text-base font-extrabold"
            style={{ background: accent, borderColor: accent, color: "#14200a" }}
            disabled={!canBid}
            onClick={doBid}
            aria-keyshortcuts="Enter"
          >
            Bid <BidText qty={qty} face={face} size={24} />
          </button>
        </>
      ) : (
        <p className="text-center text-sm font-semibold">No higher bid is possible. Call it!</p>
      )}
      {prev && (
        <div className="flex gap-2">
          <button
            type="button"
            className="btn h-12 flex-1 border-red-400/60 bg-red-500/15 text-base font-extrabold text-red-300"
            disabled={!canCall}
            onClick={doLiar}
            aria-keyshortcuts="L"
            aria-label={`Call Liar on ${P(prev.by).name}'s bid of ${prev.qty} ${FACE_PLURAL[prev.face]}`}
          >
            🤥 Liar!
          </button>
          {view.spotOk && (
            <button
              type="button"
              className="btn h-12 flex-1 flex-col gap-0 border-sky-400/50 bg-sky-500/10 py-1 text-sky-200"
              disabled={!canSpot}
              onClick={doSpot}
              aria-keyshortcuts="S"
              aria-label={`Call spot on: exactly ${prev.qty} ${FACE_PLURAL[prev.face]}`}
            >
              <span className="text-base leading-tight font-extrabold">🎯 Spot on</span>
              <span className="text-[10px] leading-tight font-medium opacity-75 tabular-nums">
                exactly {prev.qty}: {Math.round(pExact * 100)}%
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- round log ----------

function RoundLog({ view, P, you, accent }: { view: LiarsView; P: Lookup; you: string | null; accent: string }) {
  const last = view.last;
  return (
    <section className="card flex flex-col gap-2 p-3" aria-label="This round's bids">
      <div className="flex items-center justify-between gap-2">
        <span className="label">Round {view.round} bids</span>
        <span className="text-xs text-muted">{view.bids.length ? plural(view.bids.length, "bid", "bids") : ""}</span>
      </div>
      {view.bids.length ? (
        <ol className="flex flex-wrap items-center gap-1.5">
          {view.bids.map((b, i) => {
            const p = P(b.by);
            const latest = i === view.bids.length - 1;
            return (
              <li
                key={i}
                className={`inline-flex items-center gap-1 rounded-full border py-0.5 pr-2 pl-1.5 text-sm font-bold ${latest ? "animate-pop" : "opacity-70"}`}
                style={{ borderColor: latest ? p.color : `${p.color}55`, background: `${p.color}${latest ? "26" : "12"}` }}
              >
                <span aria-hidden><Avatar id={p.avatar} /></span>
                <span className="sr-only">{b.by === you ? "You" : p.name} bid</span>
                <span className="tabular-nums">{b.qty}</span>
                <span className="text-xs text-muted">×</span>
                <Die value={b.face} size={16} accent={accent} label={FACE_PLURAL[b.face]} />
                {b.auto && <span className="text-[9px] font-semibold text-muted uppercase">auto</span>}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-muted">{view.phase === "roll" ? "Dice are rolling…" : "No bids yet this round."}</p>
      )}
      {last && (
        <p className="border-t border-line pt-2 text-xs text-muted">
          <span className="font-semibold text-text">Last showdown:</span> <Who id={last.caller} you={you} P={P} />{" "}
          {verb(last.caller, you, "called", "called")} {last.kind === "liar" ? "Liar" : "spot on"} on{" "}
          <BidText qty={last.qty} face={last.face} size={13} accent={accent} />; there {last.count === 1 ? "was" : "were"}{" "}
          {last.count}.{" "}
          {last.loser ? (
            <>
              <Who id={last.loser} you={you} P={P} /> lost a die{last.out ? " and went out" : ""}.
            </>
          ) : last.gainer ? (
            <>
              <Who id={last.gainer} you={you} P={P} /> won a die back.
            </>
          ) : (
            "Bullseye!"
          )}
        </p>
      )}
    </section>
  );
}

// ---------- final ----------

function standings(view: LiarsView): string[] {
  const winners = view.winners ?? [];
  const stillIn = view.order
    .filter((id) => (view.counts[id] ?? 0) > 0 && !winners.includes(id))
    .sort((a, b) => (view.counts[b] ?? 0) - (view.counts[a] ?? 0));
  return [...winners, ...stillIn, ...[...view.out].reverse()];
}

interface Award {
  icon: string;
  title: string;
  id: string;
  detail: string;
}

function awards(view: LiarsView): Award[] {
  const stats = view.stats;
  if (!stats) return [];
  const best = (key: keyof PlayerStats): [string, number] | null => {
    let top: [string, number] | null = null;
    for (const id of view.order) {
      const v = stats[id]?.[key] ?? 0;
      if (v > 0 && (!top || v > top[1])) top = [id, v];
    }
    return top;
  };
  const out: Award[] = [];
  const right = best("right");
  if (right) out.push({ icon: "🕵️", title: "Lie detector", id: right[0], detail: plural(right[1], "right call", "right calls") });
  const held = best("held");
  if (held) out.push({ icon: "😇", title: "Honest face", id: held[0], detail: plural(held[1], "bid survived a Liar call", "bids survived a Liar call") });
  const caught = best("caught");
  if (caught) out.push({ icon: "🤥", title: "Caught red-handed", id: caught[0], detail: plural(caught[1], "bluff caught", "bluffs caught") });
  const spots = best("spots");
  if (spots) out.push({ icon: "🎯", title: "Bullseye", id: spots[0], detail: plural(spots[1], "perfect spot on", "perfect spot ons") });
  return out;
}

function Final({ view, P, you, accent }: { view: LiarsView; P: Lookup; you: string | null; accent: string }) {
  const order = standings(view);
  const winners = view.winners ?? [];
  const list = awards(view);
  return (
    <section className="card ld-in flex flex-col gap-3 p-3" aria-label="Final standings" style={{ borderColor: `${accent}66` }}>
      <div className="flex items-center justify-between gap-2">
        <span className="label">Final standings</span>
        <span className="text-xs text-muted">
          {plural(view.round, "round", "rounds")} · {plural(view.showdowns, "showdown", "showdowns")}
        </span>
      </div>
      <ol className="flex flex-col gap-1.5">
        {order.map((id, i) => {
          const p = P(id);
          const won = winners.includes(id);
          const n = view.counts[id] ?? 0;
          return (
            <li
              key={id}
              className="flex items-center gap-2 rounded-xl px-2 py-1.5"
              style={{ background: won ? `${p.color}22` : id === you ? "var(--color-panel-2)" : undefined }}
            >
              <span className="w-5 text-right text-sm font-bold text-muted tabular-nums">{i + 1}</span>
              <span aria-hidden className="text-lg leading-none">
                <Avatar id={p.avatar} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-bold" style={{ color: p.color }}>
                {p.name}
                {id === you && <span className="ml-1 text-[10px] font-semibold text-muted uppercase">you</span>}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
                {won && <span aria-hidden>👑</span>}
                {n > 0 ? (
                  <>
                    <span className="flex gap-0.5" aria-hidden>
                      {Array.from({ length: n }, (_, k) => (
                        <Die key={k} value={null} size={12} color={p.color} />
                      ))}
                    </span>
                    <span>{plural(n, "die", "dice")} left</span>
                  </>
                ) : (
                  <span>out in round {view.outRound[id] ?? "?"}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {list.length > 0 && (
        <ul className="grid gap-1.5 border-t border-line pt-3 @md:grid-cols-2" aria-label="Awards">
          {list.map((a) => (
            <li key={a.title} className="flex items-center gap-2 rounded-xl bg-panel-2 px-2.5 py-2">
              <span aria-hidden className="text-xl">
                {a.icon}
              </span>
              <span className="min-w-0 text-xs">
                <span className="block font-bold text-text">{a.title}</span>
                <span className="block truncate text-muted">
                  <span style={{ color: P(a.id).color }}>{P(a.id).name}</span> · {a.detail}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

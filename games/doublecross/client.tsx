"use client";

import { useEffect, useRef, useState } from "react";
import type { GameClientProps } from "@/shared/client-game";
import { Note, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import type { DcAction, DcView } from "./server";
import { ROUNDS, joinNames, type Choice, type RoundRec, type TableView } from "./shared";
import { ChatPanel, mergeMsgs, msgText, useRoundFeed, type Pending } from "./chat";
import { ChoicePad, HeistHeader, ReadyBar, TableHeader, TablesOverview, seatState } from "./table";
import { OUTCOME_META, RevealStage, verdictAt } from "./reveal";
import { Final, Ledger, RoundTrack } from "./ledger";
import { DcStyles, Name, useReached, vars, type Who } from "./ui";
import { feedback } from "@/lib/feedback";

type Props = GameClientProps<DcView, DcAction>;

export default function DoubleCross(props: Props) {
  if (!props.view) return <Note>Shuffling the cards…</Note>;
  return <Game {...props} view={props.view} />;
}

function Game(props: Props & { view: DcView }) {
  const { view, players, byId, isPlayer, accent } = props;
  const who: Who = (seat) => {
    const id = view.order[seat];
    return (
      byId[id] ??
      players.find((p) => p.id === id) ?? { id: id ?? `seat-${seat}`, name: "Someone", color: "#a39dc8", avatar: "🙂", connected: false }
    );
  };
  const mySeat = view.me?.seat ?? -1;
  return (
    <div className="@container mx-auto flex w-full max-w-3xl flex-col gap-3" style={vars({ "--dc-a": accent })}>
      <DcStyles />
      {view.phase === "final" ? (
        <>
          <RoundTrack view={view} myScore={mySeat >= 0 ? view.scores[mySeat] : null} accent={accent} />
          <Final view={view} who={who} mySeat={mySeat} />
        </>
      ) : (
        // A fresh deal every round: chat lines, pending sends and picks reset with it.
        <Round key={view.round} {...props} view={view} who={who} />
      )}
      {!isPlayer && <Note>👀 You&apos;re watching. Table chats stay private; every choice is revealed at the flip.</Note>}
      {/* Keeps the last controls clear of the floating chat button on phones. */}
      <div aria-hidden className="h-16 @3xl:h-2" />
    </div>
  );
}

/** Scores with one round's payouts taken back out (to hold the standings until the verdict lands). */
function without(scores: number[], rec: RoundRec): number[] {
  const out = scores.slice();
  for (const t of rec.tables) t.seats.forEach((s, i) => (out[s] -= t.gain[i]));
  return out;
}

function Round({ view, who, act, onEvent, serverNow, accent }: Props & { view: DcView; who: Who }) {
  const feed = useRoundFeed(onEvent, view.round);
  const [pending, setPending] = useState<Pending[]>([]);
  const [ready, setReady] = useState<boolean | null>(null);
  const nonce = useRef(0);

  const mySeat = view.me?.seat ?? -1;
  const tableIdx = view.me?.table ?? -1;
  const table: TableView | null = tableIdx >= 0 ? (view.tables[tableIdx] ?? null) : null;
  const partners = table ? table.seats.filter((s) => s !== mySeat) : [];
  const msgs = mergeMsgs(view.me?.msgs ?? [], feed.extra);
  const counts = view.chatter.map((c, g) => Math.max(c, feed.counts[g] ?? 0));
  const talk = view.phase === "talk";
  const choose = view.phase === "choose";
  const choice: Choice | null = choose && table ? (feed.choice ?? view.me?.choice ?? null) : null;
  // Flags: the view, overridden by any newer ready/lock events (and our own taps).
  const isReady = (seat: number) => {
    if (seat === mySeat && ready !== null) return ready;
    const e = feed.readyEv[seat];
    return e && e.x > view.rev ? e.v : !!view.ready[seat];
  };
  const isLocked = (seat: number) => {
    if (seat === mySeat && choose && table) return choice !== null;
    const x = feed.lockEv[seat];
    return (x !== undefined && x > view.rev) || !!view.locked[seat];
  };
  const iReady = talk && table ? isReady(mySeat) : false;

  // Hold the board until the verdict lands, so it can't spoil the flip.
  const verdict = useReached(verdictAt(view), serverNow);
  const cur = view.history.find((r) => r.round === view.round) ?? null;
  const hold = view.phase === "reveal" && view.step === 1 && !verdict && !!cur;
  const history = hold ? view.history.filter((r) => r !== cur) : view.history;
  const scores = hold && cur ? without(view.scores, cur) : view.scores;

  const state = (seat: number) => seatState(view.phase, who(seat).connected, isReady(seat), isLocked(seat));
  const seated = view.tables.flatMap((t) => t.seats);
  const waiting = seated.filter((s) => s !== mySeat && who(s).connected && (talk ? !isReady(s) : choose ? !isLocked(s) : false)).length;

  const send = (body: { t: string } | { q: number }) => {
    nonce.current = nonce.current ? nonce.current + 1 : 1 + Math.floor(Math.random() * 1e9);
    const n = nonce.current;
    setPending((p) => [...p, { n, ...body }].slice(-20));
    act({ ...body, type: "say", n } as DcAction);
  };
  const pick = (c: Choice) => {
    if (choice === c) return;
    feed.setChoice(c);
    act({ type: "choose", c });
  };
  const toggleReady = () => {
    const v = !iReady;
    setReady(v);
    act({ type: "ready", v });
  };

  // The partner's last words, shown right above the buttons.
  let partnerLast: { name: string; color: string; text: string } | null = null;
  for (let i = msgs.length - 1; i >= 0 && table; i--) {
    if (msgs[i].s !== mySeat) {
      const p = who(msgs[i].s);
      partnerLast = { name: p.name, color: p.color, text: msgText(msgs[i]) };
      break;
    }
  }

  const outcome = verdict && cur ? (table ? cur.tables[tableIdx]?.out : null) : null;
  const bannerAccent = outcome ? OUTCOME_META[outcome].color : accent;

  // Cues: our "split or steal?" moment, then the verdict at our table (paid, or robbed/bust).
  const myChoice = choose && !!table;
  const myRow = verdict && cur && table ? cur.tables[tableIdx] : undefined;
  const myGain = myRow ? (myRow.gain[myRow.seats.indexOf(mySeat)] ?? 0) : -1;
  const verdictKey = myRow ? view.round : -1;
  useEffect(() => {
    if (myChoice) feedback("turn");
  }, [myChoice]);
  useEffect(() => {
    if (verdictKey < 0) return;
    feedback(myGain > 0 ? "score" : "hit");
  }, [verdictKey, myGain]);
  const nextLabel = view.heist ? "Final standings in" : view.round + 1 === ROUNDS ? "The Heist in" : `Round ${view.round + 1} in`;

  return (
    <>
      <RoundTrack view={view} myScore={mySeat >= 0 ? scores[mySeat] : null} accent={accent} />
      <div aria-live="polite" aria-atomic="true">
        <StatusBanner key={`${view.phase}-${view.step}-${verdict}-${iReady}-${choice !== null}`} accent={bannerAccent}>
          <span className="line-clamp-2 block text-balance">
            <Status view={view} who={who} mySeat={mySeat} tableIdx={tableIdx} table={table} iReady={iReady} choice={choice} verdict={verdict} waiting={waiting} />
          </span>
        </StatusBanner>
      </div>
      {view.phase === "reveal" ? (
        view.step === 1 && <PhaseTimer view={view} serverNow={serverNow} color={view.heist ? "#fbbf24" : accent} label={nextLabel} />
      ) : (
        <PhaseTimer view={view} serverNow={serverNow} color={accent} urgent />
      )}
      {view.awayEndsAt !== null && <AwayNote endsAt={view.awayEndsAt} serverNow={serverNow} />}

      <div key={`${view.phase}-${view.step}`} className="dc-in flex flex-col gap-3">
        {view.phase === "reveal" ? (
          <RevealStage view={view} who={who} mySeat={mySeat} tableIdx={tableIdx} msgs={msgs} serverNow={serverNow} />
        ) : table ? (
          <>
            {view.heist ? (
              <HeistHeader who={who} mySeat={mySeat} table={table} state={state} />
            ) : (
              <TableHeader view={view} who={who} mySeat={mySeat} table={table} state={state} />
            )}
            {choose && <ChoicePad choice={choice} onPick={pick} partnerLast={partnerLast} />}
            <ChatPanel
              msgs={msgs}
              pending={pending}
              refused={feed.refused}
              mySeat={mySeat}
              who={who}
              heist={view.heist}
              open={talk}
              others={partners}
              onSend={send}
            />
            {talk && <ReadyBar ready={iReady} onToggle={toggleReady} waiting={waiting} />}
            {!view.heist && (
              <TablesOverview view={view} who={who} counts={counts} skip={tableIdx} mySeat={mySeat} state={state} title="Other tables" />
            )}
          </>
        ) : (
          <>
            {mySeat >= 0 && (
              <p role="status" className="card px-3 py-2 text-center text-sm">
                ⏸ You were away when this round was dealt, so you&apos;re sitting it out. You&apos;ll be dealt back in next round.
              </p>
            )}
            {view.heist && view.tables[0] ? (
              <HeistHeader who={who} mySeat={mySeat} table={view.tables[0]} state={state} />
            ) : (
              <TablesOverview view={view} who={who} counts={counts} skip={-1} mySeat={mySeat} state={state} title="Tables" />
            )}
          </>
        )}
      </div>

      <Ledger
        view={view}
        history={history}
        scores={scores}
        who={who}
        mySeat={mySeat}
        partners={view.heist || partners.length >= view.order.length - 1 ? [] : partners}
        fresh={verdict && cur ? cur.round : undefined}
      />
    </>
  );
}

function Status({
  view,
  who,
  mySeat,
  tableIdx,
  table,
  iReady,
  choice,
  verdict,
  waiting,
}: {
  view: DcView;
  who: Who;
  mySeat: number;
  tableIdx: number;
  table: TableView | null;
  iReady: boolean;
  choice: Choice | null;
  verdict: boolean;
  waiting: number;
}) {
  const partners = table ? table.seats.filter((s) => s !== mySeat) : [];
  if ((view.phase === "talk" || view.phase === "choose") && !table && mySeat >= 0) return <>⏸ Sitting this round out</>;
  if (view.phase === "talk") {
    if (!table) return view.heist ? <>💰 The crew is plotting…</> : <>🤫 Deals in progress…</>;
    if (iReady) return waiting > 0 ? <>✓ Done talking · waiting on {waiting}</> : <>✓ Done talking</>;
    if (view.heist) return <>💰 Plot the heist together</>;
    if (partners.length === 1) {
      return (
        <>
          💬 Make a deal with <Name p={who(partners[0])} />
        </>
      );
    }
    return <>💬 Make a three-way deal</>;
  }
  if (view.phase === "choose") {
    if (!table) return <>🤫 Choosing in secret…</>;
    if (!choice) return <>🤫 Split or steal?</>;
    return waiting > 0 ? <>🔒 Locked in · waiting on {waiting}</> : <>🔒 Locked in · flipping…</>;
  }
  const cur = view.history.find((r) => r.round === view.round);
  if (view.step === 0 || !verdict || !cur) {
    return (
      <>
        <span className="dc-drum" aria-hidden>
          🥁
        </span>{" "}
        {view.heist ? "The vault opens…" : "Flipping the cards…"}
      </>
    );
  }
  const t = table ? cur.tables[tableIdx] : null;
  if (!t) {
    const n = (o: string) => cur.tables.filter((x) => x.out === o).length;
    if (cur.tables.length === 1) {
      // One table (the heist, or a 3-player trio): tell its story.
      const h = cur.tables[0];
      if (h.out === "deal") return view.heist ? <>🤝 Honour among thieves! {h.gain[0]} each</> : <>🤝 Deal! Everyone split</>;
      if (h.out === "steal") {
        const thief = h.seats[h.c.indexOf("steal")];
        return (
          <>
            🗡️ <Name p={who(thief)} /> {view.heist ? "robbed the crew" : "stole the pot"}! +{h.pot}
          </>
        );
      }
      return view.heist ? <>💥 Bust! The vault stays shut</> : <>💥 Bust! {h.c.filter((c) => c === "steal").length} thieves</>;
    }
    const bits = [
      n("deal") && `🤝 ${n("deal")} deal${n("deal") > 1 ? "s" : ""}`,
      n("steal") && `🗡️ ${n("steal")} stolen`,
      n("bust") && `💥 ${n("bust")} bust${n("bust") > 1 ? "s" : ""}`,
    ].filter(Boolean);
    return <>{bits.join(" · ")}</>;
  }
  const i = t.seats.indexOf(mySeat);
  const others = t.seats.filter((s) => s !== mySeat);
  const thieves = t.seats.filter((_, k) => t.c[k] === "steal");
  if (t.out === "deal") {
    if (view.heist) return <>🤝 Honour among thieves! +{t.gain[i]} each</>;
    return <>🤝 Deal! {others.length === 1 ? "You both" : "Everyone"} split · +{t.gain[i]}</>;
  }
  if (t.out === "steal") {
    if (thieves[0] === mySeat) {
      return view.heist ? <>🗡️ You pulled off the heist! +{t.pot}</> : <>🗡️ You <span className="whitespace-nowrap">double-crossed</span> {joinNames(others.map((s) => who(s).name))}! +{t.pot}</>;
    }
    return (
      <>
        💔 <Name p={who(thieves[0])} /> {view.heist ? "robbed the crew" : <span className="whitespace-nowrap">double-crossed you</span>}!
      </>
    );
  }
  if (others.length === 1) return <>💥 Bust! You both stole</>;
  return <>💥 Bust! {thieves.length} thieves, 0 each</>;
}

function PhaseTimer({
  view,
  serverNow,
  color,
  label,
  urgent,
}: {
  view: DcView;
  serverNow: () => number;
  color: string;
  label?: string;
  urgent?: boolean;
}) {
  const secs = useSecondsLeft(view.endsAt, serverNow);
  const low = !!urgent && secs <= 5;
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      {label && <span className="shrink-0">{label}</span>}
      <div className="flex-1">
        <TimerBar endsAt={view.endsAt} total={view.phaseMs} serverNow={serverNow} color={low ? "#f87171" : color} />
      </div>
      <span className={`w-8 text-right font-mono font-bold tabular-nums ${low ? "text-red-400" : ""}`} aria-label={`${secs} seconds left`}>
        {secs}s
      </span>
    </div>
  );
}

function AwayNote({ endsAt, serverNow }: { endsAt: number; serverNow: () => number }) {
  const secs = useSecondsLeft(endsAt, serverNow);
  return (
    <p role="status" className="card animate-rise border-amber-400/50 px-3 py-2 text-center text-sm">
      📡 Too few players online. The game ends in <b className="tabular-nums">{secs}s</b> unless someone returns.
    </p>
  );
}

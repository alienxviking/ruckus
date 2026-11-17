"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { Note, PlayerChip, StatusBanner, useSecondsLeft } from "@/components/game-ui";
import type { Flight, PotatoAction, PotatoView, StatLine } from "./server";
import { Arena, CSS, type Floater, type SeatInfo } from "./arena";
import { NopeCard, PuzzleCard } from "./puzzle";
import { FLIGHT_MS, HECKLES, checkAnswer } from "./shared";
import { Avatar } from "@/components/Avatar";
import { feedback, sfx } from "@/lib/feedback";

type Props = GameClientProps<PotatoView, PotatoAction>;

/** Seat taps are ignored this soon after arming, so a double-tap on an answer can't throw by accident. */
const GUARD_MS = 180;
/** An unconfirmed throw snaps back after this long (the server said no). */
const THROW_TIMEOUT_MS = 1500;
const HOT = "#fb923c";
const KEY_DIR: Record<string, number> = {
  ArrowUp: 0,
  w: 0,
  W: 0,
  ArrowRight: 1,
  d: 1,
  D: 1,
  ArrowDown: 2,
  s: 2,
  S: 2,
  ArrowLeft: 3,
  a: 3,
  A: 3,
};
const THROW_KEYS = "1234567890";

/** The simulator renders several players on one page: keys go to whoever touched their screen last. */
let kbOwner: string | null = null;

const ghost = (id: string): Player => ({ id, name: "Player", color: "#94a3b8", avatar: "🙂", connected: false });

function isTyping(t: EventTarget | null) {
  return (
    t instanceof HTMLElement &&
    (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")
  );
}

function isHeckle(e: unknown): e is { k: "h"; f: string; e: number } {
  if (!e || typeof e !== "object") return false;
  const x = e as Record<string, unknown>;
  return x.k === "h" && typeof x.f === "string" && typeof x.e === "number";
}

/** True once server time reaches `at` (re-renders exactly then). */
function useReached(at: number | null, serverNow: () => number) {
  const [reached, setReached] = useState<number | null>(null);
  useEffect(() => {
    if (at === null) return;
    const id = setTimeout(() => setReached(at), Math.max(0, at - serverNow()));
    return () => clearTimeout(id);
  }, [at, serverNow]);
  return at !== null && reached === at;
}

export default function HotPotato(props: Props) {
  if (!props.view) return <Note>🥔 Heating up the potato…</Note>;
  return <Game {...props} view={props.view} />;
}

function Game({ view, me, byId, isPlayer, act, serverNow, onEvent, accent }: Props & { view: PotatoView }) {
  // Local, optimistic bits: my last answer, arrow progress, and a throw the server hasn't echoed yet.
  const [ans, setAns] = useState<{ n: number; ok: boolean } | null>(null);
  const [prog, setProg] = useState<{ n: number; seq: number[] } | null>(null);
  const [thr, setThr] = useState<{ round: number; pass: number; to: string; at: number } | null>(null);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const armedAt = useRef(0);
  const heckleTimes = useRef<number[]>([]);
  const floaterSeq = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const rootRef = useRef<HTMLDivElement>(null);

  const seats: SeatInfo[] = view.seats.map((s) => ({ id: s.id, player: byId[s.id] ?? ghost(s.id), lives: s.lives, out: s.out }));
  const mine = view.seats.find((s) => s.id === me) ?? null;
  const alive = !!mine && !mine.out;
  const live = view.phase === "live";
  const iHold = live && view.holder === me;
  const held = iHold ? view.held : null;
  const open = useReached(held?.openAt ?? null, serverNow);
  const localOk = !!held && ans?.n === held.n && ans.ok;
  const localBad = !!held && ans?.n === held.n && !ans.ok;
  const armed = iHold && (view.armed || localOk);
  const pending = thr && iHold && thr.round === view.round && (view.flight?.pass ?? 0) < thr.pass ? thr : null;
  const flight: Flight | null = pending
    ? { from: me, to: pending.to, at: pending.at, lands: pending.at + FLIGHT_MS, pass: pending.pass }
    : live
      ? view.flight
      : null;
  const potatoAt = view.phase === "ready" ? view.holder : live ? (flight ? flight.to : view.holder) : null;
  const incoming = iHold && !!held && !!view.flight && view.flight.to === me && held.openAt === view.flight.lands && !open;
  const canSolve = !!held && open && !armed && !localBad && !pending;
  const canThrow = armed && !pending;

  // Who I can throw to, and number keys for them in ring order (clockwise from me).
  const aliveCount = view.seats.filter((s) => !s.out).length;
  const targets = new Set<string>();
  if (canThrow) {
    for (const s of view.seats) {
      if (!s.out && s.id !== me && (s.id !== view.lastFrom || aliveCount <= 2)) targets.add(s.id);
    }
  }
  const myIdx = Math.max(0, view.seats.findIndex((s) => s.id === me));
  const hintOrder: string[] = [];
  for (let k = 1; k < view.seats.length; k++) {
    const s = view.seats[(myIdx + k) % view.seats.length];
    if (targets.has(s.id)) hintOrder.push(s.id);
  }
  const keyHints: Record<string, string> = {};
  hintOrder.slice(0, THROW_KEYS.length).forEach((id, i) => (keyHints[id] = THROW_KEYS[i]));

  // An unconfirmed throw gives up after a while (the potato snaps back).
  useEffect(() => {
    if (!thr) return;
    const id = setTimeout(() => setThr((t) => (t === thr ? null : t)), THROW_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [thr]);

  // Getting the potato: once per catch, not per render.
  useEffect(() => {
    if (iHold) feedback("turn");
  }, [iHold]);
  // Round start and explosions.
  const boomKey = view.phase === "boom" && view.boom ? `${view.round}:${view.boom.at}` : null;
  const onCue = useEffectEvent((what: "go" | "boom") => {
    if (what === "go") return sfx("go");
    const b = view.boom;
    if (!b) return;
    if (b.victim === me) feedback(b.out ? "out" : "hit");
    else sfx(b.out ? "out" : "hit");
  });
  useEffect(() => {
    if (live) onCue("go");
  }, [live, view.round]);
  useEffect(() => {
    if (boomKey) onCue("boom");
  }, [boomKey]);

  const grade = (n: number, ok: boolean, a: number | number[]) => {
    setAns({ n, ok });
    feedback(ok ? "score" : "error");
    if (ok) armedAt.current = performance.now();
    act({ type: "solve", n, a });
  };
  const answer = (a: number) => {
    if (!held || !canSolve) return;
    const v = checkAnswer(held.pz, a);
    if (v !== null) grade(held.n, v, a);
  };
  const arrow = (d: number) => {
    if (!held || !canSolve || held.pz.t !== "arrows") return;
    const next = [...(prog?.n === held.n ? prog.seq : []), d];
    setProg({ n: held.n, seq: next });
    const v = checkAnswer(held.pz, next);
    if (v !== null) grade(held.n, v, next);
  };
  const throwTo = (to: string) => {
    if (!canThrow || !targets.has(to)) return;
    if (performance.now() - armedAt.current < GUARD_MS) return;
    setThr({ round: view.round, pass: view.passes + 1, to, at: serverNow() });
    sfx("pop");
    act({ type: "throw", to });
  };

  const addFloater = useCallback((from: string, e: number) => {
    const emoji = HECKLES[e];
    if (!emoji) return;
    const id = ++floaterSeq.current;
    setFloaters((f) => [...f.slice(-11), { id, from, e: emoji, rx: Math.random(), fx: (Math.random() - 0.5) * 60 }]);
    const tid = setTimeout(() => {
      timers.current.delete(tid);
      setFloaters((f) => f.filter((x) => x.id !== id));
    }, 1800);
    timers.current.add(tid);
  }, []);
  useEffect(() => {
    const set = timers.current;
    return () => {
      for (const t of set) clearTimeout(t);
      set.clear();
    };
  }, []);
  useEffect(() => onEvent((e) => isHeckle(e) && addFloater(e.f, e.e)), [onEvent, addFloater]);

  const canHeckle = view.phase !== "over" && (isPlayer ? !!mine && mine.out : true);
  const heckle = (i: number) => {
    // Mirror the server's limit so a local heckle is never one nobody else sees.
    const t = performance.now();
    const recent = heckleTimes.current.filter((x) => t - x < 3000);
    if (recent.length >= 4 || (recent.length && t - recent[recent.length - 1] < 300)) return;
    heckleTimes.current = [...recent, t];
    act({ type: "heckle", e: i });
    addFloater(me, i);
  };

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTyping(e.target)) return;
    if (kbOwner !== null && kbOwner !== me) return;
    if (canSolve && held) {
      if (held.pz.t === "arrows") {
        const d = KEY_DIR[e.key];
        if (d === undefined) return;
        e.preventDefault();
        arrow(d);
        return;
      }
      const i = "123456789".indexOf(e.key);
      if (i >= 0 && i < (held.pz.t === "odd" ? 9 : 3)) {
        e.preventDefault();
        answer(i);
      }
      return;
    }
    if (canThrow) {
      const id = hintOrder[THROW_KEYS.indexOf(e.key)];
      if (THROW_KEYS.includes(e.key) && id) {
        e.preventDefault();
        throwTo(id);
      }
    }
  });
  useEffect(() => {
    const kd = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", kd);
    return () => window.removeEventListener("keydown", kd);
  }, []);
  // Touching (or focusing) anything in my screen claims the keyboard. In the simulator that's my whole frame.
  useEffect(() => {
    const claim = (e: Event) => {
      const root = rootRef.current;
      const scope = root?.closest("[data-viewer]") ?? root;
      if (scope && e.target instanceof Node && scope.contains(e.target)) kbOwner = me;
    };
    window.addEventListener("pointerdown", claim, true);
    window.addEventListener("focusin", claim, true);
    return () => {
      window.removeEventListener("pointerdown", claim, true);
      window.removeEventListener("focusin", claim, true);
    };
  }, [me]);

  const name = (id: string | null) => (id ? (byId[id] ?? ghost(id)) : null);
  const holder = name(view.holder);

  // ----- centre of the ring -----
  let center: ReactNode = null;
  let focus = false;
  if (view.phase === "ready") {
    center = <ReadyPill view={view} me={me} holder={holder} serverNow={serverNow} />;
  } else if (view.phase === "boom" && view.boom) {
    center = <BoomPill view={view} me={me} byId={byId} />;
  } else if (view.phase === "over") {
    center = <OverPill view={view} me={me} byId={byId} />;
  } else if (live && iHold) {
    if (pending) {
      const to = name(pending.to)!;
      center = (
        <Pill key="yeet">
          <span className="font-display text-2xl font-black" style={{ color: HOT }}>
            Yeet! 🥔
          </span>
          <span className="block truncate text-sm font-bold" style={{ color: to.color }}>
            → {to.name}
          </span>
        </Pill>
      );
    } else if (incoming) {
      center = (
        <Pill key="incoming" hot>
          <span className="pot-bob block font-display text-2xl font-black" style={{ color: HOT }}>
            😱 Incoming!
          </span>
        </Pill>
      );
    } else if (armed) {
      center = (
        <Pill key="armed" hot>
          <span className="block font-display text-2xl font-black" style={{ color: HOT }}>
            🎯 Throw it!
          </span>
          <span className="block text-xs font-semibold text-muted">Tap a player{aliveCount > 2 && view.lastFrom ? " (no throwbacks)" : ""}</span>
        </Pill>
      );
    } else if (held && (localBad || !open)) {
      center = <NopeCard k={ans && !ans.ok ? ans.n : held.n} />;
    } else if (held && open) {
      focus = true;
      center = (
        <PuzzleCard
          pz={held.pz}
          n={held.n}
          progress={prog?.n === held.n ? prog.seq : []}
          onAnswer={answer}
          onArrow={arrow}
        />
      );
    }
  } else if (live && holder) {
    center = <WatchPill view={view} holder={holder} byId={byId} serverNow={serverNow} />;
  }

  return (
    <div ref={rootRef} className="@container mx-auto flex w-full max-w-[46rem] flex-col gap-3 pb-16 sm:pb-2">
      <style href="ruckus-potato" precedence="default">
        {CSS}
      </style>

      <div aria-live="polite" aria-atomic="true">
        <StatusBanner key={bannerKey(view, iHold, armed, !!pending)} accent={bannerAccent(view, byId, accent)}>
          <span className="block truncate">
            <Status view={view} me={me} byId={byId} iHold={iHold} armed={armed} pending={!!pending} incoming={incoming} nope={!!held && (localBad || !open)} alive={alive} isPlayer={isPlayer} />
          </span>
        </StatusBanner>
      </div>

      <Arena
        view={view}
        seats={seats}
        me={me}
        maxLives={view.maxLives}
        potatoAt={potatoAt}
        flight={flight}
        targets={targets}
        keyHints={keyHints}
        focus={focus}
        accent={HOT}
        serverNow={serverNow}
        floaters={floaters}
        byId={byId}
        onThrow={throwTo}
        center={center}
      />

      {view.awayEndsAt !== null && view.phase !== "over" && <AwayNote endsAt={view.awayEndsAt} serverNow={serverNow} />}

      {canHeckle && <HeckleBar onHeckle={heckle} />}

      {view.phase === "over" ? (
        <Standings view={view} byId={byId} me={me} />
      ) : !isPlayer ? (
        <Note>👀 You&apos;re watching. Heckle the players with the buttons above!</Note>
      ) : !alive ? (
        <Note>☠️ You&apos;re out, but not done: heckle the survivors!</Note>
      ) : (
        <p className="hidden text-center text-xs text-muted @lg:block">
          Keys: <b>1–9</b> answer, <b>arrows/WASD</b> for arrow puzzles, then <b>1–9</b> throws to the numbered players.
        </p>
      )}
    </div>
  );
}

// ---------- status line ----------

function bannerKey(view: PotatoView, iHold: boolean, armed: boolean, pending: boolean) {
  return `${view.phase}-${view.round}-${view.holder}-${iHold ? 1 : 0}${armed ? 1 : 0}${pending ? 1 : 0}`;
}

function bannerAccent(view: PotatoView, byId: Record<string, Player>, accent: string) {
  if (view.phase === "boom") return "#ef4444";
  if (view.phase === "over" && view.winner) return byId[view.winner]?.color ?? accent;
  return accent;
}

function Who({ p }: { p: Player | null }) {
  if (!p) return <>someone</>;
  return (
    <>
      <span aria-hidden><Avatar id={p.avatar} /> </span>
      <span style={{ color: p.color }}>{p.name}</span>
    </>
  );
}

function Status({
  view,
  me,
  byId,
  iHold,
  armed,
  pending,
  incoming,
  nope,
  alive,
  isPlayer,
}: {
  view: PotatoView;
  me: string;
  byId: Record<string, Player>;
  iHold: boolean;
  armed: boolean;
  pending: boolean;
  incoming: boolean;
  nope: boolean;
  alive: boolean;
  isPlayer: boolean;
}) {
  const p = (id: string | null) => (id ? (byId[id] ?? ghost(id)) : null);
  if (view.phase === "over") {
    if (!view.winner) return <>Game over</>;
    return view.winner === me ? <>🏆 You survived!</> : <>🏆 <Who p={p(view.winner)} /> survives!</>;
  }
  if (view.phase === "boom" && view.boom) {
    const b = view.boom;
    const victim = b.victim === me ? <>You</> : <Who p={p(b.victim)} />;
    if (b.out) return <>☠️ {victim} {b.victim === me ? "are" : "is"} out!</>;
    if (b.midair) return <>💥 Mid-air! {victim} lost a life</>;
    return <>💥 BOOM! {victim} lost a life</>;
  }
  if (view.phase === "ready") {
    return view.holder === me ? <>🥔 You start with the potato!</> : <>🥔 <Who p={p(view.holder)} /> starts with it</>;
  }
  if (iHold) {
    if (pending) return <>🥔 Yeet!</>;
    if (incoming) return <>😱 Incoming! Get ready…</>;
    if (armed) return <>🎯 Throw it! Tap a player</>;
    if (nope) return <>❌ Wrong! New puzzle…</>;
    return <>🔥 Solve it to throw!</>;
  }
  if (isPlayer && !alive) return <>☠️ You&apos;re out. Heckle away!</>;
  return <>🥔 <Who p={p(view.holder)} /> has the potato</>;
}

// ---------- centre pills ----------

function Pill({ children, hot, late }: { children: ReactNode; hot?: boolean; late?: boolean }) {
  return (
    <div
      className={`pot-in ${late ? "pot-late" : ""} pointer-events-auto max-w-[15rem] rounded-2xl border px-4 py-2.5 text-center shadow-xl`}
      style={{
        borderColor: hot ? HOT : "var(--color-line)",
        background: "color-mix(in oklab, var(--color-panel) 92%, transparent)",
        boxShadow: hot ? `0 0 0 3px ${HOT}26, 0 12px 30px -10px #000a` : "0 12px 30px -10px #000a",
      }}
    >
      {children}
    </div>
  );
}

function ReadyPill({ view, me, holder, serverNow }: { view: PotatoView; me: string; holder: Player | null; serverNow: () => number }) {
  const secs = useSecondsLeft(view.endsAt, serverNow);
  const mine = view.holder === me;
  useEffect(() => {
    if (secs > 0 && secs <= 3) sfx("tick");
  }, [secs]);
  return (
    <Pill key={`ready-${view.round}`} hot={mine}>
      <span className="label block">Round {view.round}</span>
      <span className="block truncate font-display text-xl font-black">
        🥔 → {mine ? <span style={{ color: HOT }}>YOU!</span> : holder ? <span style={{ color: holder.color }}>{holder.name}</span> : "…"}
      </span>
      {view.round === 1 && <span className="mt-1 block text-xs leading-snug text-muted">Solve it, throw it, don&apos;t get caught holding it 💥</span>}
      <span key={secs} aria-hidden className="pot-in mt-1 block font-display text-2xl font-black tabular-nums" style={{ color: HOT }}>
        {secs > 0 ? secs : "Go!"}
      </span>
    </Pill>
  );
}

function WatchPill({
  view,
  holder,
  byId,
  serverNow,
}: {
  view: PotatoView;
  holder: Player;
  byId: Record<string, Player>;
  serverNow: () => number;
}) {
  const auto = useSecondsLeft(view.autoAt, serverNow);
  const landed = useReached(view.flight?.lands ?? null, serverNow);
  const from = view.flight ? byId[view.flight.from] : null;
  const flying = !!view.flight && !landed;
  return (
    <Pill key={`watch-${view.passes}`}>
      <span className="label block">{view.passes === 0 ? "Fresh potato" : `Pass ${view.passes}`}</span>
      <span className="block truncate text-lg font-black">
        <span aria-hidden><Avatar id={holder.avatar} /> </span>
        <span style={{ color: holder.color }}>{holder.name}</span>
      </span>
      <span className="block truncate text-xs font-semibold text-muted">
        {flying && from ? (
          <>incoming from {from.name}!</>
        ) : view.autoAt !== null ? (
          <>📡 offline · auto-throw in {auto}s</>
        ) : view.armed ? (
          <>🎯 is aiming…</>
        ) : from && view.passes > 0 ? (
          <>caught it from {from.name} · solving</>
        ) : (
          <>🧩 solving…</>
        )}
      </span>
    </Pill>
  );
}

function BoomPill({ view, me, byId }: { view: PotatoView; me: string; byId: Record<string, Player> }) {
  const b = view.boom!;
  const v = byId[b.victim] ?? ghost(b.victim);
  const you = b.victim === me;
  return (
    <Pill key={`boom-${b.at}`} hot late>
      <span className="pot-boom block font-display text-4xl leading-none font-black tracking-tight" style={{ color: "#f97316", textShadow: "0 0 24px #f9731688" }}>
        BOOM!
      </span>
      <span className="mt-1 block truncate text-sm font-bold">
        {b.midair && <>In mid-air! </>}
        <span style={{ color: v.color }}>{you ? "You" : v.name}</span> {b.out ? (you ? "are OUT ☠️" : "is OUT ☠️") : `lose${you ? "" : "s"} a life`}
      </span>
      {b.midair && b.to && <span className="block truncate text-xs text-muted">The thrower pays, {(byId[b.to] ?? ghost(b.to)).name} escapes!</span>}
      <span className="mt-0.5 block text-xs text-muted tabular-nums">
        Fuse was {(b.fuseMs / 1000).toFixed(1)}s · {b.passes} {b.passes === 1 ? "pass" : "passes"}
      </span>
    </Pill>
  );
}

function OverPill({ view, me, byId }: { view: PotatoView; me: string; byId: Record<string, Player> }) {
  const w = view.winner ? (byId[view.winner] ?? ghost(view.winner)) : null;
  return (
    <Pill key="over" hot>
      <span className="label block">Last one standing</span>
      {w ? (
        <span className="block truncate font-display text-xl font-black">
          <span aria-hidden>👑 </span>
          <span style={{ color: w.color }}>{w.id === me ? "You!" : w.name}</span>
        </span>
      ) : (
        <span className="block font-display text-xl font-black">Nobody 🤷</span>
      )}
    </Pill>
  );
}

// ---------- below the ring ----------

function AwayNote({ endsAt, serverNow }: { endsAt: number; serverNow: () => number }) {
  const secs = useSecondsLeft(endsAt, serverNow);
  return (
    <p role="status" className="card animate-rise border-amber-400/50 px-3 py-2 text-center text-sm">
      📡 Only one survivor is still connected. The game ends in <b className="tabular-nums">{secs}s</b> unless someone comes back.
    </p>
  );
}

function HeckleBar({ onHeckle }: { onHeckle: (i: number) => void }) {
  return (
    <div className="card flex flex-wrap items-center justify-center gap-1.5 p-2" role="group" aria-label="Heckle">
      <span className="label mr-1 hidden @sm:inline">Heckle</span>
      {HECKLES.map((e, i) => (
        <button
          key={e}
          type="button"
          aria-label={`Heckle ${e}`}
          onClick={() => onHeckle(i)}
          className="grid size-10 touch-manipulation place-items-center rounded-xl border border-line bg-panel-2 text-2xl leading-none transition-transform duration-75 hover:border-white/30 active:scale-90"
        >
          {e}
        </button>
      ))}
    </div>
  );
}

const MEDALS = ["🥇", "🥈", "🥉"];

function Standings({ view, byId, me }: { view: PotatoView; byId: Record<string, Player>; me: string }) {
  const stats = view.stats ?? [];
  const st = new Map(stats.map((s) => [s.id, s]));
  const order: string[] = [];
  if (view.winner) order.push(view.winner);
  // (If the game was abandoned, survivors rank above the knocked out.)
  for (const s of [...stats].filter((x) => x.lives > 0 && x.id !== view.winner).sort((a, b) => b.lives - a.lives)) order.push(s.id);
  for (const id of [...view.outOrder].reverse()) if (!order.includes(id)) order.push(id);
  const awards = pickAwards(stats, byId);

  return (
    <section className="card animate-rise flex flex-col gap-3 p-3" aria-label="Final standings">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label">Final standings</span>
        <span className="text-xs text-muted">🥔 throws · ❌ wrong · ⚡ fastest solve</span>
      </div>
      <ol className="flex flex-col gap-1.5">
        {order.map((id, i) => {
          const s = st.get(id);
          const p = byId[id] ?? ghost(id);
          if (!s) return null;
          return (
            <li
              key={id}
              className="flex items-center gap-2 rounded-xl px-1.5 py-1.5"
              style={{ background: id === me ? "var(--color-panel-2)" : undefined }}
            >
              <span className="w-6 shrink-0 text-center text-sm tabular-nums" aria-label={`Rank ${i + 1}`}>
                {MEDALS[i] ?? <span className="text-xs text-muted">{i + 1}</span>}
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="min-w-0 shrink overflow-hidden">
                  <PlayerChip player={p} size="sm" dim={!p.connected} />
                </span>
                <span className="shrink-0 text-xs whitespace-nowrap text-muted">
                  {s.lives > 0 ? (
                    <span aria-label={`${s.lives} ${s.lives === 1 ? "life" : "lives"} left`}>{"❤️".repeat(s.lives)}</span>
                  ) : (
                    <span title={`Out in round ${s.outRound}`} aria-label={`out in round ${s.outRound}`}>
                      ☠️ R{s.outRound}
                    </span>
                  )}
                </span>
              </span>
              <span className="flex shrink-0 gap-2 text-xs text-muted tabular-nums">
                <span title="Throws">🥔 {s.throws}</span>
                <span title="Wrong answers">❌ {s.wrong}</span>
                <span title="Fastest solve">⚡ {s.best === null ? "–" : `${(s.best / 1000).toFixed(1)}s`}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {awards.length > 0 && (
        <ul className="flex flex-wrap justify-center gap-2 border-t border-line pt-3">
          {awards.map((a) => (
            <li key={a.title} className="rounded-xl border border-line bg-panel-2 px-2.5 py-1.5 text-center text-xs">
              <span className="block font-bold">
                <span aria-hidden>{a.icon} </span>
                {a.title}
              </span>
              <span className="block text-muted">
                <span style={{ color: a.who.color }}>{a.who.name}</span> · {a.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function pickAwards(stats: StatLine[], byId: Record<string, Player>) {
  const out: { icon: string; title: string; who: Player; detail: string }[] = [];
  const who = (id: string) => byId[id] ?? ghost(id);
  const most = (f: (s: StatLine) => number) => stats.reduce<StatLine | null>((b, s) => (!b || f(s) > f(b) ? s : b), null);
  const hot = most((s) => s.throws);
  if (hot && hot.throws > 0) out.push({ icon: "🔥", title: "Hot hands", who: who(hot.id), detail: `${hot.throws} throw${hot.throws === 1 ? "" : "s"}` });
  const quick = stats.filter((s) => s.best !== null).sort((a, b) => a.best! - b.best!)[0];
  if (quick) out.push({ icon: "⚡", title: "Quick draw", who: who(quick.id), detail: `${(quick.best! / 1000).toFixed(1)}s solve` });
  const butter = most((s) => s.wrong);
  if (butter && butter.wrong > 0) out.push({ icon: "🧈", title: "Butterfingers", who: who(butter.id), detail: `${butter.wrong} wrong` });
  return out;
}

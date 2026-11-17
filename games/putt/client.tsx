"use client";

import {
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { GameClientProps } from "@/shared/client-game";
import { PLAYER_COLORS, type Player } from "@/shared/types";
import { Note, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import type { BallView, PuttAction, PuttEvent, PuttView } from "./server";
import { HOLE_BY_ID, HOLES } from "./holes";
import { MAX_POWER, MAX_STROKES, PICKUP_SCORE, clamp, scoreName, type Hole } from "./shared";
import { buildReplay, strokesAt, sunkBy, type Replay } from "./replay";
import { Course, courseMaxWidth } from "./course";
import { Avatar } from "@/components/Avatar";
import { feedback, sfx } from "@/lib/feedback";

type Props = GameClientProps<PuttView, PuttAction>;

const CSS = `
.putt-in { animation: putt-in .32s cubic-bezier(.2,.8,.2,1) both; }
@keyframes putt-in { from { opacity: 0; transform: translateY(6px) scale(.98); } }
.putt-pop { animation: putt-pop .45s cubic-bezier(.2,1.5,.4,1) both; }
@keyframes putt-pop { from { opacity: 0; transform: scale(.6); } }
.putt-hurry { animation: putt-hurry .9s ease-in-out infinite; }
@keyframes putt-hurry { 0%, 100% { box-shadow: 0 0 0 0 rgba(134,239,172,0); } 50% { box-shadow: 0 0 0 5px rgba(134,239,172,.4); } }
.putt-dot { display: inline-block; animation: putt-dot 1.2s ease-in-out infinite; }
@keyframes putt-dot { 0%, 70%, 100% { opacity: .25; } 35% { opacity: 1; } }
.putt-intro { animation: putt-intro 3.4s cubic-bezier(.2,.8,.2,1) both; }
@keyframes putt-intro {
  0% { opacity: 0; transform: translateY(10px) scale(.9); }
  10% { opacity: 1; transform: none; }
  78% { opacity: 1; transform: none; }
  100% { opacity: 0; transform: translateY(-8px) scale(.97); }
}
.putt-range { height: 2.5rem; width: 100%; cursor: pointer; }
@media (prefers-reduced-motion: reduce) {
  .putt-in, .putt-pop, .putt-hurry, .putt-dot { animation: none; }
  .putt-intro { animation: putt-fade 3.4s linear both; }
  @keyframes putt-fade { 0%, 85% { opacity: 1; } 100% { opacity: 0; } }
}
`;

const PALETTE = PLAYER_COLORS.map((c) => c.toLowerCase());

/** Each ball wears its player's colour, unless an earlier ball already wears it. */
function assignColors(key: string): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const row of key.split("\n")) {
    if (!row) continue;
    const [id, raw = ""] = row.split("\t");
    let c = /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : "";
    if (!c || used.has(c)) c = PALETTE.find((p) => !used.has(p)) ?? "#94a3b8";
    used.add(c);
    out[id] = c;
  }
  return out;
}

function subscribeReducedMotion(cb: () => void) {
  const m = window.matchMedia("(prefers-reduced-motion: reduce)");
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/** Ms since `at` on the server clock, refreshed a few times a second (0 while `at` is null). */
function useElapsed(at: number | null, serverNow: () => number) {
  const [state, setState] = useState<{ at: number | null; e: number }>({ at: null, e: 0 });
  const now = useEffectEvent(() => serverNow());
  useEffect(() => {
    if (at === null) return;
    const tick = () => setState({ at, e: now() - at });
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 200);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [at]);
  return state.at === at ? state.e : 0;
}

function isTyping(t: EventTarget | null) {
  return (
    t instanceof HTMLElement &&
    (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")
  );
}

function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const holeAt = (view: PuttView, i: number): Hole => HOLE_BY_ID[view.course[i]] ?? HOLES[0];
const parThrough = (view: PuttView, n: number) => sum(view.course.slice(0, n).map((id) => HOLE_BY_ID[id]?.par ?? 3));
const toPar = (d: number) => (d === 0 ? "E" : d > 0 ? `+${d}` : `${d}`);
const wrap = (a: number) => ((Math.round(a) % 3600) + 3600) % 3600;

/** Angle (tenths of a degree) from (x, y) to (tx, ty). */
const angleTo = (x: number, y: number, tx: number, ty: number) => wrap((Math.atan2(ty - y, tx - x) * 1800) / Math.PI);

export default function Putt(props: Props) {
  const v = props.view;
  // Also guards against a stale view from another game arriving before ours.
  if (!v || !Array.isArray(v.balls) || !Array.isArray(v.course)) return <Note>Raking the bunkers…</Note>;
  return <Game {...props} view={v} />;
}

function Game({ view: raw, me, players, byId, isPlayer, act, serverNow, onEvent, accent }: Omit<Props, "view"> & { view: PuttView }) {
  const reduced = useReducedMotion();
  const colorKey = players.map((p) => `${p.id}\t${p.color}`).join("\n");
  const colors = useMemo(() => assignColors(colorKey), [colorKey]);
  const rp = useMemo(() => buildReplay(raw), [raw]);

  // Locks and "Next hole" taps arrive as tiny events between full views; fold them in.
  const [heard, setHeard] = useState<{ lock: string; locks: string[]; ready: number; readies: string[] }>({
    lock: "",
    locks: [],
    ready: -1,
    readies: [],
  });
  useEffect(
    () =>
      onEvent((ev) => {
        if (!ev || typeof ev !== "object") return;
        const x = ev as Partial<PuttEvent>;
        if (typeof x.id !== "string" || typeof x.h !== "number") return;
        const id = x.id;
        const h = x.h;
        if (x.t === "lock" && "s" in x && typeof x.s === "number") {
          const key = `${h}:${x.s}`;
          setHeard((cur) => (cur.lock === key ? { ...cur, locks: [...cur.locks, id] } : { ...cur, lock: key, locks: [id] }));
        } else if (x.t === "ready") {
          setHeard((cur) => (cur.ready === h ? { ...cur, readies: [...cur.readies, id] } : { ...cur, ready: h, readies: [id] }));
        }
      }),
    [onEvent],
  );
  const view = useMemo(() => {
    const locks = raw.phase === "aim" && heard.lock === `${raw.hole}:${raw.shot}` ? heard.locks : [];
    const readies = raw.phase === "card" && heard.ready === raw.hole ? heard.readies : [];
    if (!locks.length && !readies.length) return raw;
    return {
      ...raw,
      balls: raw.balls.map((b) => ({ ...b, locked: b.locked || locks.includes(b.id), ready: b.ready || readies.includes(b.id) })),
    };
  }, [raw, heard]);
  const e = useElapsed(rp ? rp.r.at : null, serverNow);

  // Narrow columns (phones) turn the course upright so it can be ~1.5x bigger.
  const rootRef = useRef<HTMLDivElement>(null);
  const [rootW, setRootW] = useState(0);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setRootW((cur) => (Math.abs(cur - w) < 1 ? cur : w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const portrait = rootW > 0 && rootW < 560;
  const secs = useSecondsLeft(view.phase === "aim" || view.phase === "card" ? view.endsAt : null, serverNow);
  const awaySecs = useSecondsLeft(view.awayAt, serverNow);
  const hole = holeAt(view, view.hole);

  const mySlot = view.balls.findIndex((b) => b.id === me);
  const mine = mySlot >= 0 ? view.balls[mySlot] : null;
  const turnKey = `${view.hole}:${view.shot}`;
  const [draft, setDraft] = useState<{ key: string; a: number; p: number } | null>(null);
  // Optimistic: your lock / ready shows the moment you tap, before the server echoes it.
  const [lockedKey, setLockedKey] = useState<string | null>(null);
  const [readyHole, setReadyHole] = useState<number | null>(null);
  const canShoot = isPlayer && view.phase === "aim" && !!mine && !mine.sunk && !mine.out;
  const locked = canShoot && (!!mine?.locked || lockedKey === turnKey);
  const aim = canShoot ? (draft && draft.key === turnKey ? { a: draft.a, p: draft.p } : view.aim) : null;
  const aiming = canShoot && !locked;
  const ready = view.phase === "card" && (!!mine?.ready || readyHole === view.hole);

  // Aim updates from keys and sliders go out at most ~3 times a second (the latest always wins).
  const outbox = useRef<{ timer: ReturnType<typeof setTimeout> | null; pending: { a: number; p: number } | null }>({
    timer: null,
    pending: null,
  });
  useEffect(() => {
    const box = outbox.current;
    return () => {
      if (box.timer !== null) clearTimeout(box.timer);
    };
  }, []);
  const flush = () => {
    const box = outbox.current;
    if (box.timer !== null) clearTimeout(box.timer);
    box.timer = null;
    if (box.pending) act({ type: "aim", ...box.pending });
    box.pending = null;
  };
  const update = (a: number, p: number, send: "now" | "soon" | "no") => {
    if (!aiming) return;
    const next = { a: wrap(a), p: clamp(Math.round(p), 0, MAX_POWER) };
    setDraft({ key: turnKey, ...next });
    if (next.p < 1 || send === "no") return;
    const box = outbox.current;
    box.pending = next;
    if (send === "now") flush();
    else if (box.timer === null) box.timer = setTimeout(flush, 300);
  };
  const myX = mine?.x ?? 0;
  const myY = mine?.y ?? 0;
  const shown = aim ?? { a: angleTo(myX, myY, hole.cup[0], hole.cup[1]), p: 0 };
  const putt = () => {
    if (!aiming || !aim || aim.p < 1) return;
    const box = outbox.current;
    if (box.timer !== null) clearTimeout(box.timer);
    box.timer = null;
    box.pending = null;
    act({ type: "lock", a: aim.a, p: aim.p });
    setLockedKey(turnKey);
    sfx("pop");
  };

  // Your ball is up for a new shot: "your turn" (the very first tee shot is covered by the room's start cue).
  const myShotKey = canShoot && turnKey !== "0:1" ? turnKey : "";
  const lastShotKey = useRef("");
  useEffect(() => {
    if (myShotKey && myShotKey !== lastShotKey.current) feedback("turn");
    lastShotKey.current = myShotKey;
  }, [myShotKey]);
  const goNext = () => {
    if (view.phase !== "card" || ready || !isPlayer) return;
    act({ type: "ready" });
    setReadyHole(view.hole);
  };

  const onKey = useEffectEvent((ev: KeyboardEvent) => {
    if (ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey || isTyping(ev.target)) return;
    const k = ev.key;
    if (view.phase === "card" && (k === "Enter" || k === " ")) {
      if (!ev.repeat) goNext();
      ev.preventDefault();
      return;
    }
    if (!aiming) return;
    const base = aim && aim.p > 0 ? aim : { a: shown.a, p: 30 };
    const big = ev.shiftKey;
    if (k === "ArrowLeft") update(base.a - (big ? 50 : 10), base.p, "soon");
    else if (k === "ArrowRight") update(base.a + (big ? 50 : 10), base.p, "soon");
    else if (k === "ArrowUp") update(base.a, base.p + (big ? 10 : 2), "soon");
    else if (k === "ArrowDown") update(base.a, Math.max(1, base.p - (big ? 10 : 2)), "soon");
    else if (k === " " || k === "Enter") {
      if (!ev.repeat) putt();
    } else return;
    ev.preventDefault();
  });
  useEffect(() => {
    const handler = (ev: KeyboardEvent) => onKey(ev);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const name = (id: string | undefined) => (id === me ? "You" : (id && byId[id]?.name) || "Someone");
  const live = view.balls.filter((b) => !b.sunk && !b.out && byId[b.id]?.connected !== false);
  const lockedCount = live.filter((b) => b.locked || (b.id === me && locked)).length;
  const waitingFor = live.filter((b) => !b.locked && b.id !== me).map((b) => byId[b.id]?.name ?? "Someone");
  const settled = !!rp && e >= rp.settleMs + 150;

  // ----- status copy -----
  let head: ReactNode;
  let sub: ReactNode;
  if (view.phase === "aim") {
    if (aiming) {
      head = view.shot === 1 ? `⛳ Tee off on hole ${view.hole + 1}!` : `🎯 Shot ${view.shot}: line it up`;
      sub = aim && aim.p > 0 ? `${lockedCount} of ${live.length} locked · hit Putt when it looks right` : "Drag back anywhere on the course, then putt";
    } else if (canShoot && locked) {
      head = "✅ Putt locked in";
      sub = !waitingFor.length
        ? "Everyone's in. Here it comes!"
        : waitingFor.length > 3
          ? `Waiting for ${waitingFor.length} more…`
          : `Waiting for ${joinNames(waitingFor)}…`;
    } else if (isPlayer && mine?.sunk) {
      head = `⛳ You're in, in ${mine.strokes}!`;
      sub = `Watch the rest finish · ${lockedCount} of ${live.length} locked`;
    } else if (isPlayer && mine?.out) {
      head = "🙈 Picked up";
      sub = `That's a ${PICKUP_SCORE} on this hole · ${lockedCount} of ${live.length} locked`;
    } else {
      head = `🎯 Hole ${view.hole + 1}: golfers are aiming`;
      sub = `${lockedCount} of ${live.length} locked in`;
    }
  } else if (view.phase === "roll" && rp) {
    if (!settled) {
      const n = rp.r.shots.filter((s) => s[2] > 0).length;
      head = e < 700 ? "🏌️ Everyone putts!" : "⛳ Fore!";
      sub = `${n} ball${n === 1 ? "" : "s"} rolling`;
    } else {
      [head, sub] = rollSummary(rp, view, name);
    }
  } else if (view.phase === "card") {
    const scores = view.balls.map((b) => b.card[view.hole] ?? PICKUP_SCORE);
    const best = Math.min(...scores);
    const leaders = view.balls.filter((_, i) => scores[i] === best).map((b) => name(b.id));
    head = `🏁 Hole ${view.hole + 1} done`;
    sub =
      best >= PICKUP_SCORE
        ? "Nobody tamed that one"
        : `${joinNames(leaders)} ${leaders.length === 1 && leaders[0] !== "You" ? "takes" : "take"} it: ${scoreName(best, hole.par)}`;
  } else if (view.phase === "final") {
    const f = view.final;
    const won = !!f?.winners.includes(me);
    head = won ? (f && f.winners.length > 1 ? "🤝 You share the win!" : "🏆 You win!") : "🏁 Round complete";
    sub = f?.reason === "forfeit" ? "Players left the course" : "Fewest strokes wins";
  }

  const hurry = aiming && secs <= 4;
  const ring =
    view.phase === "final"
      ? (colors[view.final?.winners[0] ?? ""] ?? accent)
      : aiming
        ? (colors[me] ?? accent)
        : view.phase === "roll"
          ? accent + "aa"
          : accent + "55";

  const label =
    `${hole.name}, hole ${view.hole + 1} of ${view.course.length}, par ${hole.par}. ` +
    view.balls
      .map((b, i) => {
        const nm = byId[b.id]?.name ?? "Someone";
        const st = rp ? strokesAt(rp, i, e) : b.strokes;
        const inCup = rp ? sunkBy(rp, i, e) && b.sunk : b.sunk;
        return `${nm}: ${inCup ? "in the cup" : b.out ? "picked up" : `${st} stroke${st === 1 ? "" : "s"}`}`;
      })
      .join(", ") +
    ".";

  return (
    <div ref={rootRef} className="@container mx-auto flex w-full max-w-4xl flex-col gap-3 pb-16 @3xl:pb-2">
      <style href="ruckus-putt" precedence="default">
        {CSS}
      </style>

      <div aria-live="polite" aria-atomic="true">
        <StatusBanner key={`${view.phase}-${view.hole}-${view.shot}-${settled}`} accent={accent}>
          <div className="truncate">{head}</div>
          <div className="truncate font-sans text-sm font-normal text-muted">{sub || " "}</div>
        </StatusBanner>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate font-semibold">
            Hole {view.hole + 1}
            <span className="font-normal text-muted">/{view.course.length}</span>
            <span className="font-normal text-muted"> · </span>
            {hole.name}
            <span className="font-normal text-muted"> · par {hole.par}</span>
          </span>
          <span className={`shrink-0 tabular-nums ${hurry ? "font-bold text-amber-300" : "text-muted"}`}>
            {view.phase === "aim"
              ? `⏱ ${secs}s`
              : view.phase === "roll"
                ? "🏌️ rolling"
                : view.phase === "card"
                  ? `next in ${secs}s`
                  : "🏁 final"}
          </span>
        </div>
        <TimerBar
          endsAt={view.phase === "final" ? 0 : view.endsAt}
          total={view.total}
          serverNow={serverNow}
          color={view.phase === "roll" ? "#38bdf8" : hurry ? "#fbbf24" : accent}
        />
      </div>

      {view.awayAt !== null && (
        <p role="status" className="card putt-in border-amber-400/50 px-3 py-2 text-center text-sm">
          <span aria-hidden>📡 </span>
          Not enough golfers are connected. The round ends in <b className="tabular-nums">{awaySecs}s</b> unless someone comes
          back.
        </p>
      )}

      <div className="relative mx-auto w-full" style={{ maxWidth: courseMaxWidth(portrait) }}>
        <Course
          view={view}
          hole={hole}
          rp={rp}
          me={me}
          colors={colors}
          byId={byId}
          aim={aim}
          aiming={aiming}
          locked={locked}
          hint={aiming && view.shot === 1 && view.hole === 0 && !(aim && aim.p > 0)}
          onAim={(a, p, done) => update(a, p, done ? "now" : "no")}
          reduced={reduced}
          serverNow={serverNow}
          label={label}
          ring={ring}
          portrait={portrait}
        />
        {view.phase === "aim" && view.shot === 1 && <HoleIntro key={view.hole} hole={hole} n={view.hole + 1} total={view.course.length} />}
      </div>

      {aiming && portrait ? (
        <CompactControls
          a={shown.a}
          p={shown.p}
          color={colors[me] ?? accent}
          hurry={hurry}
          onChange={(a, p) => update(a, p, "soon")}
          onPutt={putt}
        />
      ) : aiming ? (
        <Controls
          a={shown.a}
          p={shown.p}
          accent={accent}
          color={colors[me] ?? accent}
          hurry={hurry}
          onChange={(a, p) => update(a, p, "soon")}
          onPutt={putt}
        />
      ) : canShoot && locked && aim ? (
        <LockedCard p={aim.p} waitingFor={waitingFor} color={colors[me] ?? accent} />
      ) : null}

      {!isPlayer && <Note>👀 You&apos;re watching. Golfers aim in secret, then every ball rolls at once.</Note>}

      {view.phase === "card" || view.phase === "final" ? (
        <>
          <Scorecard view={view} byId={byId} colors={colors} me={me} />
          {view.phase === "card" && isPlayer && (
            <button
              type="button"
              onClick={goNext}
              disabled={ready}
              className="btn btn-primary min-h-12 w-full font-display text-lg font-extrabold disabled:opacity-60"
            >
              {ready ? (
                <>
                  ✓ Ready
                  <span className="ml-2 font-sans text-sm font-normal">
                    {view.balls.filter((b) => b.ready || (b.id === me && ready)).length} of {view.balls.filter((b) => byId[b.id]?.connected !== false).length}
                  </span>
                </>
              ) : view.hole + 1 >= view.course.length ? (
                "See the final card ▶"
              ) : (
                `Next hole ▶`
              )}
            </button>
          )}
          {view.phase === "final" && <Awards view={view} byId={byId} me={me} />}
        </>
      ) : (
        <Roster view={view} rp={rp} e={e} byId={byId} colors={colors} me={me} />
      )}

      {aiming && (
        <p className="hidden text-center text-xs text-muted @3xl:block">
          Drag anywhere to aim · <Kbd>←</Kbd> <Kbd>→</Kbd> turn (<Kbd>Shift</Kbd> ×5) · <Kbd>↑</Kbd> <Kbd>↓</Kbd> power ·{" "}
          <Kbd>Space</Kbd> putt
        </p>
      )}
    </div>
  );
}

function rollSummary(rp: Replay, view: PuttView, name: (id: string | undefined) => string): [ReactNode, ReactNode] {
  const idOf = (slot: number) => view.balls[slot]?.id;
  const sinks = rp.r.ev.filter((x) => x[0] === "sink").map((x) => Number(x[2]));
  const splashes = rp.r.ev.filter((x) => x[0] === "water").map((x) => name(idOf(Number(x[2]))));
  const knocks = rp.r.ev.filter((x) => x[0] === "knock" && Number(x[6]) >= 120).length;
  const hops = rp.r.ev.filter((x) => x[0] === "portal").length;
  const whacks = rp.r.ev.filter((x) => x[0] === "whack").length;
  const extras: string[] = [];
  if (splashes.length) extras.push(`💦 ${joinNames(splashes)} found the water`);
  if (knocks) extras.push(`🎱 ${knocks} knock${knocks === 1 ? "" : "s"}`);
  if (hops) extras.push(`🌀 ${hops} portal hop${hops === 1 ? "" : "s"}`);
  if (whacks) extras.push(`🌬️ ${whacks} windmill whack${whacks === 1 ? "" : "s"}`);
  if (sinks.length) {
    const aces = sinks.filter((s) => strokesAt(rp, s, rp.r.dur) === 1);
    if (aces.length) return [`🌟 HOLE IN ONE for ${joinNames(aces.map((s) => name(idOf(s))))}!`, extras.join(" · ") || "Unreal."];
    const names = sinks.map((s) => name(idOf(s)));
    const verb = names.length === 1 && names[0] !== "You" ? "sinks it" : "sink it";
    return [`⛳ ${joinNames(names)} ${verb}!`, extras.join(" · ") || "Lovely stroke"];
  }
  if (splashes.length) return [`💦 Splash!`, extras.join(" · ")];
  if (knocks >= 2) return ["🎱 Bumper cars out there!", extras.join(" · ")];
  return ["⛳ Nobody's in yet", extras.join(" · ") || "Line up the next one"];
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-panel-2 px-1 py-px font-mono text-[11px] text-text">{children}</kbd>;
}

// ---------- hole card ----------

function HoleIntro({ hole, n, total }: { hole: Hole; n: number; total: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-start justify-center p-2 @xl:p-4" aria-hidden>
      <div className="putt-intro max-w-[90%] rounded-2xl border border-white/15 bg-ink/80 px-4 py-2 text-center shadow-xl backdrop-blur-sm">
        <div className="text-[11px] font-bold tracking-widest text-muted uppercase">
          Hole {n} of {total} · par {hole.par}
        </div>
        <div className="font-display text-lg leading-tight font-extrabold @xl:text-2xl">{hole.name}</div>
        <div className="mt-0.5 hidden text-xs text-muted @xl:block">{hole.tip}</div>
      </div>
    </div>
  );
}

// ---------- controls ----------

/** One row for phones: turn, power and putt, so the upright course and the controls fit on screen together. */
function CompactControls({
  a,
  p,
  color,
  hurry,
  onChange,
  onPutt,
}: {
  a: number;
  p: number;
  color: string;
  hurry: boolean;
  onChange: (a: number, p: number) => void;
  onPutt: () => void;
}) {
  const btn = "btn size-10 shrink-0 p-0 text-lg";
  const pw = p > 0 ? p : 30;
  return (
    <section aria-label="Your putt" className="card putt-in p-2" style={{ borderColor: color + "55" }}>
      <div className="flex items-center gap-1.5">
        <button type="button" className={btn} aria-label="Turn left" onClick={() => onChange(a - 10, pw)}>
          ↺
        </button>
        <button type="button" className={btn} aria-label="Turn right" onClick={() => onChange(a + 10, pw)}>
          ↻
        </button>
        <span className="mx-0.5 h-6 w-px shrink-0 bg-line" aria-hidden />
        <button type="button" className={btn} aria-label="Less power" onClick={() => onChange(a, Math.max(1, pw - 2))}>
          −
        </button>
        <output aria-label="Power" className="w-10 shrink-0 text-center font-mono text-sm font-bold tabular-nums">
          {p > 0 ? `${p}%` : "–"}
        </output>
        <button type="button" className={btn} aria-label="More power" onClick={() => onChange(a, Math.min(MAX_POWER, pw + 2))}>
          +
        </button>
        <button
          type="button"
          onClick={onPutt}
          disabled={p < 1}
          aria-keyshortcuts="Space"
          className={`btn btn-primary min-h-10 min-w-0 flex-1 px-2 font-display text-base font-extrabold disabled:opacity-50 ${hurry && p >= 1 ? "putt-hurry" : ""}`}
        >
          Putt!
        </button>
      </div>
    </section>
  );
}

function Controls({
  a,
  p,
  accent,
  color,
  hurry,
  onChange,
  onPutt,
}: {
  a: number;
  p: number;
  accent: string;
  color: string;
  hurry: boolean;
  onChange: (a: number, p: number) => void;
  onPutt: () => void;
}) {
  const id = useId();
  const deg = Math.round(a / 10) % 360;
  return (
    <section aria-label="Your putt" className="card putt-in p-3" style={{ borderColor: color + "55" }}>
      <div className="grid gap-2 @2xl:grid-cols-[1fr_1fr_11rem] @2xl:items-end @2xl:gap-4">
        <Row
          id={`${id}-aim`}
          label="Aim"
          value={deg}
          min={0}
          max={359}
          display={
            <>
              <span aria-hidden className="mr-1 inline-block text-muted" style={{ transform: `rotate(${deg}deg)` }}>
                ➜
              </span>
              {deg}°
            </>
          }
          onChange={(v) => onChange(v * 10, p > 0 ? p : 30)}
          minus={{ label: "Turn left", icon: "↺", delta: -1 }}
          plus={{ label: "Turn right", icon: "↻", delta: 1 }}
          wrapAround
          accent={accent}
        />
        <Row
          id={`${id}-power`}
          label="Power"
          value={p}
          min={0}
          max={MAX_POWER}
          display={<>{p > 0 ? `${p}%` : "drag to set"}</>}
          onChange={(v) => onChange(a, Math.max(1, v))}
          minus={{ label: "Less power", icon: "−", delta: -2 }}
          plus={{ label: "More power", icon: "+", delta: 2 }}
          accent={accent}
        />
        <button
          type="button"
          onClick={onPutt}
          disabled={p < 1}
          aria-keyshortcuts="Space"
          className={`btn btn-primary min-h-12 w-full font-display text-lg font-extrabold disabled:opacity-50 ${hurry && p >= 1 ? "putt-hurry" : ""}`}
        >
          <span aria-hidden>⛳</span> Putt!
        </button>
      </div>
    </section>
  );
}

function Row({
  id,
  label,
  value,
  min,
  max,
  display,
  onChange,
  minus,
  plus,
  wrapAround,
  accent,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  display: ReactNode;
  onChange: (v: number) => void;
  minus: { label: string; icon: string; delta: number };
  plus: { label: string; icon: string; delta: number };
  wrapAround?: boolean;
  accent: string;
}) {
  const step = (d: number) => {
    const v = value + d;
    onChange(wrapAround ? (v + (max + 1)) % (max + 1) : clamp(v, min, max));
  };
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="label">
          {label}
        </label>
        <output htmlFor={id} className="font-mono text-sm font-bold tabular-nums">
          {display}
        </output>
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" className="btn size-10 shrink-0 p-0 text-lg" aria-label={minus.label} onClick={() => step(minus.delta)}>
          {minus.icon}
        </button>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={(ev) => onChange(Number(ev.target.value))}
          className="putt-range min-w-0 flex-1"
          style={{ accentColor: accent }}
        />
        <button type="button" className="btn size-10 shrink-0 p-0 text-lg" aria-label={plus.label} onClick={() => step(plus.delta)}>
          {plus.icon}
        </button>
      </div>
    </div>
  );
}

function LockedCard({ p, waitingFor, color }: { p: number; waitingFor: string[]; color: string }) {
  return (
    <section aria-label="Your putt" className="card putt-pop flex items-center gap-3 px-4 py-3" style={{ borderColor: color + "88" }}>
      <span aria-hidden className="text-3xl">
        🔒
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-display font-bold">Putt locked</span>
          <span className="shrink-0 text-xs text-muted">
            {waitingFor.length ? (
              <>
                {waitingFor.length} still aiming
                <span aria-hidden>
                  <span className="putt-dot">.</span>
                  <span className="putt-dot" style={{ animationDelay: ".15s" }}>
                    .
                  </span>
                  <span className="putt-dot" style={{ animationDelay: ".3s" }}>
                    .
                  </span>
                </span>
              </>
            ) : (
              "all in!"
            )}
          </span>
        </div>
        <div className="text-sm text-muted">{p}% power · your aim stays secret until the roll</div>
      </div>
    </section>
  );
}

// ---------- roster ----------

function Roster({
  view,
  rp,
  e,
  byId,
  colors,
  me,
}: {
  view: PuttView;
  rp: Replay | null;
  e: number;
  byId: Record<string, Player>;
  colors: Record<string, string>;
  me: string;
}) {
  const parSoFar = parThrough(view, view.hole);
  return (
    <section aria-label="Golfers">
      <ul className="grid grid-cols-2 gap-1.5 @3xl:grid-cols-4">
        {view.balls.map((b, i) => {
          const p = byId[b.id];
          const color = colors[b.id] ?? "#94a3b8";
          const offline = p?.connected === false;
          const strokes = rp ? strokesAt(rp, i, e) : b.strokes;
          const sunk = rp ? sunkBy(rp, i, e) && b.sunk : b.sunk;
          const splashing = !!rp && rp.splashMs[i] !== null && e >= (rp.splashMs[i] ?? 0) && e < rp.settleMs + 400;
          const total = sum(b.card);
          let status: ReactNode;
          if (sunk) status = <span className="font-semibold text-green-400">⛳ in</span>;
          else if (b.out && !rp) status = <span className="text-red-300">picked up</span>;
          else if (splashing) status = <span className="text-sky-300">💦 +1</span>;
          else if (rp) status = rp.shot[i] ? (rp.shot[i]![1] > 0 ? "rolling" : "💤 too slow") : offline ? "📡 away" : "—";
          else if (offline) status = "📡 away";
          else if (b.locked) status = <span className="font-semibold text-green-400">✓ locked</span>;
          else status = "aiming…";
          return (
            <li
              key={b.id}
              className={`flex min-w-0 items-center gap-2 rounded-xl border px-2 py-1.5 transition-opacity ${sunk || b.out ? "opacity-75" : ""}`}
              style={{ borderColor: b.id === me ? color : color + "44", background: color + (b.id === me ? "1f" : "10") }}
            >
              <span aria-hidden className="relative text-lg leading-none">
                <Avatar id={p?.avatar ?? "🙂"} />
                <span className="absolute -right-1 -bottom-1 size-2.5 rounded-full border border-black/40" style={{ background: color }} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1 text-xs">
                  <span className="truncate font-bold" style={{ color }}>
                    {p?.name ?? "Someone"}
                    {b.id === me && <span className="font-normal text-muted"> (you)</span>}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted">{status}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-1 text-[11px] text-muted">
                  <span className="flex items-center gap-0.5" aria-label={`${strokes} stroke${strokes === 1 ? "" : "s"} on this hole`}>
                    {Array.from({ length: Math.max(MAX_STROKES, strokes) }, (_, k) => (
                      <span
                        key={k}
                        aria-hidden
                        className="inline-block size-1.5 rounded-full"
                        style={{ background: k < strokes ? (k >= MAX_STROKES - 1 ? "#f87171" : color) : "var(--color-line)" }}
                      />
                    ))}
                    <b className="ml-1 font-mono text-text tabular-nums">{strokes}</b>
                  </span>
                  <span className="font-mono tabular-nums">
                    Σ {total}
                    {view.hole > 0 && <span className="ml-1">({toPar(total - parSoFar)})</span>}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------- scorecard ----------

function cellStyle(score: number | undefined, par: number): { color: string; bg: string; mark: string } {
  if (score === undefined) return { color: "var(--color-muted)", bg: "transparent", mark: "" };
  if (score >= PICKUP_SCORE) return { color: "#fca5a5", bg: "rgba(248,113,113,0.12)", mark: "" };
  if (score === 1) return { color: "#fde047", bg: "rgba(253,224,71,0.18)", mark: "★" };
  if (score < par) return { color: "#86efac", bg: "rgba(134,239,172,0.14)", mark: "" };
  if (score === par) return { color: "var(--color-text)", bg: "transparent", mark: "" };
  return { color: "#fdba74", bg: "rgba(253,186,116,0.1)", mark: "" };
}

function Scorecard({
  view,
  byId,
  colors,
  me,
}: {
  view: PuttView;
  byId: Record<string, Player>;
  colors: Record<string, string>;
  me: string;
}) {
  const done = Math.max(...view.balls.map((b) => b.card.length), 0);
  const par = parThrough(view, done);
  const winners = new Set(view.final?.winners ?? []);
  const ranked = view.balls
    .map((b, i) => ({ b, i, total: sum(b.card) }))
    .sort((x, y) => x.total - y.total || x.i - y.i);
  return (
    <section aria-label="Scorecard" className="card putt-in overflow-hidden p-2 @xl:p-3">
      <div className="label mb-1.5 px-1">{view.phase === "final" ? "Final card" : `Scorecard · after ${done} of ${view.course.length}`}</div>
      <table className="w-full table-fixed border-collapse text-center text-xs tabular-nums">
        <colgroup>
          <col />
          {view.course.map((id) => (
            <col key={id} className="w-[1.65rem] @xl:w-9" />
          ))}
          <col className="w-8 @xl:w-11" />
          <col className="w-8 @xl:w-10" />
        </colgroup>
        <thead>
          <tr className="text-[10px] text-muted">
            <th scope="col" className="px-1 text-left font-semibold">
              Golfer
            </th>
            {view.course.map((id, i) => (
              <th
                key={id}
                scope="col"
                className="py-0.5 font-semibold"
                style={i === view.hole && view.phase === "card" ? { color: "var(--color-text)" } : undefined}
                title={HOLE_BY_ID[id]?.name}
              >
                {i + 1}
                <div className="font-normal opacity-80">p{HOLE_BY_ID[id]?.par ?? 3}</div>
              </th>
            ))}
            <th scope="col" className="font-semibold">
              Tot
            </th>
            <th scope="col" className="font-semibold">
              ±
            </th>
          </tr>
        </thead>
        <tbody>
          {ranked.map(({ b, total }, row) => {
            const p = byId[b.id];
            const color = colors[b.id] ?? "#94a3b8";
            const won = winners.has(b.id);
            return (
              <tr
                key={b.id}
                className="putt-in border-t border-line/70"
                style={{ animationDelay: `${row * 50}ms`, background: b.id === me ? color + "14" : undefined }}
              >
                <th scope="row" className="truncate px-1 py-1.5 text-left font-semibold" style={{ color }}>
                  <span aria-hidden className="mr-1">
                    <Avatar id={won ? "👑" : (p?.avatar ?? "🙂")} />
                  </span>
                  {p?.name ?? "Someone"}
                  {b.id === me && <span className="font-normal text-muted"><span className="hidden @md:inline"> (you)</span><span className="sr-only @md:hidden"> (you)</span></span>}
                </th>
                {view.course.map((id, i) => {
                  const score = b.card[i];
                  const st = cellStyle(score, HOLE_BY_ID[id]?.par ?? 3);
                  const fresh = i === view.hole && view.phase === "card";
                  return (
                    <td key={id} className="px-0.5 py-1">
                      <span
                        className={`inline-flex h-6 w-full items-center justify-center rounded-md font-mono font-bold ${fresh ? "putt-pop" : ""}`}
                        style={{ color: st.color, background: st.bg, animationDelay: fresh ? `${200 + row * 70}ms` : undefined }}
                        title={score !== undefined ? scoreName(score, HOLE_BY_ID[id]?.par ?? 3, score >= PICKUP_SCORE) : undefined}
                      >
                        {score === undefined ? "·" : `${score}${st.mark}`}
                      </span>
                    </td>
                  );
                })}
                <td className="font-mono font-extrabold">{total}</td>
                <td className="font-mono text-muted">{done ? toPar(total - par) : "–"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1.5 px-1 text-[10px] text-muted">
        ★ hole in one · <span style={{ color: "#86efac" }}>green</span> under par ·{" "}
        <span style={{ color: "#fdba74" }}>orange</span> over · {PICKUP_SCORE} = picked up after {MAX_STROKES} strokes
      </p>
    </section>
  );
}

function Awards({ view, byId, me }: { view: PuttView; byId: Record<string, Player>; me: string }) {
  const nm = (b: BallView) => (b.id === me ? "You" : (byId[b.id]?.name ?? "Someone"));
  const most = (k: keyof BallView["stats"]) => {
    const best = Math.max(0, ...view.balls.map((b) => b.stats[k]));
    return best > 0 ? { who: view.balls.filter((b) => b.stats[k] === best), n: best } : null;
  };
  const awards: { icon: string; title: string; who: BallView[]; note: string }[] = [];
  const aces = most("aces");
  if (aces) awards.push({ icon: "🌟", title: "Ace", who: aces.who, note: `${aces.n} hole${aces.n === 1 ? "" : "s"} in one` });
  const knocks = most("knocks");
  if (knocks) awards.push({ icon: "🎱", title: "Bully", who: knocks.who, note: `${knocks.n} knock${knocks.n === 1 ? "" : "s"}` });
  const splash = most("splashes");
  if (splash) awards.push({ icon: "💦", title: "Splash magnet", who: splash.who, note: `${splash.n} splash${splash.n === 1 ? "" : "es"}` });
  const whacks = most("whacks");
  if (whacks) awards.push({ icon: "🌬️", title: "Windmill fodder", who: whacks.who, note: `${whacks.n} whack${whacks.n === 1 ? "" : "s"}` });
  const hops = most("portals");
  if (hops) awards.push({ icon: "🌀", title: "Portal hopper", who: hops.who, note: `${hops.n} hop${hops.n === 1 ? "" : "s"}` });
  if (!awards.length) return null;
  return (
    <div className="flex flex-wrap justify-center gap-2 text-xs">
      {awards.slice(0, 4).map((a, i) => (
        <span key={a.title} className="putt-pop rounded-full border border-line bg-panel-2 px-2.5 py-1" style={{ animationDelay: `${i * 110}ms` }}>
          <span aria-hidden>{a.icon} </span>
          {a.title}: <b>{a.who.map(nm).join(", ")}</b> ({a.note})
        </span>
      ))}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { Note, PlayerChip, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import { feedback } from "@/lib/feedback";
import type { PixelsAction, PixelsView } from "./server";
import { COLORS, EMBLEM, EMBLEM_CELLS, PERFECT_BONUS, digits, type PixelsEvent } from "./shared";
import { Board, CanvasStore } from "./board";
import { HiddenArt, PixelArt, cropBoard, inkOn, painterColors, playerOr } from "./parts";
import { Avatar } from "@/components/Avatar";
import { TEAMS, teamOf } from "@/shared/teams";

type Props = GameClientProps<PixelsView, PixelsAction>;

// Game-local animations, prefixed so they can't clash with other games.
const CSS = `
.pix-pop { animation: pix-pop .45s cubic-bezier(.2,1.4,.4,1) both; }
@keyframes pix-pop { from { opacity: 0; transform: scale(.4); } }
.pix-box { animation: pix-box .5s cubic-bezier(.2,1.3,.4,1) both; }
@keyframes pix-box { from { opacity: 0; transform: scale(2.2); } }
.pix-flip { animation: pix-flip .6s cubic-bezier(.2,.9,.3,1.25) both; }
@keyframes pix-flip { from { opacity: 0; transform: perspective(240px) rotateY(100deg) scale(.7); } }
.pix-bump { animation: pix-bump .4s cubic-bezier(.2,1.6,.4,1); }
@keyframes pix-bump { 40% { transform: scale(1.3); } }
.pix-in { animation: pix-in .45s cubic-bezier(.2,1.2,.4,1) both; }
@keyframes pix-in { from { opacity: 0; transform: translateY(10px) scale(.94); } }
.pix-shine { position: relative; overflow: hidden; }
.pix-shine::after { content: ""; position: absolute; inset: 0; background: linear-gradient(110deg, transparent 35%, rgba(255,255,255,.35) 50%, transparent 65%); transform: translateX(-120%); animation: pix-shine 2.2s ease-in-out .4s infinite; }
@keyframes pix-shine { 60%, 100% { transform: translateX(120%); } }
@media (prefers-reduced-motion: reduce) {
  .pix-pop, .pix-box, .pix-flip, .pix-in { animation: pix-fade .2s ease both; }
  .pix-bump, .pix-shine::after { animation: none; }
  @keyframes pix-fade { from { opacity: 0; } }
}
`;

const MEDALS = ["🥇", "🥈", "🥉"];
const SUBTITLE: Record<PixelsView["phase"], string> = {
  intro: "paint it anywhere",
  paint: "tap to enlarge",
  spots: "still secret…",
  reveal: "revealed to all",
  final: "",
};

function isTyping(t: EventTarget | null) {
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

/** The viewer's best copy on their own screen, recomputed at most 4x a second. */
function useLiveMatch(store: CanvasStore, art: string | null, active: boolean) {
  const [m, setM] = useState<{ x: number; y: number; n: number; art: string } | null>(null);
  useEffect(() => {
    if (!art || !active) return;
    const target = digits(art);
    let timer = 0;
    let last = 0;
    const run = () => {
      timer = 0;
      last = performance.now();
      if (store.w) setM({ ...store.match(target), art });
    };
    const kick = () => {
      if (!timer) timer = window.setTimeout(run, Math.max(0, 250 - (performance.now() - last)));
    };
    kick();
    const off = store.subscribe(kick);
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [store, art, active]);
  return active && m && m.art === art ? m : null;
}

export default function CanvasClash({ view, byId, act, serverNow, onEvent, accent }: Props) {
  const [store] = useState(() => new CanvasStore());
  const [picked, setPicked] = useState<number | null>(null);
  const [bigFor, setBigFor] = useState(-1);
  const [nextFor, setNextFor] = useState(-1);

  useEffect(() => {
    store.setSender((px) => act({ type: "paint", px }));
  }, [store, act]);
  const [readyEv, setReadyEv] = useState<{ round: number; who: number[] }>({ round: -1, who: [] });
  useEffect(
    () =>
      onEvent((e) => {
        store.handle(e);
        const r = e as PixelsEvent | null;
        if (r && typeof r === "object" && r.k === "ready" && Number.isInteger(r.i) && Number.isInteger(r.round)) {
          setReadyEv((cur) => (cur.round === r.round ? { round: r.round, who: [...cur.who, r.i] } : { round: r.round, who: [r.i] }));
        }
      }),
    [store, onEvent],
  );
  useEffect(() => {
    if (view) store.adopt(view);
  }, [store, view]);
  useEffect(() => () => store.dispose(), [store]);
  // A gap in pixel revisions (a missed event) asks for a fresh board.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (store.wantsSync(performance.now())) act({ type: "sync" });
    }, 400);
    return () => window.clearInterval(id);
  }, [store, act]);

  const you = view?.you ?? -1;
  const phase = view?.phase ?? "intro";
  const choosing = you >= 0 && (phase === "intro" || phase === "paint");
  const mineArt = view?.mine?.art ?? null;
  const color = picked ?? (mineArt ? mineArt.charCodeAt(0) - 48 : 1);
  const live = useLiveMatch(store, mineArt, phase === "paint" && you >= 0);

  // Brushes up: the paint phase opening is everyone's go.
  const painting = phase === "paint" && you >= 0 ? (view?.round ?? 0) : -1;
  const lastPaint = useRef(-1);
  useEffect(() => {
    if (painting >= 0 && painting !== lastPaint.current) feedback("go");
    lastPaint.current = painting;
  }, [painting]);

  // Keys 1-8 pick a colour.
  useEffect(() => {
    if (!choosing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const n = "12345678".indexOf(e.key);
      if (n < 0) return;
      e.preventDefault();
      setPicked(n + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choosing]);

  const ids = view?.ids;
  const teams = view?.teams ?? null;
  // Red vs Blue: everyone wears their team colour (chips, flashes, boxes).
  const colors = useMemo(
    () => (ids ? (teams ? ids.map((id) => TEAMS[Math.max(0, teamOf(teams, id))].color) : painterColors(ids, byId)) : []),
    [ids, byId, teams],
  );
  const players = useMemo(() => (ids ? ids.map((id, i) => ({ ...playerOr(byId, id, i), color: colors[i] })) : []), [ids, byId, colors]);
  const avatars = useMemo(() => players.map((p) => p.avatar), [players]);
  const mineBox = useMemo(() => (live && live.n > 0 ? { x: live.x, y: live.y } : null), [live]);

  if (!view) return <Note>Stretching the canvas…</Note>;

  const round = view.round;
  const big = bigFor === round && phase === "paint";
  const ready = phase === "reveal" ? [...new Set([...view.ready, ...(readyEv.round === round ? readyEv.who : [])])] : [];
  const iAmReady = you >= 0 && (ready.includes(you) || nextFor === round);
  const here = players.filter((p) => p.connected).length;

  let overlay = null;
  if (phase === "intro") overlay = <IntroCard view={view} players={players} serverNow={serverNow} />;
  else if (big && view.mine) overlay = <BigEmblem mine={view.mine} onClose={() => setBigFor(-1)} />;
  else if (view.spots && (phase === "spots" || phase === "reveal" || phase === "final")) {
    overlay = <SpotBoxes view={view} players={view.teams ? teamPlayers(view, players) : players} />;
  }

  return (
    <div className="@container mx-auto flex w-full max-w-4xl flex-col gap-3 pb-16 @3xl:pb-2">
      <style href="ruckus-pixels" precedence="default">
        {CSS}
      </style>

      <div aria-live="polite" aria-atomic="true">
        <StatusBanner key={`${phase}-${round}`} accent={you >= 0 ? colors[you] : accent}>
          <span className="block truncate">
            <Status view={view} serverNow={serverNow} />
          </span>
        </StatusBanner>
      </div>
      {phase !== "final" && (
        <TimerBar endsAt={view.endsAt} total={view.phaseMs} serverNow={serverNow} color={phase === "paint" ? accent : "var(--color-muted)"} />
      )}

      {view.teams ? <TeamStrip view={view} players={players} ready={ready} /> : <ScoreStrip view={view} players={players} ready={ready} />}

      {view.abandonAt !== null && phase !== "final" && <AbandonNote at={view.abandonAt} serverNow={serverNow} />}

      <Board
        store={store}
        w={view.w}
        h={view.h}
        zoomable={phase === "intro" || phase === "paint"}
        canPaint={phase === "paint" && you >= 0}
        color={color}
        colors={colors}
        avatars={avatars}
        you={you}
        mineBox={mineBox}
        label={`Shared canvas, ${view.w} by ${view.h} pixels.${
          phase === "paint" && you >= 0 ? " Click or drag to paint. Arrow keys move the cursor, Space paints, keys 1 to 8 pick a colour." : ""
        }`}
        toolbar={
          you >= 0 && view.mine && phase !== "final" ? (
            <MineBadge
              view={view}
              live={live?.n ?? null}
              open={big}
              onToggle={() => setBigFor(big ? -1 : round)}
            />
          ) : (
            <span className="block truncate pl-1 text-sm text-muted">
              {phase === "final" ? `Final canvas · round ${round}` : `Round ${round} of ${view.rounds} · ${view.w}×${view.h} canvas`}
            </span>
          )
        }
        overlay={overlay}
      />

      {choosing && <Palette color={color} mineArt={mineArt} onPick={setPicked} />}
      {choosing && (
        <p className="hidden text-center text-xs text-muted @xl:block">
          Drag to paint lines · keys 1–8 pick a colour · Tab to the canvas, then arrows + Space · the dashed box is your best copy
        </p>
      )}

      {(phase === "spots" || phase === "reveal") && <Results view={view} players={view.teams ? teamPlayers(view, players) : players} />}

      {phase === "reveal" && you >= 0 && (
        <button
          type="button"
          className={`btn mx-auto w-full max-w-sm ${iAmReady ? "" : "btn-primary"}`}
          disabled={iAmReady}
          onClick={() => {
            setNextFor(round);
            act({ type: "next" });
          }}
        >
          {iAmReady
            ? `Waiting for the others… ${Math.max(ready.length, 1)}/${here}`
            : round >= view.rounds
              ? "See the final standings ▸"
              : `Ready for round ${round + 1} ▸`}
        </button>
      )}

      {phase === "final" && (view.teams ? <TeamStandings view={view} players={players} /> : <Standings view={view} players={players} />)}

      {you < 0 && phase !== "final" && (
        <Note>
          {view.teams
            ? "👀 You're watching Red vs Blue. Each team shares a secret emblem: the flashes show which team is painting where."
            : "👀 You're watching. Everyone has a secret emblem: the coloured flashes show who is painting where."}
        </Note>
      )}
    </div>
  );
}

// ---------- header ----------

function Secs({ endsAt, serverNow }: { endsAt: number; serverNow: () => number }) {
  const s = useSecondsLeft(endsAt, serverNow);
  return <span className={`tabular-nums ${s <= 10 ? "text-brand" : "text-muted"}`}> · {s}s</span>;
}

function Status({ view, serverNow }: { view: PixelsView; serverNow: () => number }) {
  const { phase, round, rounds, you, mine } = view;
  switch (phase) {
    case "intro":
      return you >= 0 ? (
        <>
          Round {round}/{rounds} · memorise it! 🧠
        </>
      ) : (
        <>
          Round {round}/{rounds} · secret emblems 🤫
        </>
      );
    case "paint":
      return you >= 0 && mine ? (
        <>
          Paint {view.teams ? "your team's" : "your"} {mine.icon} {mine.name}!
          <Secs endsAt={view.endsAt} serverNow={serverNow} />
        </>
      ) : (
        <>
          Painting frenzy!
          <Secs endsAt={view.endsAt} serverNow={serverNow} />
        </>
      );
    case "spots":
      return <>⏱ Time&apos;s up! Best copies…</>;
    case "reveal": {
      if (you < 0 || !view.pts || !view.spots) return <>🎨 Emblems revealed!</>;
      const n = view.spots[you][2];
      return n === EMBLEM_CELLS ? (
        <>PERFECT copy! +{view.pts[you]} 🎉</>
      ) : (
        <>
          {view.teams ? "Team's" : "Your"} best copy: {n}/{EMBLEM_CELLS} → +{view.pts[you]}
        </>
      );
    }
    case "final":
      if (view.teams && view.endReason !== "abandoned" && view.winners?.length) {
        const [a, b] = teamTotals(view);
        if (a !== b) return <>{TEAMS[a > b ? 0 : 1].name} team wins! 🎨</>;
        return <>Red and Blue tie! 🎨</>;
      }
      return view.endReason === "abandoned" ? <>Game over: painters left</> : <>Game over! 🎨</>;
  }
}

function ScoreStrip({ view, players, ready }: { view: PixelsView; players: Player[]; ready: number[] }) {
  return (
    <ul className="flex flex-wrap justify-center gap-1.5" aria-label="Scores">
      {players.map((p, i) => (
        <li key={p.id}>
          <PlayerChip player={p} size="sm" dim={!p.connected}>
            <b key={view.totals[i]} className={`font-mono tabular-nums ${view.totals[i] ? "pix-bump" : ""}`} style={{ display: "inline-block" }}>
              {view.totals[i]}
            </b>
            {i === view.you && <span className="text-xs font-semibold text-muted">you</span>}
            {ready.includes(i) && <span aria-label="ready">✓</span>}
            {!p.connected && <span aria-label="offline">⚠</span>}
          </PlayerChip>
        </li>
      ))}
    </ul>
  );
}

function AbandonNote({ at, serverNow }: { at: number; serverNow: () => number }) {
  const s = useSecondsLeft(at, serverNow);
  return (
    <p role="status" className="card animate-rise border-amber-400/50 px-3 py-2 text-center text-sm">
      📡 Not enough painters online. The game ends in <b className="tabular-nums">{s}s</b> unless someone comes back.
    </p>
  );
}

// ---------- the viewer's emblem ----------

function MineBadge({ view, live, open, onToggle }: { view: PixelsView; live: number | null; open: boolean; onToggle: () => void }) {
  const mine = view.mine!;
  const painting = view.phase === "paint";
  const secret = view.phase === "intro" || painting || view.phase === "spots";
  return (
    <div className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        onClick={onToggle}
        disabled={!painting}
        aria-expanded={painting ? open : undefined}
        aria-label={`Your secret emblem: ${mine.name}. ${painting ? (open ? "Tap to shrink" : "Tap to enlarge") : ""}`}
        className="grid size-11 shrink-0 place-items-center rounded-lg border border-line bg-ink p-1 transition-transform hover:scale-105 disabled:cursor-default disabled:hover:scale-100 @md:size-12"
      >
        <PixelArt art={mine.art} size="100%" />
      </button>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-sm font-bold">
          <span aria-hidden>{mine.icon} </span>
          {mine.name}
          {secret && <span className="hidden font-normal text-muted @sm:inline"> · {view.teams ? "team secret" : "secret"}</span>}
        </span>
        {painting && live !== null ? (
          <span className="flex items-center gap-1.5 text-xs whitespace-nowrap text-muted" aria-live="off">
            <span>
              best<span className="hidden @sm:inline"> copy</span>
            </span>
            <span className="relative hidden h-1.5 w-12 overflow-hidden rounded-full bg-panel-2 @sm:block @md:w-20" aria-hidden>
              <span
                className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
                style={{ width: `${(live / EMBLEM_CELLS) * 100}%`, background: live === EMBLEM_CELLS ? "#4ade80" : "var(--color-brand-2)" }}
              />
            </span>
            <b key={live} className="pix-bump inline-block font-mono text-text tabular-nums">
              {live}/{EMBLEM_CELLS}
            </b>
            {live === EMBLEM_CELLS && <span aria-label="perfect">✨</span>}
          </span>
        ) : (
          <span className="block truncate text-xs text-muted">{SUBTITLE[view.phase]}</span>
        )}
      </span>
    </div>
  );
}

function IntroCard({ view, players, serverNow }: { view: PixelsView; players: Player[]; serverNow: () => number }) {
  const s = useSecondsLeft(view.endsAt, serverNow);
  const mine = view.mine;
  return (
    <div className="absolute inset-0 grid place-items-center bg-ink/40 p-2">
      <div key={view.round} className="pix-in card flex max-w-full flex-col items-center gap-1.5 px-4 py-3 text-center @md:gap-2 @md:px-6 @md:py-4">
        {view.teams && <TeamIntro view={view} players={players} />}
        {mine ? (
          <>
            <span className="label">
              Round {view.round} of {view.rounds} · {view.teams ? "team emblem" : "your secret emblem"}
            </span>
            <span className="w-24 @md:w-36">
              <PixelArt art={mine.art} size="100%" digits label={`${mine.name} emblem`} className="pix-pop" />
            </span>
            <span className="font-display text-lg font-extrabold @md:text-2xl">
              {mine.icon} {mine.name}
            </span>
            <span className="hidden text-sm text-muted @sm:block">
              {view.teams ? "Paint it together. Guard it. Wreck the other team's." : "Paint it anywhere. Guard it. Wreck everyone else's."}
            </span>
          </>
        ) : (
          <>
            <span className="label">
              Round {view.round} of {view.rounds}
            </span>
            <span className="text-4xl">🤫</span>
            <span className="font-display text-lg font-extrabold @md:text-2xl">{view.teams ? "One secret emblem per team" : "Secret emblems handed out"}</span>
            <span className="text-sm text-muted">Watch who paints where…</span>
          </>
        )}
        <span key={s} className="pix-pop font-mono text-sm font-bold text-brand-2 tabular-nums">
          {s > 0 ? `Painting in ${s}…` : "Go!"}
        </span>
      </div>
    </div>
  );
}

function BigEmblem({ mine, onClose }: { mine: NonNullable<PixelsView["mine"]>; onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close the enlarged emblem"
      className="pix-in pointer-events-auto absolute top-2 left-2 flex flex-col items-center gap-1 rounded-xl border border-line bg-panel/95 p-2 shadow-xl"
    >
      <span className="w-28 @md:w-40">
        <PixelArt art={mine.art} size="100%" digits label={`${mine.name} emblem, enlarged`} />
      </span>
      <span className="text-xs font-semibold">
        {mine.icon} {mine.name} <span className="text-muted">· tap to close</span>
      </span>
    </button>
  );
}

function Palette({ color, mineArt, onPick }: { color: number; mineArt: string | null; onPick: (c: number) => void }) {
  return (
    <div role="group" aria-label="Paint colour" className="grid grid-cols-4 gap-1.5 @md:grid-cols-8">
      {COLORS.slice(1).map((c, k) => {
        const idx = k + 1;
        const sel = idx === color;
        const inMine = !!mineArt && mineArt.includes(String(idx));
        return (
          <button
            key={c.name}
            type="button"
            aria-pressed={sel}
            aria-label={`${c.name}, key ${idx}${inMine ? ", used in your emblem" : ""}`}
            onClick={() => onPick(idx)}
            className={`relative grid h-11 place-items-center rounded-xl border-2 transition-transform duration-150 active:scale-95 ${sel ? "z-10 scale-[1.06]" : "hover:scale-[1.03]"}`}
            style={{
              background: c.hex,
              borderColor: sel ? "#ffffff" : "rgba(255,255,255,.08)",
              boxShadow: sel ? `0 0 0 2px ${c.hex}, 0 8px 20px -6px ${c.hex}` : undefined,
            }}
          >
            <span className="absolute top-1 left-1.5 font-mono text-[10px] leading-none font-bold opacity-80" style={{ color: inkOn(idx) }}>
              {idx}
            </span>
            {inMine && (
              <span className="absolute right-1.5 bottom-1 text-[10px] leading-none" style={{ color: inkOn(idx) }} aria-hidden>
                ★
              </span>
            )}
            {sel && (
              <span className="text-base leading-none font-black" style={{ color: inkOn(idx) }} aria-hidden>
                ✓
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------- reveal ----------

function SpotBoxes({ view, players }: { view: PixelsView; players: (Player | undefined)[] }) {
  const spots = view.spots!;
  const stack = new Map<string, number>();
  return (
    <>
      {spots.map(([x, y, n], i) => {
        const p = players[i];
        if (!p) return null;
        const key = `${x},${y}`;
        const k = stack.get(key) ?? 0;
        stack.set(key, k + 1);
        const below = y < 3;
        const anchor: CSSProperties =
          x < 3 ? { left: 0 } : x + EMBLEM > view.w - 3 ? { right: 0 } : { left: "50%", transform: "translateX(-50%)" };
        const emblem = view.emblems?.[i];
        const delay = `${i * 110}ms`;
        return (
          <div
            key={p.id}
            className="absolute"
            style={{
              left: `${(x / view.w) * 100}%`,
              top: `${(y / view.h) * 100}%`,
              width: `${(EMBLEM / view.w) * 100}%`,
              height: `${(EMBLEM / view.h) * 100}%`,
              zIndex: 10 - k,
            }}
          >
            <div
              className="pix-box absolute -inset-px rounded-[3px]"
              style={{ boxShadow: `0 0 0 2px ${p.color}, 0 0 0 4px rgba(14,12,29,.6), 0 0 16px 2px ${p.color}`, animationDelay: delay }}
            />
            <span className="absolute whitespace-nowrap" style={{ ...anchor, [below ? "top" : "bottom"]: `calc(100% + ${5 + k * 20}px)` }}>
              <span
                className="pix-pop inline-flex items-center gap-0.5 rounded-full border border-ink/40 px-1.5 py-0.5 text-[11px] leading-none font-bold text-ink shadow-md"
                style={{ background: p.color, animationDelay: delay }}
              >
                <span aria-hidden><Avatar id={p.avatar} /></span>
                {emblem && <span aria-hidden>{emblem.icon}</span>}
                <span className="tabular-nums">{n}</span>
              </span>
            </span>
          </div>
        );
      })}
    </>
  );
}

function Results({ view, players }: { view: PixelsView; players: (Player | undefined)[] }) {
  const spots = view.spots ?? [];
  const revealed = view.emblems !== null && view.pts !== null;
  const order = players.flatMap((p, i) => (p ? [i] : []));
  if (revealed) order.sort((a, b) => view.pts![b] - view.pts![a]);
  return (
    <section aria-label={revealed ? "Round results" : "Best copies"} className={`grid grid-cols-2 gap-2 ${view.teams ? "mx-auto w-full max-w-lg" : "@xl:grid-cols-4"}`}>
      {order.map((i, rank) => {
        const p = players[i];
        const sp = spots[i];
        if (!p || !sp) return null;
        const [x, y, n] = sp;
        const crop = cropBoard(view.board, view.w, x, y);
        const emblem = view.emblems?.[i];
        const marks = emblem ? Array.from({ length: EMBLEM_CELLS }, (_, k) => crop[k] !== emblem.art[k]) : undefined;
        const perfect = n === EMBLEM_CELLS;
        const delay = { animationDelay: `${rank * 70}ms` };
        return (
          <article
            key={`${p.id}-${revealed ? "r" : "s"}`}
            className={`card pix-in flex min-w-0 flex-col gap-1.5 p-2 ${perfect && revealed ? "pix-shine" : ""}`}
            style={{ borderColor: `${p.color}88`, background: i === view.you ? `${p.color}14` : undefined, ...delay }}
            aria-label={`${p.name}: ${n} of ${EMBLEM_CELLS} pixels${emblem ? `, emblem ${emblem.name}` : ""}${revealed ? `, ${view.pts![i]} points` : ""}`}
          >
            <div className="flex min-w-0 items-center justify-between gap-1">
              <PlayerChip player={p} size="sm" dim={!p.connected} />
              {revealed && (
                <b key={`${view.round}-pts`} className="pix-pop font-display text-lg leading-none font-extrabold tabular-nums" style={{ color: p.color, ...delay }}>
                  +{view.pts![i]}
                </b>
              )}
            </div>
            <div className="flex items-center justify-center gap-1.5">
              <span className="flex flex-col items-center gap-0.5">
                {emblem ? (
                  <PixelArt art={emblem.art} size={46} className="pix-flip" label={`Emblem: ${emblem.name}`} />
                ) : (
                  <HiddenArt size={46} />
                )}
                <span className="text-xs text-muted">emblem</span>
              </span>
              <span aria-hidden className="pb-3 text-muted">
                →
              </span>
              <span className="flex flex-col items-center gap-0.5">
                <PixelArt art={crop} size={46} marks={marks} label="Best copy on the canvas" />
                <span className="text-xs text-muted">best copy</span>
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-1 text-xs">
              <span className="min-w-0 truncate text-muted">{emblem ? `${emblem.icon} ${emblem.name}` : "🤫 secret"}</span>
              <span className="font-mono font-bold tabular-nums">
                {n}/{EMBLEM_CELLS}
              </span>
            </div>
            {perfect && revealed && (
              <span className="pix-pop self-center rounded-full bg-emerald-400/20 px-2 py-0.5 text-[11px] font-bold text-emerald-300" style={delay}>
                ✨ PERFECT +{PERFECT_BONUS}
              </span>
            )}
          </article>
        );
      })}
    </section>
  );
}

// ---------- final ----------

function Standings({ view, players }: { view: PixelsView; players: Player[] }) {
  const history = view.history ?? [];
  const order = players.map((_, i) => i).sort((a, b) => view.totals[b] - view.totals[a]);
  const winners = new Set(view.winners ?? []);
  return (
    <section className="card pix-in p-3" aria-label="Final standings">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="label">Final standings</span>
        <span className="text-xs text-muted">
          {history.length} round{history.length === 1 ? "" : "s"} · best copy per round
        </span>
      </div>
      <ol className="flex flex-col gap-1.5">
        {order.map((i) => {
          const p = players[i];
          const rank = 1 + view.totals.filter((t) => t > view.totals[i]).length;
          const won = winners.has(p.id);
          return (
            <li
              key={p.id}
              className="flex min-w-0 items-center gap-2 rounded-xl px-2 py-1.5"
              style={{ background: won ? `${p.color}1f` : i === view.you ? "var(--color-panel-2)" : undefined, boxShadow: won ? `inset 0 0 0 1px ${p.color}66` : undefined }}
            >
              <span className="w-6 shrink-0 text-center text-lg leading-none" aria-label={`Rank ${rank}`}>
                {rank <= 3 ? MEDALS[rank - 1] : <span className="text-xs text-muted">{rank}</span>}
              </span>
              <span className="min-w-0 flex-1">
                <PlayerChip player={p} size="sm" dim={!p.connected} />
              </span>
              <span className="flex shrink-0 items-center gap-1.5" aria-label="Rounds">
                {history.map((r, k) => (
                  <span key={k} className="flex flex-col items-center gap-0.5" title={`Round ${k + 1}: ${r.emblems[i]?.name}, ${r.n[i]}/25`}>
                    <PixelArt art={r.emblems[i]?.art ?? ""} size={22} label={`Round ${k + 1}: ${r.emblems[i]?.name}, ${r.n[i]} of 25`} />
                    <span className="font-mono text-[11px] leading-none text-muted tabular-nums">{r.pts[i]}</span>
                  </span>
                ))}
              </span>
              <b className="w-9 shrink-0 text-right font-display text-xl leading-none font-extrabold tabular-nums" style={{ color: won ? p.color : undefined }}>
                {view.totals[i]}
              </b>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---------- Red vs Blue ----------

const TEAM_ICON = ["🟥", "🟦"];

/** Team totals: teammates share every round's score, so any member's total is the team's. */
function teamTotals(view: PixelsView): [number, number] {
  const t = view.teams;
  if (!t) return [0, 0];
  const total = (k: number) => {
    const i = t[k].length ? view.ids.indexOf(t[k][0]) : -1;
    return i < 0 ? 0 : view.totals[i];
  };
  return [total(0), total(1)];
}

/** One stand-in "player" per team at its first member's seat (others empty): for per-emblem cards and boxes. */
function teamPlayers(view: PixelsView, players: Player[]): (Player | undefined)[] {
  const out: (Player | undefined)[] = players.map(() => undefined);
  view.teams?.forEach((ids, k) => {
    const i = ids.length ? view.ids.indexOf(ids[0]) : -1;
    if (i < 0) return;
    out[i] = {
      id: `team-${k}`,
      name: `${TEAMS[k].name} team`,
      color: TEAMS[k].color,
      avatar: TEAM_ICON[k],
      connected: ids.some((id) => players[view.ids.indexOf(id)]?.connected),
    };
  });
  return out;
}

function TeamIntro({ view, players }: { view: PixelsView; players: Player[] }) {
  const teams = view.teams!;
  const mine = view.you >= 0 ? teamOf(teams, view.ids[view.you]) : -1;
  if (mine < 0) {
    return (
      <span className="font-display text-base font-extrabold @md:text-xl">
        <span style={{ color: TEAMS[0].color }}>{TEAMS[0].name}</span> vs <span style={{ color: TEAMS[1].color }}>{TEAMS[1].name}</span>
      </span>
    );
  }
  const mates = teams[mine].filter((id) => id !== view.ids[view.you]).map((id) => players[view.ids.indexOf(id)]?.name ?? "?");
  const c = TEAMS[mine].color;
  return (
    <span className="pix-pop flex max-w-full flex-col items-center rounded-xl px-3 py-1" style={{ background: `${c}22`, boxShadow: `inset 0 0 0 1.5px ${c}` }}>
      <span className="font-display text-base leading-tight font-extrabold @md:text-xl" style={{ color: c }}>
        You&apos;re on {TEAMS[mine].name}
      </span>
      <span className="max-w-[16rem] truncate text-xs text-muted">{mates.length ? `with ${mates.join(", ")}` : "a team of one: paint fast!"}</span>
    </span>
  );
}

function TeamStrip({ view, players, ready }: { view: PixelsView; players: Player[]; ready: number[] }) {
  const teams = view.teams!;
  const totals = teamTotals(view);
  const lead = totals[0] === totals[1] ? -1 : totals[0] > totals[1] ? 0 : 1;
  return (
    <div className="grid grid-cols-2 gap-2" aria-label="Team scores">
      {teams.map((ids, k) => {
        const c = TEAMS[k].color;
        return (
          <section
            key={k}
            className="card flex min-w-0 flex-col gap-1 px-2 py-1.5"
            style={{ borderColor: `${c}88`, background: `linear-gradient(180deg, ${c}26, ${c}0a)` }}
            aria-label={`${TEAMS[k].name} team: ${totals[k]} points`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="font-display text-sm font-extrabold" style={{ color: c }}>
                {TEAMS[k].name}
                {lead === k && <span aria-label="leading"> 👑</span>}
              </span>
              <b
                key={totals[k]}
                className={`font-display text-lg leading-none font-extrabold tabular-nums ${totals[k] ? "pix-bump" : ""}`}
                style={{ color: c, display: "inline-block" }}
              >
                {totals[k]}
              </b>
            </div>
            <ul className="flex flex-wrap gap-1">
              {ids.map((id) => {
                const i = view.ids.indexOf(id);
                const p = players[i];
                if (!p) return null;
                return (
                  <li key={id}>
                    <PlayerChip player={p} size="sm" dim={!p.connected}>
                      {i === view.you && <span className="text-xs font-semibold text-muted">you</span>}
                      {ready.includes(i) && <span aria-label="ready">✓</span>}
                      {!p.connected && <span aria-label="offline">⚠</span>}
                    </PlayerChip>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function TeamStandings({ view, players }: { view: PixelsView; players: Player[] }) {
  const teams = view.teams!;
  const history = view.history ?? [];
  const totals = teamTotals(view);
  const order = totals[1] > totals[0] ? [1, 0] : [0, 1];
  const winners = new Set(view.winners ?? []);
  return (
    <section className="card pix-in p-3" aria-label="Final standings">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="label">Final standings</span>
        <span className="text-xs text-muted">
          {history.length} round{history.length === 1 ? "" : "s"} · each team&apos;s best copy
        </span>
      </div>
      <ol className="flex flex-col gap-2">
        {order.map((k) => {
          const c = TEAMS[k].color;
          const seat = teams[k].length ? view.ids.indexOf(teams[k][0]) : -1;
          const won = teams[k].some((id) => winners.has(id));
          return (
            <li
              key={k}
              className="flex min-w-0 flex-col gap-1.5 rounded-xl px-2 py-2"
              style={{ background: won ? `${c}1f` : "var(--color-panel-2)", boxShadow: `inset 0 0 0 1px ${won ? c : `${c}44`}` }}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="w-6 shrink-0 text-center text-lg leading-none">{won ? "🏆" : ""}</span>
                <span className="min-w-0 flex-1 truncate font-display text-lg font-extrabold" style={{ color: c }}>
                  {TEAMS[k].name} team
                </span>
                {seat >= 0 && (
                  <span className="flex shrink-0 items-center gap-1.5" aria-label="Rounds">
                    {history.map((r, j) => (
                      <span key={j} className="flex flex-col items-center gap-0.5" title={`Round ${j + 1}: ${r.emblems[seat]?.name}, ${r.n[seat]}/25`}>
                        <PixelArt art={r.emblems[seat]?.art ?? ""} size={22} label={`Round ${j + 1}: ${r.emblems[seat]?.name}, ${r.n[seat]} of 25`} />
                        <span className="font-mono text-[11px] leading-none text-muted tabular-nums">{r.pts[seat]}</span>
                      </span>
                    ))}
                  </span>
                )}
                <b className="w-9 shrink-0 text-right font-display text-xl leading-none font-extrabold tabular-nums" style={{ color: c }}>
                  {totals[k]}
                </b>
              </div>
              <ul className="flex flex-wrap gap-1 pl-8">
                {teams[k].map((id) => {
                  const p = players[view.ids.indexOf(id)];
                  return p ? (
                    <li key={id}>
                      <PlayerChip player={p} size="sm" dim={!p.connected} />
                    </li>
                  ) : null;
                })}
              </ul>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

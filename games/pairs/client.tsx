"use client";

import { useEffect, useRef, useState } from "react";
import type { GameClientProps } from "@/shared/client-game";
import { Note, PlayerChip, StatusBanner, TimerBar, useTicker } from "@/components/game-ui";
import { Avatar } from "@/components/Avatar";
import { PLAYER_COLORS, type Player } from "@/shared/types";
import { feedback, sfx } from "@/lib/feedback";
import { FACES, MISS_COST, PAIR_POINTS, SECOND_COST, soloScore, type PairsAction, type PairsView } from "./shared";

type Props = GameClientProps<PairsView, PairsAction>;

const CSS = `
.mp-grid { display: grid; gap: clamp(6px, 1.6vw, 10px); }
.mp-card { position: relative; aspect-ratio: 1; perspective: 800px; border-radius: .8rem; outline: none; -webkit-tap-highlight-color: transparent; }
.mp-card:focus-visible .mp-inner { box-shadow: 0 0 0 3px var(--acc); border-radius: .8rem; }
.mp-inner { position: absolute; inset: 0; transform-style: preserve-3d; transition: transform .5s cubic-bezier(.3,1.35,.5,1); }
.mp-card[data-up="true"] .mp-inner { transform: rotateY(180deg); }
.mp-face { position: absolute; inset: 0; border-radius: .8rem; backface-visibility: hidden; -webkit-backface-visibility: hidden; display: grid; place-items: center; overflow: hidden; }
.mp-back { border: 1px solid color-mix(in oklab, var(--acc) 35%, var(--color-line));
  background:
    radial-gradient(circle at 50% 50%, color-mix(in oklab, var(--acc) 30%, transparent) 0 14%, transparent 15%),
    repeating-linear-gradient(45deg, color-mix(in oklab, var(--acc) 12%, transparent) 0 6px, transparent 6px 14px),
    repeating-linear-gradient(-45deg, color-mix(in oklab, var(--acc) 12%, transparent) 0 6px, transparent 6px 14px),
    linear-gradient(160deg, #13261f, #0b1210);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / .08), 0 6px 16px -10px #000; transition: transform .15s ease, box-shadow .15s ease; }
.mp-back::after { content: ""; position: absolute; inset: 5px; border-radius: .55rem; border: 1px dashed color-mix(in oklab, var(--acc) 30%, transparent); }
.mp-card[data-live="true"]:hover .mp-back { transform: translateY(-2px); box-shadow: inset 0 1px 0 rgb(255 255 255 / .1), 0 10px 22px -10px var(--acc); }
.mp-front { transform: rotateY(180deg); background: linear-gradient(170deg, #f7f9ff, #dfe6f5); border: 2px solid #fff;
  font-size: clamp(2rem, 9cqi, 3.4rem); box-shadow: 0 8px 22px -12px #000; }
.mp-card[data-own] .mp-front { border-color: var(--own); box-shadow: 0 0 0 2px var(--own), 0 0 22px -4px var(--own); background: linear-gradient(170deg, color-mix(in oklab, var(--own) 22%, #f7f9ff), color-mix(in oklab, var(--own) 34%, #dfe6f5)); }
.mp-card[data-own] { opacity: .92; }
.mp-match .mp-front { animation: mp-match .7s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes mp-match { 0% { transform: rotateY(180deg) scale(1); } 40% { transform: rotateY(180deg) scale(1.14); } 100% { transform: rotateY(180deg) scale(1); } }
.mp-miss .mp-inner { animation: mp-miss .45s .45s ease both; }
@keyframes mp-miss { 0%,100% { translate: 0; } 25% { translate: -5px; } 50% { translate: 5px; } 75% { translate: -3px; } }
.mp-badge { position: absolute; right: 4px; bottom: 4px; width: 22%; aspect-ratio: 1; border-radius: 999px; display: grid; place-items: center; font-size: .65rem; background: var(--own); color: #06120c; font-weight: 900; }
.mp-stat { display: flex; flex-direction: column; align-items: center; min-width: 4.5rem; }
`;

function seatPlayers(view: PairsView, byId: Record<string, Player>): Player[] {
  return view.seats.map(
    (id, i): Player =>
      byId[id] ?? { id, name: `Player ${i + 1}`, color: PLAYER_COLORS[i % PLAYER_COLORS.length], avatar: "🙂", connected: false },
  );
}

const fmt = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

export default function MemoryPairs({ view, isPlayer, byId, act, serverNow, accent }: Props) {
  useTicker(500);
  // Faces we've seen, so a card can keep its picture while it flips back over.
  const [known, setKnown] = useState<Record<number, number>>({});
  const [seenKey, setSeenKey] = useState("");
  const key = view ? view.faces.join(",") : "";
  if (view && key !== seenKey) {
    setSeenKey(key);
    let add: Record<number, number> | null = null;
    view.faces.forEach((f, i) => {
      if (f >= 0 && known[i] !== f) (add ??= { ...known })[i] = f;
    });
    if (add) setKnown(add);
  }

  const you = view && isPlayer ? view.you : -1;
  const myTurn = !!view && view.phase === "pick" && you >= 0 && view.turn === you;

  // Cues.
  const prev = useRef<{ up: number; n: number; myTurn: boolean } | null>(null);
  useEffect(() => {
    if (!view) return;
    const p = prev.current;
    prev.current = { up: view.up.length, n: view.last?.n ?? 0, myTurn };
    if (!p) return;
    if (view.up.length > p.up) sfx("pop");
    if ((view.last?.n ?? 0) > p.n && view.last) {
      if (view.last.match) {
        if (view.last.seat === you) feedback("score");
        else sfx("pop");
      } else sfx("bump");
    }
    if (myTurn && !p.myTurn && !view.solo) feedback("turn");
  }, [view, myTurn, you]);

  if (!view) return <Note>Shuffling the cards…</Note>;

  const seats = seatPlayers(view, byId);
  const mover = seats[view.turn];
  const left = view.owner.filter((o) => o < 0).length / 2;
  const total = view.n / 2;
  const cols = view.n === 16 ? "grid-cols-4" : view.n === 24 ? "grid-cols-4 @lg:grid-cols-6" : "grid-cols-6";
  const maxW = view.n === 16 ? "max-w-[30rem]" : view.n === 24 ? "max-w-[40rem]" : "max-w-[38rem]";
  const lastFresh = view.last && view.phase !== "over" ? view.last : null;
  // The clock stops when the run ends.
  const elapsed = view.secs ?? Math.max(0, Math.floor((serverNow() - view.startedAt) / 1000));

  let status: string;
  let sub = "";
  if (view.phase === "over") status = "Board cleared!";
  else if (view.solo) {
    status = view.phase === "show" ? "No match. Remember them!" : view.up.length === 1 ? "Now find its partner" : lastFresh?.match ? "Match! Keep going" : "Flip a card";
  } else if (myTurn) {
    status = view.up.length === 1 ? "Your turn: flip its partner" : lastFresh?.match && lastFresh.seat === you ? "Match! Go again" : "Your turn: flip a card";
  } else if (view.phase === "show") {
    status = `No match for ${view.turn === you ? "you" : mover?.name}`;
    sub = "Remember where they are…";
  } else {
    status = `${mover?.name ?? "Someone"}'s turn`;
    if (mover && !mover.connected) sub = "They're away: skipping soon";
    else if (lastFresh?.match && lastFresh.seat === view.turn) sub = "Found a pair, going again";
  }

  return (
    <div className="@container mx-auto w-full max-w-[1000px]" style={{ "--acc": accent } as React.CSSProperties}>
      <style href="ruckus-pairs" precedence="default">
        {CSS}
      </style>
      <div className="flex flex-col gap-3">
        {view.phase !== "over" && (
          <div aria-live="polite">
            <StatusBanner key={`${view.turn}:${view.last?.n ?? 0}:${view.phase}:${view.up.length}`} accent={view.solo ? accent : mover?.color}>
              <div className="truncate">{status}</div>
              {sub && <div className="mt-0.5 truncate font-sans text-xs font-medium text-muted sm:text-sm">{sub}</div>}
            </StatusBanner>
          </div>
        )}

        {view.solo ? (
          <SoloBar view={view} elapsed={elapsed} left={left} total={total} />
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap justify-center gap-1.5">
              {seats.map((p, i) => (
                <span
                  key={p.id}
                  className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 transition-all ${i === view.turn && view.phase !== "over" ? "scale-105" : "opacity-80"}`}
                  style={{
                    borderColor: i === view.turn && view.phase !== "over" ? p.color : "var(--color-line)",
                    background: i === view.turn && view.phase !== "over" ? `${p.color}22` : "var(--color-panel)",
                    boxShadow: i === view.turn && view.phase !== "over" ? `0 0 18px -6px ${p.color}` : undefined,
                  }}
                >
                  <PlayerChip player={p} size="sm" dim={!p.connected} />
                  <span className="font-mono text-lg font-bold tabular-nums" style={{ color: p.color }}>
                    {view.scores[i]}
                  </span>
                  {i === you && <span className="label">you</span>}
                </span>
              ))}
            </div>
            {view.phase !== "over" && (
              <TimerBar endsAt={view.endsAt} total={view.turnMs} serverNow={serverNow} color={mover?.color ?? accent} />
            )}
          </div>
        )}

        {view.phase === "over" && <Final view={view} seats={seats} you={you} />}

        <div className={`mp-grid mx-auto w-full ${maxW} ${cols}`} role="grid" aria-label="Cards">
          {view.faces.map((f, i) => {
            const own = view.owner[i];
            const face = f >= 0 ? f : known[i];
            const isUp = f >= 0;
            const canFlip = myTurn && !isUp && own < 0;
            const isLast = !!lastFresh && (lastFresh.a === i || lastFresh.b === i);
            const cls = isLast ? (lastFresh!.match ? "mp-match" : view.phase === "show" ? "mp-miss" : "") : "";
            const ownColor = own >= 0 ? (view.solo ? accent : seats[own]?.color) : undefined;
            return (
              <button
                key={`${i}-${isLast ? lastFresh!.n : 0}`}
                className={`mp-card ${cls}`}
                data-up={isUp}
                data-live={canFlip}
                data-own={own >= 0 ? own : undefined}
                style={ownColor ? ({ "--own": ownColor } as React.CSSProperties) : undefined}
                disabled={!canFlip}
                onClick={() => canFlip && act({ type: "flip", i })}
                aria-label={isUp ? `Card ${i + 1}: ${FACES[f]}${own >= 0 ? ", matched" : ""}` : `Card ${i + 1}, face down`}
              >
                <span className="mp-inner">
                  <span className="mp-face mp-back" aria-hidden />
                  <span className="mp-face mp-front" aria-hidden>
                    {face !== undefined ? FACES[face] : ""}
                    {own >= 0 && !view.solo && seats[own] && (
                      <span className="mp-badge">
                        <Avatar id={seats[own].avatar} />
                      </span>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {!isPlayer && <Note>You&apos;re watching. Every card turned over is a clue for everyone.</Note>}
      </div>
    </div>
  );
}

function SoloBar({ view, elapsed, left, total }: { view: PairsView; elapsed: number; left: number; total: number }) {
  const found = total - left;
  const est = view.final ?? soloScore(found, view.misses[0] ?? 0, elapsed);
  return (
    <div className="card flex flex-wrap items-center justify-around gap-2 px-3 py-2">
      <div className="mp-stat">
        <span className="label">Pairs</span>
        <span className="font-mono text-xl font-bold">
          {found}/{total}
        </span>
      </div>
      <div className="mp-stat">
        <span className="label">Misses</span>
        <span className="font-mono text-xl font-bold">{view.misses[0] ?? 0}</span>
      </div>
      <div className="mp-stat">
        <span className="label">Time</span>
        <span className="font-mono text-xl font-bold">{fmt(elapsed)}</span>
      </div>
      <div className="mp-stat">
        <span className="label">Score</span>
        <span className="font-mono text-xl font-bold" style={{ color: "var(--acc)" }}>
          {est}
        </span>
      </div>
    </div>
  );
}

function Final({ view, seats, you }: { view: PairsView; seats: Player[]; you: number }) {
  if (view.solo) {
    const found = view.owner.filter((o) => o >= 0).length / 2;
    return (
      <div className="card animate-rise p-4 text-center">
        <div className="label">Final score</div>
        <div className="font-display text-5xl font-black" style={{ color: "var(--acc)" }}>
          {view.final ?? 0}
        </div>
        <div className="mt-2 font-mono text-xs text-muted">
          {found} pairs × {PAIR_POINTS} − {view.misses[0]} misses × {MISS_COST} − {view.secs ?? 0}s × {SECOND_COST}
        </div>
        <div className="mt-1 text-sm text-muted">
          {view.flips[0]} flips (a perfect memory needs {view.n})
        </div>
      </div>
    );
  }
  const order = seats.map((_, i) => i).sort((a, b) => view.scores[b] - view.scores[a]);
  const best = Math.max(...view.scores);
  return (
    <div className="card animate-rise p-3">
      <div className="label mb-2">Pairs found</div>
      <ol className="flex flex-col gap-1.5">
        {order.map((i) => (
          <li key={i} className={`flex items-center justify-between rounded-md px-2 py-1 ${i === you ? "bg-panel-2" : ""}`}>
            <span className="flex items-center gap-2">
              <span className="w-5 text-center">{view.scores[i] === best && best > 0 ? "🏆" : ""}</span>
              <PlayerChip player={seats[i]} size="sm" />
            </span>
            <span className="font-mono text-sm text-muted">
              <b className="text-lg text-text" style={{ color: seats[i].color }}>
                {view.scores[i]}
              </b>{" "}
              · {view.misses[i]} misses
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

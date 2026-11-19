"use client";

import { useState } from "react";
import { rateGame, sendRatingNote } from "@/lib/rate-game";
import { Rux } from "./Rux";

// Arrives a beat after the result, the thumbs wiggle twice, then everything sits still:
// noticeable, never nagging. Reduced motion: no movement at all.
const STYLES = `
@keyframes rg-in { 0% { opacity: 0; transform: translateY(14px) scale(.92); } 70% { opacity: 1; transform: translateY(-3px) scale(1.03); } 100% { opacity: 1; transform: none; } }
.rg-in { animation: rg-in .55s cubic-bezier(.2,.9,.25,1) .9s both; }
@keyframes rg-peek { 0% { transform: translateY(70%) rotate(-12deg); } 60% { transform: translateY(-8%) rotate(6deg); } 100% { transform: translateY(0) rotate(-4deg); } }
.rg-peek { animation: rg-peek .6s cubic-bezier(.2,.9,.25,1.2) 1.2s both; }
@keyframes rg-wiggle { 0%, 100% { transform: rotate(0); } 20% { transform: rotate(-16deg) scale(1.12); } 40% { transform: rotate(14deg) scale(1.12); } 60% { transform: rotate(-8deg); } 80% { transform: rotate(4deg); } }
.rg-wiggle { animation: rg-wiggle .7s ease-in-out 1.8s 2 both; }
.rg-wiggle + .rg-wiggle { animation-delay: 1.95s; }
@keyframes rg-pop { 0% { transform: scale(1); } 40% { transform: scale(1.45) rotate(-10deg); } 100% { transform: scale(1.12); } }
.rg-pop { animation: rg-pop .45s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes rg-float { from { opacity: 1; transform: translate(-50%, 0); } to { opacity: 0; transform: translate(-50%, -26px); } }
.rg-float { animation: rg-float .9s ease-out both; }
@keyframes rg-drop { from { opacity: 0; transform: translateY(-6px); } }
.rg-drop { animation: rg-drop .3s ease-out both; }
@media (prefers-reduced-motion: reduce) { .rg-in, .rg-peek, .rg-wiggle, .rg-pop, .rg-float, .rg-drop { animation: none; } }
`;

/**
 * "Fun or nah?" with 👍 / 👎, once per finished game. `gameKey` is unique per game played
 * (e.g. room code + game number), so a new game asks again.
 */
export function RateGame({ gameId, gameKey }: { gameId: string; gameKey: string }) {
  const [voted, setVoted] = useState<{ key: string; v: 1 | -1 } | null>(null);
  const mine = voted?.key === gameKey ? voted.v : null;
  const vote = (v: 1 | -1) => {
    if (mine) return;
    setVoted({ key: gameKey, v });
    rateGame(gameId, v);
  };
  return (
    <div key={gameKey} className="flex flex-col items-center gap-2">
      <div
        className="rg-in flex items-center gap-2 rounded-full border-2 bg-panel py-1 pr-1 pl-1.5 shadow-[3px_4px_0_rgb(0_0_0/0.45)] transition-colors"
        style={{
          borderColor: mine ? "var(--color-line)" : "color-mix(in srgb, var(--color-brand-2) 70%, transparent)",
        }}
      >
        <style>{STYLES}</style>
        <span aria-hidden className="rg-peek block w-8 shrink-0">
          <Rux mood={mine ? (mine > 0 ? "wink" : "wow") : "grin"} className="w-full" />
        </span>
        <span className="marker text-lg leading-none text-text" role="status">
          {mine ? (mine > 0 ? "shukriya! noted" : "noted, sudhaar denge") : "fun tha ya nahi?"}
        </span>
        {([1, -1] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-label={v > 0 ? "I liked this game" : "I didn't like this game"}
            aria-pressed={mine === v}
            disabled={mine !== null}
            onClick={() => vote(v)}
            className={`relative grid size-10 place-items-center rounded-full border-2 text-xl transition-[transform,opacity] duration-150 enabled:hover:scale-110 enabled:active:scale-90 ${
              mine === v ? "rg-pop border-ink bg-brand-2" : mine ? "border-transparent opacity-30" : "rg-wiggle border-line bg-panel-2"
            }`}
          >
            {v > 0 ? "👍" : "👎"}
            {mine === v && (
              <span aria-hidden className="rg-float pointer-events-none absolute -top-2 left-1/2 text-xs font-black text-brand-2">
                +1
              </span>
            )}
          </button>
        ))}
      </div>
      {mine === -1 && <WhatWentWrong gameId={gameId} />}
    </div>
  );
}

const REASONS = ["Confusing", "Boring", "Too hard", "Too slow", "Buggy"];

/** After a 👎: one tap on a reason (or a few typed words). Optional, never asks twice. */
function WhatWentWrong({ gameId }: { gameId: string }) {
  const [sent, setSent] = useState(false);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const send = (note: string) => {
    const t = note.trim();
    if (!t || sent) return;
    setSent(true);
    sendRatingNote(gameId, t);
  };
  if (sent) return <p className="rg-drop text-xs font-semibold text-muted">Thanks, that helps.</p>;
  return (
    <div className="rg-drop w-full max-w-xs rounded-2xl border-2 border-line bg-panel p-2.5">
      <p className="mb-2 text-center text-xs font-bold text-muted">What was bad? (optional)</p>
      {typing ? (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <input
            autoFocus
            value={text}
            maxLength={140}
            onChange={(e) => setText(e.target.value)}
            placeholder="A few words"
            aria-label="What was bad about this game"
            className="min-h-10 min-w-0 flex-1 rounded-lg border-2 border-line bg-panel-2 px-2.5 text-sm outline-none focus:border-brand-2"
          />
          <button type="submit" disabled={!text.trim()} className="btn min-h-10 px-3 text-sm disabled:opacity-40">
            Send
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap justify-center gap-1.5">
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => send(r)}
              className="min-h-9 rounded-full border-2 border-line bg-panel-2 px-3 text-xs font-bold transition-colors hover:border-brand-2 active:scale-95"
            >
              {r}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setTyping(true)}
            className="min-h-9 rounded-full border-2 border-dashed border-line px-3 text-xs font-bold text-muted hover:text-text"
          >
            Something else…
          </button>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { rateGame } from "@/lib/rate-game";

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
    <div className="flex items-center gap-2 rounded-full border-2 border-line bg-ink/40 py-1 pr-1 pl-3">
      <span className="marker text-base leading-none text-muted">{mine ? (mine > 0 ? "noted! glad you liked it" : "noted, we'll fix it") : "fun or nah?"}</span>
      {([1, -1] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-label={v > 0 ? "I liked this game" : "I didn't like this game"}
          aria-pressed={mine === v}
          disabled={mine !== null}
          onClick={() => vote(v)}
          className={`grid size-10 place-items-center rounded-full text-xl transition-transform duration-150 enabled:hover:scale-110 enabled:active:scale-90 ${
            mine === v ? "bg-brand-2 scale-110" : mine ? "opacity-30" : "bg-panel-2"
          }`}
        >
          {v > 0 ? "👍" : "👎"}
        </button>
      ))}
    </div>
  );
}

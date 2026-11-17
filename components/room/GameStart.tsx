"use client";

import { Rux } from "../Rux";

const SHOUTS = ["chalo!", "shuru karo!", "let's go!", "game on!", "bawaal time!"];

/**
 * Rux popping up over the game for a moment when it starts: a quick "chalo!" with a burst.
 * Pointer-transparent and short (~1.3 s), so it never blocks a game's own start.
 * Keyed by the game number by the parent, so it plays once per game.
 */
export function GameStart({ seq }: { seq: number }) {
  return (
    <div aria-hidden className="game-start pointer-events-none absolute inset-x-0 top-6 z-30 flex justify-center">
      <div className="gs-pop flex items-end gap-1">
        <span className="w-16 sm:w-20">
          <Rux mood="shout" megaphone className="w-full" />
        </span>
        <span className="marker mb-4 rounded-2xl border-[3px] border-ink bg-brand-2 px-3 py-1 text-2xl leading-none text-ink shadow-[3px_4px_0_#000] sm:text-3xl">
          {SHOUTS[seq % SHOUTS.length]}
        </span>
      </div>
    </div>
  );
}

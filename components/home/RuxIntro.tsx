"use client";

import { Rux } from "../Rux";

// Before first paint, a script in the root layout (INTRO_SCRIPT) marks <html data-intro>:
// "play" on a first visit to the home page in this tab session, "skip" otherwise.

function done() {
  document.documentElement.dataset.intro = "skip";
}

// The curtain is a grid of tiles that flip to a colour and shrink away in a wave from the
// middle, like a level transition. Delays are worked out once, here.
const COLS = 10;
const ROWS = 6;
const COLORS = ["#c6f432", "#ff4fa3", "#4f7bff", "#ffd23f"];
const TILES = Array.from({ length: COLS * ROWS }, (_, i) => {
  const c = i % COLS;
  const r = Math.floor(i / COLS);
  const d = Math.hypot((c - (COLS - 1) / 2) / COLS, ((r - (ROWS - 1) / 2) / ROWS) * 0.8);
  return { delay: Math.round(d * 900), color: COLORS[(c + r * 3) % COLORS.length] };
});
const LAST = Math.max(...TILES.map((t) => t.delay));

/**
 * The landing intro, once per session: Rux drops in, says hi, does a spinning hop, then the
 * screen breaks into colour tiles that pop away in a wave. Transforms and opacity only (smooth
 * on any phone), ~2 s, tap to skip, nothing at all for people who prefer reduced motion.
 */
export function RuxIntro() {
  return (
    <>
      <div
        className="rux-intro"
        aria-hidden
        onClick={done}
        onAnimationEnd={(e) => {
          if ((e.target as HTMLElement).dataset.last) done();
        }}
      >
        <div className="ri-grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
          {TILES.map((t, i) => (
            <span
              key={i}
              className="ri-tile"
              data-last={t.delay === LAST && TILES.findIndex((x) => x.delay === LAST) === i ? "1" : undefined}
              style={{ "--d": `${t.delay}ms`, "--c": t.color } as React.CSSProperties}
            />
          ))}
        </div>
        <div className="ri-hero">
          <span className="ri-bubble marker">oye! chalo, khelte hain? 🎮</span>
          <span className="ri-rux">
            <span className="ri-hop">
              <span className="ri-face ri-face-wow">
                <Rux mood="wow" className="w-full" />
              </span>
              <span className="ri-face ri-face-grin">
                <Rux mood="grin" className="w-full" />
              </span>
            </span>
          </span>
          <span className="ri-shadow" />
        </div>
      </div>
    </>
  );
}

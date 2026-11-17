"use client";

import { Rux } from "../Rux";
import { SCRAWL_VIEWBOX, SCRAWL_WORD } from "./scrawl";

// Before first paint: a repeat visit in this tab session skips the intro entirely (no flash).
// It marks <html data-intro>, which the CSS reads; <html> has suppressHydrationWarning for it.
const SKIP_SCRIPT = `try{var d=document.documentElement;if(sessionStorage.getItem("rux-intro"))d.dataset.intro="skip";else{sessionStorage.setItem("rux-intro","1");d.dataset.intro="play"}}catch(e){}`;

function done() {
  document.documentElement.dataset.intro = "skip";
}

/**
 * The landing intro, once per session: one lime marker line runs in from the left, scrawls
 * "ruckus" in a single stroke and shoots off to the right; Rux drops onto the line and winks;
 * then the screen splits open along the line. CSS only (~1.7 s), tap to skip, and nothing at
 * all for people who prefer reduced motion.
 */
export function RuxIntro() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: SKIP_SCRIPT }} />
      <div
        className="rux-intro"
        aria-hidden
        onClick={done}
        onAnimationEnd={(e) => {
          if (e.animationName === "ri-split-bottom") done();
        }}
      >
        <span className="ri-half ri-top" />
        <span className="ri-half ri-bottom" />
        <span className="ri-stage">
          <span className="ri-line ri-line-l" />
          <svg viewBox={SCRAWL_VIEWBOX} className="ri-word" overflow="visible">
            <path className="ri-ink ri-ink-shadow" d={SCRAWL_WORD} pathLength={1} />
            <path className="ri-ink" d={SCRAWL_WORD} pathLength={1} />
          </svg>
          <span className="ri-line ri-line-r" />
          <span className="ri-rux">
            <Rux mood="wink" className="w-full" />
          </span>
        </span>
      </div>
    </>
  );
}

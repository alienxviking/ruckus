"use client";

import { Rux } from "../Rux";

// Before first paint: a repeat visit in this tab session skips the intro entirely (no flash).
// It marks <html data-intro>, which the CSS reads; <html> has suppressHydrationWarning for it.
const SKIP_SCRIPT = `try{var d=document.documentElement;if(sessionStorage.getItem("rux-intro"))d.dataset.intro="skip";else{sessionStorage.setItem("rux-intro","1");d.dataset.intro="play"}}catch(e){}`;

function done() {
  document.documentElement.dataset.intro = "skip";
}

/**
 * The landing intro, once per session: Rux pops up and yells "RUCKUS!" through his megaphone,
 * sound rings burst out, then the curtain flies up to reveal the page. CSS only, ~1.4 s,
 * tap to skip, and nothing at all for people who prefer reduced motion.
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
          if (e.target === e.currentTarget) done();
        }}
      >
        <div className="ri-stage">
          <span className="ri-rux">
            <Rux mood="shout" megaphone className="w-full" />
          </span>
          <span className="ri-ring ri-r1" />
          <span className="ri-ring ri-r2" />
          <span className="ri-ring ri-r3" />
          <span className="ri-word font-hero">RUCKUS!</span>
        </div>
      </div>
    </>
  );
}

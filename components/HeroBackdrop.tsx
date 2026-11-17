"use client";

import { useEffect, useRef } from "react";

/**
 * The landing hero's moving backdrop, three layers deep: lava-lamp colour blobs under a print
 * halftone, stage lights sweeping through with a few twinkles, and marker doodles on top that
 * jitter like stop-motion. CSS keyframes on transforms/opacity only, paused whenever the hero
 * is off-screen or the tab is hidden; static for reduced motion.
 */

const C = ["#c6f432", "#ff4fa3", "#4f7bff", "#ffd23f", "#4ce0ff"];

// Marker doodles (24x24 boxes, round strokes).
const DOODLES = [
  "M12 2 L14.6 8.6 L21.5 9 L16.2 13.4 L18 20.2 L12 16.4 L6 20.2 L7.8 13.4 L2.5 9 L9.4 8.6 Z", // star
  "M2 12 C5 6 8 18 11 12 S17 6 20 12 S23 16 23 16", // squiggle
  "M2 16 L6 8 L10 16 L14 8 L18 16 L22 8", // zigzag
  "M12 4 C18 3 21 9 19 14 C17 20 8 21 5 15 C3 10 7 5 13 6", // scribble circle
  "M3 19 L19 5 M11 5 L19 5 L19 13", // arrow
  "M12 12 m0 0 c1 0 2 1 2 2 s-1 3 -3 3 s-4 -2 -4 -4 s2 -6 6 -6 s7 3 7 7", // spiral
  "M12 2 V22 M2 12 H22 M5 5 L19 19 M19 5 L5 19", // sparkle
  "M12 20 C4 14 2 9 5 6 C8 3 11 5 12 8 C13 5 16 3 19 6 C22 9 20 14 12 20 Z", // heart
  "M13 2 L5 14 H11 L9 22 L19 9 H13 Z", // lightning
  "M4 8 Q12 2 20 8 M6 14 Q12 9 18 14 M8 20 Q12 16 16 20", // waves
  "M7 4 L9 4 M15 4 L17 4 M5 14 Q12 22 19 14", // smiley
  "M12 3 V15 M12 20 V21", // !
];

/** Stable pseudo-random numbers per item, so server and client render the same scatter. */
function scatter(n: number, seed: number) {
  return Array.from({ length: n }, (_, i) => (k: number) => {
    const x = Math.sin((i + 1) * 9301 + seed * 49297 + k * 233) * 10000;
    // Rounded: the browser rounds long decimals in style attributes, which would make the
    // server's HTML and the client's first render disagree (a hydration mismatch).
    return Math.round((x - Math.floor(x)) * 1000) / 1000;
  });
}

const DOODLE_SPOTS = scatter(18, 1);
const SPARKS = scatter(22, 3);

export function HeroBackdrop() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let visible = true;
    const sync = () => {
      el.dataset.paused = String(!visible || document.hidden);
    };
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", sync);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return (
    <div ref={ref} aria-hidden className="hero-field bd-mix">
      {/* 1. Lava-lamp colour wash under a print halftone. */}
      {[0, 1, 2, 3].map((i) => (
        <span key={`b${i}`} className={`bd-blob bd-blob-${i}`} style={{ backgroundColor: C[i] }} />
      ))}
      <span className="bd-halftone" />
      {/* 2. Stage lights sweeping through, and a few twinkles. */}
      {[0, 1, 2, 3].map((i) => (
        <span
          key={`l${i}`}
          className="bd-beam"
          style={
            {
              left: `${12 + i * 25}%`,
              "--c": C[i],
              animationDuration: `${6 + i * 1.7}s`,
              animationDelay: `${-i * 1.3}s`,
            } as React.CSSProperties
          }
        />
      ))}
      {SPARKS.map((r, i) => (
        <span
          key={`s${i}`}
          className="bd-spark"
          style={{
            left: `${(r(1) * 100).toFixed(1)}%`,
            top: `${(r(2) * 90).toFixed(1)}%`,
            backgroundColor: C[i % C.length],
            animationDelay: `${(-r(3) * 3).toFixed(2)}s`,
          }}
        />
      ))}
      {/* 3. Marker doodles on top, boiling like stop-motion. */}
      {DOODLE_SPOTS.map((r, i) => (
        <span
          key={`d${i}`}
          className={`bd-doodle ${i >= 9 ? "bd-more" : ""}`}
          style={
            {
              left: `${(r(1) * 96).toFixed(1)}%`,
              top: `${(r(2) * 92).toFixed(1)}%`,
              width: `${Math.round(30 + r(3) * 40)}px`,
              color: C[i % C.length],
              "--rot": `${Math.round((r(4) - 0.5) * 70)}deg`,
              animationDelay: `${(-r(5) * 2).toFixed(2)}s, ${(-r(6) * 9).toFixed(2)}s`,
            } as React.CSSProperties
          }
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d={DOODLES[i % DOODLES.length]} />
          </svg>
        </span>
      ))}
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";

/**
 * The landing hero's moving backdrop: drifting aurora glows, a perspective floor grid
 * running toward the viewer and a slow scan band. CSS keyframes on transforms only,
 * paused whenever the hero is off-screen or the tab is hidden; static for reduced motion.
 */
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
    <div ref={ref} aria-hidden className="hero-field">
      <div className="aurora aurora-a" />
      <div className="aurora aurora-b" />
      <div className="aurora aurora-c" />
      <div className="floor" />
      <div className="scan" />
    </div>
  );
}

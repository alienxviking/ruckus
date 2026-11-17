"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Renders its children once the first screen has settled: after the landing intro (if it's
 * playing) and then when the browser is idle. A same-size placeholder holds the space until
 * then. For heavy below-the-fold sections, so their start-up work never competes with the
 * intro or the hero for the main thread.
 */
export function WhenIdle({ children, minHeight, maxWait = 1800 }: { children: ReactNode; minHeight: string; maxWait?: number }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancel = () => {};
    const whenIdle = () => {
      const go = () => setReady(true);
      if (typeof window.requestIdleCallback === "function") {
        const id = window.requestIdleCallback(go, { timeout: maxWait });
        cancel = () => window.cancelIdleCallback(id);
      } else {
        // Safari: no idle callback, a short delay does the same job.
        const t = setTimeout(go, 600);
        cancel = () => clearTimeout(t);
      }
    };
    const root = document.documentElement;
    if (root.dataset.intro !== "play") {
      whenIdle();
      return () => cancel();
    }
    // The intro marks <html data-intro="skip"> when it's done (or tapped away).
    const mo = new MutationObserver(() => {
      if (root.dataset.intro === "play") return;
      mo.disconnect();
      whenIdle();
    });
    mo.observe(root, { attributes: true, attributeFilter: ["data-intro"] });
    return () => {
      mo.disconnect();
      cancel();
    };
  }, [maxWait]);
  return ready ? <>{children}</> : <div aria-busy="true" style={{ minHeight }} />;
}

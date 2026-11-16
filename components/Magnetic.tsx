"use client";

import { useRef, type ReactNode } from "react";

/**
 * Pulls its child gently toward a fine pointer and springs back on leave. Transform
 * only, on its own wrapper, so the child's own :active press transform still works.
 * Off for touch and for prefers-reduced-motion.
 */
export function Magnetic({
  children,
  strength = 0.22,
  className = "",
}: {
  children: ReactNode;
  strength?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);

  const ok = (e: React.PointerEvent) =>
    e.pointerType === "mouse" && !matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <div
      ref={ref}
      className={`transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform ${className}`}
      onPointerMove={(e) => {
        if (!ok(e)) return;
        const el = ref.current;
        if (!el) return;
        const { clientX, clientY } = e;
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
          const r = el.getBoundingClientRect();
          // Measure without our own offset so the pull never feeds back on itself.
          const cx = r.left + r.width / 2 - (Number(el.dataset.x) || 0);
          const cy = r.top + r.height / 2 - (Number(el.dataset.y) || 0);
          const x = Math.max(-14, Math.min(14, (clientX - cx) * strength));
          const y = Math.max(-10, Math.min(10, (clientY - cy) * strength));
          el.dataset.x = String(x);
          el.dataset.y = String(y);
          el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        });
      }}
      onPointerLeave={() => {
        const el = ref.current;
        cancelAnimationFrame(frame.current);
        if (!el) return;
        el.dataset.x = el.dataset.y = "0";
        el.style.transform = "";
      }}
    >
      {children}
    </div>
  );
}

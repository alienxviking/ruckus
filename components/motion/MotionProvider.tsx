"use client";

import { LazyMotion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";

// Not `strict`: the lazily loaded Animate UI dialog renders full `motion.*` components.
// Only the tiny `m` renderer ships in the page bundle; the animation and layout
// features stream in as a separate chunk once the page is interactive.
const loadFeatures = () => import("./features").then((mod) => mod.default);

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures}>
      {/* Honour the OS "reduce motion" setting: transforms and layout moves become instant. */}
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}

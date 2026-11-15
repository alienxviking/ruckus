"use client";

import type { GameClientProps } from "@/shared/client-game";

// STUB: replace with the real game UI.
export default function Stub({ accent }: GameClientProps) {
  return (
    <p className="text-center text-muted" style={{ color: accent }}>
      This game is still being built.
    </p>
  );
}

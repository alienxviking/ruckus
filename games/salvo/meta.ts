import type { GameMeta } from "../catalog";

// Catalog entry for Salvo (listed in games/catalog.ts).
export const meta: GameMeta = {
  id: "salvo",
  name: "Salvo",
  tagline: "Hide your fleet. Fire three shots a turn.",
  category: "board",
  minPlayers: 2,
  maxPlayers: 2,
  minutes: 8,
  emoji: "⚓",
  accent: "#60a5fa",
  how: [
    "Drag your five ships onto your hidden grid (or hit Random).",
    "Each turn aim three shots at your rival's waters and fire the salvo.",
    "Hits, misses and sinkings are revealed. Sink their whole fleet first to win.",
  ],
  original: true,
  isNew: true,
};

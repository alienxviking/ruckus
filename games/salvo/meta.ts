import type { GameMeta } from "../catalog";

// Catalog entry for Salvo (listed in games/catalog.ts).
export const meta: GameMeta = {
  "id": "salvo",
  "name": "Salvo",
  "tagline": "Hide your fleet. Fire three shots a turn.",
  "category": "board",
  "minPlayers": 2,
  "maxPlayers": 2,
  "minutes": 8,
  "emoji": "⚓",
  "accent": "#60a5fa",
  "how": [
    "Place your ships on a hidden grid.",
    "Each turn fire a salvo of three shots at your rival's waters.",
    "Sink their whole fleet first to win."
  ],
  "original": true,
  "isNew": true
};

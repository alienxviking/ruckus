import type { GameMeta } from "../catalog";

// Catalog entry for Tower Stack (listed in games/catalog.ts).
export const meta: GameMeta = {
  "id": "stack",
  "name": "Tower Stack",
  "tagline": "Drop each block right on top. How high can you go?",
  "category": "arena",
  "minPlayers": 1,
  "maxPlayers": 12,
  "minutes": 3,
  "emoji": "🧱",
  "accent": "#fbbf24",
  "how": [
    "A block slides back and forth. Tap to drop it on the tower.",
    "Whatever hangs over the edge is sliced off, so the tower narrows.",
    "Tallest tower wins. Play solo or stack side by side with friends."
  ],
  "original": true,
  "isNew": true
};

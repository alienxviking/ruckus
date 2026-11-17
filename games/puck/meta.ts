import type { GameMeta } from "../catalog";

// Catalog entry for Puck (listed in games/catalog.ts).
export const meta: GameMeta = {
  "id": "puck",
  "name": "Puck",
  "tagline": "Air hockey, 1v1 or 2v2. Fast.",
  "category": "arena",
  "minPlayers": 2,
  "maxPlayers": 4,
  "minutes": 4,
  "emoji": "🏒",
  "accent": "#38bdf8",
  "how": [
    "Slide your paddle to smack the puck into the other goal.",
    "Play 1v1, or 2v2 with a teammate on each side.",
    "First to 7 goals wins."
  ],
  "original": true,
  "isNew": true,
  "teams": true
};

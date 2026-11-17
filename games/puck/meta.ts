import type { GameMeta } from "../catalog";

// Catalog entry for Puck (listed in games/catalog.ts).
export const meta: GameMeta = {
  "id": "puck",
  "name": "Puck",
  "tagline": "Neon air hockey, 1v1 or 2v2. Fast.",
  "category": "arena",
  "minPlayers": 2,
  "maxPlayers": 4,
  "minutes": 4,
  "emoji": "🏒",
  "accent": "#38bdf8",
  "how": [
    "Drag or mouse your paddle around your half of the table.",
    "Smash the puck into the far goal. Hit through it for power.",
    "1v1, 2v1 or 2v2. First side to 7 goals wins."
  ],
  "original": true,
  "isNew": true,
  "teams": true
};

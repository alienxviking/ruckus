import type { GameMeta } from "../catalog";

// Catalog entry for Flag Raid (listed in games/catalog.ts).
export const meta: GameMeta = {
  "id": "flags",
  "name": "Flag Raid",
  "tagline": "Capture their flag. Guard your own.",
  "category": "arena",
  "minPlayers": 2,
  "maxPlayers": 12,
  "minutes": 6,
  "emoji": "🚩",
  "accent": "#ef4444",
  "how": [
    "Two teams, two bases. Sneak into enemy ground and grab their flag.",
    "Get tagged on their side and you're sent home. Tag raiders on your side.",
    "Carry the flag home to score. First to 3 captures wins."
  ],
  "original": true,
  "isNew": true,
  "teams": true
};

import type { GameMeta } from "../catalog";

// Catalog entry for Flag Raid (listed in games/catalog.ts).
export const meta: GameMeta = {
  "id": "flags",
  "name": "Flag Raid",
  "tagline": "Steal their flag. Guard your own. Pure chaos.",
  "category": "arena",
  "minPlayers": 2,
  "maxPlayers": 12,
  "minutes": 5,
  "emoji": "🚩",
  "accent": "#ef4444",
  "how": [
    "Two teams, two halves. Run into enemy ground and grab their flag.",
    "Touched on their side? You're sent home. On your side, you do the tagging.",
    "Carry the flag into your base to score. First to 3 captures wins."
  ],
  "original": true,
  "isNew": true,
  "teams": true
};

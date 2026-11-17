import type { GameMeta } from "../catalog";

// Catalog entry for Hot Seat (listed in games/catalog.ts).
export const meta: GameMeta = {
  "id": "hotseat",
  "name": "Hot Seat",
  "tagline": "How well do you really know your friends?",
  "category": "party",
  "minPlayers": 3,
  "maxPlayers": 12,
  "minutes": 8,
  "emoji": "🔥",
  "accent": "#fb7185",
  "how": [
    "Each round one player takes the hot seat and secretly answers a fun question.",
    "Everyone else guesses what they picked, then talk it out on the call.",
    "Score for every right guess. The hot seat scores when friends read them right."
  ],
  "original": true,
  "isNew": true,
  "call": true
};

import type { GameMeta } from "../catalog";

// Catalog entry for Hot Seat (listed in games/catalog.ts).
export const meta: GameMeta = {
  "id": "hotseat",
  "name": "Hot Seat",
  "tagline": "How well do you really know your friends?",
  "category": "party",
  "minPlayers": 3,
  "maxPlayers": 12,
  "minutes": 10,
  "emoji": "🔥",
  "accent": "#fb7185",
  "how": [
    "Each round one player takes the hot seat and secretly answers a fun question about themselves.",
    "Everyone else predicts their pick. Drumroll, reveal, then talk it out on the call.",
    "Right reads score 100. The hot seat scores when friends read them right."
  ],
  "original": true,
  "isNew": true,
  "call": true
};

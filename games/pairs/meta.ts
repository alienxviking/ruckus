import type { GameMeta } from "../catalog";

// Catalog entry for Memory Pairs (listed in games/catalog.ts).
export const meta: GameMeta = {
  "id": "pairs",
  "name": "Memory Pairs",
  "tagline": "Flip two cards. Remember. Match them all.",
  "category": "brain",
  "minPlayers": 1,
  "maxPlayers": 6,
  "minutes": 5,
  "emoji": "🃏",
  "accent": "#34d399",
  "how": [
    "Flip two cards a turn. Find a matching pair and you keep it.",
    "Solo: clear the board in as few flips as you can.",
    "With friends: take turns, and a match earns another go. Most pairs wins."
  ],
  "original": true,
  "isNew": true
};

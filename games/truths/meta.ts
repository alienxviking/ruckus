import type { GameMeta } from "../catalog";

// Catalog entry for Truth Bombs (listed in games/catalog.ts).
export const meta: GameMeta = {
  "id": "truths",
  "name": "Truth Bombs",
  "tagline": "Two truths, one lie. Read it out. Can they tell?",
  "category": "party",
  "minPlayers": 3,
  "maxPlayers": 10,
  "minutes": 15,
  "emoji": "💣",
  "accent": "#22d3ee",
  "how": [
    "Everyone writes three things about themselves: two true, one made up.",
    "Take turns reading yours out loud on the call while everyone grills you and votes on the lie.",
    "Spot a lie for 100. Score 50 for every friend your lie fools."
  ],
  "original": true,
  "isNew": true,
  "call": true
};

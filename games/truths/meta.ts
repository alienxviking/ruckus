import type { GameMeta } from "../catalog";

// Catalog entry for Truth Bombs (listed in games/catalog.ts).
export const meta: GameMeta = {
  "id": "truths",
  "name": "Truth Bombs",
  "tagline": "Two truths, one lie. Read it out. Can they tell?",
  "category": "party",
  "minPlayers": 3,
  "maxPlayers": 10,
  "minutes": 10,
  "emoji": "💣",
  "accent": "#22d3ee",
  "how": [
    "Everyone writes three things about themselves: two true, one made up.",
    "Take turns reading yours out loud on the call while everyone votes on the lie.",
    "Score for spotting lies, and for every friend your lie fools."
  ],
  "original": true,
  "isNew": true,
  "call": true
};

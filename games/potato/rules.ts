import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Be the last player still holding on to a life when everyone else has been blown up.",
  flow: [
    "Each round the potato starts in a random player's hands with a secret fuse somewhere between 12 and 30 seconds.",
    "If you're holding it, solve the tiny puzzle on your screen: a quick sum, the odd emoji out, repeat 3 arrows, or tap the colour of the ink (not the word).",
    "Solve it and the potato is ready to throw: tap any other player to send it flying. It's in the air for half a second.",
    "Whoever catches it gets a fresh puzzle and does the same. You can't throw it straight back to the person who just threw it to you, unless only two of you are left.",
    "When the fuse runs out: BOOM. Whoever is holding it loses a life, and a new round starts after a short pause.",
  ],
  controls: {
    desktop: [
      "Press 1–9 to pick a puzzle answer.",
      "Use the arrow keys or WASD for arrow puzzles.",
      "Once it's ready, press the number key shown next to a player (1–9, then 0) to throw to them.",
      "Or just click answers and players with the mouse.",
    ],
    touch: [
      "Tap the right answer on the puzzle.",
      "Tap the arrow buttons to repeat an arrow pattern.",
      "Once it's ready, tap a player to throw it to them.",
    ],
  },
  scoring: [
    "Everyone starts with 2 lives, or just 1 life when there are 9 or more players.",
    "Holding the potato when it explodes costs you 1 life. If it explodes while it's in the air, the thrower loses the life.",
    "A wrong answer doesn't cost a life, but it freezes you for a moment before a new puzzle appears.",
    "Lose your last life and you're out (you can still throw emoji heckles). The last player standing wins.",
  ],
  tips: [
    "Nobody knows the fuse length, and the sparks grow the same way every round, so they're no clue. Get rid of it fast.",
    "Don't throw at the last second: a potato that blows up mid-air still counts against you.",
    "Ink puzzles are a trap: tap the colour the word is painted in, not the colour it spells.",
  ],
};

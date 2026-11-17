import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Be the first to win 3 rounds by being the last player still standing on the floor.",
  flow: [
    "Everyone starts on a floor of hex tiles over a sea of lava. After a 3-second countdown, start moving.",
    "Every tile you step off cracks and drops into the lava a moment later. Stand on one tile for more than about a second and it cracks under you too.",
    "Bump into rivals to shove them toward the holes, and jump over a single missing tile to escape.",
    "Power-ups appear on the floor. Run over one to use it straight away: 🧱 Rebuild fixes the floor around you, 🪽 Float lets you hover over lava for 3 seconds, 💥 Shockwave cracks the floor under everyone else.",
    "After 25 seconds the outer ring starts crumbling, then another ring every 3 seconds. Fall in and you're out until the next round.",
  ],
  controls: {
    desktop: [
      "Run with WASD or the arrow keys.",
      "Jump with Space (or Shift). A jump clears one missing tile, not two.",
    ],
    touch: [
      "Hold and drag on the left half of the arena to run.",
      "Tap the right half of the arena, or the JUMP button, to hop a gap.",
    ],
  },
  scoring: [
    "The last player standing wins the round. If the last players fall together, nobody gets the round.",
    "The first player to win 3 rounds wins the game.",
    "If nobody reaches 3 wins after 7 rounds, whoever has won the most rounds wins (ties share the win).",
  ],
  tips: [
    "Keep moving, but plan a loop: every tile you leave is gone for good.",
    "After you jump you have to wait 1.5 seconds before you can jump again, so don't waste it.",
    "Try to stay near the middle: once the edges start crumbling, it's the last solid ground.",
  ],
};

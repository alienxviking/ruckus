import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Be the first to win 2 rounds by being the last snake alive, or the longest when time runs out.",
  flow: [
    "Every snake starts 4 long near the edge of the board. After a 3-second countdown, all snakes start moving at once.",
    "Your snake never stops. Steer it to eat pellets and grow, and avoid crashing.",
    "A gold star appears roughly every 8 seconds. Crashed snakes burst into pellets for others to eat.",
    "The round ends when only one snake is left, or after 90 seconds.",
    "After a 3-second break the next round starts. The match lasts up to 5 rounds.",
  ],
  controls: {
    desktop: [
      "Arrow keys or WASD to steer.",
      "You can also click and drag on the board in the direction you want to go.",
      "You can't turn straight back into yourself; that press is ignored.",
    ],
    touch: [
      "Swipe on the board in the direction you want to go.",
      "Or tap beside your snake's head to turn that way.",
      "Or use the on-screen arrow pad below the board.",
    ],
  },
  scoring: [
    "A pellet makes you 1 longer. A gold star makes you 3 longer.",
    "Hitting a wall, any snake's body or your own body knocks you out for the round. Two heads crashing together knock out both.",
    "Last snake standing wins the round. If time runs out, the longest snake wins; a tie for longest, or everyone crashing, is a draw.",
    "First to 2 round wins takes the match. If nobody gets there in 5 rounds, the most round wins takes it (ties share).",
  ],
  tips: [
    "Get your head just in front of a rival so they run into your body.",
    "Turns are buffered, so you can tap two directions quickly to make a tight U-turn.",
    "When someone crashes, race to their pellets: it's the fastest way to grow.",
  ],
};

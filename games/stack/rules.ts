import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Build the tallest, tidiest tower: your best tower's points count.",
  flow: [
    "After a 3-second countdown, a block starts sliding back and forth above your tower. Everyone gets the same sequence of slides.",
    "Drop it. The part that lands on the tower stays; whatever hangs over the edge is sliced off, so the next block is that much smaller.",
    "Each new block slides a little faster. A block you don't drop within 9 seconds falls by itself.",
    "Miss the tower completely and it topples. You get 2 towers by default (the host can pick 1 to 3) and your best one counts.",
    "The game ends when every tower has toppled, or after 4 minutes.",
  ],
  controls: {
    desktop: ["Click the tower, or press Space, Enter or ↓ to drop the block."],
    touch: ["Tap anywhere on the tower to drop the block."],
  },
  scoring: [
    "Every block that stays on the tower: 10 points.",
    "A perfect drop (within 3% of dead centre) snaps into place with nothing cut, and scores 5 bonus points.",
    "From 3 perfects in a row, every further perfect also grows the block back a little.",
    "Your best tower's points are your score. Most points wins; tied players share the win.",
    "The host can make the blocks Chill, Normal or Fast.",
  ],
  tips: [
    "Watch the block's shadow line up with the edge of the tower below.",
    "Don't rush: the block always slides back. Wait for a clean line-up.",
  ],
};

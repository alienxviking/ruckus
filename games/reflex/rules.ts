import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  quick: [
    { icon: "hand", anim: "float", text: "Keep still and wait for the signal" },
    { icon: "ban", anim: "wiggle", text: "Don't fall for fake words" },
    { icon: "zap", anim: "tap", text: "Tap first when it says DRAW!" },
  ],
  win: "First to win five rounds",
  goal: "Be the first to win 5 rounds (the host can change this) by tapping fastest when the panel says DRAW!",
  flow: [
    "Each round starts with 2 seconds to get ready. Keep your hands still.",
    "Then the wait begins. The real signal comes somewhere between 1.5 and 5 seconds later.",
    "In some rounds a yellow fake word like DRAW? or DRAMA! flashes first (the host can make these rarer or more common). Don't tap on it.",
    "When the panel turns green and says DRAW!, tap. You get one tap per round, and the round closes when everyone has tapped or after 2 seconds.",
    "Everyone's reaction times are shown for a few seconds, then the next round starts.",
  ],
  controls: {
    desktop: ["Click anywhere in the game, or press Space or Enter."],
    touch: ["Tap anywhere in the game."],
  },
  scoring: [
    "The fastest tap in a round scores 1 point. If two or more players tie on the exact same time, they all score.",
    "Tapping before DRAW! (during the wait or on a fake word) is a foul: you sit out that round and can't score.",
    "If you don't tap within 2 seconds of DRAW!, you score nothing that round.",
    "First to 5 points wins (or whatever target the host picked). If more than one player reaches 5 in the same round, they share the win.",
  ],
  tips: [
    "Watch for the green panel and the exact word DRAW!, not just any flash of text.",
    "Rest your finger lightly on the screen or key so you only have to press, not reach.",
  ],
};

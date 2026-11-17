import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Hide among 36 identical bots, light landmarks and dart the other humans to score the most points over 3 rounds.",
  flow: [
    "Each round you are one walker in a park full of look-alike bots. Only you can see which walker is yours.",
    "There are 5 landmarks (Statue, Bell, Clock, Tulips, Carousel). Stand on one for 1.5 seconds to light it. Each light makes a pulse everyone can see, but bots sometimes fake pulses too.",
    "After a 4-second start, your 3 darts unlock. Throw one at any walker you think is a human.",
    "Hit a human and they're out for the rest of the round. Hit a bot and you light up in your own colour for a moment, so everyone can spot you.",
    "A round ends when someone lights all 5 landmarks, when only one human is left, or after 100 seconds. Play 3 rounds, each in a new park.",
  ],
  controls: {
    desktop: [
      "WASD or the arrow keys to walk.",
      "Hold Shift to sprint (bots never sprint, so it looks suspicious).",
      "Point at a walker and click to throw a dart, or press Space or Enter while pointing at one.",
      "You can also click and drag in the park to walk.",
    ],
    touch: [
      "Drag anywhere in the park to walk.",
      "Tap a walker to aim, then tap them again or press THROW to throw a dart.",
      "Hold SPRINT to run faster (bots never run, so careful).",
    ],
  },
  scoring: [
    "Dart a human: +2 points, and they're out for the round. Darting a bot costs you a dart and gives away where you are.",
    "Light all 5 landmarks: +3 points and the round ends right away.",
    "Be the last human not darted: +2 points.",
    "If time runs out (100 seconds), the humans still in with the most lit landmarks each get +3.",
    "You get 3 darts per round, at most one every 0.7 seconds. Most points after 3 rounds wins; ties share the win.",
  ],
  tips: [
    "Move like a bot: walk in straight lines at normal speed and pause now and then. Sprinting and zig-zagging give you away.",
    "Watch for walkers that head straight to a landmark and wait there, then dart them after they pulse.",
    "Don't throw darts too fast. Every miss shows everyone where you are.",
  ],
};

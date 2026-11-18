import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  quick: [
    { icon: "shuffle", anim: "spin", text: "Cards are shuffled face down" },
    { icon: "tap", anim: "tap", text: "Flip two cards on your turn" },
    { icon: "check", anim: "bounce", text: "Match them to keep them and go again" },
  ],
  win: "Find the most pairs",
  goal: "Find matching pairs of cards: solo for the best score, with friends for the most pairs.",
  flow: [
    "The cards are shuffled face down: 24 by default (the host can pick 16, 24 or 36).",
    "On your turn, flip two cards. If they show the same picture, the pair is yours and you flip again.",
    "If they don't match, everyone gets a moment to memorise them, then they flip back and the next player goes.",
    "With friends, each turn has a 15-second clock (the host can pick 10, 15 or 25). If it runs out, your turn passes. A disconnected player's turn is skipped after a few seconds.",
    "The game ends when every pair has been found (solo games also stop after 6 minutes).",
  ],
  controls: {
    desktop: ["Click a card to flip it."],
    touch: ["Tap a card to flip it."],
  },
  scoring: [
    "With friends: each pair is 1 point. Most pairs wins; tied players share the win.",
    "Solo: 100 points per pair, minus 10 for every wrong pair you turn over and 1 for every second. Each pair found is always worth at least 10.",
  ],
  tips: [
    "Every card someone turns over is a free clue: remember where it was.",
    "Flip a card you've never seen first. If it matches one you remember, go get it.",
  ],
};

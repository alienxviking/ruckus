import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Be the last player with any dice left.",
  flow: [
    "Everyone starts with the same number of dice: 5 each with up to 4 players, 4 each with 5–6 players, 3 each with 7–8 players. The host can set a different number.",
    "Each round, everyone rolls in secret. You can see only your own dice.",
    "Players take turns bidding on how many dice on the whole table show one face, like \"four 5s\". Ones are wild: they count as every face. You can't bid on ones.",
    "On your turn, raise the bid (more dice, or the same number of a higher face) or call Liar! on the last bid. You have 30 seconds per turn (the host can change this).",
    "Someone calls: every die is revealed and counted, and someone loses a die. Whoever lost the die starts the next round.",
    "Lose your last die and you're out. Play continues until one player is left.",
  ],
  controls: {
    desktop: [
      "↑ / ↓ (or + / -) change the number of dice in your bid. ← / → or keys 2–6 pick the face.",
      "Press Enter or click Bid to place your bid.",
      "Press L or click Liar! to challenge the last bid. Press S or click Spot on for an exact-count call (3+ players only).",
    ],
    touch: [
      "Use the − and + buttons to set the number of dice, and tap a face to choose it.",
      "Tap Bid to place it, Liar! to challenge the last bid, or Spot on for an exact-count call (3+ players only).",
    ],
  },
  scoring: [
    "Liar!: if there are fewer matching dice than bid, the bidder loses a die. If there are at least that many, the caller loses a die.",
    "Spot on (only while 3+ players still have dice): you claim the bid is exactly right. If it is, you win a die back (never above your starting number). If not, you lose a die.",
    "If your turn timer runs out, the game plays a move for you.",
    "The last player still holding dice wins.",
  ],
  tips: [
    "Count your own dice that match the bid, ones included, then guess about a third of everyone else's dice also match.",
    "Ones help every face, so a hand full of ones lets you bid more boldly.",
    "Watch the odds shown under your bid buttons before you call Liar! or Spot on.",
  ],
};

import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Finish with the most money: your leftover cash plus the value of every crate you bought.",
  flow: [
    "Everyone starts with $100. There are 8 mystery crates: 3 or 4 treasures, 2 junk, 1 or 2 cursed, and one 🎁 gift crate.",
    "Peek time (15 seconds): you secretly see inside a few crates. Every crate is seen by exactly 2 players, and nobody knows who the other one is. Press \"I've seen enough\" to start early once everyone is ready.",
    "The crates are auctioned one at a time. Bidding opens a moment after each crate appears.",
    "Every new bid restarts the countdown: going once, going twice, last call, about 4.5 seconds in all. When it runs out, the top bidder pays and takes the crate, and its contents are shown to everyone.",
    "If nobody bids within 6 seconds, the crate goes unsold. After the 8th crate, the 🎁 gift is opened and the scores are counted.",
  ],
  controls: {
    desktop: [
      "Click +$1, +$5 or +$10 to raise the current top bid by that much, or press 1, 2 or 3.",
      "Type an exact amount in the box and press Bid (or Enter).",
    ],
    touch: [
      "Tap +$1, +$5 or +$10 to raise the current top bid by that much.",
      "Type an exact amount in the box and tap Bid.",
    ],
  },
  scoring: [
    "Treasure is worth $10 to $60, junk $0 to $5, and a cursed crate takes $15 to $40 off your total.",
    "The 🎁 gift is a coin flip that was decided before the game: it either doubles the total value of your other crates or wipes it to $0. Only the 2 players who peeked inside it know which.",
    "Bids start at $1. You can't bid more than the cash you have, and you can't outbid yourself.",
    "Final score = cash left + crate values. The highest score wins; ties share the win.",
  ],
  tips: [
    "If you peeked at junk or a curse, bid it up to drain a rival's cash, then stop before you end up owning it.",
    "Someone bidding hard may know something, or may be bluffing. Remember the other peeker exists too.",
    "Don't spend everything early. Cash you keep counts just as much as treasure you win.",
  ],
};

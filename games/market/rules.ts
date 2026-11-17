import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Make the most profit over 3 rounds (the host can change this) by buying when the final total looks higher than the price and selling when it looks lower.",
  flow: [
    "Each round, every player gets one secret card (A = 1 up to K = 13) and 3 street cards are dealt face down.",
    "The contract is worth the sum of all those cards: every player's card plus the 3 street cards.",
    "You have 90 seconds to trade (the host can pick 60 or 120). The street cards flip one at a time, at 25, 50 and 70 seconds in a 90-second round.",
    "At the bell, every card is shown and your trades are settled at the real total. You see the results for 8 seconds.",
    "After the last round, the player with the highest total profit wins.",
  ],
  controls: {
    desktop: [
      "B buys at the best price on offer; S sells at the best price someone is paying.",
      "1 to 5 picks how many lots you trade at once.",
      "Q posts both your bid and your ask; X pulls all your quotes.",
      "Type a price in the bid or ask box and press Enter to post just that side.",
      "Click someone's quote in the order book to trade with them directly.",
    ],
    touch: [
      "Tap BUY or SELL to trade right away at the best price.",
      "Tap a size from 1 to 5.",
      "Use the −5, −1, +1, +5 buttons to set your bid and ask, then tap Post bid, Post ask or Post both.",
      "Tap a quote in the order book to trade with that player; tap the cancel button on your own quote, or Pull all, to remove it.",
    ],
  },
  scoring: [
    "Each lot you buy earns (final total − price you paid); each lot you sell earns (price you sold at − final total).",
    "You can hold at most 15 lots long or 15 lots short at a time, and trade up to 5 lots per order.",
    "A House bot always quotes about 6 points either side of the fair guess (known street cards plus 7 for each hidden card), so there's always someone to trade with.",
    "Profits add up over every round. Highest total wins; equal totals share the win.",
    "If fewer than 2 traders stay connected for 20 seconds, the market closes early and scores as they stand.",
  ],
  tips: [
    "Start from 7 per hidden card, then nudge it with your own card: a King means the total is probably higher than the crowd thinks.",
    "Watch what others do: someone buying hard probably holds a high card.",
    "Posting a bid below your guess and an ask above it lets other players pay you the spread.",
  ],
};

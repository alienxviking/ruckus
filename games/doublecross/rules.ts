import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  quick: [
    { icon: "talk", anim: "wiggle", text: "Chat, promise and bluff with your partner" },
    { icon: "hand", anim: "tap", text: "Secretly pick Split or Steal" },
    { icon: "coins", anim: "pulse", text: "Both split: share. One steals: takes all" },
  ],
  win: "Most points after the final heist",
  goal: "Finish the 6 rounds (the host can pick 4 or 8) with the most points by knowing when to trust and when to steal.",
  flow: [
    "Each round you're seated at a private table with one partner (or two, if there's an odd number of players). The game avoids repeat partners where it can.",
    "You get 40 seconds (the host can change this) to chat privately: make promises, bluff or beg. Tap Done talking when you're finished: once every player is done, everyone moves on early.",
    "Then you have 10 seconds to secretly pick Split or Steal. You can change your mind until the timer ends or everyone has picked.",
    "The cards flip and everyone's choice is shown to the whole room, so your reputation follows you into later rounds.",
    "The last round is the Heist: everyone sits at one big table with a pot of about 30 points and a little less time to talk (30 seconds by default).",
  ],
  controls: {
    desktop: [
      "Type a message (up to 120 characters) or click a quick-chat button to talk to your table.",
      "Press 1 or Left arrow to pick Split, 2 or Right arrow to pick Steal, or click the cards.",
    ],
    touch: [
      "Type a message or tap a quick-chat button to talk to your table.",
      "Tap Split or Steal to make your choice.",
    ],
  },
  scoring: [
    "Pots grow each round: 4, 6, 8, 10, then 14 points in a 6-round game (half as much again at a table of three).",
    "Everyone splits: the pot is shared evenly. Exactly one thief: they take the whole pot and the others get 0. Two or more thieves: nobody gets anything.",
    "Don't pick in time and you automatically Split.",
    "After the Heist, the highest total wins. Tied players share the win.",
  ],
  tips: [
    "Everyone sees every choice after the flip, so stealing early can make people stop trusting you later.",
    "In the Heist, if two or more players steal, nobody gets a point. That's a lot of trust to ask for.",
  ],
};

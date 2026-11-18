import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  quick: [
    { icon: "swords", anim: "float", text: "Five castles, each worth points" },
    { icon: "users", anim: "slide", text: "Split your 100 troops in secret" },
    { icon: "crown", anim: "bounce", text: "Biggest army takes the castle" },
  ],
  win: "Most points after the last round",
  goal: "Score the most points over 5 rounds (the host can change this) by sending bigger armies than everyone else to the right castles.",
  flow: [
    "Each round shows five castles, each worth 2 to 9 points. One of them secretly hides a dragon with 10 to 40 strength.",
    "In secret, split your 100 troops across the five castles, then lock in. You get 40 seconds (the host can change this), plus 10 extra in round 1.",
    "When everyone has locked in (or time runs out), the castles are revealed one by one.",
    "After the reveal you see the round's points. Everyone's past armies stay visible, so you can study how people play.",
    "After the last round, the player with the most points wins.",
  ],
  controls: {
    desktop: [
      "Use the + and − buttons (hold to repeat), drag the slider, or type a number for each castle.",
      "In a castle's number box: Up/Down arrows add or remove 1 troop, Shift or Page Up/Page Down move 10, Home empties it, End puts all your spare troops there.",
      "Quick plans: Even, By value, 🎲 Random split, or Clear. \"All in\" sends every spare troop to that castle.",
      "Press 🔒 Lock in when you're done. You can unlock and change your plan until the battle starts.",
    ],
    touch: [
      "Tap or hold + and − on each castle, or drag its slider.",
      "Tap a quick plan (Even, By value, 🎲, Clear) or \"All in\" on a castle to move troops fast.",
      "Tap 🔒 Lock in when you're done. Tap Unlock to change your mind before the battle.",
    ],
  },
  scoring: [
    "The biggest army at a castle takes all its points. If several players tie for biggest, they split the points (rounded down, at least 1 each).",
    "At the dragon's castle, the biggest army must also be bigger than the dragon. If not, the dragon keeps it and nobody scores.",
    "A castle nobody sends troops to scores for nobody. You don't have to use all 100 troops.",
    "If you don't lock in, your last unlocked plan is used. If you never touched the board, your troops are split evenly (20 each).",
    "Most points after the last round wins; ties share the win. If fewer than 2 players are online for 30 seconds, the game ends with the current scores.",
  ],
  tips: [
    "You can't win everything. Pick two or three castles to win big and leave the rest nearly empty.",
    "Sending a few troops to a castle everyone ignores can steal its points for cheap.",
    "Check the history: if a player always spreads troops evenly, beat them with 21 troops where it counts.",
  ],
};

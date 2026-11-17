import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Score the most points over 3 rounds by surviving as a human, biting as a zombie, and curing your friends.",
  flow: [
    "Each round one player starts as patient zero, the first zombie (two zombies when there are 8 or more players). Everyone else is a survivor.",
    "A round lasts 75 seconds. If a zombie touches you, you turn into a zombie too and start hunting the others.",
    "Survivors are smaller than zombies, so they can slip through the narrow striped doors that zombies can't fit through.",
    "Items appear on the map every few seconds: grab 💉 to cure the next zombie you touch, or 🔦 to stun nearby zombies.",
    "The round ends when time runs out or when everyone has been infected. A new patient zero is picked for the next round.",
  ],
  controls: {
    desktop: [
      "Move with WASD or the arrow keys.",
      "Press Space to use your 🔦 flash as a survivor, or to lunge forward as a zombie.",
    ],
    touch: [
      "Drag anywhere on the map to run, like a joystick.",
      "Tap the action button to use your 🔦 flash as a survivor, or to lunge as a zombie.",
    ],
  },
  scoring: [
    "Still human when the 75-second bell rings: +5 points.",
    "Every survivor you bite as a zombie: +2 points. Every zombie you cure with 💉: +2 points.",
    "If patient zero infects everyone before time runs out, each patient zero gets +3.",
    "After 3 rounds the highest total wins. Tied players share the win.",
  ],
  tips: [
    "Patient zero can't be cured. Touching them while carrying 💉 just gets you bitten.",
    "The 🔦 flash stuns every zombie close to you for about 2 seconds. Save it for when you're cornered.",
    "A zombie's lunge needs 4 seconds to recharge, so dodge the first one and run.",
  ],
};

import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Be the last disc left on the ice in a round, and win 3 rounds (the host can change this) to become champion.",
  flow: [
    "Everyone starts spread around a round ice rink. A 3-second countdown starts each round.",
    "Steer your disc and dash into rivals to knock them into the water. The ice is slippery, so you keep sliding.",
    "About 8 seconds in, a power-up drops on the ice. Touch it to grab it. A new one appears 6 seconds after it's taken.",
    "After 15 seconds the rink starts melting. It shrinks steadily for 40 seconds, then keeps creeping in until someone falls.",
    "The last disc on the ice wins the round. A new round starts a few seconds later.",
  ],
  controls: {
    desktop: [
      "WASD or the arrow keys to steer.",
      "Space or Shift to dash. You can also click the DASH button.",
      "You can also click and drag anywhere on the rink with the mouse to steer.",
    ],
    touch: [
      "Press and drag on the left half of the rink to steer, like a joystick.",
      "Tap the right half of the rink, or the DASH button, to dash.",
    ],
  },
  scoring: [
    "Last disc standing wins the round. If everyone left falls at the same moment, nobody gets the round.",
    "First to 3 round wins is champion (the host can pick 2, 3 or 5). If nobody gets there after 7 rounds (11 for first to 5, 5 for first to 2), whoever won the most rounds wins (ties share the crown).",
    "Your dash recharges in 2.5 seconds. 🍔 Heavy gives you 2.2× the mass and a bigger disc for 6 seconds. ⚡ Turbo recharges your dash in 0.6 seconds for 5 seconds.",
    "Knockouts are counted when a rival falls within 3 seconds of you shoving them, but only round wins decide the champion.",
    "If fewer than 2 players are connected for 10 seconds, the match ends.",
  ],
  tips: [
    "Don't dash blindly near the edge: you slide a long way and can shoot yourself into the water.",
    "Stay near the middle once the rink starts melting, and let rivals fight each other at the edges.",
    "Grab 🍔 Heavy before a big clash: a heavier disc barely moves when hit.",
  ],
};

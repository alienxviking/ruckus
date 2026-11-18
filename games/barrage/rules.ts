import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  quick: [
    { icon: "crosshair", anim: "float", text: "Secretly set your angle and power" },
    { icon: "bomb", anim: "bounce", text: "All tanks fire at the same time" },
    { icon: "shield", anim: "pulse", text: "Lose all armour and you're out" },
  ],
  win: "Last tank still rolling",
  goal: "Be the last tank still rolling, or have the most armour left when the last turn ends (15 turns; the host can change this).",
  flow: [
    "Every tank starts with 100 armour on a hilly map, spread out from left to right.",
    "Each turn, everyone aims in secret: set your angle, power, shell and an optional short drive. You get 15 seconds per turn (the host can change this), plus 5 extra on turn 1.",
    "Press Fire! to lock in. When everyone is locked in (or time runs out), all tanks drive, then every shell flies at the same moment.",
    "If time runs out before you lock in, your tank still fires with whatever aim you had set.",
    "Blasts hurt every tank nearby and dig craters in the ground. Then the wind shifts and the next turn starts.",
  ],
  controls: {
    desktop: [
      "Drag back from your tank like a slingshot: the direction sets the angle and the pull length sets the power.",
      "Left / Right arrows tilt the barrel; Up / Down arrows change power. Hold Shift to move in steps of 5.",
      "A and D plan a drive left or right, 5 units per press.",
      "1, 2, 3 pick Shell, Heavy or Splitter.",
      "Space fires and locks in your shot.",
    ],
    touch: [
      "Drag back from your tank like a slingshot to aim; pull further for more power.",
      "Or use the Angle, Power and Drive sliders and their − / + buttons for fine tuning.",
      "Tap a shell type, then tap Fire! to lock in.",
    ],
  },
  scoring: [
    "Shell: unlimited, deals up to 35 damage. Heavy: 1 per game, huge blast, up to 55 damage. Splitter: 2 per game, splits into 3 small bombs (up to 20 each) at the top of its arc.",
    "Damage is highest right at the blast and fades with distance. Your own shells can hurt you too.",
    "A tank at 0 armour is out. So is a tank whose ground gets blown away into the bottomless pit.",
    "You have 200 fuel for the whole game and can drive up to 40 per turn.",
    "Last tank standing wins. If everyone left dies in the same volley, it's a draw between them. After the last turn, the most armour wins (ties share the win).",
  ],
  tips: [
    "The dotted aiming guide ignores wind, so check the wind gauge and aim a little into it.",
    "Shots are fired at the same time, so drive a few steps to dodge a shell that was aimed at where you were.",
    "Don't blast the ground right under yourself: a deep crater can drop you into the pit.",
  ],
};

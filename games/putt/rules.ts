import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Finish the course (six holes unless the host picks 3 or 9) in the fewest total strokes.",
  flow: [
    "Everyone tees off together. You get 15 seconds to aim your first shot on each hole, then 12 seconds for every shot after that (the host can make the aim timer shorter or longer).",
    "Drag back to set your direction and power, then press Putt to lock it in. Nobody can see your aim until the roll.",
    "When everyone has locked in (or time runs out), all the aims are shown and every ball rolls at the same time.",
    "Balls bump into each other, so you can knock rivals off line, or into the water. Watch for sand, bumpers, portals, boost pads, slopes and spinning windmills.",
    "Keep shooting until your ball drops. When everyone is done, a scorecard shows for 8 seconds (or until everyone taps Next hole), then on to the next hole.",
  ],
  controls: {
    desktop: [
      "Click and drag back anywhere on the course, like a slingshot: the ball goes the opposite way, and a longer pull means more power.",
      "Left / Right arrows turn your aim (hold Shift to turn 5× faster); Up / Down change the power.",
      "Space or Enter to putt and lock in. On the scorecard, Space or Enter moves to the next hole.",
    ],
    touch: [
      "Drag back anywhere on the course like a slingshot: the ball goes the opposite way, and a longer pull means more power.",
      "Use the turn and power buttons to fine-tune, then tap Putt to lock it in.",
    ],
  },
  scoring: [
    "Every shot counts as 1 stroke, even if the timer runs out before you aim (your ball just sits there).",
    "Roll into the water and your ball goes back to where it was, plus a 1-stroke penalty.",
    "Reach 6 strokes without sinking it and you pick up: that hole counts as 8.",
    "After the last hole, the lowest total wins. Equal lowest totals share the win.",
  ],
  tips: [
    "Your aim stays secret until everyone rolls, so think about where the other balls will be, not just where they are now.",
    "Windmills keep spinning while you aim, so time your power for the gap.",
    "A careful shot that stays dry beats a hero shot into the water: a splash costs you a stroke and your position.",
  ],
};

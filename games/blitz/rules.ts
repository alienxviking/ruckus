import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Score the most points across a run of lightning-fast microgames.",
  flow: [
    "A match is 12 microgames (the host can pick 6 or 18), drawn from 28 kinds: brainy ones like Quick maths, Spell check, Rhyme time, What's next? and Number flash, and reflex ones like Green light, Whack-a-mole, Spin stop, Simon says and Spot the difference.",
    "Every match deals a different line-up, and the room remembers what you just played, so the next match opens with fresh kinds and fresh puzzles.",
    "Before each one, a title card shows its name and a one-line instruction. Read it fast! Each lasts only 4 to 8 seconds, and they get harder and quicker as the match goes on.",
    "Watch for twist cards: 🔄 Reverse (tap a WRONG answer), ⚡ Speed up (much less time) and 💎 Double points.",
    "You get one answer per microgame, and the round ends early once everyone has answered. The finale (last 3 at ×2, or one Boss round at ×3) decides a lot.",
  ],
  controls: {
    desktop: [
      "Click an answer, or press the number keys (1, 2, 3, 4…) to pick one.",
      "Bigger and Dice duel: Left / Right arrows pick a side. Majority and Middle arrow: press the arrow key for the direction.",
      "Memory: repeat the arrows with the arrow keys; Backspace undoes your last one.",
      "Stop the clock, Spin stop and Green light: Space or Enter. Tap frenzy: tap Space as fast as you can (holding it down doesn't count). Whack-a-mole: click the moles, or press 1–9 (laid out like a phone keypad).",
    ],
    touch: [
      "Tap your answer. For Find the pair, tap both matching emoji; for Spot the difference, tap the odd square in either grid.",
      "Memory: tap the on-screen arrow pad in the same order you saw.",
      "Stop the clock, Spin stop, Green light and Tap frenzy: tap the big button.",
    ],
  },
  scoring: [
    "Right answer: 100 points plus up to 100 more for speed, so up to 200. Wrong or no answer: 0.",
    "Stop the clock (aim for exactly 5.00 seconds) and Tap frenzy pay by rank: 200, 150, 100, 75, 50, 40, 30, 25, 20, 15, 10, 5. Ties share a rank.",
    "Green light: 100 to 200 for how fast you react. Tap before it's green and you score nothing. Spin stop: 100 for landing in the zone, up to 200 for dead centre.",
    "Whack-a-mole: a clean sweep is 200; each bomb you hit costs 60. Simon says: if Simon didn't say it, keeping your hands off scores 150.",
    "Double rounds are worth ×2, the Boss round ×3. Highest total after the last microgame wins; equal totals share the win.",
  ],
  tips: [
    "Speed matters, but a wrong answer scores nothing. Take half a second to be sure, and re-read the twist card.",
    "Simon says: only the exact words \"Simon says\" count. Simone, Simon's cat and friends don't!",
    "What time?: the short hand is the hour. Mixing the hands up is the classic trap.",
  ],
};

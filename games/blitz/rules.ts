import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Score the most points across 12 lightning-fast microgames.",
  flow: [
    "A match is 12 microgames picked from: Odd one out, Count flash, Quick maths, Ink colour, Stop the clock, Bigger, Memory, Tap frenzy, Find the pair, Majority, Anagram and Fruit maths.",
    "Before each one, a title card shows its name and a one-line instruction. Read it fast!",
    "Everyone plays at the same time. Each microgame lasts only 5 to 8 seconds.",
    "You get one answer per microgame, so you can't change it. The round ends early once everyone has answered.",
    "Results show for a moment, then the next microgame starts. The last 3 count double.",
  ],
  controls: {
    desktop: [
      "Click an answer, or press the number keys (1, 2, 3, 4…) to pick one.",
      "Bigger: Left / Right arrows pick a side. Majority: press the arrow key for the direction most arrows point.",
      "Memory: repeat the arrows with the arrow keys; Backspace undoes your last one.",
      "Stop the clock: Space or Enter. Tap frenzy: tap Space as fast as you can (holding it down doesn't count).",
    ],
    touch: [
      "Tap your answer. For Find the pair, tap both matching emoji.",
      "Memory: tap the on-screen arrow pad in the same order you saw.",
      "Stop the clock and Tap frenzy: tap the big button.",
    ],
  },
  scoring: [
    "Right answer: 100 points plus up to 100 more for speed, so up to 200. Wrong or no answer: 0.",
    "Stop the clock (aim for exactly 5.00 seconds) and Tap frenzy (most taps in 5 seconds) pay by rank: 200, 150, 100, 75, 50, 40, 30, 25, 20, 15, 10, 5. Ties share a rank.",
    "Stop the clock only scores if you stop within 1.5 seconds of 5.00.",
    "The last 3 microgames are worth double, so up to 400 each.",
    "Highest total after all 12 wins. Equal totals share the win.",
  ],
  tips: [
    "Speed matters, but a wrong answer scores nothing. Take half a second to be sure.",
    "Ink colour: ignore the word itself and name the colour it's printed in.",
    "Stop the clock: the timer fades out before 5 seconds, so count the beats in your head.",
  ],
};

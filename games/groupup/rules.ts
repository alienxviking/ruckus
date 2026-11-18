import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  quick: [
    { icon: "tiles", anim: "float", text: "Sixteen words hide four groups of four" },
    { icon: "tap", anim: "tap", text: "Pick four words that belong together" },
    { icon: "heart", anim: "pulse", text: "Wrong guesses use up your mistakes" },
  ],
  win: "Most groups found, fewest mistakes",
  goal: "Sort sixteen words into the four hidden groups of four, with as few mistakes as you can.",
  flow: [
    "Everyone gets the same puzzle: 1 by default (the host can pick 1, 2 or 3). A room doesn't repeat puzzles it has played recently.",
    "After a 3-second countdown, pick four words you think share a connection (a category, a hidden word, a fill-in-the-blank like \"___ ball\", a sound-alike…) and submit.",
    "Right: the group locks in as a coloured band with its name. Colours go from easiest to sneakiest: lime, cyan, orange, pink.",
    "Wrong: it costs a mistake. If three of your four were right you'll hear \"one away\". Trying the exact same four again is free.",
    "Mistakes allowed per puzzle: 4 by default (the host can pick 3 or 5). Run out, or hit the 6-minute limit, and the missing groups are revealed. Then the next puzzle starts (tap Next, or it starts by itself after 15 seconds).",
    "Everyone plays at their own pace; the game ends when everyone has finished.",
  ],
  controls: {
    desktop: ["Click words to pick them, then Submit or press Enter.", "S shuffles the tiles, Esc deselects everything."],
    touch: ["Tap four words, then Submit. Shuffle moves the tiles around to help you see new links."],
  },
  scoring: [
    "100 points for each group you find.",
    "Clear all four groups and earn 40 more for each mistake you had left, plus up to 60 for speed (full within 1 minute, nothing at the 6-minute limit).",
    "Points add up over all the puzzles; the highest total wins.",
  ],
  tips: [
    "Some words fit two groups: find the group that can only be made one way first.",
    "If a category seems to have five members, one of them belongs somewhere else.",
    "Stuck? Shuffle. New neighbours spark new ideas.",
  ],
};

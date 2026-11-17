import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Finish with more seeds in your store than your rival.",
  flow: [
    "Two players face each other across a board of 12 pits, 6 on each side, with a store at each end. Your pits are the bottom row and your store is on your right. Every pit starts with 4 seeds (the host can choose 3, 4, 5 or 6). A random player goes first.",
    "On your turn, pick one of your pits that has seeds. All its seeds are sown one at a time into the following pits, counter-clockwise: along your row, into your own store, then along your rival's row. Your rival's store is skipped.",
    "If the last seed lands in your own store, you take another turn straight away.",
    "If the last seed lands in an empty pit on your side and the pit facing it has seeds, you capture: those seeds and your last seed all go into your store.",
    "As soon as either row is completely empty, the game ends and each player adds the seeds still on their own side to their store.",
    "Anyone beyond the first two players watches.",
  ],
  controls: {
    desktop: ["Click one of your glowing pits to sow it, or press 1-6 (pits counted left to right on your row)."],
    touch: ["Tap one of your glowing pits to sow it."],
  },
  scoring: [
    "The player with more seeds in their store wins the game; equal stores are a draw.",
    "The match is a single game by default (a draw is a shared result). The host can make it best of 3: first to 2 game wins, draws count for nobody, and after 5 games the leader takes it.",
    "You have 30 seconds per move (the host can pick 15 or 45), or a random pit of yours is sown for you. If you disconnect, it happens after 5 seconds.",
    "A player who stays disconnected for a full minute forfeits the match.",
  ],
  tips: [
    "Count the seeds: a pit with exactly enough seeds to reach your store gives you a free move. Play the one closest to your store first, then the others.",
    "Watch your rival's empty pits: a seed landing there could steal your pit across from it.",
    "Seeds left on your own row when a row runs dry are yours, so a pile can pay off, but a big pile is also a big target for a capture.",
  ],
};

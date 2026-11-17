import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Score the most points over 3 rounds (the host can change this) by painting the best copy of your own secret emblem.",
  flow: [
    "Each round you get a secret 5×5 pixel emblem (like a heart or a skull). Only you can see it.",
    "Everyone paints on the same shared canvas at once for 75 seconds (the host can pick 45 or 120). Paint your emblem anywhere you like.",
    "Every new pixel briefly flashes in its painter's colour, so you can work out who is painting what, then paint over their emblem to wreck it.",
    "When time's up, the game finds the best copy of each emblem anywhere on the canvas and reveals everyone's emblem.",
    "Tap Ready to move on. The canvas is wiped clean and you get a new emblem for the next round.",
    "Red vs Blue (host setting): players are split into two random teams. Each team shares one secret emblem, paints it together and tries to wreck the other team's.",
  ],
  controls: {
    desktop: [
      "Click a square to paint it, or click and drag to paint lines.",
      "Press 1–8 to pick one of the 8 colours.",
      "Or Tab to the canvas, move with the arrow keys and press Space to paint.",
      "When zoomed in, scroll to move around; Ctrl + scroll zooms.",
    ],
    touch: [
      "Tap a square to paint it, or drag your finger to paint lines.",
      "Tap a colour in the palette to switch colours.",
    ],
  },
  scoring: [
    "Your best copy scores 1 point for every pixel that matches your emblem, up to 25.",
    "A perfect copy (all 25 pixels right) earns a 5-point bonus, so 30 points in total.",
    "Points add up over every round. The highest total wins, and equal top scores share the win.",
    "Red vs Blue: each team scores its own best copy the same way (up to 30 a round), so a smaller team isn't at a disadvantage. The team with more points wins and every member shares the win.",
  ],
  tips: [
    "Paint takes a moment to recharge, so you can only lay down a few pixels each second. Don't waste them.",
    "Your copy can be anywhere, so a quiet corner is safer than the middle of the action.",
    "Watch the flashing colours to spot rivals' emblems, then change a few of their pixels to drop their score.",
  ],
};

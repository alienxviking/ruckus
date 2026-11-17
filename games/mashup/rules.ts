import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Score the most points over 2 rounds (the host can pick 1 to 3) by drawing monsters people love and giving them names people vote for.",
  flow: [
    "Each round makes one monster per player, built from three parts: a head, a body and legs. Everyone draws at the same time, a different monster's part each time, with 60 seconds per part (the host can change this).",
    "You never see the whole monster. When you draw a body or legs, you only see a thin strip from the bottom of the part above, so line your drawing up with it.",
    "Next you get 30 seconds to name two monsters that you didn't draw (up to 32 characters each).",
    "The finished monsters are revealed one at a time, all stitched together, with their names.",
    "Then you have 35 seconds to give one ⭐ to your favourite monster and one 🏷️ to your favourite name. You can't vote for your own work.",
  ],
  controls: {
    desktop: [
      "Draw with the mouse. Pick a colour from the palette or press 1–9, 0, - or =.",
      "[ and ] change brush size, E toggles the eraser, B goes back to the brush, Z undoes.",
      "Click Done when you're finished to move on early once everyone is done.",
    ],
    touch: [
      "Draw with your finger. Tap a colour, brush size, the eraser or Undo in the toolbar.",
      "Tap Done when you're finished to move on early once everyone is done.",
    ],
  },
  scoring: [
    "Every ⭐ a monster gets gives 2 points to each artist who drew part of it.",
    "Every 🏷️ a name gets gives 3 points to the player who wrote it.",
    "After the last round the highest total wins. Tied players share the win.",
  ],
  tips: [
    "Use the strip you can see: carry the lines on so the parts join up, then add your own twist.",
    "Your ink is limited for each part, so don't spend it all on tiny scribbles.",
    "A funny name can earn more than a great drawing: 3 points per vote versus 2.",
  ],
};

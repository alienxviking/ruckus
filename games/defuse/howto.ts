import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Work together to defuse at least 2 of the 3 bombs. The whole team wins or loses together.",
  flow: [
    "Each bomb has one defuser, and the job rotates so different players get a turn. Only the defuser can see and touch the bomb.",
    "Everyone else is an expert holding a few torn pages of the bomb manual. The manual is new every game, and nobody has all of it.",
    "You get a 12-second briefing before each bomb (tap Ready to start sooner). Then the 3:00 clock starts (the host can set it anywhere from 2 to 5 minutes).",
    "The defuser describes what they see: the wires, the button, the symbols on the keypad, the coloured flashes, the dial, plus the serial number, batteries and lights on the side. Experts check their pages and call out what to do.",
    "A bomb is defused when every module on it is solved. The first bomb has 3 modules, then 4, then 5.",
  ],
  controls: {
    desktop: [
      "Defuser: click a wire to cut it, click symbols, colour pads and dial positions to press them.",
      "Defuser: on the big button, either tap it, or hold it (mouse, Space or Enter) and let go when its counter shows the right number.",
      "Everyone: type in the chat (up to 100 characters) or click quick replies, symbols and colours to share them.",
    ],
    touch: [
      "Defuser: tap a wire to cut it, tap symbols, colour pads and dial positions to press them.",
      "Defuser: on the big button, either tap it, or press and hold, then let go when its counter shows the right number.",
      "Everyone: type in the chat or tap quick replies, symbols and colours to share them.",
    ],
  },
  scoring: [
    "Every wrong move is a strike, and each strike makes the clock run faster (1.25× after one, 1.5× after two).",
    "Three strikes, or the clock reaching zero, and the bomb blows up.",
    "Each defused bomb adds 100 points plus 1 point for every second left on the clock to the team score.",
    "Defuse 2 or 3 of the 3 bombs and everyone wins together.",
  ],
  tips: [
    "Experts: read your pages out loud early, because the answer may need lines from two different people.",
    "Defuser: read out the serial number, batteries and lit lights right away. Many rules depend on them.",
    "Don't guess. A strike speeds up the clock for everyone.",
  ],
};

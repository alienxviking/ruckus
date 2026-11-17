import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Drag the flag over your team's line more often than the other team: first to 3 round wins takes the match (best of 5; the host can pick best of 3 or 7).",
  flow: [
    "Everyone is split into two teams, Red (pulls left) and Blue (pulls right), as evenly as possible.",
    "Each round is one quick challenge: 👊 Mash (tap PULL as fast as you can), ⌨️ Type (type the word shown), 🧮 Sums (tap the right answer), 🎨 Ink (tap the colour a word is painted in, not what it says) or 🥁 Heave-ho (tap on the beat). The first round is always Mash; the rest rotate.",
    "A short countdown shows the challenge, then you have 30 seconds. Every right answer drags the flag toward your side.",
    "Drag the flag over your line to win the round straight away. Otherwise, whoever's side the flag is on when time runs out wins it. Dead centre is a draw.",
    "The last 8 seconds are a FRENZY: every pull counts 1.6×.",
  ],
  controls: {
    desktop: [
      "Mash and Heave-ho: Space, Enter or any letter key (or click the big button).",
      "Type: type the word; it sends itself as soon as it's right. Enter sends a wrong guess.",
      "Sums and Ink: click an answer or press 1–4.",
    ],
    touch: [
      "Mash: tap the big PULL button. Two fingers count double.",
      "Heave-ho: tap HEAVE as each beat reaches the ring.",
      "Type: type with your keyboard. Sums and Ink: tap an answer.",
    ],
  },
  scoring: [
    "Pulls are shared out by team size: on a team of 3 each answer pulls a third as far as it would for a team of 1, so the team trying hardest wins, not the bigger one. Players who drop out stop counting toward their team's size.",
    "Roughly how far one input pulls for a team of one, out of 100 to the line: a Mash tap 4.2, a typed word 12 + 4.4 per letter, a right sum 22, a right ink 17, an on-beat heave 14 (perfect, within 70 ms), 7 (good, 140 ms) or 2 (ok, 230 ms). Mashing counts at most 16 taps a second.",
    "Answer Type, Sums or Ink questions right several times in a row for a streak bonus: +10% for each one after the first, up to +50%.",
    "A wrong sum slips the rope 10 back and freezes you for 0.9 s; a wrong ink slips it 8 back for 0.7 s. A wrong word just makes you stumble for a moment.",
    "Comeback: pulling back while the flag is on your own side is up to 30% stronger (the closer to your line, the stronger).",
    "Best of 5 by default (first to 3). If drawn rounds stretch the match to its last round (7 rounds for best of 5), the team with more round wins takes it; level is a draw.",
    "If a whole team is disconnected for 12 seconds, the other team wins.",
  ],
  tips: [
    "On a phone, drum the PULL button with two fingers.",
    "In Ink, ignore what the word says: look at its colour.",
    "Behind? Don't give up: the comeback boost and the frenzy make the last seconds wild.",
  ],
};

import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  quick: [
    { icon: "users", anim: "slide", text: "Teams take turns describing on a call" },
    { icon: "talk", anim: "wiggle", text: "Get teammates to guess, avoiding banned words" },
    { icon: "ban", anim: "pulse", text: "Say a banned word and rivals buzz" },
  ],
  win: "Team with more points wins",
  goal: "Smuggle more words past the other team than they smuggle past yours.",
  flow: [
    "Players are split at random into Red and Blue. Play on a voice or video call: describing and guessing happen out loud.",
    "Teams alternate turns. Each turn one player describes (everyone takes a go; each team gets at least 3 turns). The describer taps Start when ready, or the turn starts by itself after 45 seconds.",
    "A turn lasts 60 seconds (the host can pick 45 or 90). The describer sees a secret word and five banned words and talks their team towards it without saying any of them, or the word itself.",
    "Teammates see only the clock and the score: shout guesses! The describer taps Got it when someone says the word, or Skip to pass.",
    "The other team sees the same card. If the describer says a banned word, they hit Buzz: the word is lost.",
    "When everyone has described (the host can make it twice each) the team with more points wins.",
  ],
  controls: {
    desktop: ["Describer: Enter or Space = Got it, S = Skip.", "Other team: B = Buzz."],
    touch: ["Describer: tap Got it or Skip.", "Other team: tap the big Buzz button."],
  },
  scoring: [
    "Got it: +1 for the describing team.",
    "Buzzed: −1 for the describing team, and the word is lost.",
    "Skip: 0 points, next word.",
    "A word left on screen when time runs out scores nothing. A tie is a draw.",
    "The host can add their own words (10 or more). Custom words have no banned list: buzz if the describer says the word itself or part of it.",
  ],
  tips: [
    "Don't screen-share while you're describing: the word is on your screen.",
    "Skip early on a tough word; a fast skip beats a slow buzz.",
  ],
};

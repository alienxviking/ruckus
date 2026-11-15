// Game metadata shared by the server (player limits) and the client (lobby cards).

export type GameCategory = "party" | "board" | "arena" | "brain";

export interface GameMeta {
  id: string;
  name: string;
  tagline: string;
  category: GameCategory;
  minPlayers: number;
  maxPlayers: number;
  /** Rough length of one game, minutes. */
  minutes: number;
  emoji: string;
  /** Accent colour used on the card and in-game chrome. */
  accent: string;
  /** Short rules shown before starting. */
  how: string[];
  /** Ruckus original mechanics. */
  original?: boolean;
}

export const CATALOG: GameMeta[] = [
  {
    id: "sketch",
    name: "Sketch Storm",
    tagline: "One draws, everyone races to guess.",
    category: "party",
    minPlayers: 2,
    maxPlayers: 12,
    minutes: 8,
    emoji: "🎨",
    accent: "#f472b6",
    how: [
      "Take turns drawing: pick one of three secret words and sketch it in 80 seconds.",
      "Everyone else races to type the word. Faster guesses score more, and letter hints appear over time.",
      "The artist earns 60 points per correct guess. Most points once everyone has drawn wins.",
    ],
  },
  {
    id: "trivia",
    name: "Trivia Rush",
    tagline: "Same question, everyone at once. Speed counts.",
    category: "brain",
    minPlayers: 1,
    maxPlayers: 12,
    minutes: 5,
    emoji: "⚡",
    accent: "#facc15",
    how: [
      "10 questions from 10 categories, 15 seconds each. Everyone gets the same question at once.",
      "Tap an answer or press 1–4 / A–D. One pick per question, no take-backs.",
      "Right answers score 500–1,000 (faster = more); answer streaks add up to +300 more.",
    ],
  },
  {
    id: "letters",
    name: "Letter Rush",
    tagline: "One letter, six categories, ninety seconds.",
    category: "party",
    minPlayers: 2,
    maxPlayers: 12,
    minutes: 6,
    emoji: "🔤",
    accent: "#fb923c",
    how: [
      "Each round: one letter, six categories, 90 seconds to write an answer for each that starts with it.",
      "Then review everyone's answers and 👎 veto any that don't fit. Half the others' vetoes knock one out.",
      "Unique answers score 10, shared ones 5. Three rounds, highest total wins.",
    ],
  },
  {
    id: "snakes",
    name: "Snake Brawl",
    tagline: "Real-time snakes. Cut them off, take their length.",
    category: "arena",
    minPlayers: 2,
    maxPlayers: 8,
    minutes: 3,
    emoji: "🐍",
    accent: "#4ade80",
    how: [
      "Steer with arrow keys or WASD. On phones, swipe the board or use the on-screen pad.",
      "Eat glowing pellets to grow (gold stars give +3). Hit a wall or any snake, even yourself, and you're out.",
      "Last snake standing takes the round, or the longest after 90s. First to 2 round wins takes the match.",
    ],
  },
  {
    id: "turf",
    name: "Turf War",
    tagline: "Paint the map your colour. Most ground in 60s wins.",
    category: "arena",
    minPlayers: 2,
    maxPlayers: 8,
    minutes: 2,
    emoji: "🖌️",
    accent: "#38bdf8",
    original: true,
    how: [
      "Steer with arrows/WASD, a swipe or the on-screen pad. Every tile you enter turns your colour.",
      "Leave your turf and loop back: everything you wall off from the map edge becomes yours, rivals’ paint too.",
      "Grab ⚡ dashes, 💣 paint bombs and 🧊 freezes. Most of the map after 60 seconds wins.",
    ],
  },
  {
    id: "reflex",
    name: "Quick Draw",
    tagline: "Wait for it... wait for it... TAP!",
    category: "arena",
    minPlayers: 2,
    maxPlayers: 12,
    minutes: 2,
    emoji: "🤠",
    accent: "#f87171",
    how: [
      "Hands off until the panel turns green and says DRAW!, then tap anywhere (or press Space) as fast as you can.",
      "Tap early, or fall for a yellow fake like DRAW? or DRAMA!, and you sit out the round.",
      "Fastest tap scores a point and exact ties all score. First to 5 wins.",
    ],
  },
  {
    id: "impostor",
    name: "Odd One Out",
    tagline: "Everyone has the same word. Except one.",
    category: "party",
    minPlayers: 3,
    maxPlayers: 12,
    minutes: 8,
    emoji: "🕵️",
    accent: "#a78bfa",
    original: true,
    how: [
      "Everyone gets a secret word, but one player's word is slightly different. Nobody knows who.",
      "Take turns giving one-word clues about your word.",
      "Vote out who you think is the odd one. They can still win by guessing the real word.",
    ],
  },
  {
    id: "fib",
    name: "Fib Finder",
    tagline: "Write convincing lies. Find the strange truth.",
    category: "party",
    minPlayers: 3,
    maxPlayers: 10,
    minutes: 10,
    emoji: "🤥",
    accent: "#34d399",
    original: true,
    how: [
      "Everyone sees a weird but true fact with a blank in it.",
      "Fill the blank with a believable fake answer.",
      "Then find the real answer among all the fakes. Score for fooling friends.",
    ],
  },
  {
    id: "mindmeld",
    name: "Mind Meld",
    tagline: "Co-op: keep going until everyone says the same word.",
    category: "brain",
    minPlayers: 2,
    maxPlayers: 12,
    minutes: 4,
    emoji: "🧠",
    accent: "#e879f9",
    original: true,
    how: [
      "Everyone secretly types any word at the same time. Then they're revealed.",
      "Next round, everyone tries to find the word that links the last ones.",
      "You all win when every word matches. Fewer rounds = legendary.",
    ],
  },
  {
    id: "dial",
    name: "On the Dial",
    tagline: "One clue, a hidden target, everyone drags a live dial.",
    category: "party",
    minPlayers: 2,
    maxPlayers: 12,
    minutes: 8,
    emoji: "🎚️",
    accent: "#22d3ee",
    original: true,
    how: [
      "The clue-giver sees a hidden target on a scale like Cold ↔ Hot.",
      "They give a clue that sits at that spot on the scale.",
      "Everyone drags their dial live. The closer you are, the more you score.",
    ],
  },
  {
    id: "dots",
    name: "Dots & Boxes",
    tagline: "Draw lines, close boxes, steal the board.",
    category: "board",
    minPlayers: 2,
    maxPlayers: 4,
    minutes: 6,
    emoji: "🔳",
    accent: "#60a5fa",
    how: [
      "On your turn, draw one line between two neighbouring dots. You have 30 seconds per move.",
      "Close the fourth side of a box to claim it and move again. Careful: a third side hands it over.",
      "Most boxes when the grid is full wins. Idle or disconnected players' moves are auto-played.",
    ],
  },
  {
    id: "fourrow",
    name: "Four in a Row",
    tagline: "Drop discs. Connect four. Classic.",
    category: "board",
    minPlayers: 2,
    maxPlayers: 2,
    minutes: 5,
    emoji: "🔴",
    accent: "#ef4444",
    how: [
      "Take turns dropping a disc into a column.",
      "First to line up four (across, down or diagonal) wins.",
      "Extra players in the room watch and cheer.",
    ],
  },
  {
    id: "tictactoe",
    name: "Tic-Tac-Toe",
    tagline: "The quick classic. Best of 5.",
    category: "board",
    minPlayers: 2,
    maxPlayers: 2,
    minutes: 2,
    emoji: "❌",
    accent: "#94a3b8",
    how: [
      "Take turns placing X or O.",
      "Three in a row wins the round. First to 3 rounds wins.",
      "Starting player alternates each round.",
    ],
  },
];

export const CATALOG_BY_ID: Record<string, GameMeta> = Object.fromEntries(
  CATALOG.map((g) => [g.id, g]),
);

export const CATEGORY_LABEL: Record<GameCategory, string> = {
  party: "Party",
  board: "Board",
  arena: "Real-time",
  brain: "Brain",
};

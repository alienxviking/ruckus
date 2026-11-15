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
      "Each round one player draws a secret word.",
      "Everyone else types guesses. Faster correct guesses score more.",
      "The artist scores for every player who gets it.",
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
      "10 multiple-choice questions, 15 seconds each.",
      "Correct answers score up to 1000 points, more the faster you lock in.",
      "Answer streaks earn a bonus.",
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
      "A random letter and a list of categories appear.",
      "Write an answer for each category starting with that letter.",
      "Everyone votes out bad answers. Unique answers score double.",
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
      "Steer with arrow keys / WASD, or swipe on mobile.",
      "Eat food to grow. Hit a wall or another snake and you're out.",
      "Last snake standing wins the round. Best of 3.",
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
      "Move around the grid. Every tile you cross turns your colour.",
      "Close a loop of your own tiles to fill everything inside it.",
      "Grab power-ups for speed and paint bursts. Most tiles at the end wins.",
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
      "Wait for the signal, then tap as fast as you can.",
      "Tap too early and you're out for the round.",
      "Some signals are fakes. First to 5 points wins.",
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
      "On your turn, draw one line between two dots.",
      "Close a box to claim it and take another turn.",
      "Most boxes when the grid is full wins.",
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

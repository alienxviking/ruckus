// Constants used by both the server logic and the client UI.

export const COLS = 7;
export const ROWS = 6;
/** Discs in a line needed to win a game. */
export const CONNECT = 4;
/** Game wins needed to take the match (best of 3, draws don't count). */
export const TARGET_WINS = 2;
/** Hard cap on games per match: after this many the leader wins (tie = shared win). */
export const MAX_GAMES = 5;
/** Time to make a move before a random legal disc is dropped for you. */
export const TURN_MS = 30_000;
/** When the player to move is disconnected, their disc is auto-dropped this quickly. */
export const AWAY_MS = 5_000;
/** Pause between games so everyone can see the result. */
export const PAUSE_MS = 2_500;
/** A participant gone this long forfeits the match. */
export const FORFEIT_MS = 60_000;

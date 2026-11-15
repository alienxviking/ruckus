// Types shared between the PartyKit server and the Next.js client.

export interface Player {
  id: string;
  name: string;
  color: string;
  avatar: string;
  connected: boolean;
}

export interface ChatMsg {
  id: string;
  from: string | null; // null = system message
  text: string;
  at: number;
}

export interface GameResult {
  /** Player ids that won (empty = nobody / draw). */
  winners: string[];
  /** One-line summary, e.g. "Asha wins with 42 points". */
  headline: string;
  /** Optional final scores keyed by player id. */
  scores?: Record<string, number>;
}

export type RoomPhase = "lobby" | "playing";

export interface RoomView {
  code: string;
  hostId: string | null;
  players: Player[];
  phase: RoomPhase;
  gameId: string;
  /** Players taking part in the current game (others spectate). */
  participants: string[];
  chat: ChatMsg[];
  /** Wins this session, keyed by player id. */
  wins: Record<string, number>;
  /** Set once the current game has finished. */
  result: GameResult | null;
  /** Increments every time a game starts; the client keys the game UI on it. */
  gameSeq: number;
}

export type ClientMsg =
  /** `key` is a per-browser secret proving this socket really is player `id`. */
  | { t: "hello"; name: string; color: string; avatar: string; key: string }
  | { t: "chat"; text: string }
  | { t: "pick"; gameId: string }
  | { t: "start" }
  | { t: "lobby" }
  | { t: "act"; a: unknown };

export type ServerMsg =
  | { t: "room"; room: RoomView; now: number }
  | { t: "game"; view: unknown; now: number }
  | { t: "ev"; e: unknown; now: number }
  | { t: "err"; msg: string; now: number }
  /** The server refused this socket (room full, identity clash). Don't reconnect. */
  | { t: "rejected"; msg: string; now: number };

export const PLAYER_COLORS = [
  "#ff5d73",
  "#ffb020",
  "#ffe14d",
  "#4ade80",
  "#2dd4bf",
  "#38bdf8",
  "#818cf8",
  "#c084fc",
  "#f472b6",
  "#fb923c",
  "#a3e635",
  "#e2e8f0",
] as const;

export const AVATARS = [
  "🦊", "🐸", "🐙", "🦄", "🐼", "🐯", "🦉", "🐢",
  "🐧", "🦖", "👾", "🤖", "👻", "🍕", "🌵", "🍄",
] as const;

export const MAX_PLAYERS = 12;
export const MAX_NAME = 16;

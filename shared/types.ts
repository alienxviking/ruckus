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
  /** System lines about a player ("X joined") carry their avatar, drawn before the text. */
  avatar?: string;
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
  /** Recent chat. On the wire it is only sent in full when a socket joins; after that
   * new lines arrive as small "chat" messages and the client keeps the list. */
  chat: ChatMsg[];
  /** Wins this session, keyed by player id. */
  wins: Record<string, number>;
  /** Set once the current game has finished. */
  result: GameResult | null;
  /** Increments every time a game starts; the client keys the game UI on it. */
  gameSeq: number;
  /** Quick play: after each result the next game (one that fits the group) starts by itself. */
  autoNext: boolean;
  /** The game quick play will start next, and when (server time). */
  next: { gameId: string; at: number } | null;
}

export type ClientMsg =
  /** `key` is a per-browser secret proving this socket really is player `id`. */
  | { t: "hello"; name: string; color: string; avatar: string; key: string }
  | { t: "chat"; text: string }
  | { t: "pick"; gameId: string }
  /** Start the picked game, or `gameId` (the host skipping quick play's countdown). */
  | { t: "start"; gameId?: string }
  | { t: "lobby" }
  /** Host turns quick play (auto-next) on or off. */
  | { t: "auto"; on: boolean }
  | { t: "act"; a: unknown }
  /** Clock sync / latency probe; the server answers with "pong" right away. */
  | { t: "ping"; c: number };

/** The room as sent over the wire: `chat` only on a socket's first sync. */
export type RoomWire = Omit<RoomView, "chat"> & { chat?: ChatMsg[] };

export type ServerMsg =
  | { t: "room"; room: RoomWire; now: number }
  | { t: "chat"; msg: ChatMsg; now: number }
  /** Reply to "ping": `c` is the client's send time, `now` the server time. */
  | { t: "pong"; c: number; now: number }
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

/** Avatar ids. The art lives in lib/avatar-art.ts; text-only spots use AVATAR_EMOJI. */
export const AVATARS = [
  "fox", "frog", "cat", "bear", "panda", "bunny", "owl", "penguin",
  "robot", "alien", "ghost", "octo", "dino", "slime", "tiger", "shroom",
] as const;
export type AvatarId = (typeof AVATARS)[number];

/** Each avatar's emoji, for chat lines, labels and other plain text. */
export const AVATAR_EMOJI: Record<AvatarId, string> = {
  fox: "🦊", frog: "🐸", cat: "🐱", bear: "🐻", panda: "🐼", bunny: "🐰", owl: "🦉", penguin: "🐧",
  robot: "🤖", alien: "👽", ghost: "👻", octo: "🐙", dino: "🦖", slime: "💧", tiger: "🐯", shroom: "🍄",
};

/** The old emoji avatars (saved profiles, stale tabs) mapped onto the new set. */
const LEGACY_AVATAR: Record<string, AvatarId> = {
  "🦊": "fox", "🐸": "frog", "🐙": "octo", "🦄": "bunny", "🐼": "panda", "🐯": "tiger", "🦉": "owl", "🐢": "bear",
  "🐧": "penguin", "🦖": "dino", "👾": "alien", "🤖": "robot", "👻": "ghost", "🍕": "cat", "🌵": "slime", "🍄": "shroom",
};

export function isAvatarId(v: unknown): v is AvatarId {
  return typeof v === "string" && (AVATARS as readonly string[]).includes(v);
}

/** A valid avatar id for anything a client sends or a browser saved. */
export function toAvatarId(v: unknown): AvatarId | null {
  if (isAvatarId(v)) return v;
  return typeof v === "string" ? (LEGACY_AVATAR[v] ?? null) : null;
}

/** Plain-text form of an avatar (ids become emoji; anything else, like a fallback emoji, passes through). */
export function avatarText(v: string | undefined): string {
  return v === undefined ? "" : isAvatarId(v) ? AVATAR_EMOJI[v] : v;
}

export const MAX_PLAYERS = 12;
export const MAX_NAME = 16;

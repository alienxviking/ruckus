import { AVATARS, PLAYER_COLORS } from "@/shared/types";

export interface Identity {
  /** Public player id (everyone in a room sees it). */
  id: string;
  /** Secret that proves this browser owns `id`. Never shown to anyone. */
  key: string;
  name: string;
  color: string;
  avatar: string;
}

const KEY = "ruckus:identity";

function randomString(length: number): string {
  // crypto.getRandomValues works in insecure contexts too (e.g. LAN testing over http).
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function read(): Partial<Identity> | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<Identity>) : null;
  } catch {
    return null; // storage blocked or corrupt
  }
}

function write(identity: Identity) {
  try {
    localStorage.setItem(KEY, JSON.stringify(identity));
  } catch {
    /* private mode: identity just won't persist */
  }
}

/** Identity saved in this browser, or null if the player hasn't picked a name yet. */
export function loadIdentity(): Identity | null {
  const v = read();
  if (!v || typeof v.id !== "string" || typeof v.name !== "string" || !v.name.trim()) return null;
  const identity: Identity = {
    id: v.id,
    key: typeof v.key === "string" && v.key.length >= 16 ? v.key : randomString(32),
    name: v.name,
    color: typeof v.color === "string" ? v.color : PLAYER_COLORS[0],
    avatar: typeof v.avatar === "string" ? v.avatar : AVATARS[0],
  };
  if (identity.key !== v.key) write(identity); // upgrade identities saved before keys existed
  return identity;
}

export function saveIdentity(look: { name: string; color: string; avatar: string }): Identity {
  const prev = read();
  const id = typeof prev?.id === "string" ? prev.id : randomString(16);
  const key = typeof prev?.key === "string" && prev.key.length >= 16 ? prev.key : randomString(32);
  const identity: Identity = { ...look, id, key };
  write(identity);
  return identity;
}

export function randomLook() {
  return {
    color: PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)],
    avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
  };
}

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

export function newRoomCode(): string {
  return Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
}

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

export function partyHost(): string {
  return process.env.NEXT_PUBLIC_PARTYKIT_HOST || `${window.location.hostname}:1999`;
}

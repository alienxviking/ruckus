// The room this browser was last in, so the home page can offer "jump back in" after a
// locked phone, a closed tab or a stray tap on the logo. Rooms are kept for 6 h after their
// last change (party/server.ts), so older ones aren't offered.

const KEY = "ruckus:last-room";
export const REJOIN_WINDOW_MS = 6 * 3_600_000;

export interface LastRoom {
  code: string;
  gameId: string;
  playing: boolean;
  players: number;
  /** Last time this browser saw the room (ms). */
  at: number;
}

export function rememberRoom(room: Omit<LastRoom, "at">) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...room, at: Date.now() } satisfies LastRoom));
  } catch {
    /* storage blocked: no banner, that's all */
  }
}

/** Forget it (left for good, removed, or the room is gone). Only if it's still that room. */
export function forgetRoom(code?: string) {
  try {
    if (code && loadLastRoom(true)?.code !== code) return;
    localStorage.removeItem(KEY);
  } catch {
    /* fine */
  }
}

export function loadLastRoom(any = false): LastRoom | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as LastRoom | null;
    if (!v || typeof v.code !== "string" || typeof v.at !== "number") return null;
    if (!any && Date.now() - v.at > REJOIN_WINDOW_MS) return null;
    return v;
  } catch {
    return null;
  }
}

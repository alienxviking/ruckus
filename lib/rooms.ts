"use client";

import { partyHost } from "./identity";

/** HTTP address of a room on the game server (same host the WebSocket uses). */
function roomUrl(code: string): string {
  const secure = process.env.NEXT_PUBLIC_PARTYKIT_HOST ? true : window.location.protocol === "https:";
  return `${secure ? "https" : "http"}://${partyHost()}/parties/main/${code.toLowerCase()}`;
}

export type RoomResult = { ok: true } | { ok: false; error: string };

/** Create a room on the server. Fails with a friendly message when rate limited or offline. */
export async function createRoom(code: string): Promise<RoomResult> {
  try {
    const res = await fetch(roomUrl(code), { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (res.ok && body.ok) return { ok: true };
    return { ok: false, error: body.error ?? "Couldn't create a room. Try again in a moment." };
  } catch {
    return { ok: false, error: "Can't reach the game server. Check your connection and try again." };
  }
}

/** Whether a room with this code is open right now. */
export async function roomExists(code: string): Promise<boolean | null> {
  try {
    const res = await fetch(roomUrl(code));
    if (!res.ok) return res.status === 404 ? false : null;
    return Boolean(((await res.json()) as { exists?: boolean }).exists);
  } catch {
    return null; // unknown: let the room page try
  }
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { newRoomCode } from "./identity";
import { createRoom } from "./rooms";

/** Creates a room on the game server and opens it (optionally with a game picked). */
export function useCreateRoom() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (gameId?: string) => {
    setBusy(true);
    setError(null);
    const fresh = newRoomCode();
    const res = await createRoom(fresh);
    if (res.ok) {
      router.push(gameId ? `/r/${fresh}?game=${encodeURIComponent(gameId)}` : `/r/${fresh}`);
      return true;
    }
    setError(res.error);
    setBusy(false);
    return false;
  };

  return { create, busy, error, setError };
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { newRoomCode } from "./identity";
import { createRoom } from "./rooms";

/** Creates a room on the game server and opens it (optionally with a game picked). */
export function useCreateRoom() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Coming back to this page (browser Back) must never leave the button stuck on "Setting up…".
  // Next keeps visited pages alive in the background and re-runs their effects when they're
  // shown again; the browser's back-forward cache restores pages through "pageshow".
  useEffect(() => {
    queueMicrotask(() => setBusy(false));
    const onShow = () => setBusy(false);
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

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

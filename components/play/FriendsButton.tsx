"use client";

import { Users } from "lucide-react";
import { useCreateRoom } from "@/lib/useCreateRoom";

/** "Play this with friends": makes a room with this game picked. */
export function FriendsButton({ gameId, className = "" }: { gameId: string; className?: string }) {
  const { create, busy, error } = useCreateRoom();
  return (
    <div className="flex flex-col">
      <button className={`btn ${className}`} onClick={() => create(gameId)} disabled={busy}>
        <Users aria-hidden className="size-4" strokeWidth={2} />
        {busy ? "Creating room…" : "Play this with friends"}
      </button>
      {error && (
        <p role="alert" className="mt-1.5 max-w-xs text-xs text-brand">
          {error}
        </p>
      )}
    </div>
  );
}

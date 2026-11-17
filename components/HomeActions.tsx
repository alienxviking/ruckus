"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { normalizeCode } from "@/lib/identity";
import { roomExists } from "@/lib/rooms";
import { useCreateRoom } from "@/lib/useCreateRoom";
import { Magnetic } from "./Magnetic";

/** Create a room, or join friends with a code (the "Play with friends" path on the home page). */
export function HomeActions() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const clean = normalizeCode(code);
  const room = useCreateRoom();
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const busy = room.busy || joining;
  const error = joinError ?? room.error;

  const join = async () => {
    if (clean.length < 4) return;
    setJoining(true);
    setJoinError(null);
    room.setError(null);
    // A mistyped code used to create a brand-new room; check it exists first.
    const exists = await roomExists(clean);
    if (exists === false) {
      setJoinError(`No room with the code ${clean}. Check it with your friends, or create a new room.`);
      setJoining(false);
      return;
    }
    router.push(`/r/${clean}`);
  };

  // Every room link is served by the same static page: fetch its code now so
  // "Create a room" and "Join" open instantly.
  useEffect(() => {
    router.prefetch("/r/warmup");
  }, [router]);

  return (
    <div className="space-y-4">
      <Magnetic>
        <button
          className="btn btn-primary w-full py-3 text-lg"
          onClick={() => {
            setJoinError(null);
            void room.create();
          }}
          disabled={busy}
        >
          {room.busy ? "Creating…" : "Create a room"}
        </button>
      </Magnetic>
      <div className="label flex items-center gap-3 text-[10px]">
        <span className="h-px flex-1 bg-line" /> or join with a code <span className="h-px flex-1 bg-line" />
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void join();
        }}
      >
        <label htmlFor="room-code" className="sr-only">
          Room code
        </label>
        <input
          id="room-code"
          className="input min-w-0 font-mono text-lg tracking-[0.3em] uppercase"
          placeholder="CODE"
          autoComplete="off"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setJoinError(null);
            room.setError(null);
          }}
          aria-invalid={error !== null && !busy && code !== ""}
          aria-describedby={error ? "home-error" : undefined}
        />
        <button className="btn" disabled={clean.length < 4 || busy}>
          {joining ? "…" : "Join"}
        </button>
      </form>
      {error && (
        <p id="home-error" role="alert" className="animate-rise text-sm text-brand">
          {error}
        </p>
      )}
    </div>
  );
}

"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { normalizeCode } from "@/lib/identity";
import { roomExists } from "@/lib/rooms";
import { useCreateRoom } from "@/lib/useCreateRoom";

/** The big one: start a room. Plus joining friends with a code. */
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
      setJoinError(`No room called ${clean}. Check the code with your friends, or start your own.`);
      setJoining(false);
      return;
    }
    router.push(`/r/${clean}`);
  };

  // Every room link is served by the same static page: fetch its code now so
  // "Start a room" and "Join" open instantly.
  useEffect(() => {
    router.prefetch("/r/warmup");
  }, [router]);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
      <button
        className="stk-btn px-7 py-4 text-xl sm:text-2xl"
        onClick={() => {
          setJoinError(null);
          void room.create();
        }}
        disabled={busy}
      >
        {room.busy ? "Setting up…" : "Start a room"}
        <ArrowRight aria-hidden className="size-6" strokeWidth={3} />
      </button>
      <form
        className="flex min-w-0 flex-1 items-stretch gap-2 sm:max-w-[17rem]"
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
          className="input min-w-0 flex-1 border-2 py-3 text-center font-hero text-xl font-extrabold tracking-[0.25em] uppercase"
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
        <button className="btn border-2 px-4 font-hero font-extrabold" disabled={clean.length < 4 || busy}>
          {joining ? "…" : "Join"}
        </button>
      </form>
      {error && (
        <p id="home-error" role="alert" className="animate-rise text-sm text-brand sm:basis-full">
          {error}
        </p>
      )}
    </div>
  );
}

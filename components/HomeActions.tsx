"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { newRoomCode, normalizeCode } from "@/lib/identity";
import { createRoom, roomExists } from "@/lib/rooms";
import { Magnetic } from "./Magnetic";

export function HomeActions() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const clean = normalizeCode(code);
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy("create");
    setError(null);
    const fresh = newRoomCode();
    const res = await createRoom(fresh);
    if (res.ok) router.push(`/r/${fresh}`);
    else {
      setError(res.error);
      setBusy(null);
    }
  };

  const join = async () => {
    if (clean.length < 4) return;
    setBusy("join");
    setError(null);
    // A mistyped code used to create a brand-new room; check it exists first.
    const exists = await roomExists(clean);
    if (exists === false) {
      setError(`No room with the code ${clean}. Check it with your friends, or create a new room.`);
      setBusy(null);
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
    <div className="glass lit-edge space-y-5 p-5 sm:p-6">
      <div>
        <div className="label mb-2">Start fresh</div>
        <Magnetic>
          <button className="btn btn-primary w-full py-3 text-lg" onClick={create} disabled={busy !== null}>
            {busy === "create" ? "Creating…" : "Create a room"}
          </button>
        </Magnetic>
      </div>
      <div className="label flex items-center gap-3 text-[10px]">
        <span className="h-px flex-1 bg-line" /> or join friends <span className="h-px flex-1 bg-line" />
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
          className="input font-mono text-lg tracking-[0.3em] uppercase"
          placeholder="CODE"
          autoComplete="off"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError(null);
          }}
          aria-invalid={error !== null && busy === null && code !== ""}
          aria-describedby={error ? "home-error" : undefined}
        />
        <button className="btn" disabled={clean.length < 4 || busy !== null}>
          {busy === "join" ? "…" : "Join"}
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

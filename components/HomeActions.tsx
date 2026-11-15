"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { newRoomCode, normalizeCode } from "@/lib/identity";

export function HomeActions() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const clean = normalizeCode(code);

  return (
    <div className="card space-y-5 p-5 sm:p-6">
      <div>
        <div className="label mb-2">Start fresh</div>
        <button className="btn btn-primary w-full py-3 text-lg" onClick={() => router.push(`/r/${newRoomCode()}`)}>
          Create a room
        </button>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" /> or join friends <span className="h-px flex-1 bg-line" />
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (clean.length >= 4) router.push(`/r/${clean}`);
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
          onChange={(e) => setCode(e.target.value)}
        />
        <button className="btn" disabled={clean.length < 4}>
          Join
        </button>
      </form>
    </div>
  );
}

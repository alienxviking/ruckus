"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import type { ClientMsg, Player, RoomView } from "@/shared/types";
import { Avatar } from "../Avatar";

/** Covers the game while someone reads the rules: who, how long at most, and Resume for the host. */
export function PauseOverlay({
  pause,
  byId,
  me,
  isHost,
  serverNow,
  send,
}: {
  pause: NonNullable<RoomView["pause"]>;
  byId: Record<string, Player>;
  me: string;
  isHost: boolean;
  serverNow: () => number;
  send: (m: ClientMsg) => void;
}) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((pause.until - serverNow()) / 1000)));
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.ceil((pause.until - serverNow()) / 1000)));
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [pause.until, serverNow]);

  const readers = pause.by.map((id) => byId[id]).filter(Boolean);
  const names = readers.map((p) => (p.id === me ? "You" : p.name));
  const who = names.length > 2 ? `${names.length} players` : names.join(" and ");
  const mine = pause.by.includes(me);

  return (
    <div className="pause-live absolute inset-0 z-30 grid place-items-center rounded-xl bg-ink/75 p-4 backdrop-blur-sm" role="status">
      <div className="card lit-edge animate-rise flex max-w-sm flex-col items-center gap-3 p-5 text-center">
        <span className="grid size-11 place-items-center rounded-full border border-line bg-panel-2">
          <Pause aria-hidden className="size-5" strokeWidth={2.2} />
        </span>
        <p className="font-hero text-xl font-extrabold tracking-[-0.03em]">Paused</p>
        <p className="flex flex-wrap items-center justify-center gap-1.5 text-sm text-muted">
          {readers.slice(0, 2).map((p) => (
            <Avatar key={p.id} id={p.avatar} />
          ))}
          <span>
            <b className="text-text">{who || "Someone"}</b> {names.length === 1 && names[0] !== "You" ? "is" : "are"}{" "}
            reading the rules
          </span>
        </p>
        <p className="font-mono text-xs text-muted">Back on in {left}s at the latest</p>
        {isHost && !mine && (
          <button className="btn btn-primary" onClick={() => send({ t: "pause", on: false, all: true })}>
            <Play aria-hidden className="size-4" strokeWidth={2.2} /> Resume now
          </button>
        )}
      </div>
    </div>
  );
}

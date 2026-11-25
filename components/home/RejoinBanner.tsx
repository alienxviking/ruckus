"use client";

import { ArrowRight, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CATALOG_BY_ID } from "@/games/catalog";
import { forgetRoom, loadLastRoom, type LastRoom } from "@/lib/last-room";
import { roomExists } from "@/lib/rooms";
import { Rux } from "../Rux";

/** "You were in room ABCD: jump back in?" when this browser's last room is still open. */
export function RejoinBanner() {
  const [room, setRoom] = useState<(LastRoom & { when: string }) | null>(null);

  useEffect(() => {
    const last = loadLastRoom();
    if (!last) return;
    let live = true;
    // Only offer rooms that still exist (the server forgets them a while after everyone leaves).
    roomExists(last.code).then((exists) => {
      if (!live) return;
      if (exists === false) forgetRoom(last.code);
      else if (exists) {
        const ago = Math.max(1, Math.round((Date.now() - last.at) / 60_000));
        setRoom({ ...last, when: ago < 60 ? `${ago} min ago` : `${Math.round(ago / 60)} h ago` });
      }
    });
    return () => {
      live = false;
    };
  }, []);

  if (!room) return null;
  const game = CATALOG_BY_ID[room.gameId];
  return (
    <div
      role="region"
      aria-label="Rejoin your room"
      className="animate-rise relative mt-2 mb-1 flex max-w-md items-center gap-3 rounded-2xl border-2 border-brand-2/60 bg-panel/90 p-3 pr-10 shadow-lg shadow-black/40"
    >
      <span aria-hidden className="bob w-11 shrink-0" style={{ "--tilt": "-6deg" } as React.CSSProperties}>
        <Rux mood="wow" className="w-full" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="marker text-lg leading-tight text-brand-2">wapas aao!</p>
        <p className="text-sm">
          You were in room <b className="font-mono tracking-[0.15em]">{room.code}</b>
          <span className="text-muted">
            {game ? ` · ${room.playing ? "playing" : "picked"} ${game.name}` : ""} · {room.when}
          </span>
        </p>
        <Link href={`/r/${room.code}`} className="btn btn-primary mt-2 min-h-10 px-4 text-sm font-bold">
          Jump back in <ArrowRight aria-hidden className="size-4" strokeWidth={2.4} />
        </Link>
      </div>
      <button
        type="button"
        onClick={() => {
          forgetRoom(room.code);
          setRoom(null);
        }}
        aria-label="No thanks, hide this"
        title="Hide"
        className="absolute top-2 right-2 grid size-8 place-items-center rounded-lg text-muted hover:bg-panel-2 hover:text-text"
      >
        <X aria-hidden className="size-4" strokeWidth={2.25} />
      </button>
    </div>
  );
}

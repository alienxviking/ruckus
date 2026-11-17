"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bot, Users, X } from "lucide-react";
import type { GameMeta } from "@/games/catalog";
import { useCreateRoom } from "@/lib/useCreateRoom";
import { GameBrowser } from "../GameBrowser";
import { GameBadge } from "../GameBadge";

/**
 * The game library on the home page. Tapping a game offers the two ways to play it:
 * solo / vs bots (when it runs locally) or in a new room with friends.
 */
export function HomeGames({ localIds }: { localIds: string[] }) {
  const [picked, setPicked] = useState<GameMeta | null>(null);
  // A fresh "nothing selected" id after every close, so the browser drops its highlight.
  const [closes, setCloses] = useState(0);
  const close = () => {
    setPicked(null);
    setCloses((n) => n + 1);
  };

  return (
    <>
      <GameBrowser selectedId={picked?.id ?? `none-${closes}`} onSelect={setPicked} />
      {picked && (
        <PlaySheet key={picked.id} game={picked} local={localIds.includes(picked.id)} onClose={close} />
      )}
    </>
  );
}

function PlaySheet({ game, local, onClose }: { game: GameMeta; local: boolean; onClose: () => void }) {
  const { create, busy, error } = useCreateRoom();
  const first = useRef<HTMLAnchorElement & HTMLButtonElement>(null);

  useEffect(() => {
    first.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const solo = game.minPlayers <= 1;
  return (
    <div
      role="dialog"
      aria-labelledby="play-sheet-title"
      className="glass lit-edge animate-rise fixed inset-x-3 bottom-3 z-40 mx-auto max-w-md p-4 sm:bottom-6"
      style={{ "--accent": game.accent } as React.CSSProperties}
    >
      <div className="flex items-start gap-3">
        <GameBadge id={game.id} accent={game.accent} size="md" sheen />
        <div className="min-w-0 flex-1">
          <p className="label">How do you want to play?</p>
          <h3 id="play-sheet-title" className="truncate font-display text-lg font-bold">
            {game.name}
          </h3>
        </div>
        <button className="btn shrink-0 p-2" aria-label="Close" onClick={onClose}>
          <X aria-hidden className="size-4" strokeWidth={2} />
        </button>
      </div>
      <div className={`mt-3 grid gap-2 ${local ? "grid-cols-2" : ""}`}>
        {local && (
          <Link ref={first} href={`/play/${game.id}`} className="btn btn-primary py-2.5">
            <Bot aria-hidden className="size-4" strokeWidth={2} />
            {solo ? "Play solo" : "Play vs bots"}
          </Link>
        )}
        <button
          ref={local ? undefined : first}
          className={`btn py-2.5 ${local ? "" : "btn-primary"}`}
          onClick={() => create(game.id)}
          disabled={busy}
        >
          <Users aria-hidden className="size-4" strokeWidth={2} />
          {busy ? "Creating…" : "With friends"}
        </button>
      </div>
      {!local && (
        <p className="mt-2 font-mono text-[11px] text-muted">
          {game.minPlayers}+ players: makes a room with this game picked.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-brand">
          {error}
        </p>
      )}
    </div>
  );
}

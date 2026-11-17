"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { REACTIONS, type ClientMsg, type Player } from "@/shared/types";
import { Avatar } from "../Avatar";

// Mirrors the server's limit (3 in a burst, then one every 1.5 s) so the buttons show it.
const BURST = 3;
const REFILL_MS = 1_500;
const MAX_ON_SCREEN = 18;

/** Row of quick reactions under the game. Rate limited (here and on the server). */
export function ReactionBar({ send }: { send: (m: ClientMsg) => void }) {
  const bucket = useRef({ tokens: BURST, at: 0 });
  const [cooling, setCooling] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);

  const fire = useCallback((e: number) => {
    const now = performance.now();
    const b = bucket.current;
    b.tokens = Math.min(BURST, b.tokens + (now - b.at) / REFILL_MS);
    b.at = now;
    if (b.tokens < 1) return;
    b.tokens -= 1;
    send({ t: "react", e });
    if (b.tokens < 1) {
      setCooling(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCooling(false), (1 - b.tokens) * REFILL_MS);
    }
  }, [send]);

  return (
    <div className="flex items-center justify-end gap-0.5" role="group" aria-label="Reactions">
      {REACTIONS.map((emoji, i) => (
        <button
          key={emoji}
          type="button"
          className={`grid size-9 place-items-center rounded-full text-lg transition-[transform,opacity] duration-150 hover:scale-110 active:scale-90 ${
            cooling ? "opacity-35" : ""
          }`}
          aria-label={`React ${emoji}`}
          aria-disabled={cooling}
          onClick={() => fire(i)}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

interface Floating {
  id: number;
  emoji: string;
  avatar?: string;
  x: number;
  drift: number;
}

/** Reactions floating up over the game, from everyone. Pointer-transparent. */
export function ReactionLayer({
  onReact,
  byId,
}: {
  onReact: (fn: (r: { from: string; e: number }) => void) => () => void;
  byId: Record<string, Player>;
}) {
  const [items, setItems] = useState<Floating[]>([]);
  const seq = useRef(0);
  const players = useRef(byId);
  useEffect(() => {
    players.current = byId;
  }, [byId]);

  useEffect(
    () =>
      onReact(({ from, e }) => {
        const emoji = REACTIONS[e];
        if (!emoji) return;
        const id = ++seq.current;
        const item: Floating = {
          id,
          emoji,
          avatar: players.current[from]?.avatar,
          x: 8 + Math.random() * 84,
          drift: (Math.random() - 0.5) * 60,
        };
        setItems((cur) => [...cur.slice(-(MAX_ON_SCREEN - 1)), item]);
        window.setTimeout(() => setItems((cur) => cur.filter((it) => it.id !== id)), 2_400);
      }),
    [onReact],
  );

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {items.map((it) => (
        <span
          key={it.id}
          className="react-float absolute bottom-6 flex flex-col items-center"
          style={{ left: `${it.x}%`, "--drift": `${it.drift}px` } as React.CSSProperties}
        >
          <span className="text-4xl drop-shadow-[0_4px_10px_rgba(0,0,0,.5)]">{it.emoji}</span>
          {it.avatar && <Avatar id={it.avatar} size="1.4rem" />}
        </span>
      ))}
    </div>
  );
}

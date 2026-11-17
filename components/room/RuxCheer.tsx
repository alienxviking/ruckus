"use client";

import { useEffect, useRef, useState } from "react";
import type { RoomView } from "@/shared/types";
import { Rux, type RuxMood } from "../Rux";

interface Cheer {
  id: number;
  text: string;
  mood: RuxMood;
}

const pick = <T,>(xs: T[], n: number) => xs[n % xs.length];

/**
 * Rux popping up in the corner for the room's little moments: someone arriving or leaving, a
 * winning streak, a photo finish. Never more than one at a time, at most one every few
 * seconds, and nothing while a game is being played (the board needs your eyes).
 */
export function RuxCheer({ room, me }: { room: RoomView; me: string }) {
  const [cheer, setCheer] = useState<Cheer | null>(null);
  const seen = useRef<{ chat: string | undefined; games: number } | null>(null);
  const lastAt = useRef(0);
  const seq = useRef(0);

  useEffect(() => {
    const lastChat = room.chat[room.chat.length - 1]?.id;
    const prev = seen.current;
    seen.current = { chat: lastChat, games: room.history.length };
    if (!prev) return; // first sync: don't react to the past
    const say = (text: string, mood: RuxMood) => {
      const now = Date.now();
      if (now - lastAt.current < 5000) return;
      lastAt.current = now;
      const id = ++seq.current;
      queueMicrotask(() => setCheer({ id, text, mood }));
      window.setTimeout(() => setCheer((c) => (c?.id === id ? null : c)), 3400);
    };
    const n = seq.current + room.gameSeq;

    // A game just finished: streaks and photo finishes.
    if (room.history.length > prev.games) {
      const h = room.history;
      const last = h[h.length - 1];
      const w = last.winners.length === 1 ? last.winners[0] : null;
      let streak = 0;
      for (let i = h.length - 1; i >= 0 && w && h[i].winners.length === 1 && h[i].winners[0] === w; i--) streak++;
      const name = w === me ? "you" : (room.players.find((p) => p.id === w)?.name ?? "someone");
      const scores = room.result?.scores ? Object.values(room.result.scores).sort((a, b) => b - a) : [];
      if (w && streak >= 3) {
        say(w === me ? `${streak} in a row?! you're on fire 🔥` : `${name} ${streak} in a row?! koi toh roko 😳`, "wow");
      } else if (scores.length >= 2 && scores[0] > 0 && scores[0] - scores[1] <= Math.max(1, scores[0] * 0.04)) {
        say(pick(["photo finish! 📸", "uff, itna close! 😮‍💨", "by a whisker! 🐭"], n), "wow");
      }
      return;
    }

    // Arrivals and departures (lobby / results only).
    if (lastChat !== prev.chat && room.phase === "lobby") {
      const m = room.chat[room.chat.length - 1];
      if (m && !m.from) {
        const joined = /^(.+?) joined(?: \(practice bot\))?$/.exec(m.text);
        const left = /^(.+?) left$/.exec(m.text);
        if (joined && !m.text.includes(room.players.find((p) => p.id === me)?.name ?? "\u0000")) {
          say(pick([`${joined[1]} aa gaya! 🎉`, `welcome ${joined[1]}! 👋`, `${joined[1]} is here, ab maza aayega`], n), "grin");
        } else if (left) {
          say(pick([`${left[1]} bhaag gaya 🏃`, `bye ${left[1]} 👋`], n), "sleepy");
        }
      }
    }
  }, [room, me]);

  if (!cheer) return null;
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-24 left-3 z-40 lg:bottom-6 lg:left-6">
      <div key={cheer.id} className="rux-cheer flex items-end gap-1.5">
        <span className="w-14 shrink-0">
          <Rux mood={cheer.mood} className="w-full" />
        </span>
        <span className="marker mb-4 max-w-[15rem] rounded-2xl rounded-bl-md border-[3px] border-ink bg-paper px-3 py-1.5 text-lg leading-tight text-ink shadow-[3px_4px_0_var(--color-pink)]">
          {cheer.text}
        </span>
      </div>
    </div>
  );
}

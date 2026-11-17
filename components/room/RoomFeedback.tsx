"use client";

import { Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { feedback, getFeedbackSettings, setFeedbackSettings, sfx, subscribeFeedback } from "@/lib/feedback";
import { recordResult } from "@/lib/progress";
import type { AccessoryId, RoomView } from "@/shared/types";

/**
 * Room-wide sound and haptics: a game starting, the result (win or not), people joining,
 * chat from others, and quick play's last seconds. Games add their own cues on top.
 */
export function useRoomFeedback(room: RoomView | null, me: string, serverNow: () => number) {
  /** Accessories a win just unlocked (for the "Unlocked!" toast). */
  const [unlocked, setUnlocked] = useState<AccessoryId[]>([]);
  const seen = useRef<{ seq: number; result: boolean; chat: string | undefined } | null>(null);

  useEffect(() => {
    if (!room) return;
    const lastChat = room.chat[room.chat.length - 1]?.id;
    const prev = seen.current;
    seen.current = { seq: room.gameSeq, result: !!room.result, chat: lastChat };
    if (!prev) return; // first sync: don't replay what already happened

    if (room.gameSeq !== prev.seq && room.phase === "playing") feedback("start");
    else if (room.result && !prev.result) {
      const won = room.result.winners.includes(me);
      feedback(won ? "win" : "end");
      if (room.participants.includes(me)) {
        // Only games with at least one other person count (practice bots don't).
        const humans = room.participants.filter((id) => !room.players.find((p) => p.id === id)?.bot).length;
        const fresh = recordResult({ gameId: room.gameId, won, humans });
        if (fresh.length) queueMicrotask(() => setUnlocked(fresh));
      }
    }

    if (lastChat !== prev.chat) {
      // Only the newest line, so a burst of history doesn't machine-gun.
      const m = room.chat[room.chat.length - 1];
      if (m?.from && m.from !== me) sfx("chat");
      else if (!m?.from && m?.avatar && / joined/.test(m.text)) sfx("join");
    }
  }, [room, me]);

  // Quick play: tick through the last three seconds before the next game.
  const at = room?.next?.at;
  useEffect(() => {
    if (!at) return;
    const timers: number[] = [];
    for (const s of [3, 2, 1]) {
      const wait = at - s * 1000 - serverNow();
      if (wait > 0) timers.push(window.setTimeout(() => sfx("tick"), wait));
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [at, serverNow]);

  return { unlocked, dismissUnlocked: () => setUnlocked([]) };
}

/** Header button: sound on/off (vibration follows it). */
export function SoundToggle() {
  const on = useSyncExternalStore(
    subscribeFeedback,
    () => getFeedbackSettings().sound,
    () => true,
  );
  return (
    <button
      className="btn px-2.5 py-1.5"
      aria-pressed={on}
      aria-label={on ? "Mute sounds" : "Turn sounds on"}
      title={on ? "Mute sounds" : "Turn sounds on"}
      onClick={() => {
        setFeedbackSettings({ sound: !on, haptics: !on });
        if (!on) feedback("pop");
      }}
    >
      {on ? (
        <Volume2 aria-hidden className="size-4" strokeWidth={2} />
      ) : (
        <VolumeX aria-hidden className="size-4 text-muted" strokeWidth={2} />
      )}
    </button>
  );
}

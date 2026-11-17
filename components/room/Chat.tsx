"use client";

import { SendHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ClientMsg, Player, RoomView } from "@/shared/types";
import { Avatar } from "@/components/Avatar";

export function Chat({
  room,
  byId,
  me,
  send,
  compact,
}: {
  room: RoomView;
  byId: Record<string, Player>;
  me: string;
  send: (m: ClientMsg) => void;
  compact?: boolean;
}) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const last = room.chat[room.chat.length - 1]?.id;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [last]);

  return (
    <div className="card flex flex-col p-3">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="font-hero text-base font-extrabold">Chat</span>
        <span className="marker text-base text-muted">bolo bolo</span>
      </div>
      <ol
        ref={listRef}
        className={`flex flex-col gap-1.5 overflow-x-hidden overflow-y-auto px-1 text-sm ${compact ? "h-56" : "h-72"}`}
        aria-live="polite"
      >
        {room.chat.map((m, i) => {
          if (!m.from) {
            // Room news (joins, starts, wins): a small marker note in the middle.
            const tone = /\bleft\b|removed/.test(m.text)
              ? "var(--color-pink)"
              : /won|wins|🏆|started|🎮/.test(m.text)
                ? "var(--color-sun)"
                : /quick play|⏭️|⏸️|paused|▶️|host|locked|🔒|🔓/i.test(m.text)
                  ? "var(--color-cyan)"
                  : "var(--color-volt)";
            return (
              <li key={m.id} className="animate-chat flex justify-center py-0.5">
                <span
                  className="marker max-w-[92%] rounded-lg border-2 border-ink px-2.5 py-0.5 text-center text-[15px] leading-snug break-words text-ink shadow-[2px_3px_0_rgb(0_0_0/0.5)]"
                  style={{ background: tone, transform: `rotate(${i % 2 ? 1.5 : -1.5}deg)` }}
                >
                  {m.avatar && (
                    <>
                      <Avatar id={m.avatar} />{" "}
                    </>
                  )}
                  {m.text}
                </span>
              </li>
            );
          }
          const p = byId[m.from];
          const mine = m.from === me;
          // Consecutive lines from the same person share one name/avatar.
          const prev = room.chat[i - 1];
          const first = !prev || prev.from !== m.from;
          return (
            <li key={m.id} className={`animate-chat flex items-end gap-1.5 ${mine ? "flex-row-reverse" : ""}`}>
              <span aria-hidden className={`w-6 shrink-0 text-center text-lg leading-none ${first ? "" : "invisible"}`}>
                {p ? <Avatar id={p.avatar} /> : "🙂"}
              </span>
              <span className={`flex min-w-0 max-w-[80%] flex-col ${mine ? "items-end" : "items-start"}`}>
                {first && !mine && (
                  <span className="px-1 text-[11px] font-bold" style={{ color: p?.color }}>
                    {p?.name ?? "someone"}
                  </span>
                )}
                <span
                  className={`rounded-2xl border-2 px-3 py-1.5 break-words ${
                    mine ? "rounded-br-md border-ink bg-brand-2 font-medium text-ink" : "rounded-bl-md border-line bg-panel-2 text-text"
                  }`}
                  style={mine ? undefined : { borderColor: p ? `${p.color}66` : undefined }}
                >
                  {m.text}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          send({ t: "chat", text });
          setText("");
        }}
      >
        <label htmlFor={compact ? "chat-m" : "chat"} className="sr-only">
          Message
        </label>
        <input
          id={compact ? "chat-m" : "chat"}
          className="input rounded-full py-1.5 text-sm"
          placeholder="kuch toh bolo…"
          maxLength={200}
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn btn-primary rounded-full px-3 py-1.5 text-sm" aria-label="Send">
          <SendHorizontal aria-hidden className="size-4" strokeWidth={2.4} />
        </button>
      </form>
    </div>
  );
}

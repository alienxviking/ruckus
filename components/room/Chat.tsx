"use client";

import { useEffect, useRef, useState } from "react";
import type { ClientMsg, Player, RoomView } from "@/shared/types";

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
      <div className="label mb-2">Chat</div>
      <ol
        ref={listRef}
        className={`space-y-1 overflow-y-auto pr-1 text-sm ${compact ? "h-56" : "h-72"}`}
        aria-live="polite"
      >
        {room.chat.map((m) => {
          if (!m.from) {
            return (
              <li key={m.id} className="text-xs text-muted">
                {m.text}
              </li>
            );
          }
          const p = byId[m.from];
          return (
            <li key={m.id} className="break-words">
              <span className="font-semibold" style={{ color: p?.color }}>
                {p ? `${p.avatar} ${p.name}` : "someone"}
              </span>
              <span className={m.from === me ? "text-text" : "text-text/85"}>: {m.text}</span>
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
          className="input py-1.5 text-sm"
          placeholder="Say something…"
          maxLength={200}
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn px-3 py-1.5 text-sm">Send</button>
      </form>
    </div>
  );
}

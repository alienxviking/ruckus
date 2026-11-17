"use client";

import { Bot, Crown, Lock, LockOpen, Minus, MoreHorizontal, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MAX_PLAYERS, type ClientMsg, type RoomView } from "@/shared/types";
import { GAME_CONFIG } from "@/games/config";
import { CATALOG_BY_ID } from "@/games/catalog";
import { RollingNumber } from "../RollingNumber";
import { Avatar } from "@/components/Avatar";

export function PlayerList({
  room,
  me,
  isHost,
  send,
}: {
  room: RoomView;
  me: string;
  isHost: boolean;
  send: (m: ClientMsg) => void;
}) {
  const players = room.players.slice().sort((a, b) => (room.wins[b.id] ?? 0) - (room.wins[a.id] ?? 0));
  const online = room.players.filter((p) => p.connected).length;
  const bots = room.players.filter((p) => p.bot && p.connected).length;
  const [menu, setMenu] = useState<string | null>(null);
  const [confirmKick, setConfirmKick] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  // Close the row menu on any outside click or Escape.
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !listRef.current?.querySelector("[data-menu]")?.contains(e.target as Node)) {
        setMenu(null);
        setConfirmKick(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);

  const game = CATALOG_BY_ID[room.gameId];
  const botsPlay = !!GAME_CONFIG[room.gameId]?.bots;

  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <span className="label flex items-center gap-1.5">
          Players
          <span className="rounded-sm border border-line bg-ink px-1.5 py-px text-text">
            <RollingNumber value={online} />
          </span>
          {room.locked && !isHost && <Lock aria-label="Room locked" className="size-3 text-brand-2" strokeWidth={2.2} />}
        </span>
        <span className="flex items-center gap-2">
          {isHost && (
            <button
              type="button"
              className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] tracking-wide uppercase transition-colors ${
                room.locked ? "border-brand-2/50 bg-brand-2/10 text-brand-2" : "border-line text-muted hover:text-text"
              }`}
              aria-pressed={room.locked}
              title={room.locked ? "Locked: nobody new can join. Click to open." : "Lock the room so nobody new can join"}
              onClick={() => send({ t: "lock", on: !room.locked })}
            >
              {room.locked ? <Lock aria-hidden className="size-3" strokeWidth={2.2} /> : <LockOpen aria-hidden className="size-3" strokeWidth={2.2} />}
              {room.locked ? "locked" : "lock"}
            </button>
          )}
          <span className="label text-[10px]">wins</span>
        </span>
      </div>
      <ul ref={listRef} className="space-y-1">
        {players.map((p) => {
          const playing = room.phase === "playing" && room.participants.includes(p.id);
          const watching = room.phase === "playing" && !playing;
          const status = p.bot
            ? !p.connected
              ? "leaving"
              : playing
                ? "playing"
                : watching
                  ? "sitting out"
                  : "practice bot"
            : !p.connected
              ? "reconnecting…"
              : watching
                ? "watching"
                : playing
                  ? "playing"
                  : "in lobby";
          const canManage = isHost && p.id !== me;
          return (
            <li
              key={p.id}
              className={`animate-rise relative flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-opacity duration-300 ${
                p.id === me ? "bg-panel-2" : ""
              } ${p.connected ? "" : "opacity-45"} ${menu === p.id ? "z-20" : ""}`}
            >
              {p.id === me && (
                <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full" style={{ background: p.color }} />
              )}
              <span
                aria-hidden
                className="relative grid size-8 shrink-0 place-items-center rounded-md text-lg"
                style={{
                  background: `linear-gradient(180deg, ${p.color}30, ${p.color}12)`,
                  boxShadow: `inset 0 0 0 1px ${p.color}aa, inset 0 0 12px -4px ${p.color}`,
                }}
              >
                <Avatar id={p.avatar} />
                <span
                  className={`absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-panel ${
                    p.connected ? "bg-green-400" : "bg-muted"
                  }`}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold" style={{ color: p.color }}>
                  {p.name}
                  {p.id === me && <span className="ml-1 text-xs font-normal text-muted">(you)</span>}
                </span>
                <span className="flex items-center gap-1 font-mono text-[10px] tracking-wide text-muted uppercase">
                  {p.id === room.hostId && (
                    <>
                      <Crown aria-hidden className="size-3 text-brand-2" strokeWidth={2} />
                      <span className="text-brand-2">host</span> ·
                    </>
                  )}
                  {p.bot && <Bot aria-hidden className="size-3" strokeWidth={2} />} {status}
                </span>
              </span>
              <RollingNumber value={room.wins[p.id] ?? 0} className="font-mono text-sm font-bold" />
              {canManage && (
                <span className="relative" data-menu={menu === p.id ? "" : undefined}>
                  <button
                    type="button"
                    className="grid size-7 place-items-center rounded-md text-muted transition-colors hover:bg-panel-2 hover:text-text"
                    aria-label={`Manage ${p.name}`}
                    aria-haspopup="menu"
                    aria-expanded={menu === p.id}
                    onClick={() => {
                      setConfirmKick(false);
                      setMenu(menu === p.id ? null : p.id);
                    }}
                  >
                    <MoreHorizontal aria-hidden className="size-4" strokeWidth={2} />
                  </button>
                  {menu === p.id && (
                    <span
                      role="menu"
                      className="absolute top-full right-0 z-30 mt-1 flex w-44 flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-lg shadow-black/50"
                    >
                      {!p.bot && p.connected && (
                        <button
                          role="menuitem"
                          className="flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-panel-2"
                          onClick={() => {
                            send({ t: "host", id: p.id });
                            setMenu(null);
                          }}
                        >
                          <Crown aria-hidden className="size-3.5 text-brand-2" strokeWidth={2} /> Make host
                        </button>
                      )}
                      <button
                        role="menuitem"
                        className={`px-3 py-2 text-left text-sm hover:bg-panel-2 ${confirmKick ? "font-semibold text-brand" : "text-brand"}`}
                        onClick={() => {
                          if (!p.bot && !confirmKick) return setConfirmKick(true);
                          send({ t: "kick", id: p.id });
                          setMenu(null);
                          setConfirmKick(false);
                        }}
                      >
                        {p.bot ? "Remove bot" : confirmKick ? `Remove ${p.name}? Tap again` : "Remove from room"}
                      </button>
                    </span>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {isHost && room.phase === "lobby" && (
        <div className="mt-2 flex items-center gap-2 border-t border-line px-1 pt-2">
          <Bot aria-hidden className="size-4 shrink-0 text-muted" strokeWidth={2} />
          <span className="min-w-0 flex-1 text-xs text-muted">
            Practice bots{" "}
            <span className="block font-mono text-[10px]">
              {botsPlay ? `they play ${game?.name ?? "this game"}` : `can't play ${game?.name ?? "this game"}`}
            </span>
          </span>
          <button
            type="button"
            className="btn p-1.5"
            aria-label="Remove a practice bot"
            disabled={!bots}
            onClick={() => send({ t: "bot", add: false })}
          >
            <Minus aria-hidden className="size-3.5" strokeWidth={2.4} />
          </button>
          <span className="w-4 text-center font-mono text-sm">{bots}</span>
          <button
            type="button"
            className="btn p-1.5"
            aria-label="Add a practice bot"
            disabled={room.players.length >= MAX_PLAYERS}
            onClick={() => send({ t: "bot", add: true })}
          >
            <Plus aria-hidden className="size-3.5" strokeWidth={2.4} />
          </button>
        </div>
      )}
    </div>
  );
}

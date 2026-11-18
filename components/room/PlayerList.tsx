"use client";

import { ChevronDown, Crown, Lock, LockOpen, Minus, Plus } from "lucide-react";
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
  const players = room.players.filter((p) => !p.removed).sort((a, b) => (room.wins[b.id] ?? 0) - (room.wins[a.id] ?? 0));
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
      <div className="mb-2.5 flex items-center justify-between gap-2 px-1">
        <span className="flex items-center gap-2">
          <span className="font-hero text-base font-extrabold">Players</span>
          <span className="grid h-6 min-w-6 place-items-center rounded-full border-2 border-ink bg-brand-2 px-1.5 text-xs font-extrabold text-ink">
            <RollingNumber value={online} />
          </span>
          {room.locked && !isHost && <Lock aria-label="Room locked" className="size-3.5 text-brand-2" strokeWidth={2.4} />}
        </span>
        {isHost && (
          <button
            type="button"
            className={`flex min-h-9 items-center gap-1 rounded-full border-2 px-3 py-0.5 text-sm font-bold transition-colors ${
              room.locked ? "border-ink bg-brand-2 text-ink" : "border-text/35 text-text hover:border-text/60"
            }`}
            aria-pressed={room.locked}
            title={room.locked ? "Locked: nobody new can join. Click to open." : "Lock the room so nobody new can join"}
            onClick={() => send({ t: "lock", on: !room.locked })}
          >
            {room.locked ? <Lock aria-hidden className="size-3" strokeWidth={2.4} /> : <LockOpen aria-hidden className="size-3" strokeWidth={2.4} />}
            {room.locked ? "Locked" : "Lock room"}
          </button>
        )}
      </div>
      <ul ref={listRef} className="space-y-1.5">
        {players.map((p, i) => {
          const playing = room.phase === "playing" && room.participants.includes(p.id);
          const watching = room.phase === "playing" && !playing;
          const status = p.bot
            ? !p.connected
              ? "leaving…"
              : playing
                ? "playing 🎮"
                : watching
                  ? "sitting out"
                  : "practice bot 🤖"
            : !p.connected
              ? "reconnecting… 📡"
              : watching
                ? "watching 👀"
                : playing
                  ? "playing 🎮"
                  : "ready ✌️";
          const canManage = isHost && p.id !== me;
          const wins = room.wins[p.id] ?? 0;
          return (
            <li
              key={p.id}
              className={`animate-rise relative flex items-center gap-2.5 rounded-xl border-2 px-2 py-1.5 transition-opacity duration-300 ${
                p.connected ? "" : "opacity-45"
              } ${menu === p.id ? "z-20" : ""}`}
              style={{
                borderColor: p.id === me ? p.color : `${p.color}40`,
                background: `linear-gradient(90deg, ${p.color}22, transparent 70%)`,
              }}
            >
              <span
                aria-hidden
                className="relative grid size-10 shrink-0 place-items-center rounded-xl border-2 border-paper text-2xl shadow-[2px_3px_0_rgb(0_0_0/0.5)]"
                style={{ background: `${p.color}55`, transform: `rotate(${i % 2 ? 5 : -5}deg)` }}
              >
                <Avatar id={p.avatar} />
                {p.id === room.hostId && <span className="absolute -top-3 -left-2 rotate-[-18deg] text-base leading-none">👑</span>}
                <span
                  className={`absolute -right-1 -bottom-1 size-3 rounded-full border-2 border-panel ${p.connected ? "bg-green-400" : "bg-muted"}`}
                />
              </span>
              <span className="relative min-w-0 flex-1" data-menu={menu === p.id ? "" : undefined}>
                {canManage ? (
                  // Host: the name opens this player's menu (keeps the wins column lined up).
                  <button
                    type="button"
                    className="-mx-1 flex max-w-full items-center gap-1 rounded px-1 text-left font-hero font-extrabold transition-colors hover:bg-panel-2"
                    style={{ color: p.color }}
                    aria-haspopup="menu"
                    aria-expanded={menu === p.id}
                    title={`Manage ${p.name}`}
                    onClick={() => {
                      setConfirmKick(false);
                      setMenu(menu === p.id ? null : p.id);
                    }}
                  >
                    <span className="truncate">{p.name}</span>
                    <ChevronDown
                      aria-hidden
                      className={`size-3.5 shrink-0 text-muted transition-transform ${menu === p.id ? "rotate-180" : ""}`}
                      strokeWidth={2.4}
                    />
                  </button>
                ) : (
                  <span className="block truncate font-hero font-extrabold" style={{ color: p.color }}>
                    {p.name}
                    {p.id === me && <span className="ml-1 font-sans text-xs font-semibold text-muted">(you)</span>}
                  </span>
                )}
                <span className="marker block truncate text-[15px] leading-tight text-muted">
                  {p.id === room.hostId ? <span className="text-brand-2">host · </span> : null}
                  {status}
                </span>
                {menu === p.id && (
                  <span
                    role="menu"
                    className="absolute top-6 left-0 z-30 flex w-48 flex-col overflow-hidden rounded-xl border-2 border-paper bg-panel shadow-[4px_5px_0_rgb(0_0_0/0.6)]"
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
              <span
                title={`${wins} ${wins === 1 ? "win" : "wins"} this session`}
                className={`flex shrink-0 items-center gap-0.5 rounded-lg border-2 px-1.5 py-0.5 text-xs font-extrabold ${
                  wins ? "border-ink bg-sun text-ink" : "border-line text-muted"
                }`}
              >
                🏆 <RollingNumber value={wins} />
              </span>
            </li>
          );
        })}
      </ul>
      {isHost && room.phase === "lobby" && (
        <div className="mt-2.5 flex items-center gap-2 rounded-xl border-2 border-dashed border-line px-2 py-1.5">
          <span aria-hidden className="text-xl leading-none">
            🤖
          </span>
          <span className="min-w-0 flex-1 text-xs font-bold text-text">
            Practice bots{" "}
            <span className="marker block text-[14px] font-normal text-muted">
              {botsPlay ? `they play ${game?.name ?? "this game"}` : `can't play ${game?.name ?? "this game"}`}
            </span>
          </span>
          <button
            type="button"
            className="btn size-10 shrink-0 p-0"
            aria-label="Remove a practice bot"
            disabled={!bots}
            onClick={() => send({ t: "bot", add: false })}
          >
            <Minus aria-hidden className="size-3.5" strokeWidth={2.4} />
          </button>
          <span className="w-4 text-center font-hero text-base font-extrabold">{bots}</span>
          <button
            type="button"
            className="btn size-10 shrink-0 p-0"
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

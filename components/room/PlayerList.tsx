import { Crown } from "lucide-react";
import type { RoomView } from "@/shared/types";
import { RollingNumber } from "../RollingNumber";

export function PlayerList({ room, me }: { room: RoomView; me: string }) {
  const players = room.players.slice().sort((a, b) => (room.wins[b.id] ?? 0) - (room.wins[a.id] ?? 0));
  const online = room.players.filter((p) => p.connected).length;
  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="label flex items-center gap-1.5">
          Players
          <span className="rounded-sm border border-line bg-ink px-1.5 py-px text-text">
            <RollingNumber value={online} />
          </span>
        </span>
        <span className="label text-[10px]">wins</span>
      </div>
      <ul className="space-y-1">
        {players.map((p) => {
          const playing = room.phase === "playing" && room.participants.includes(p.id);
          const watching = room.phase === "playing" && !playing;
          const status = !p.connected ? "reconnecting…" : watching ? "watching" : playing ? "playing" : "in lobby";
          return (
            <li
              key={p.id}
              className={`animate-rise relative flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-opacity duration-300 ${
                p.id === me ? "bg-panel-2" : ""
              } ${p.connected ? "" : "opacity-45"}`}
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
                {p.avatar}
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
                  )}{" "}
                  {status}
                </span>
              </span>
              <RollingNumber value={room.wins[p.id] ?? 0} className="font-mono text-sm font-bold" />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

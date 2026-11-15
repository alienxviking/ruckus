import type { RoomView } from "@/shared/types";

export function PlayerList({ room, me }: { room: RoomView; me: string }) {
  const players = room.players.slice().sort((a, b) => (room.wins[b.id] ?? 0) - (room.wins[a.id] ?? 0));
  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="label">Players · {room.players.filter((p) => p.connected).length}</span>
        <span className="text-xs text-muted">wins</span>
      </div>
      <ul className="space-y-1">
        {players.map((p) => {
          const playing = room.phase === "playing" && room.participants.includes(p.id);
          const watching = room.phase === "playing" && !playing;
          return (
            <li
              key={p.id}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${p.id === me ? "bg-panel-2" : ""} ${
                p.connected ? "" : "opacity-45"
              }`}
            >
              <span
                aria-hidden
                className="grid size-8 shrink-0 place-items-center rounded-lg text-lg"
                style={{ background: p.color + "26", boxShadow: `inset 0 0 0 1.5px ${p.color}` }}
              >
                {p.avatar}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold" style={{ color: p.color }}>
                  {p.name}
                  {p.id === me && <span className="ml-1 text-xs font-normal text-muted">(you)</span>}
                </span>
                <span className="block text-[11px] text-muted">
                  {p.id === room.hostId && "👑 host · "}
                  {!p.connected ? "reconnecting…" : watching ? "watching" : playing ? "playing" : "in lobby"}
                </span>
              </span>
              <span className="font-mono text-sm font-bold tabular-nums">{room.wins[p.id] ?? 0}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

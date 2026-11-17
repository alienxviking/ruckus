// Numbers for the session recap, worked out from the room's game history.
import type { HistoryEntry, Player } from "@/shared/types";

export interface PlayerLine {
  id: string;
  name: string;
  avatar: string;
  color: string;
  wins: number;
  played: number;
  bestStreak: number;
}

export interface Recap {
  games: number;
  minutes: number;
  lines: PlayerLine[];
  /** Most wins (ties included). Empty when nobody won anything. */
  champions: PlayerLine[];
  streak: { line: PlayerLine; n: number } | null;
  favourite: { gameId: string; n: number } | null;
}

export function buildRecap(history: HistoryEntry[], players: Player[]): Recap {
  const byId = new Map(players.map((p) => [p.id, p]));
  const stats = new Map<string, PlayerLine & { run: number }>();
  const line = (id: string) => {
    let s = stats.get(id);
    if (!s) {
      const p = byId.get(id);
      // Left the room (their wins went with them), or a practice bot: not in the recap.
      if (!p || p.bot || id.startsWith("bot-")) return null;
      s = { id, name: p.name, avatar: p.avatar, color: p.color, wins: 0, played: 0, bestStreak: 0, run: 0 };
      stats.set(id, s);
    }
    return s;
  };
  const counts: Record<string, number> = {};
  for (const h of history) {
    counts[h.gameId] = (counts[h.gameId] ?? 0) + 1;
    for (const id of h.players) {
      const s = line(id);
      if (!s) continue;
      s.played++;
      if (h.winners.includes(id)) {
        s.wins++;
        s.run++;
        s.bestStreak = Math.max(s.bestStreak, s.run);
      } else s.run = 0;
    }
  }
  const lines = [...stats.values()]
    .map((l): PlayerLine => ({ id: l.id, name: l.name, avatar: l.avatar, color: l.color, wins: l.wins, played: l.played, bestStreak: l.bestStreak }))
    .sort((a, b) => b.wins - a.wins || a.played - b.played || a.name.localeCompare(b.name));
  const top = lines[0]?.wins ?? 0;
  const champions = top > 0 ? lines.filter((l) => l.wins === top) : [];
  const bestStreak = lines.reduce<PlayerLine | null>((best, l) => (l.bestStreak > (best?.bestStreak ?? 1) ? l : best), null);
  const fav = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const minutes = history.length ? Math.max(1, Math.round((history[history.length - 1].at - history[0].at) / 60_000)) : 0;
  return {
    games: history.length,
    minutes,
    lines,
    champions,
    streak: bestStreak ? { line: bestStreak, n: bestStreak.bestStreak } : null,
    favourite: fav && fav[1] > 1 ? { gameId: fav[0], n: fav[1] } : null,
  };
}

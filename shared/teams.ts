// Two-team helpers for team games (and team modes of other games).

export const TEAMS = [
  { name: "Red", color: "#ff5d73" },
  { name: "Blue", color: "#38bdf8" },
] as const;

/** Shuffles players into two teams as evenly as possible (the first team gets the extra one). */
export function splitTeams(ids: readonly string[], random: () => number): [string[], string[]] {
  const a = ids.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  const half = Math.ceil(a.length / 2);
  return [a.slice(0, half), a.slice(half)];
}

/** Team index (0 or 1) of a player, or -1. */
export function teamOf(teams: readonly (readonly string[])[], id: string): number {
  return teams.findIndex((t) => t.includes(id));
}

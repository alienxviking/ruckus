// Full "How to play" rules, shown in a dialog on demand (the catalog's `how` is the short version).

export interface GameRules {
  /** One sentence: how you win. */
  goal: string;
  /** How a game flows, in order. 3–6 short steps. */
  flow: string[];
  /** Controls. Omit a field that doesn't apply. */
  controls: { desktop?: string[]; touch?: string[] };
  /** How points / elimination / winning are decided, with real numbers. */
  scoring: string[];
  /** 1–3 practical tips. */
  tips?: string[];
}

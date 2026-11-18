// "How to play" rules, shown in a dialog on demand. The dialog leads with `quick` and `win`
// (pictures + a few words); everything else sits under "All the details".

import type { RuleAnim, RuleIcon } from "./rule-icons";

export interface QuickCard {
  /** Picture for this step (see games/rule-icons.ts). */
  icon: RuleIcon;
  /** How the picture moves. */
  anim: RuleAnim;
  /** The step in a few words (aim for 3–7, never more than 9). Plain English. */
  text: string;
}

export interface GameRules {
  /** Exactly 3 picture cards: what you do, in order. */
  quick: [QuickCard, QuickCard, QuickCard];
  /** How you win, in a few words (aim for 3–7). */
  win: string;
  /** One sentence: how you win (the long form, in the details). */
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

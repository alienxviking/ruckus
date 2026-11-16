// Constants and types used by both the server and the client. No secrets here:
// the manual itself is generated per game on the server (rules.ts).

export const BOMBS = 3;
export const BOMB_MS = 180_000;
export const MAX_STRIKES = 3;
/** Each strike makes the clock run this much faster (1 → 1.25 → 1.5). */
export const STRIKE_SPEEDUP = 0.25;
export const BRIEF_MS = 12_000;
export const RESULT_MS = 6_000;
/** While the big button is held, its counter steps 1..9 this fast. */
export const COUNT_STEP_MS = 650;
/** A press shorter than this is a tap. */
export const TAP_MS = 550;
export const MAX_MSG = 100;
export const CHAT_KEEP = 24;

export const WIRE_COLORS = ["red", "blue", "yellow", "white", "black", "green"] as const;
export type WireColor = (typeof WIRE_COLORS)[number];
export const PAD_COLORS = ["red", "blue", "green", "yellow"] as const;
export type PadColor = (typeof PAD_COLORS)[number];
export const BUTTON_COLORS = ["red", "blue", "yellow", "white"] as const;
export type ButtonColor = (typeof BUTTON_COLORS)[number];
export const STRIP_COLORS = ["red", "blue", "yellow", "white"] as const;
export type StripColor = (typeof STRIP_COLORS)[number];
export const BUTTON_LABELS = ["PRESS", "ABORT", "HOLD", "ARM", "STOP"] as const;
export const LAMPS = ["ARM", "VLT", "OXY", "NAV", "HUM", "RAD"] as const;
/** Every colour name the quick-talk panel can reference. */
export const TALK_COLORS = ["red", "blue", "yellow", "green", "white", "black"] as const;

export const SWATCH: Record<string, string> = {
  red: "#ef4444",
  blue: "#3b82f6",
  yellow: "#facc15",
  green: "#22c55e",
  white: "#f1f5f9",
  black: "#1f2430",
};

export const MODULE_TYPES = ["wires", "button", "keypad", "signal", "dial"] as const;
export type ModType = (typeof MODULE_TYPES)[number];
export const MODULE_NAME: Record<ModType, string> = {
  wires: "Wires",
  button: "Big Button",
  keypad: "Glyph Keys",
  signal: "Signal Lamp",
  dial: "Lock Dial",
};
export const MODULE_ICON: Record<ModType, string> = { wires: "🧵", button: "🔴", keypad: "🔣", signal: "🚨", dial: "🎛️" };

/** How the manual is laid out (fixed shape; the content is random per game). */
export const WIRE_COUNTS = [3, 4, 5, 6] as const;
export const WIRE_RULES = 4; // 3 conditions + "otherwise"
export const BUTTON_RULES = 5; // 4 conditions + "otherwise"
export const DIAL_STEPS = 8;
export const CODEBOOK = 10;

// Glyphs drawn as 24×24 stroked paths: our own little alphabet.
export const GLYPHS: { name: string; d: string }[] = [
  { name: "Comet", d: "M19 7a3 3 0 1 1-6 0a3 3 0 1 1 6 0M13.8 9.2 4 19M13 6 6 10M17 10l-3 8" },
  { name: "Trident", d: "M12 21V5M6 4v5a6 6 0 0 0 12 0V4M9 16h6" },
  { name: "Eye", d: "M3 12c4-6.5 14-6.5 18 0c-4 6.5-14 6.5-18 0ZM14.5 12a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0" },
  { name: "Hourglass", d: "M6 3h12L6 21h12ZM9 18h6" },
  { name: "Key", d: "M10 9a4 4 0 1 1-8 0a4 4 0 1 1 8 0M10 9h11M17 9v4M20 9v3" },
  { name: "Moon", d: "M15 3a9 9 0 1 0 6 15a7 7 0 0 1-6-15Z" },
  { name: "Ladder", d: "M8 3v18M16 3v18M8 7h8M8 12h8M8 17h8" },
  { name: "Crown", d: "M4 18 3 7l5 4 4-7 4 7 5-4-1 11ZM4 21h16" },
  { name: "Spiral", d: "M12 12a1.5 1.5 0 0 1 3 0a3 3 0 0 1-6 0a4.5 4.5 0 0 1 9 0a6 6 0 0 1-12 0a7.5 7.5 0 0 1 15 0" },
  { name: "Bolt", d: "M14 2 5 13h6l-2 9 9-12h-6Z" },
  { name: "Anchor", d: "M12 7v14M8 11h8M5 14a7 7 0 0 0 14 0M14 5a2 2 0 1 1-4 0a2 2 0 1 1 4 0" },
  { name: "Fish", d: "M3 12c4-6 10-6 14 0c-4 6-10 6-14 0ZM17 12l4-4v8ZM8 11h.5" },
  { name: "Tower", d: "M7 21V9h10v12M7 9V4h2v2h2V4h2v2h2V4h2v5M11 21v-4h2v4" },
  { name: "Knot", d: "M12 12c-2-3-5-4.5-7-3s-1 6 2 6 3.5-1.5 5-3 2.5-3 5-3 3.5 4.5 2 6-5 0-7-3" },
  { name: "Sprout", d: "M12 21v-9M12 12c0-4-3-6-7-6 0 4 3 6 7 6M12 16c0-4 3-6 7-6 0 4-3 6-7 6" },
  { name: "Mask", d: "M5 4h14v7a7 7 0 0 1-14 0ZM8 9.5h2.5M13.5 9.5H16M9 15c2 1.2 4 1.2 6 0" },
];

// ---------- the manual's vocabulary ----------

/** A condition in a rule. Wire-only and button-only kinds are only used in those modules. */
export type Cond =
  | { k: "none" | "one" | "many" | "first" | "last"; c: WireColor }
  | { k: "odd" }
  | { k: "even" }
  | { k: "vowel" }
  | { k: "batt"; n: number }
  | { k: "lamp"; l: string }
  | { k: "bcolor"; c: ButtonColor }
  | { k: "blabel"; l: string }
  | { k: "bboth"; c: ButtonColor; l: string };

export type WireAct = { k: "nth"; n: number } | { k: "last" } | { k: "firstOf"; c: WireColor } | { k: "lastOf"; c: WireColor };

/** One line of the manual. Experts each hold some of these. */
export type Fact =
  | { t: "wire"; n: number; i: number; if: Cond | null; cut: WireAct }
  | { t: "btn"; i: number; if: Cond | null; hold: boolean }
  | { t: "strip"; c: StripColor; d: number }
  | { t: "glyph"; g: number; v: number }
  | { t: "korder"; if: Cond }
  | { t: "sig"; p: 0 | 1; from: PadColor; to: PadColor }
  | { t: "code"; code: string; pos: number }
  | { t: "dfix"; if: Cond; add: number };

export const FACT_MODULE: Record<Fact["t"], ModType> = {
  wire: "wires",
  btn: "button",
  strip: "button",
  glyph: "keypad",
  korder: "keypad",
  sig: "signal",
  code: "dial",
  dfix: "dial",
};

/** Stable identity of a manual line (two copies of the same line share it). */
export function factKey(f: Fact): string {
  switch (f.t) {
    case "wire":
      return `w${f.n}.${f.i}`;
    case "btn":
      return `b${f.i}`;
    case "strip":
      return `s.${f.c}`;
    case "glyph":
      return `g${f.g}`;
    case "korder":
      return "ko";
    case "sig":
      return `x${f.p}.${f.from}`;
    case "code":
      return `c.${f.code}`;
    case "dfix":
      return "df";
  }
}

// ---------- what the defuser sees ----------

export interface Edge {
  serial: string;
  batteries: number;
  lamps: { l: string; lit: boolean }[];
}

export type ModView =
  | { t: "wires"; done: boolean; wires: WireColor[]; cut: boolean[] }
  | { t: "button"; done: boolean; color: ButtonColor; label: string; strip: StripColor }
  | { t: "keypad"; done: boolean; glyphs: number[]; pressed: boolean[] }
  /** `seq` holds only the flashes of the current stage (all of them once done). */
  | { t: "signal"; done: boolean; seq: PadColor[]; stage: number; stages: number; progress: number }
  /** `at`: where it was set when it was disarmed. */
  | { t: "dial"; done: boolean; code: string; at: number | null };

// ---------- quick talk ----------

export interface Msg {
  /** Sequence number (ordering, dedupe). */
  i: number;
  from: string;
  /** Free text, or a glyph reference, or a colour reference. */
  t?: string;
  g?: number;
  c?: string;
  /** The sender's nonce, so their pending copy can be matched. */
  n?: number;
}

export const QUICK_LINES = ["Got it ✓", "Say again?", "Wait…", "Yes", "No", "Which one?", "Done! ✅", "Cut it ✂️"];

export type DefuseEvent =
  | { k: "say"; m: Msg }
  | { k: "strike"; m: number; s: number }
  | { k: "hold"; m: number; on: boolean };

/** Strip control characters, collapse whitespace, trim and cap. */
export function cleanText(raw: string, max = MAX_MSG): string {
  let s = "";
  for (const ch of raw) {
    const c = ch.codePointAt(0) ?? 0;
    const bad = c < 32 || (c >= 127 && c < 160) || (c >= 8203 && c <= 8207) || (c >= 8232 && c <= 8238) || (c >= 8288 && c <= 8303) || c === 65279;
    s += bad ? " " : ch;
  }
  return s.replace(/\s+/g, " ").trim().slice(0, max);
}

/** The counter shown on a held button `elapsed` ms after the press. */
export const holdDigit = (elapsed: number) => 1 + (Math.floor(Math.max(0, elapsed) / COUNT_STEP_MS) % 9);

export const ordinal = (n: number) => ["first", "second", "third", "fourth", "fifth", "sixth"][n - 1] ?? `#${n}`;

// Per-game options the host can change in the lobby (rounds, timers, difficulty, custom words).
// Each game declares them in games/<id>/config.ts; the room validates what the host sends,
// and the game reads them in setup() with readSettings(), which fills in the defaults.

export type SettingValue = number | string | string[];

export interface ChoiceSetting {
  kind: "choice";
  key: string;
  label: string;
  options: { value: number | string; label: string }[];
  default: number | string;
  /** Short helper text under the control. */
  hint?: string;
}

/** A list of the host's own words/phrases. Empty = use the game's built-in list. */
export interface WordsSetting {
  kind: "words";
  key: string;
  label: string;
  /** Fewest words that make a usable list (fewer and the game sticks to its own). */
  min: number;
  /** Most words kept (default 200). */
  max?: number;
  /** Longest word/phrase in characters (default 32). */
  maxLen?: number;
  hint?: string;
  /** Example shown as the textarea placeholder. */
  placeholder?: string;
}

export type SettingDef = ChoiceSetting | WordsSetting;

export interface GameConfig {
  /** Options the host can change. Keep it to 1–3; the defaults should be the best experience. */
  settings?: SettingDef[];
  /** True when the server half implements GameDef.bot (practice bots can join). */
  bots?: boolean;
}

export type Settings = Record<string, SettingValue>;

/** Cleans a custom word list: trimmed, single-spaced, length-capped, de-duplicated. */
export function cleanWords(raw: unknown, def: WordsSetting): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\n,]/) : [];
  const maxLen = def.maxLen ?? 32;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const w = item
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLen)
      .trim();
    const k = w.toLowerCase();
    if (!w || seen.has(k)) continue;
    seen.add(k);
    out.push(w);
    if (out.length >= (def.max ?? 200)) break;
  }
  return out;
}

/** One validated value, or undefined when it isn't allowed. */
export function validSetting(def: SettingDef, value: unknown): SettingValue | undefined {
  if (def.kind === "choice") return def.options.some((o) => o.value === value) ? (value as number | string) : undefined;
  return cleanWords(value, def);
}

/** Settings with defaults filled in. Anything invalid falls back to the default. */
export function readSettings(defs: SettingDef[] | undefined, raw: Settings | undefined): Settings {
  const out: Settings = {};
  for (const def of defs ?? []) {
    const v = raw?.[def.key];
    const ok = v === undefined ? undefined : validSetting(def, v);
    out[def.key] = ok ?? (def.kind === "choice" ? def.default : []);
  }
  return out;
}

/** The custom words to use, or null when there aren't enough (use the built-in list). */
export function customWords(defs: SettingDef[] | undefined, raw: Settings | undefined, key: string): string[] | null {
  const def = defs?.find((d) => d.key === key);
  if (!def || def.kind !== "words") return null;
  const words = readSettings([def], raw)[key] as string[];
  return words.length >= def.min ? words : null;
}

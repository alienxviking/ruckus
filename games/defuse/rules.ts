// Server-only: the manual generator, the bomb generator, the solver and the
// dealer that tears the manual into expert fragments.
//
// The solver is the single source of truth. A bomb's answers are computed by
// solving it with the FULL manual; the tests prove that the union of the
// fragments dealt to the experts solves every module to the same answer, using
// only what the defuser can see (ModView + Edge).

import {
  BUTTON_COLORS,
  BUTTON_LABELS,
  BUTTON_RULES,
  CODEBOOK,
  DIAL_STEPS,
  FACT_MODULE,
  GLYPHS,
  LAMPS,
  MODULE_TYPES,
  PAD_COLORS,
  STRIP_COLORS,
  WIRE_COLORS,
  WIRE_COUNTS,
  WIRE_RULES,
  factKey,
  type Cond,
  type Edge,
  type Fact,
  type ModType,
  type ModView,
  type PadColor,
  type WireAct,
  type WireColor,
} from "./shared";

type Rand = () => number;
const int = (r: Rand, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pickR = <T>(r: Rand, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
function shuffleR<T>(r: Rand, arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const condKey = (c: Cond) => JSON.stringify(c);

// ---------- the manual ----------

function edgeCond(r: Rand): Cond {
  switch (int(r, 0, 4)) {
    case 0:
      return { k: "odd" };
    case 1:
      return { k: "even" };
    case 2:
      return { k: "vowel" };
    case 3:
      return { k: "batt", n: int(r, 1, 3) };
    default:
      return { k: "lamp", l: pickR(r, LAMPS) };
  }
}

function wireCond(r: Rand): Cond {
  const k = pickR(r, ["none", "one", "many", "first", "last"] as const);
  return { k, c: pickR(r, WIRE_COLORS) };
}

/** An action that always names an existing wire when its condition holds. */
function wireAct(r: Rand, cond: Cond, n: number): WireAct {
  if ((cond.k === "one" || cond.k === "many" || cond.k === "first" || cond.k === "last") && r() < 0.55) {
    // The condition guarantees a wire of this colour exists.
    return r() < 0.5 ? { k: "firstOf", c: cond.c } : { k: "lastOf", c: cond.c };
  }
  return r() < 0.25 ? { k: "last" } : { k: "nth", n: int(r, 1, n) };
}

function buttonCond(r: Rand): Cond {
  const roll = r();
  if (roll < 0.25) return { k: "bcolor", c: pickR(r, BUTTON_COLORS) };
  if (roll < 0.5) return { k: "blabel", l: pickR(r, BUTTON_LABELS) };
  if (roll < 0.65) return { k: "bboth", c: pickR(r, BUTTON_COLORS), l: pickR(r, BUTTON_LABELS) };
  return edgeCond(r);
}

const CODE_LETTERS = [..."ABCDEFGHJKLMNPQRSTUVWXYZ"];

/** A whole manual, random per game. Every fact's key is unique. */
export function makeManual(r: Rand): Fact[] {
  const facts: Fact[] = [];
  // Wires: a short rule chain per wire count. The first matching rule wins.
  for (const n of WIRE_COUNTS) {
    const used = new Set<string>();
    for (let i = 0; i < WIRE_RULES - 1; i++) {
      let cond: Cond;
      do cond = r() < 0.7 ? wireCond(r) : edgeCond(r);
      while (used.has(condKey(cond)));
      used.add(condKey(cond));
      facts.push({ t: "wire", n, i, if: cond, cut: wireAct(r, cond, n) });
    }
    facts.push({ t: "wire", n, i: WIRE_RULES - 1, if: null, cut: r() < 0.4 ? { k: "last" } : { k: "nth", n: int(r, 1, n) } });
  }
  // Big button: tap or hold; a held button lights a strip that says when to let go.
  {
    const used = new Set<string>();
    for (let i = 0; i < BUTTON_RULES - 1; i++) {
      let cond: Cond;
      do cond = buttonCond(r);
      while (used.has(condKey(cond)));
      used.add(condKey(cond));
      facts.push({ t: "btn", i, if: cond, hold: r() < 0.5 });
    }
    facts.push({ t: "btn", i: BUTTON_RULES - 1, if: null, hold: r() < 0.5 });
    const digits = shuffleR(r, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    STRIP_COLORS.forEach((c, i) => facts.push({ t: "strip", c, d: digits[i] }));
  }
  // Glyph keys: every glyph has a value; press in value order.
  {
    const values = shuffleR(
      r,
      Array.from({ length: 90 }, (_, i) => i + 10),
    ).slice(0, GLYPHS.length);
    GLYPHS.forEach((_, g) => facts.push({ t: "glyph", g, v: values[g] }));
    facts.push({ t: "korder", if: edgeCond(r) });
  }
  // Signal lamp: odd and even flashes each have their own reply table.
  {
    let odd: PadColor[];
    let even: PadColor[];
    do {
      odd = shuffleR(r, PAD_COLORS);
      even = shuffleR(r, PAD_COLORS);
    } while (odd.join() === even.join());
    PAD_COLORS.forEach((c, i) => {
      facts.push({ t: "sig", p: 0, from: c, to: odd[i] });
      facts.push({ t: "sig", p: 1, from: c, to: even[i] });
    });
  }
  // Lock dial: a codebook and one correction.
  {
    const codes = new Set<string>();
    while (codes.size < CODEBOOK) codes.add(`${pickR(r, CODE_LETTERS)}${int(r, 2, 9)}${pickR(r, CODE_LETTERS)}`);
    for (const code of codes) facts.push({ t: "code", code, pos: int(r, 0, DIAL_STEPS - 1) });
    facts.push({ t: "dfix", if: edgeCond(r), add: int(r, 1, 3) });
  }
  return facts;
}

// ---------- the solver ----------

export class ManualError extends Error {}

/** Index fragments by key. Copies of one line are fine; two different lines with one key are not. */
export function indexFacts(facts: Iterable<Fact>): Map<string, Fact> {
  const map = new Map<string, Fact>();
  for (const f of facts) {
    const k = factKey(f);
    const prev = map.get(k);
    if (prev && JSON.stringify(prev) !== JSON.stringify(f)) throw new ManualError(`conflicting copies of ${k}`);
    map.set(k, f);
  }
  return map;
}

function need<T extends Fact>(book: Map<string, Fact>, key: string): T {
  const f = book.get(key);
  if (!f) throw new ManualError(`missing ${key}`);
  return f as T;
}

const lastDigit = (serial: string) => Number(serial[serial.length - 1]);

export function holds(cond: Cond, mod: ModView, edge: Edge): boolean {
  const wires = mod.t === "wires" ? mod.wires : null;
  const count = (c: WireColor) => {
    if (!wires) throw new ManualError("wire rule on a non-wire module");
    return wires.filter((w) => w === c).length;
  };
  switch (cond.k) {
    case "none":
      return count(cond.c) === 0;
    case "one":
      return count(cond.c) === 1;
    case "many":
      return count(cond.c) > 1;
    case "first":
      count(cond.c);
      return wires![0] === cond.c;
    case "last":
      count(cond.c);
      return wires![wires!.length - 1] === cond.c;
    case "odd":
      return lastDigit(edge.serial) % 2 === 1;
    case "even":
      return lastDigit(edge.serial) % 2 === 0;
    case "vowel":
      return /[AEU]/.test(edge.serial);
    case "batt":
      return edge.batteries >= cond.n;
    case "lamp":
      return edge.lamps.some((l) => l.l === cond.l && l.lit);
    case "bcolor":
    case "blabel":
    case "bboth":
      if (mod.t !== "button") throw new ManualError("button rule on a non-button module");
      if (cond.k === "bcolor") return mod.color === cond.c;
      if (cond.k === "blabel") return mod.label === cond.l;
      return mod.color === cond.c && mod.label === cond.l;
  }
}

export type Answer =
  | { t: "wires"; wire: number }
  | { t: "button"; hold: boolean; digit: number }
  | { t: "keypad"; order: number[] }
  | { t: "signal"; presses: PadColor[] }
  | { t: "dial"; pos: number };

/**
 * Solve one module from what the defuser sees and a set of manual lines.
 * Throws ManualError if a needed line is missing or the answer isn't unique.
 */
export function solve(mod: ModView, edge: Edge, book: Map<string, Fact>): Answer {
  switch (mod.t) {
    case "wires": {
      const n = mod.wires.length;
      for (let i = 0; i < WIRE_RULES; i++) {
        const rule = need<Extract<Fact, { t: "wire" }>>(book, `w${n}.${i}`);
        if (rule.if !== null && !holds(rule.if, mod, edge)) continue;
        const a = rule.cut;
        let wire = -1;
        if (a.k === "nth") wire = a.n - 1;
        else if (a.k === "last") wire = n - 1;
        else if (a.k === "firstOf") wire = mod.wires.indexOf(a.c);
        else wire = mod.wires.lastIndexOf(a.c);
        if (wire < 0 || wire >= n) throw new ManualError("rule names a wire that isn't there");
        return { t: "wires", wire };
      }
      throw new ManualError("no wire rule applied");
    }
    case "button": {
      for (let i = 0; i < BUTTON_RULES; i++) {
        const rule = need<Extract<Fact, { t: "btn" }>>(book, `b${i}`);
        if (rule.if !== null && !holds(rule.if, mod, edge)) continue;
        // A hold needs the strip table; a tap releases at once (digit 0).
        const digit = rule.hold ? need<Extract<Fact, { t: "strip" }>>(book, `s.${mod.strip}`).d : 0;
        return { t: "button", hold: rule.hold, digit };
      }
      throw new ManualError("no button rule applied");
    }
    case "keypad": {
      const values = mod.glyphs.map((g) => need<Extract<Fact, { t: "glyph" }>>(book, `g${g}`).v);
      if (new Set(values).size !== values.length) throw new ManualError("glyph values tie");
      const desc = holds(need<Extract<Fact, { t: "korder" }>>(book, "ko").if, mod, edge);
      const order = values.map((_, i) => i).sort((a, b) => (desc ? values[b] - values[a] : values[a] - values[b]));
      return { t: "keypad", order };
    }
    case "signal": {
      const presses = mod.seq.map((c, i) => need<Extract<Fact, { t: "sig" }>>(book, `x${i % 2}.${c}`).to);
      return { t: "signal", presses };
    }
    case "dial": {
      const entry = need<Extract<Fact, { t: "code" }>>(book, `c.${mod.code}`);
      const fix = need<Extract<Fact, { t: "dfix" }>>(book, "df");
      const pos = (entry.pos + (holds(fix.if, mod, edge) ? fix.add : 0)) % DIAL_STEPS;
      return { t: "dial", pos };
    }
  }
}

// ---------- bombs ----------

const SERIAL_CHARS = [..."ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"];

export function makeEdge(r: Rand): Edge {
  let serial = "";
  for (let i = 0; i < 5; i++) serial += pickR(r, SERIAL_CHARS);
  serial += int(r, 0, 9);
  const lamps = shuffleR(r, LAMPS)
    .slice(0, 3)
    .map((l) => ({ l, lit: r() < 0.5 }));
  return { serial, batteries: int(r, 0, 4), lamps };
}

/** Server-side module: the public face plus private bookkeeping. */
export type ModState = ModView & {
  ans: Answer;
  /** keypad: correct presses so far. */
  step: number;
  /** signal: the full flash sequence (the view only shows the current stage). */
  full: PadColor[];
  /** button: when the current hold began (server time), or null. */
  holdAt: number | null;
};

/** The defuser's view of a module (no answers, no future flashes). */
export function publicMod(m: ModState): ModView {
  switch (m.t) {
    case "wires":
      return { t: "wires", done: m.done, wires: m.wires, cut: m.cut };
    case "button":
      return { t: "button", done: m.done, color: m.color, label: m.label, strip: m.strip };
    case "keypad":
      return { t: "keypad", done: m.done, glyphs: m.glyphs, pressed: m.pressed };
    case "signal":
      return {
        t: "signal",
        done: m.done,
        seq: m.done ? m.full : m.full.slice(0, m.stage + 2),
        stage: m.stage,
        stages: m.stages,
        progress: m.progress,
      };
    case "dial":
      return { t: "dial", done: m.done, code: m.code, at: m.at };
  }
}

function makeModView(r: Rand, t: ModType, level: number, manual: Fact[]): ModView {
  switch (t) {
    case "wires": {
      const n = int(r, 3 + (level >= 2 ? 1 : 0), 4 + level);
      const wires = Array.from({ length: n }, () => pickR(r, WIRE_COLORS));
      return { t, done: false, wires, cut: wires.map(() => false) };
    }
    case "button":
      return { t, done: false, color: pickR(r, BUTTON_COLORS), label: pickR(r, BUTTON_LABELS), strip: pickR(r, STRIP_COLORS) };
    case "keypad":
      return { t, done: false, glyphs: shuffleR(r, GLYPHS.map((_, i) => i)).slice(0, 4), pressed: [false, false, false, false] };
    case "signal": {
      const stages = level === 0 ? 2 : 3;
      const seq: PadColor[] = [];
      while (seq.length < stages + 1) {
        const c = pickR(r, PAD_COLORS);
        if (seq.length >= 2 && seq[seq.length - 1] === c && seq[seq.length - 2] === c) continue;
        seq.push(c);
      }
      return { t, done: false, seq, stage: 0, stages, progress: 0 };
    }
    case "dial": {
      const codes = manual.filter((f): f is Extract<Fact, { t: "code" }> => f.t === "code");
      return { t, done: false, code: pickR(r, codes).code, at: null };
    }
  }
}

/** Bomb `level` (0, 1, 2) has 3, 4, 5 modules of different types. */
export function makeBomb(r: Rand, manual: Fact[], level: number): { edge: Edge; mods: ModState[] } {
  const edge = makeEdge(r);
  const book = indexFacts(manual);
  const types = shuffleR(r, MODULE_TYPES).slice(0, Math.min(MODULE_TYPES.length, 3 + level));
  const mods = types.map((t): ModState => {
    const v = makeModView(r, t, level, manual);
    const full = v.t === "signal" ? v.seq : [];
    return { ...v, ans: solve(v, edge, book), step: 0, full, holdAt: null };
  });
  return { edge, mods };
}

// ---------- tearing the manual into fragments ----------

/**
 * Deal the lines relevant to this bomb's module types among the experts.
 * Every line goes to at least one expert (two with 4+ experts), and with
 * 2+ experts nobody holds a whole module's rules. Returns manual indices.
 */
export function dealFragments(r: Rand, manual: Fact[], types: ModType[], experts: string[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const e of experts) out[e] = [];
  if (!experts.length) return out;
  const relevant = manual.map((f, i) => ({ f, i })).filter(({ f }) => types.includes(FACT_MODULE[f.t]));
  const copies = experts.length >= 4 ? 2 : 1;
  // Deal module by module so each expert gets a slice of every module.
  let seat = Math.floor(r() * experts.length);
  for (const t of types) {
    const lines = shuffleR(
      r,
      relevant.filter(({ f }) => FACT_MODULE[f.t] === t),
    );
    for (const { i } of lines) {
      for (let c = 0; c < copies; c++) out[experts[(seat + c) % experts.length]].push(i);
      seat = (seat + 1) % experts.length;
    }
  }
  for (const e of experts) out[e].sort((a, b) => a - b);
  return out;
}

// Sound effects and haptics, with no audio files: every sound is synthesised with Web Audio
// (a few oscillators and envelopes), so it costs nothing to download.
//
//   sfx("win")          play a sound (no-op while muted, before the first tap, or on the server)
//   buzz("hit")         vibrate on phones that support it (Android; iOS Safari has no API)
//   feedback("hit")     both at once: the usual call from game code
//
// Browsers only allow audio after a user gesture, so the AudioContext is created (and resumed)
// on the first pointer/key press. Settings persist per browser.

export type Cue =
  | "start" // a game begins
  | "win" // you won
  | "end" // the game ended, you didn't win
  | "turn" // your turn
  | "tick" // countdown tick
  | "go" // countdown finished / round starts
  | "join" // someone joined
  | "chat" // a chat message from someone else
  | "pop" // small UI confirmation (claim, pick, score)
  | "hit" // you hit something / got hit
  | "bump" // a light collision
  | "out" // eliminated (you, or someone)
  | "score" // you scored
  | "error"; // invalid move

type Settings = { sound: boolean; haptics: boolean };
const KEY = "ruckus:feedback";

let settings: Settings = { sound: true, haptics: true };
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) settings = { ...settings, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* storage blocked */
  }
}

export function getFeedbackSettings(): Settings {
  load();
  return settings;
}

export function setFeedbackSettings(next: Partial<Settings>) {
  load();
  settings = { ...settings, ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode */
  }
  for (const l of listeners) l();
  if (settings.sound) unlock();
}

/** For useSyncExternalStore. */
export function subscribeFeedback(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// ----- audio -----

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function unlock() {
  if (typeof window === "undefined") return;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC({ latencyHint: "interactive" });
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
}

if (typeof window !== "undefined") {
  const first = () => {
    load();
    if (settings.sound) unlock();
  };
  window.addEventListener("pointerdown", first, { capture: true, passive: true });
  window.addEventListener("keydown", first, { capture: true });
}

/** One enveloped oscillator note. `at` is seconds from now. */
function note(freq: number, at: number, dur: number, type: OscillatorType = "sine", vol = 1, slideTo?: number) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** A short burst of filtered noise (thuds, whooshes). */
function noise(at: number, dur: number, freq: number, vol = 0.6, q = 1) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + at;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

const SOUNDS: Record<Cue, () => void> = {
  start: () => {
    note(392, 0, 0.12, "triangle", 0.7);
    note(523, 0.09, 0.12, "triangle", 0.7);
    note(784, 0.18, 0.22, "triangle", 0.8);
  },
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) => note(f, i * 0.09, 0.22, "triangle", 0.75));
    note(1568, 0.38, 0.4, "sine", 0.35);
    note(1047, 0.38, 0.45, "triangle", 0.5);
  },
  end: () => {
    note(440, 0, 0.16, "triangle", 0.6);
    note(349, 0.13, 0.28, "triangle", 0.55);
  },
  turn: () => {
    note(880, 0, 0.09, "sine", 0.6);
    note(1175, 0.08, 0.16, "sine", 0.6);
  },
  tick: () => note(1320, 0, 0.05, "square", 0.18),
  go: () => note(1760, 0, 0.18, "square", 0.22),
  join: () => {
    note(660, 0, 0.08, "sine", 0.4);
    note(990, 0.06, 0.12, "sine", 0.4);
  },
  chat: () => note(1400, 0, 0.06, "sine", 0.22),
  pop: () => note(700, 0, 0.07, "sine", 0.5, 1100),
  hit: () => {
    noise(0, 0.09, 900, 0.9, 0.8);
    note(180, 0, 0.12, "sine", 0.8, 70);
  },
  bump: () => noise(0, 0.05, 1400, 0.45, 1.2),
  out: () => {
    note(520, 0, 0.35, "sawtooth", 0.25, 110);
    noise(0.02, 0.2, 400, 0.4, 0.6);
  },
  score: () => {
    note(988, 0, 0.07, "square", 0.22);
    note(1319, 0.06, 0.14, "square", 0.22);
  },
  error: () => note(160, 0, 0.14, "square", 0.25),
};

// Don't let a burst of identical cues (ten collisions in one frame) stack into noise.
const lastAt = new Map<Cue, number>();
const MIN_GAP: Partial<Record<Cue, number>> = { bump: 70, hit: 60, tick: 120, chat: 150, pop: 40, score: 60 };

export function sfx(cue: Cue) {
  load();
  if (!settings.sound || typeof window === "undefined") return;
  const now = performance.now();
  if (now - (lastAt.get(cue) ?? -1e9) < (MIN_GAP[cue] ?? 30)) return;
  lastAt.set(cue, now);
  if (!ctx || ctx.state !== "running") return; // no gesture yet: stay silent rather than queue
  try {
    SOUNDS[cue]();
  } catch {
    /* audio graph unavailable */
  }
}

// ----- haptics -----

const PATTERNS: Partial<Record<Cue, number | number[]>> = {
  start: 30,
  win: [40, 60, 40, 60, 80],
  end: 60,
  turn: [25, 40, 25],
  go: 40,
  hit: 45,
  bump: 15,
  out: [80, 40, 120],
  score: 20,
  error: [30, 30, 30],
  pop: 10,
};

export function buzz(cue: Cue) {
  load();
  if (!settings.haptics || typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  const p = PATTERNS[cue];
  if (p === undefined) return;
  try {
    navigator.vibrate(p);
  } catch {
    /* not allowed (no user activation yet) */
  }
}

/** Sound + vibration for one moment: the call game code should use. */
export function feedback(cue: Cue) {
  sfx(cue);
  buzz(cue);
}

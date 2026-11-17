"use client";

// The bottom half of the screen: whatever this round asks of you, big and thumb-sized.

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { feedback, sfx } from "@/lib/feedback";
import { TEAMS } from "@/shared/teams";
import type { TugAction } from "./server";
import {
  BEAT_MS,
  BEAT_NAMES,
  BEAT_WINDOWS,
  INKS,
  STREAK_MAX,
  STREAK_STEP,
  beatAt,
  type AnswerEvent,
  type BeatEvent,
  type Prompt,
} from "./shared";
import type { Kick } from "./scene";

type Act = (a: TugAction) => void;

const GRADE_COLORS = ["#ffe14d", "#4ade80", "#7dd3fc"];

function Streak({ n }: { n: number }) {
  if (n < 2) return <span className="text-xs text-muted">Answer in a row for a bonus</span>;
  const pct = Math.round(Math.min(STREAK_MAX, (n - 1) * STREAK_STEP) * 100);
  return (
    <span key={n} className="tw-bump inline-flex items-center gap-1 rounded-full bg-orange-500/20 px-2 py-0.5 text-xs font-bold text-orange-300">
      🔥 {n} in a row · +{pct}%
    </span>
  );
}

// ---------- mash ----------

export function MashPanel({ act, team, kickRef, active }: { act: Act; team: number; kickRef: { current: Kick }; active: boolean }) {
  const pending = useRef(0);
  const times = useRef<number[]>([]);
  const lastSound = useRef(0);
  const [count, setCount] = useState(0);
  const [tps, setTps] = useState(0);
  const [pressed, setPressed] = useState(0);
  const col = TEAMS[team]?.color ?? "#f97316";

  const tap = () => {
    if (!active) return;
    pending.current += 1;
    kickRef.current = { n: kickRef.current.n + 1, team };
    const now = performance.now();
    times.current.push(now);
    setCount((c) => c + 1);
    setPressed((p) => p + 1);
    if (now - lastSound.current > 110) {
      lastSound.current = now;
      feedback("bump");
    }
  };
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === " " || e.key === "Enter" || /^[a-z]$/i.test(e.key)) {
      e.preventDefault();
      tap();
    }
  });

  const flush = useEffectEvent(() => {
    const n = Math.min(8, pending.current);
    if (n > 0) {
      pending.current -= n;
      act({ type: "mash", n });
    }
    const now = performance.now();
    times.current = times.current.filter((t) => now - t < 1_000);
    setTps(times.current.length);
  });

  useEffect(() => {
    const id = setInterval(() => flush(), 100);
    const key = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", key);
    return () => {
      clearInterval(id);
      window.removeEventListener("keydown", key);
    };
  }, []);

  const hot = Math.min(1, tps / 10);
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        disabled={!active}
        onPointerDown={(e) => {
          e.preventDefault();
          tap();
        }}
        onContextMenu={(e) => e.preventDefault()}
        className="tw-mash relative grid h-40 w-full touch-none select-none place-items-center overflow-hidden rounded-3xl border-4 font-display text-5xl font-black tracking-tight text-white sm:h-44"
        style={{
          borderColor: col,
          background: `radial-gradient(circle at 50% 40%, ${col}, color-mix(in oklab, ${col} 45%, #000))`,
          boxShadow: `0 0 ${12 + hot * 40}px ${col}${hot > 0.5 ? "cc" : "66"}, inset 0 -8px 0 rgba(0,0,0,.25)`,
        }}
        aria-label="Pull! Tap as fast as you can"
      >
        <span key={pressed} className="tw-press pointer-events-none flex flex-col items-center leading-none">
          PULL!
          <span className="mt-1 text-base font-bold opacity-90">{team === 0 ? "⟵ heave left" : "heave right ⟶"}</span>
        </span>
      </button>
      <div className="flex w-full items-center justify-between text-sm">
        <span className="text-muted">
          Taps <b className="font-mono text-text tabular-nums">{count}</b>
        </span>
        <span className="flex items-center gap-2">
          <span className="text-muted">speed</span>
          <span className="h-2 w-28 overflow-hidden rounded-full bg-panel-2">
            <span className="block h-full rounded-full transition-[width] duration-100" style={{ width: `${hot * 100}%`, background: col }} />
          </span>
          <b className="w-10 font-mono tabular-nums">{tps}/s</b>
        </span>
      </div>
      <p className="hidden text-xs text-muted pointer-fine:block">Tip: Space or any letter key mashes too. Use two fingers on a phone!</p>
    </div>
  );
}

// ---------- prompts (type / sums / colour) ----------

export interface PromptProps {
  act: Act;
  prompt: Prompt | null;
  streak: number;
  lock: number;
  serverNow: () => number;
  team: number;
  kickRef: { current: Kick };
  last: AnswerEvent | null;
}

function useLockLeft(lock: number, serverNow: () => number) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const upd = () => setLeft(Math.max(0, lock - serverNow()));
    upd();
    if (lock <= serverNow()) return;
    const id = setInterval(upd, 50);
    return () => clearInterval(id);
  }, [lock, serverNow]);
  return left;
}

export function TypePanel({ act, prompt, streak, lock, serverNow, team, kickRef, last }: PromptProps) {
  const [text, setText] = useState("");
  const [sentQ, setSentQ] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const word = prompt?.k === "type" ? prompt.w : "";
  const q = prompt?.q ?? -1;
  const left = useLockLeft(lock, serverNow);
  const waiting = sentQ === q && !(last && last.q === q && last.ok === 0);
  const [prevQ, setPrevQ] = useState(q);
  if (prevQ !== q) {
    setPrevQ(q);
    setText("");
  }

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, [q]);

  const send = (value: string) => {
    if (!prompt || waiting || left > 0) return;
    setSentQ(q);
    act({ type: "word", q, text: value });
    if (value.trim().toLowerCase() === word) {
      kickRef.current = { n: kickRef.current.n + 3, team };
      feedback("pop");
    }
  };

  const typed = text.toLowerCase();
  let goodTo = 0;
  while (goodTo < typed.length && typed[goodTo] === word[goodTo]) goodTo++;
  const bad = typed.length > goodTo;

  return (
    <div className={`flex flex-col items-center gap-3 ${last && last.q === q && last.ok === 0 ? "tw-shake" : ""}`} key={`${q}-${last?.ok === 0 && last.q === q ? "x" : ""}`}>
      <div className="flex w-full items-center justify-between text-sm">
        <span className="label">Type it!</span>
        <Streak n={streak} />
      </div>
      <div key={q} className="animate-pop font-mono text-4xl font-black tracking-wider sm:text-5xl" aria-live="polite">
        {word ? (
          [...word].map((ch, i) => (
            <span key={i} className={i < goodTo ? "text-lime-300" : i === goodTo && bad ? "text-red-400 underline" : "text-text"}>
              {ch}
            </span>
          ))
        ) : (
          <span className="text-muted">…</span>
        )}
      </div>
      <input
        ref={input}
        value={text}
        disabled={!prompt}
        onChange={(e) => {
          const v = e.target.value.slice(0, 30);
          setText(v);
          if (v.trim().toLowerCase() === word && word) send(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (text.trim()) send(text);
          }
        }}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="send"
        aria-label={`Type the word ${word}`}
        placeholder={left > 0 ? "Oops! catch your breath…" : "type here — it sends itself"}
        className={`w-full max-w-sm rounded-2xl border-2 bg-panel-2 px-4 py-3 text-center font-mono text-2xl outline-none ${bad ? "border-red-400" : "border-line focus:border-[var(--tw-accent)]"}`}
      />
      <p className="text-xs text-muted">Longer words pull harder. A wrong word just makes you stumble.</p>
    </div>
  );
}

export function ChoicePanel({ act, prompt, streak, lock, serverNow, team, kickRef, last }: PromptProps) {
  const [sentQ, setSentQ] = useState(-1);
  const q = prompt?.q ?? -1;
  const left = useLockLeft(lock, serverNow);
  const locked = left > 0;
  const waiting = sentQ === q;
  const choices = prompt && prompt.k !== "type" ? prompt.c : [];

  const pick = (i: number) => {
    if (!prompt || prompt.k === "type" || waiting || locked || i < 0 || i >= choices.length) return;
    setSentQ(q);
    act({ type: "pick", q, c: i });
    kickRef.current = { n: kickRef.current.n + 1, team };
  };
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const i = ["1", "2", "3", "4"].indexOf(e.key);
    if (i >= 0) {
      e.preventDefault();
      pick(i);
    }
  });

  useEffect(() => {
    const key = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const flash = last && last.ok === 0 && locked;
  return (
    <div className={`relative flex flex-col items-center gap-3 ${flash ? "tw-shake" : ""}`}>
      <div className="flex w-full items-center justify-between text-sm">
        <span className="label">{prompt?.k === "colour" ? "Tap the INK colour" : "Quick! Tap the answer"}</span>
        <Streak n={streak} />
      </div>
      <div key={q} className="animate-pop grid min-h-20 place-items-center" aria-live="polite">
        {prompt?.k === "sums" && <span className="font-mono text-5xl font-black tabular-nums sm:text-6xl">{prompt.a} = ?</span>}
        {prompt?.k === "colour" && (
          <span
            className="font-display text-5xl font-black tracking-tight sm:text-6xl"
            style={{ color: INKS[prompt.i]?.hex, textShadow: "0 2px 0 #000, 0 0 18px rgba(0,0,0,.6)" }}
            aria-label={`The word ${INKS[prompt.w]?.name} written in ${INKS[prompt.i]?.name} ink`}
          >
            {INKS[prompt.w]?.name}
          </span>
        )}
        {!prompt && <span className="text-muted">…</span>}
      </div>
      <div className="grid w-full grid-cols-2 gap-2.5">
        {choices.map((c, i) => {
          const ink = prompt?.k === "colour" ? INKS[c] : null;
          return (
            <button
              key={`${q}-${i}`}
              type="button"
              disabled={waiting || locked}
              onPointerDown={(e) => {
                e.preventDefault();
                pick(i);
              }}
              onClick={(e) => {
                // Keyboard activation (Enter on a focused button).
                if (e.detail === 0) pick(i);
              }}
              className="relative h-16 touch-manipulation select-none rounded-2xl border-2 border-line bg-panel-2 font-display text-2xl font-black transition-transform active:scale-95 disabled:opacity-50 sm:h-20"
              style={ink ? { background: ink.hex, borderColor: "rgba(255,255,255,.35)", color: "#0b0e18" } : undefined}
              aria-label={ink ? ink.name : String(c)}
            >
              {ink ? <span className="text-lg tracking-wide opacity-80">{ink.name.toLowerCase()}</span> : <span className="tabular-nums">{c}</span>}
              <span className="absolute top-1 left-2 font-mono text-xs opacity-60">{i + 1}</span>
            </button>
          );
        })}
      </div>
      {locked && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-2xl bg-ink/70">
          <span className="font-display text-2xl font-black text-red-400">
            Slipped! {(left / 1000).toFixed(1)}s
          </span>
        </div>
      )}
    </div>
  );
}

// ---------- rhythm ----------

export function RhythmPanel({
  act,
  pullAt,
  endsAt,
  serverNow,
  team,
  kickRef,
  onEvent,
  active,
}: {
  act: Act;
  pullAt: number;
  endsAt: number;
  serverNow: () => number;
  team: number;
  kickRef: { current: Kick };
  onEvent: (fn: (e: unknown) => void) => () => void;
  active: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const used = useRef<Map<number, number>>(new Map());
  const lastTick = useRef(-1);
  const [shown, setShown] = useState<{ g: number; n: number } | null>(null);
  const col = TEAMS[team]?.color ?? "#f97316";

  const tap = () => {
    if (!active) return;
    const now = serverNow();
    const b = Math.round((now - beatAt(pullAt, 0)) / BEAT_MS);
    if (b < 0 || used.current.has(b)) return;
    const e = Math.round(now - beatAt(pullAt, b));
    const gi = BEAT_WINDOWS.findIndex((w) => Math.abs(e) <= w);
    used.current.set(b, gi);
    setShown((s) => ({ g: gi, n: (s?.n ?? 0) + 1 }));
    act({ type: "beat", b, e: Math.max(-1000, Math.min(1000, e)) });
    if (gi >= 0) {
      kickRef.current = { n: kickRef.current.n + (3 - gi), team };
      feedback(gi === 0 ? "score" : "pop");
    } else feedback("error");
  };
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === " " || e.key === "Enter" || /^[a-z]$/i.test(e.key)) {
      e.preventDefault();
      tap();
    }
  });

  // The server's word wins if it differs (it rarely does).
  useEffect(
    () =>
      onEvent((e) => {
        const ev = e as BeatEvent | null;
        if (!ev || typeof ev !== "object" || ev.k !== "b" || typeof ev.b !== "number" || typeof ev.g !== "number") return;
        if (used.current.get(ev.b) === ev.g) return;
        used.current.set(ev.b, ev.g);
        setShown((s) => ({ g: ev.g, n: (s?.n ?? 0) + 1 }));
      }),
    [onEvent],
  );

  const paint = useEffectEvent(() => {
    const c = canvas.current;
    if (!c) return;
    const g = c.getContext("2d");
    if (!g) return;
    const dpr = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
    const r = c.getBoundingClientRect();
    const W = Math.round(r.width * dpr);
    const H = Math.round(r.height * dpr);
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    const now = serverNow();
    const hitX = W * 0.18;
    const spacing = Math.max(70 * dpr, W * 0.2);
    const y = H / 2;
    g.clearRect(0, 0, W, H);
    g.fillStyle = "rgba(255,255,255,0.05)";
    g.fillRect(0, y - H * 0.3, W, H * 0.6);
    const cur = (now - beatAt(pullAt, 0)) / BEAT_MS;
    // Metronome: tick on each beat.
    const nb = Math.floor(cur);
    if (active && nb >= 0 && nb !== lastTick.current && beatAt(pullAt, nb) < endsAt) {
      lastTick.current = nb;
      sfx("tick");
    }
    const phase = cur - Math.round(cur);
    const pulse = Math.max(0, 1 - Math.abs(phase) * 4);
    g.strokeStyle = col;
    g.lineWidth = (3 + pulse * 4) * dpr;
    g.beginPath();
    g.arc(hitX, y, H * 0.3 + pulse * 5 * dpr, 0, Math.PI * 2);
    g.stroke();
    const first = Math.max(0, Math.floor(cur) - 1);
    for (let b = first; b < first + 8; b++) {
      const bt = beatAt(pullAt, b);
      if (bt > endsAt) break;
      const x = hitX + (b - cur) * spacing;
      if (x < -30 || x > W + 30) continue;
      const u = used.current.get(b);
      const passed = cur - b > 0.5;
      g.fillStyle = u === undefined ? (passed ? "rgba(148,163,184,0.25)" : b % 2 ? "#fde68a" : "#fb923c") : u >= 0 ? GRADE_COLORS[u] : "rgba(248,113,113,0.6)";
      g.beginPath();
      g.arc(x, y, H * 0.2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#0b0e18";
      g.font = `900 ${Math.round(H * (b % 2 ? 0.16 : 0.095))}px system-ui, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(b % 2 ? "HO" : "HEAVE", x, y + 1);
    }
  });

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      paint();
    };
    raf = requestAnimationFrame(loop);
    const key = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", key);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", key);
    };
  }, []);

  const label = shown ? (shown.g >= 0 ? BEAT_NAMES[shown.g] : "MISS") : "";
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex w-full items-center justify-between text-sm">
        <span className="label">Tap when a beat hits the ring</span>
        <span key={shown?.n} className="tw-bump font-display text-lg font-black" style={{ color: shown ? (shown.g >= 0 ? GRADE_COLORS[shown.g] : "#f87171") : undefined }}>
          {label}
        </span>
      </div>
      <canvas ref={canvas} className="h-20 w-full rounded-2xl border border-line bg-panel-2" aria-hidden />
      <button
        type="button"
        disabled={!active}
        onPointerDown={(e) => {
          e.preventDefault();
          tap();
        }}
        onContextMenu={(e) => e.preventDefault()}
        className="h-24 w-full touch-none select-none rounded-3xl border-4 font-display text-4xl font-black text-white active:scale-[.98]"
        style={{ borderColor: col, background: `linear-gradient(180deg, ${col}, color-mix(in oklab, ${col} 40%, #000))` }}
      >
        HEAVE!
      </button>
      <p className="text-xs text-muted">On the beat = perfect pull. Spamming just misses.</p>
    </div>
  );
}

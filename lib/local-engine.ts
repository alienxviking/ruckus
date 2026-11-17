// Runs a game entirely in this browser: you plus practice bots, no room and no network.
// Modelled on party/server.ts (the real room): same GameCtx, the same tick loop with bot
// moves applied through def.action, the same pause clock (game time = now − paused time),
// and views JSON round-tripped exactly as a client would receive them.

import { useEffect, useSyncExternalStore } from "react";
import type { GameCtx, GameDef } from "@/shared/game";
import type { Settings } from "@/shared/settings";
import { PLAYER_COLORS, type GameResult, type Player } from "@/shared/types";

/** Your player id in a local game. */
export const ME = "me";

// Same names and looks as the room's practice bots (party/server.ts).
export const BOT_NAMES = ["Bolt", "Pixel", "Byte", "Chip", "Sprocket", "Widget", "Gizmo", "Servo", "Diode", "Turbo", "Nano"];
export const BOT_AVATARS = ["robot", "robot+cap", "robot+shades", "alien", "robot+headphones", "alien+beanie"];

const MEMORY_PREFIX = "ruckus:memory:";
const MEMORY_MAX = 64_000;

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** Deterministic PRNG from a string (xmur3 hash seeding mulberry32). */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadMemory(gameId: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(MEMORY_PREFIX + gameId);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function saveMemory(gameId: string, mem: Record<string, unknown>) {
  try {
    const raw = JSON.stringify(mem);
    // Like the room: a game that lets its memory grow too big starts over.
    if (raw.length > MEMORY_MAX) localStorage.removeItem(MEMORY_PREFIX + gameId);
    else localStorage.setItem(MEMORY_PREFIX + gameId, raw);
  } catch {
    /* storage blocked: the next game just may repeat a question */
  }
}

export interface LocalSnapshot {
  view: unknown;
  result: GameResult | null;
  paused: boolean;
  error: string | null;
}

export interface LocalOptions {
  def: GameDef;
  /** You: name, colour and avatar (from the saved identity). */
  me: Pick<Player, "name" | "color" | "avatar">;
  bots: number;
  /** Validated settings with defaults filled in (readSettings). */
  settings?: Settings;
  /** Seed for ctx.random (the daily challenge: everyone gets the same puzzle). */
  seed?: string;
  /** Keep the game's memory in localStorage between games (so solo trivia doesn't repeat). */
  persistMemory?: boolean;
}

let engineSeq = 0;

export class LocalEngine {
  /** Unique per engine, so the game UI remounts on "Play again" (like the room's gameSeq). */
  readonly id = ++engineSeq;
  readonly players: Player[];
  readonly byId: Record<string, Player>;
  readonly ctx: GameCtx;
  private readonly def: GameDef;
  private readonly persist: boolean;
  private state: unknown = null;
  private result: GameResult | null = null;
  private error: string | null = null;
  private pauseAt: number | null = null;
  private pausedMs = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private settle: ReturnType<typeof setTimeout> | null = null;
  private lastView = "";
  private snap: LocalSnapshot;
  private readonly events = new Set<(e: unknown) => void>();
  private readonly subs = new Set<() => void>();

  constructor(opts: LocalOptions) {
    this.def = opts.def;
    this.persist = !!opts.persistMemory;
    const you: Player = { id: ME, ...opts.me, connected: true };
    const colors = PLAYER_COLORS.filter((c) => c !== you.color);
    const bots: Player[] = Array.from({ length: Math.max(0, Math.min(opts.bots, BOT_NAMES.length)) }, (_, n) => ({
      id: `bot-${n}`,
      name: BOT_NAMES[n],
      color: colors[n % colors.length],
      avatar: BOT_AVATARS[n % BOT_AVATARS.length],
      connected: true,
      bot: true,
    }));
    this.players = [you, ...bots];
    this.byId = Object.fromEntries(this.players.map((p) => [p.id, p]));
    this.ctx = {
      now: () => this.now(),
      players: this.players.map((p) => ({ ...p })),
      player: (id) => this.byId[id],
      random: opts.seed ? seededRandom(opts.seed) : Math.random,
      settings: { ...(opts.settings ?? {}) },
      memory: this.persist ? loadMemory(opts.def.id) : {},
      emit: (event, o) => {
        // Only you are listening (bots read views, not events).
        if ((o?.to && o.to !== ME) || o?.except === ME) return;
        const data = clone(event);
        for (const fn of this.events) fn(data);
      },
      end: (r) => {
        if (this.result) return;
        this.result = clone(r);
        if (this.pauseAt !== null) this.setPaused(false);
        if (this.persist) saveMemory(this.def.id, this.ctx.memory);
        // Keep ticking briefly so final animations settle, then stop (like the room).
        this.settle = setTimeout(() => this.stopTimer(), 1500);
        this.notify();
      },
    };
    try {
      this.state = opts.def.setup(this.ctx);
    } catch (e) {
      console.error(`[${opts.def.id}] setup failed`, e);
      this.error = "This game failed to start.";
    }
    this.snap = { view: null, result: null, paused: false, error: this.error };
    this.refresh();
  }

  /** The game clock: stands still while paused and skips the paused stretch. */
  now = (): number => (this.pauseAt ?? Date.now()) - this.pausedMs;

  start() {
    if (this.error || this.timer || this.result || (!this.def.tick && !this.def.bot)) return;
    this.timer = setInterval(() => this.tick(), this.def.tickMs ?? 250);
  }

  /** Stops the clock (unmount). Safe to call start() again afterwards. */
  stop() {
    this.stopTimer();
    if (this.settle) clearTimeout(this.settle);
    this.settle = null;
    if (this.persist && !this.error) saveMemory(this.def.id, this.ctx.memory);
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick() {
    if (this.pauseAt !== null) return; // frozen while you read the rules
    let changed: boolean | void = false;
    try {
      changed = this.def.tick?.(this.state, this.ctx);
    } catch (e) {
      console.error(`[${this.def.id}] tick failed`, e);
    }
    if (this.def.bot && !this.result) {
      for (const p of this.players) {
        if (!p.bot) continue;
        try {
          const a = this.def.bot(this.state, p.id, this.ctx);
          if (a != null && this.def.action(this.state, p.id, a, this.ctx) !== false) changed = true;
        } catch (e) {
          console.error(`[${this.def.id}] bot failed`, e);
        }
      }
    }
    if (changed) this.notify();
  }

  /** Your move (the game client's `act`). Ignored while paused, like the room. */
  act = (action: unknown) => {
    if (this.error || this.pauseAt !== null) return;
    let changed: boolean | void;
    try {
      changed = this.def.action(this.state, ME, clone(action ?? null), this.ctx);
    } catch (e) {
      console.error(`[${this.def.id}] action failed`, e);
      return;
    }
    if (changed !== false) this.notify();
  };

  /** Subscribe to ctx.emit events (the game client's `onEvent`). */
  onEvent = (fn: (e: unknown) => void) => {
    this.events.add(fn);
    return () => {
      this.events.delete(fn);
    };
  };

  setPaused(on: boolean) {
    if (on === (this.pauseAt !== null)) return;
    if (on) {
      if (this.result || this.error) return;
      this.pauseAt = Date.now();
    } else {
      this.pausedMs += Date.now() - this.pauseAt!;
      this.pauseAt = null;
    }
    this.notify();
  }

  // ---- store for useSyncExternalStore ----

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  };

  getSnapshot = (): LocalSnapshot => this.snap;

  private notify() {
    if (this.refresh()) for (const fn of this.subs) fn();
  }

  /** Rebuilds the snapshot; true when anything you can see changed. */
  private refresh(): boolean {
    let view = this.snap.view;
    if (!this.error) {
      try {
        const json = JSON.stringify(this.def.view(this.state, ME, this.ctx) ?? null);
        if (json !== this.lastView) {
          this.lastView = json;
          view = JSON.parse(json);
        }
      } catch (e) {
        console.error(`[${this.def.id}] view failed`, e);
      }
    }
    const paused = this.pauseAt !== null;
    const s = this.snap;
    if (view === s.view && this.result === s.result && paused === s.paused && this.error === s.error) return false;
    this.snap = { view, result: this.result, paused, error: this.error };
    return true;
  }
}

const noSub = () => () => {};
const nothing = () => null;

/** Live snapshot of a local game, ticking while mounted. */
export function useLocalGame(engine: LocalEngine | null): LocalSnapshot | null {
  const snap = useSyncExternalStore(engine ? engine.subscribe : noSub, engine ? engine.getSnapshot : nothing, nothing);
  useEffect(() => {
    if (!engine) return;
    engine.start();
    return () => engine.stop();
  }, [engine]);
  return snap;
}

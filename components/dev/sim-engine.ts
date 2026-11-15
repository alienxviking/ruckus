// In-browser stand-in for the room server, used by the dev simulator.
// Mirrors party/server.ts: participants, ctx, ticking, per-viewer views,
// JSON round-trips (so non-serialisable state shows up), events and results.

import type { ComponentType } from "react";
import type { GameCtx, GameDef } from "@/shared/game";
import type { GameClientProps } from "@/shared/client-game";
import { AVATARS, PLAYER_COLORS, type GameResult, type Player } from "@/shared/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyClient = ComponentType<GameClientProps<any, any>>;

const NAMES = ["Asha", "Bo", "Chen", "Dev", "Eli", "Fay", "Gus", "Hana", "Ivo", "Jun", "Kai", "Lua"];
export const SPECTATOR: Player = { id: "spectator", name: "Spectator", color: "#94a3b8", avatar: "👀", connected: true };

export const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

type Handle = Pick<GameClientProps, "act" | "onEvent" | "serverNow">;

let engineSeq = 0;

export class SimEngine {
  /** Unique per engine so game UIs remount on restart (like gameSeq in the room). */
  readonly id = ++engineSeq;
  readonly players: Player[];
  readonly ctx: GameCtx;
  state: unknown = null;
  result: GameResult | null = null;
  error: string | null = null;
  private warpMs = 0;
  private listeners = new Map<string, Set<(e: unknown) => void>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  readonly handles: Record<string, Handle>;

  constructor(
    readonly def: GameDef,
    readonly Client: AnyClient,
    n: number,
    private onChange: () => void,
  ) {
    this.players = Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      name: NAMES[i],
      color: PLAYER_COLORS[i],
      avatar: AVATARS[i],
      connected: true,
    }));
    this.ctx = {
      now: () => this.now(),
      players: this.players.map((p) => ({ ...p })),
      player: (id) => this.players.find((p) => p.id === id) ?? (id === SPECTATOR.id ? SPECTATOR : undefined),
      random: Math.random,
      emit: (event, opts) => {
        const data = clone(event);
        for (const [viewer, fns] of this.listeners) {
          if (opts?.to && viewer !== opts.to) continue;
          if (opts?.except && viewer === opts.except) continue;
          for (const fn of fns) fn(data);
        }
      },
      end: (r) => {
        if (this.result) return;
        this.result = clone(r);
        this.onChange();
      },
    };
    try {
      this.state = def.setup(this.ctx);
    } catch (e) {
      this.error = `setup threw: ${String(e)}`;
      console.error(e);
    }
    // Stable per-viewer handles so game clients don't resubscribe every render.
    this.handles = Object.fromEntries(
      [...this.players, SPECTATOR].map((p) => [
        p.id,
        {
          serverNow: () => this.now(),
          act: (a: unknown) => this.act(p.id, a),
          onEvent: (fn: (e: unknown) => void) => this.subscribe(p.id, fn),
        } satisfies Handle,
      ]),
    );
  }

  now() {
    return Date.now() + this.warpMs;
  }

  start() {
    if (!this.def.tick || this.error || this.timer) return;
    this.timer = setInterval(() => {
      if (this.runTick()) this.onChange();
    }, this.def.tickMs ?? 250);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private runTick(): boolean {
    try {
      return !!this.def.tick?.(this.state, this.ctx);
    } catch (e) {
      console.error("tick threw", e);
      return false;
    }
  }

  act(playerId: string, a: unknown) {
    const player = this.players.find((x) => x.id === playerId);
    const spectator = playerId === SPECTATOR.id;
    if (spectator ? !this.def.spectatorAction : !player || !player.connected) return; // like the room
    let changed: boolean | void;
    try {
      changed = spectator
        ? this.def.spectatorAction!(this.state, playerId, clone(a ?? null), this.ctx)
        : this.def.action(this.state, playerId, clone(a ?? null), this.ctx);
    } catch (e) {
      console.error("action threw", e);
      return;
    }
    if (changed !== false) this.onChange();
  }

  warp(ms: number) {
    this.warpMs += ms;
    this.runTick();
    this.onChange();
  }

  setConnected(id: string, connected: boolean) {
    const p = this.players.find((x) => x.id === id);
    if (!p || p.connected === connected) return;
    p.connected = connected;
    try {
      if (connected) this.def.playerReturned?.(this.state, id, this.ctx);
      else this.def.playerLeft?.(this.state, id, this.ctx);
    } catch (e) {
      console.error("playerLeft/playerReturned threw", e);
    }
    this.onChange();
  }

  /** JSON round-tripped view, exactly as a client would receive it. */
  view(viewerId: string): { view: unknown; error: string | null } {
    try {
      return { view: clone(this.def.view(this.state, viewerId, this.ctx) ?? null), error: null };
    } catch (e) {
      return { view: null, error: String(e) };
    }
  }

  snapshot() {
    return clone(this.state);
  }

  private subscribe(viewer: string, fn: (e: unknown) => void) {
    let set = this.listeners.get(viewer);
    if (!set) this.listeners.set(viewer, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }
}

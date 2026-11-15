// Client-side board for Mine Rush. Full views arrive rarely (join, phase changes);
// everything in between comes as tiny op events. Both carry the public op counter
// `s`, so whichever is newer wins, and a skipped number means we missed an event.
// Our own flags and digs show instantly (optimistic) and reconcile with the server.

import type { ItemKind, MrView, NoEvent, OpEvent, PlayerRow } from "./shared";

export const HIDDEN = 255;
export const BOOM = 9;
export const MINE = 10;

const ITEM_CODE: Record<ItemKind, number> = { g: 1, s: 2, f: 3 };
export const ITEM_OF: (ItemKind | null)[] = [null, "g", "s", "f"];

/** A dig waits this long for the server before we give up on it. */
const PENDING_MS = 1_500;
const POPUP_MS = 1_000;
const FX_MS = 1_300;
/** Reveal animations: stagger per ring of distance from the click, capped. */
const RIPPLE_STEP = 32;
const RIPPLE_MAX = 560;

export interface Popup {
  id: number;
  cell: number;
  text: string;
  p: number;
  big: boolean;
  bad: boolean;
  at: number;
}

export interface Fx {
  id: number;
  kind: "boom" | "scan" | "freeze" | "gem";
  cell: number;
  p: number;
  at: number;
}

export class MineStore {
  w = 0;
  h = 0;
  /** Public op counter applied so far (-1 = nothing yet). */
  s = -1;
  me = -1;
  /** Where the main opening is (initial scroll target). */
  home = 0;
  cells = new Uint8Array(0);
  own = new Int8Array(0);
  item = new Uint8Array(0);
  /** My flags (1 = flagged). */
  flags = new Uint8Array(0);
  /** Reveal animation per cell: 0 = none, else an id; with its stagger delay in ms. */
  anim = new Uint32Array(0);
  delay = new Uint16Array(0);
  /** Cells waiting for the server after we dug them, with the clicked cell they came from. */
  pending = new Map<number, { at: number; src: number }>();
  ps: PlayerRow[] = [];
  opened = 0;
  popups: Popup[] = [];
  fx: Fx[] = [];
  /** Bumps when I hit a mine (the board shakes). */
  shake = 0;
  version = 0;

  private q = 0;
  private flagOps: { q: number; cell: number; on: boolean }[] = [];
  private seq = 0;
  private animAt = new Map<number, number>();
  private subs = new Set<() => void>();

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  };
  getVersion = () => this.version;

  private bump() {
    this.version += 1;
    for (const fn of this.subs) fn();
  }

  // ---------- from the server ----------

  /** Adopt a full view unless what we have is newer. */
  applyView(v: MrView, now = 0) {
    const size = v.w * v.h;
    const fresh = this.s < 0 || v.w !== this.w || v.h !== this.h;
    if (!fresh && v.s < this.s) return;
    if (fresh) {
      this.w = v.w;
      this.h = v.h;
      this.cells = new Uint8Array(size).fill(HIDDEN);
      this.own = new Int8Array(size).fill(-1);
      this.item = new Uint8Array(size);
      this.flags = new Uint8Array(size);
      this.anim = new Uint32Array(size);
      this.delay = new Uint16Array(size);
    }
    const cx = v.w / 2;
    const cy = v.h / 2;
    for (let i = 0; i < size; i++) {
      const ch = v.cells.charCodeAt(i);
      const code = ch === 46 ? HIDDEN : ch === 120 ? BOOM : ch === 109 ? MINE : ch - 48;
      // Mines shown at the end (and anything we missed) still get a small reveal.
      if (!fresh && code !== this.cells[i] && this.cells[i] === HIDDEN) {
        const x = i % v.w;
        const y = (i - x) / v.w;
        this.markAnim(i, Math.min(RIPPLE_MAX, Math.max(Math.abs(x - cx), Math.abs(y - cy)) * 22), now);
      }
      this.cells[i] = code;
      const o = v.own.charCodeAt(i);
      this.own[i] = o === 46 ? -1 : o - 48;
    }
    this.item.fill(0);
    for (const [c, k] of v.items) if (c >= 0 && c < size) this.item[c] = ITEM_CODE[k] ?? 0;
    this.ps = v.ps.map((r) => ({ ...r }));
    this.opened = v.opened;
    this.me = v.you;
    this.home = v.home;
    // Flags: the server's set as of op `fq`, plus whatever we've done since.
    this.q = Math.max(this.q, v.fq);
    this.flagOps = this.flagOps.filter((op) => op.q > v.fq);
    this.flags.fill(0);
    for (const c of v.flags) if (c >= 0 && c < size) this.flags[c] = 1;
    for (const op of this.flagOps) if (this.cells[op.cell] === HIDDEN) this.flags[op.cell] = op.on ? 1 : 0;
    for (const c of [...this.pending.keys()]) if (this.cells[c] !== HIDDEN) this.pending.delete(c);
    this.s = v.s;
    this.bump();
  }

  /** Returns "gap" when an op was skipped (ask the server for a full view). */
  applyOp(e: OpEvent, now: number): "ok" | "stale" | "gap" {
    if (this.s < 0 || e.s <= this.s) return "stale";
    const gap = e.s > this.s + 1;
    const size = this.w * this.h;
    const ax = e.a % this.w;
    const ay = (e.a - ax) / this.w;
    for (let k = 0; k < e.o.length; k++) {
      const c = e.o[k];
      if (c < 0 || c >= size) continue;
      this.cells[c] = e.n.charCodeAt(k) - 48;
      this.own[c] = e.p;
      this.flags[c] = 0;
      this.pending.delete(c);
      const x = c % this.w;
      const y = (c - x) / this.w;
      this.markAnim(c, Math.min(RIPPLE_MAX, Math.max(Math.abs(x - ax), Math.abs(y - ay)) * RIPPLE_STEP), now);
    }
    for (const c of e.x) {
      if (c < 0 || c >= size) continue;
      this.cells[c] = BOOM;
      this.own[c] = e.p;
      this.flags[c] = 0;
      this.pending.delete(c);
      this.markAnim(c, 0, now);
      this.fx.push({ id: ++this.seq, kind: "boom", cell: c, p: e.p, at: now });
    }
    const mine = e.p === this.me;
    for (const [c, k] of e.k) {
      if (c < 0 || c >= size) continue;
      this.item[c] = ITEM_CODE[k] ?? 0;
      const label = k === "g" ? "💎 +15" : k === "s" ? "🔍 Scan!" : "❄️ Freeze!";
      this.popups.push({ id: ++this.seq, cell: c, text: label, p: e.p, big: mine, bad: false, at: now + 120 });
      if (k === "s" && mine) this.fx.push({ id: ++this.seq, kind: "scan", cell: c, p: e.p, at: now });
      if (k === "f") this.fx.push({ id: ++this.seq, kind: "freeze", cell: c, p: e.p, at: now });
      if (k === "g") this.fx.push({ id: ++this.seq, kind: "gem", cell: c, p: e.p, at: now });
    }
    if (e.sm) for (const c of e.sm) if (c >= 0 && c < size && this.cells[c] === HIDDEN) this.flags[c] = 1;
    this.opened += e.o.length;
    const r = this.ps[e.p];
    if (r) {
      r.score = e.sc;
      if (e.st) r.stun = e.st;
    }
    if (e.fz) {
      this.ps.forEach((row, q) => {
        if (q === e.p) return;
        row.frozen = Math.max(row.frozen, e.fz!);
        row.frozenBy = e.p;
      });
    }
    // Score popup at the click: always for me, for others only when it's a big moment.
    const gems = e.k.filter(([, k]) => k === "g").length;
    const pts = e.d - gems * 15;
    if (mine || e.x.length || Math.abs(pts) >= 6) {
      const text = e.x.length ? `💥 ${pts}` : `+${pts}`;
      this.popups.push({ id: ++this.seq, cell: e.a, text, p: e.p, big: mine, bad: e.x.length > 0, at: now });
    }
    if (mine && e.x.length) this.shake += 1;
    this.s = e.s;
    this.bump();
    return gap ? "gap" : "ok";
  }

  /** The server refused something of ours: undo the optimistic bit. */
  nack(e: NoEvent) {
    let changed = false;
    if (typeof e.c === "number") {
      for (const [c, p] of [...this.pending]) {
        if (p.src === e.c) {
          this.pending.delete(c);
          changed = true;
        }
      }
    }
    if (typeof e.q === "number") {
      const i = this.flagOps.findIndex((op) => op.q === e.q);
      if (i >= 0) {
        const op = this.flagOps[i];
        this.flagOps.splice(i, 1);
        if (this.cells[op.cell] === HIDDEN) this.flags[op.cell] = op.on ? 0 : 1;
        changed = true;
      }
    }
    if (changed) this.bump();
  }

  // ---------- local, optimistic ----------

  dig(cells: number[], src: number, now: number) {
    for (const c of cells) this.pending.set(c, { at: now, src });
    this.bump();
  }

  /** Flip a flag locally; returns the op id to send. */
  flag(cell: number, on: boolean): number {
    this.q += 1;
    this.flags[cell] = on ? 1 : 0;
    this.flagOps.push({ q: this.q, cell, on });
    if (this.flagOps.length > 400) this.flagOps.splice(0, this.flagOps.length - 400);
    this.bump();
    return this.q;
  }

  flagCount() {
    let n = 0;
    for (let i = 0; i < this.flags.length; i++) n += this.flags[i];
    return n;
  }

  /** Drop finished animations, popups and digs the server never answered. */
  prune(now: number) {
    let changed = false;
    for (const [c, p] of this.pending) {
      if (now - p.at > PENDING_MS) {
        this.pending.delete(c);
        changed = true;
      }
    }
    const pl = this.popups.length;
    this.popups = this.popups.filter((p) => now - p.at < POPUP_MS);
    const fl = this.fx.length;
    this.fx = this.fx.filter((f) => now - f.at < FX_MS);
    if (this.popups.length !== pl || this.fx.length !== fl) changed = true;
    for (const [c, at] of this.animAt) {
      if (now - at > 1_400) {
        this.anim[c] = 0;
        this.animAt.delete(c);
        changed = true;
      }
    }
    if (changed) this.bump();
  }

  private markAnim(c: number, delay: number, now: number) {
    this.anim[c] = ++this.seq;
    this.delay[c] = delay;
    this.animAt.set(c, now);
  }
}

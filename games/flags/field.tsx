"use client";

// Canvas renderer, playback buffer, prediction and controls for Flag Raid.
//
// Everyone else: the server sends every player's position 20 times a second; the renderer keeps a
// short buffer and draws them ~100 ms in the past (snakes/netsmooth Timeline), blending the two
// frames around that moment. Events in a frame (tags, grabs, captures) play when it's on screen.
//
// You: your own runner uses the same running model locally (shared.ts) from your keys or stick,
// so steering is instant; drift from the server's copy is compared with the path you actually ran
// (Trail) and eased out, so latency never rubber-bands you.
//
// The field is turned so your base is at the bottom (tall screens) or on the left (wide ones).

import { useEffect, useEffectEvent, useRef, type PointerEvent, type ReactNode } from "react";
import type { FlagAction, FlagView } from "./server";
import {
  BASES,
  BASE_R,
  FLAG_DROPPED,
  FLAG_HOME,
  FLAG_RETURN_MS,
  FX_CAP,
  FX_DROP,
  FX_GRAB,
  FX_POWER,
  FX_RETURN,
  FX_SPAWN,
  FX_TAG,
  MID,
  PLAYER_R,
  POWER_R,
  ST_OUT,
  ST_TURBO,
  TICK_MS,
  WORLD_H,
  WORLD_W,
  decodePositions,
  inputDir,
  isSnap,
  speedOf,
  stepBody,
  teamHalf,
  type FlagTuple,
  type Snap,
} from "./shared";
import { Timeline, Trail, debugFrame, reconcile } from "../snakes/netsmooth";
import { drawAvatar } from "@/lib/avatar-art";
import { feedback, sfx } from "@/lib/feedback";

const TAU = Math.PI * 2;
const DELAY_MS = 100;
const EXTRAP_MS = 150;
const RECONCILE = { tol: 6, snap: 170, tauMs: 140 };
const MAX_FRAMES = 60;
const SEND_GAP = 50;
const SANS = "ui-sans-serif, system-ui, sans-serif";
const DISPLAY = '"Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif';

const perfNow = () => performance.now();
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------- frames & clock ----------

interface Frame {
  n: number;
  t: number;
  xy: number[];
  st: string;
  g: [FlagTuple, FlagTuple];
  u: [number, number] | null;
  f: number[][] | null;
}

class Clock extends Timeline {
  constructor() {
    super({ period: TICK_MS, start: DELAY_MS, min: TICK_MS + 15, max: 650 });
  }
  play(now: number, frames: { t: number }[]) {
    return this.tick(now, frames.length ? frames[frames.length - 1].t : Infinity, TICK_MS, 200);
  }
}

// ---------- surface (world -> screen) ----------

interface Surface {
  W: number;
  H: number;
  dpr: number;
  /** Wide screen: the field lies on its side. */
  land: boolean;
  /** Your team plays from the top of the world: turn it round so your base is bottom/left. */
  flip: boolean;
  s: number;
  ox: number;
  oy: number;
  bg: HTMLCanvasElement | null;
  bgKey: string;
}

function layout(W: number, H: number, dpr: number, flip: boolean): Surface {
  const land = W > H;
  const fw = land ? WORLD_H : WORLD_W;
  const fh = land ? WORLD_W : WORLD_H;
  const s = Math.min(W / fw, H / fh);
  return { W, H, dpr, land, flip, s, ox: (W - fw * s) / 2, oy: (H - fh * s) / 2, bg: null, bgKey: "" };
}

/** World point -> screen (canvas px). */
function toS(S: Surface, wx: number, wy: number, out: [number, number]): [number, number] {
  let u: number;
  let v: number;
  if (!S.land) {
    u = S.flip ? WORLD_W - wx : wx;
    v = S.flip ? WORLD_H - wy : wy;
  } else if (!S.flip) {
    u = WORLD_H - wy;
    v = wx;
  } else {
    u = wy;
    v = WORLD_W - wx;
  }
  out[0] = S.ox + u * S.s;
  out[1] = S.oy + v * S.s;
  return out;
}

/** Screen direction -> world direction. */
function toWorldDir(S: Surface | null, dx: number, dy: number): [number, number] {
  if (!S) return [dx, dy];
  if (!S.land) return S.flip ? [-dx, -dy] : [dx, dy];
  // land, no flip: (u, v) = (-wy, wx) -> wx = v, wy = -u
  return S.flip ? [-dy, dx] : [dy, -dx];
}

// ---------- scene ----------

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t0: number;
  life: number;
  color: string;
  size: number;
}
interface Pop {
  x: number;
  y: number;
  text: string;
  color: string;
  t0: number;
  big: boolean;
}

interface Scene {
  clock: Clock;
  frames: Frame[];
  fxCursor: number;
  pos: number[];
  pred: { x: number; y: number; vx: number; vy: number; ready: boolean; n: number; at: number; stillMs: number };
  trail: Trail;
  err: { x: number; y: number };
  ix: number;
  iy: number;
  keys: Set<string>;
  stick: { id: number; ox: number; oy: number; kx: number; ky: number } | null;
  sent: string;
  sentAt: number;
  sendTimer: ReturnType<typeof setTimeout> | null;
  particles: Particle[];
  pops: Pop[];
  /** Recent positions of flag carriers (world), per slot. */
  ribbons: Map<number, { x: number; y: number; t: number }[]>;
  droppedAt: [number, number];
  flash: { color: string; t0: number } | null;
  shakeAt: number;
  last: number;
}

function newScene(): Scene {
  return {
    clock: new Clock(),
    frames: [],
    fxCursor: 0,
    pos: [],
    pred: { x: 0, y: 0, vx: 0, vy: 0, ready: false, n: -1, at: 0, stillMs: 0 },
    trail: new Trail(3_000),
    err: { x: 0, y: 0 },
    ix: 0,
    iy: 0,
    keys: new Set(),
    stick: null,
    sent: "",
    sentAt: 0,
    sendTimer: null,
    particles: [],
    pops: [],
    ribbons: new Map(),
    droppedAt: [0, 0],
    flash: null,
    shakeAt: -1e9,
    last: -1,
  };
}

function pushFrame(sc: Scene, snap: Snap, now: number) {
  const f: Frame = {
    n: snap.n,
    t: snap.t,
    xy: decodePositions(snap.p),
    st: snap.s,
    g: snap.g,
    u: Array.isArray(snap.u) ? snap.u : null,
    f: Array.isArray(snap.f) ? snap.f : null,
  };
  const frames = sc.frames;
  let last: Frame | undefined = frames[frames.length - 1];
  if (!last) sc.fxCursor = f.t;
  else if (f.n !== last.n) {
    if (f.n < last.n) return;
    frames.length = 0;
    sc.fxCursor = f.t - 1;
    sc.ribbons.clear();
    last = undefined;
  }
  if (!last || f.t > last.t) {
    sc.clock.observe(f.t, now);
    if (last && snap.q === 1 && f.t - last.t > TICK_MS * 1.5) frames.push({ ...last, t: f.t - TICK_MS, f: null });
    frames.push(f);
  } else if (!frames.some((x) => x.t === f.t)) {
    const i = frames.findIndex((x) => x.t > f.t);
    frames.splice(i, 0, f);
  } else {
    // The same frame again (a full view carrying the snapshot we already have).
    return;
  }
  if (frames.length > MAX_FRAMES) frames.splice(0, frames.length - MAX_FRAMES);
}

function sampleAll(frames: Frame[], rt: number, out: number[]): Frame | null {
  const n = frames.length;
  if (!n) return null;
  let i = n - 1;
  while (i > 0 && frames[i].t > rt) i--;
  const a = frames[i];
  const len = a.xy.length;
  out.length = len;
  if (a.t >= rt) {
    for (let j = 0; j < len; j++) out[j] = a.xy[j];
    return a;
  }
  const b = frames[i + 1];
  if (!b) {
    const p = frames[i - 1];
    const gap = p ? a.t - p.t : 0;
    if (!p || gap > TICK_MS * 2.5 || p.xy.length !== len) {
      for (let j = 0; j < len; j++) out[j] = a.xy[j];
      return a;
    }
    const e = Math.min(rt - a.t, EXTRAP_MS) / gap;
    for (let j = 0; j < len; j++) out[j] = a.xy[j] + (a.xy[j] - p.xy[j]) * e;
    return a;
  }
  const k = (rt - a.t) / (b.t - a.t);
  // A teleport (respawn) isn't blended.
  for (let j = 0; j < len; j += 2) {
    const bx = b.xy[j] ?? a.xy[j];
    const by = b.xy[j + 1] ?? a.xy[j + 1];
    if (Math.abs(bx - a.xy[j]) + Math.abs(by - a.xy[j + 1]) > 80) {
      out[j] = bx;
      out[j + 1] = by;
    } else {
      out[j] = a.xy[j] + (bx - a.xy[j]) * k;
      out[j + 1] = a.xy[j + 1] + (by - a.xy[j + 1]) * k;
    }
  }
  return a;
}

// ---------- colours ----------

function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0x94a3b8;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(hex: string, a: number) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// ---------- effects ----------

function burst(sc: Scene, x: number, y: number, n: number, now: number, color: string, speed: number, size: number, life = 650) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU;
    const v = speed * (0.35 + Math.random() * 0.75);
    sc.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t0: now, life: life * (0.6 + Math.random() * 0.6), color, size: size * (0.6 + Math.random() * 0.8) });
  }
  if (sc.particles.length > 500) sc.particles.splice(0, sc.particles.length - 500);
}

export interface FieldData {
  view: FlagView;
  mySlot: number;
  myTeam: number;
  teamColors: [string, string];
  teamNames: [string, string];
  names: string[];
  avatars: string[];
  reduced: boolean;
}

/** Play the events of every frame between the last one played and `rt`. */
function playFx(sc: Scene, d: FieldData, rt: number, now: number) {
  const frames = sc.frames;
  for (const f of frames) {
    if (f.t <= sc.fxCursor || f.t > rt) continue;
    sc.fxCursor = f.t;
    if (!f.f) continue;
    const red = d.reduced;
    for (const e of f.f) {
      if (!Array.isArray(e)) continue;
      const at = (slot: number): [number, number] => [f.xy[slot * 2] ?? WORLD_W / 2, f.xy[slot * 2 + 1] ?? MID];
      const teamOfSlot = (slot: number) => d.view.team[slot] ?? 0;
      if (e[0] === FX_TAG) {
        const [x, y] = at(e[1]);
        const c = d.teamColors[teamOfSlot(e[2])];
        burst(sc, x, y, red ? 6 : 26, now, c, 260, 5);
        burst(sc, x, y, red ? 2 : 10, now, "#ffffff", 180, 3);
        sc.pops.push({ x, y: y - 30, text: e[1] === d.mySlot ? "TAGGED! 💫" : "TAGGED!", color: c, t0: now, big: e[1] === d.mySlot });
        if (e[1] === d.mySlot) {
          feedback("out");
          sc.shakeAt = now;
        } else if (e[2] === d.mySlot) feedback("hit");
        else sfx("bump");
      } else if (e[0] === FX_GRAB) {
        const [x, y] = at(e[1]);
        const team = e[2];
        burst(sc, x, y, red ? 6 : 22, now, d.teamColors[team], 220, 4);
        const mine = e[1] === d.mySlot;
        sc.pops.push({ x, y: y - 34, text: mine ? "YOU GOT IT! RUN!" : team === d.myTeam ? "FLAG TAKEN!" : "FLAG GRABBED!", color: d.teamColors[1 - team], t0: now, big: mine || team === d.myTeam });
        if (mine) feedback("score");
        else if (team === d.myTeam) {
          feedback("error");
          sc.flash = { color: "#ff3b3b", t0: now };
        } else sfx("pop");
      } else if (e[0] === FX_CAP) {
        const team = e[2];
        const [bx, by] = BASES[team];
        const c = d.teamColors[team];
        burst(sc, bx, by, red ? 12 : 90, now, c, 520, 6, 1100);
        burst(sc, bx, by, red ? 4 : 40, now, "#fde047", 420, 4, 1100);
        burst(sc, bx, by, red ? 4 : 30, now, "#ffffff", 300, 3, 900);
        sc.flash = { color: c, t0: now };
        sc.shakeAt = now;
        if (d.myTeam === team) feedback("win");
        else if (d.myTeam >= 0) feedback("end");
        else sfx("score");
      } else if (e[0] === FX_RETURN) {
        const team = e[1];
        const [bx, by] = BASES[team];
        burst(sc, bx, by, red ? 4 : 16, now, d.teamColors[team], 160, 4);
        sc.pops.push({ x: bx, y: by - 50, text: e[2] >= 0 ? "SAVED! ↩" : "FLAG HOME ↩", color: d.teamColors[team], t0: now, big: false });
        if (e[2] === d.mySlot) feedback("score");
        else sfx("pop");
      } else if (e[0] === FX_DROP) {
        sc.droppedAt[e[1]] = f.t;
      } else if (e[0] === FX_POWER) {
        const [x, y] = at(e[1]);
        burst(sc, x, y, red ? 4 : 16, now, "#facc15", 200, 4);
        sc.pops.push({ x, y: y - 30, text: "⚡ TURBO", color: "#facc15", t0: now, big: e[1] === d.mySlot });
        if (e[1] === d.mySlot) feedback("pop");
      } else if (e[0] === FX_SPAWN) {
        const [x, y] = at(e[1]);
        burst(sc, x, y, red ? 3 : 12, now, d.teamColors[teamOfSlot(e[1])], 140, 3, 450);
        if (e[1] === d.mySlot) sfx("go");
      }
    }
  }
}

// ---------- background ----------

function renderBackground(S: Surface, d: FieldData): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = S.W;
  c.height = S.H;
  const g = c.getContext("2d")!;
  const p: [number, number] = [0, 0];
  const q: [number, number] = [0, 0];
  const rectOf = (y0: number, y1: number) => {
    toS(S, 0, y0, p);
    toS(S, WORLD_W, y1, q);
    return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1])] as const;
  };
  // Halves.
  for (const team of [0, 1]) {
    const [x, y, w, h] = team === 0 ? rectOf(MID, WORLD_H) : rectOf(0, MID);
    const col = d.teamColors[team];
    g.fillStyle = "#0b0f19";
    g.fillRect(x, y, w, h);
    g.fillStyle = rgba(col, 0.1);
    g.fillRect(x, y, w, h);
    // Mowed stripes across the field.
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.fillStyle = rgba(col, 0.045);
    const stripe = 50 * S.s;
    if (S.land) for (let sx = x; sx < x + w; sx += stripe * 2) g.fillRect(sx, y, stripe, h);
    else for (let sy = y; sy < y + h; sy += stripe * 2) g.fillRect(x, sy, w, stripe);
    g.restore();
    // Big team name in the half.
    toS(S, WORLD_W / 2, team === 0 ? MID + 210 : MID - 210, p);
    g.save();
    g.translate(p[0], p[1]);
    g.font = `900 ${Math.round(64 * S.s)}px ${DISPLAY}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = rgba(col, 0.09);
    g.fillText(d.teamNames[team].toUpperCase(), 0, 0);
    g.restore();
  }
  // Border.
  const [fx, fy, fw, fh] = rectOf(0, WORLD_H);
  g.strokeStyle = "rgba(255,255,255,0.14)";
  g.lineWidth = 2 * S.dpr;
  g.strokeRect(fx + S.dpr, fy + S.dpr, fw - 2 * S.dpr, fh - 2 * S.dpr);
  // Midline.
  toS(S, 0, MID, p);
  toS(S, WORLD_W, MID, q);
  g.save();
  g.shadowColor = "rgba(255,255,255,0.6)";
  g.shadowBlur = 10 * S.dpr;
  g.strokeStyle = "rgba(255,255,255,0.55)";
  g.lineWidth = 3 * S.dpr;
  g.setLineDash([14 * S.dpr, 10 * S.dpr]);
  g.beginPath();
  g.moveTo(p[0], p[1]);
  g.lineTo(q[0], q[1]);
  g.stroke();
  g.restore();
  // Centre circle.
  toS(S, WORLD_W / 2, MID, p);
  g.strokeStyle = "rgba(255,255,255,0.12)";
  g.lineWidth = 2 * S.dpr;
  g.beginPath();
  g.arc(p[0], p[1], 70 * S.s, 0, TAU);
  g.stroke();
  // Bases.
  for (const team of [0, 1]) {
    const col = d.teamColors[team];
    toS(S, BASES[team][0], BASES[team][1], p);
    const r = BASE_R * S.s;
    const grad = g.createRadialGradient(p[0], p[1], r * 0.1, p[0], p[1], r * 1.6);
    grad.addColorStop(0, rgba(col, 0.32));
    grad.addColorStop(0.6, rgba(col, 0.12));
    grad.addColorStop(1, rgba(col, 0));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(p[0], p[1], r * 1.6, 0, TAU);
    g.fill();
    g.strokeStyle = rgba(col, 0.85);
    g.lineWidth = 3 * S.dpr;
    g.setLineDash([10 * S.dpr, 7 * S.dpr]);
    g.beginPath();
    g.arc(p[0], p[1], r, 0, TAU);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = rgba(col, 0.16);
    g.beginPath();
    g.arc(p[0], p[1], r, 0, TAU);
    g.fill();
  }
  return c;
}

// ---------- drawing ----------

function drawFlag(g: CanvasRenderingContext2D, x: number, y: number, h: number, color: string, now: number, wave = 1) {
  // Pole from (x, y) up; cloth flaps.
  g.strokeStyle = "#e5e7eb";
  g.lineWidth = Math.max(1.5, h * 0.07);
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x, y - h);
  g.stroke();
  const w = h * 0.72;
  const ch = h * 0.46;
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x, y - h);
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    g.lineTo(x + w * u, y - h + Math.sin(now / 120 + u * 4) * ch * 0.14 * wave * u);
  }
  for (let i = steps; i >= 0; i--) {
    const u = i / steps;
    g.lineTo(x + w * u, y - h + ch + Math.sin(now / 120 + u * 4 + 0.4) * ch * 0.14 * wave * u - ch * 0.18 * u);
  }
  g.closePath();
  g.fill();
  g.strokeStyle = "rgba(255,255,255,0.7)";
  g.lineWidth = Math.max(1, h * 0.03);
  g.stroke();
}

function drawScene(g: CanvasRenderingContext2D, sc: Scene, S: Surface, d: FieldData, now: number, canSteer: boolean) {
  const frames = sc.frames;
  const latest = frames[frames.length - 1];
  const rt = sc.clock.play(now, frames);
  sc.last = now;
  const view = d.view;
  playFx(sc, d, rt, now);
  const a = sampleAll(frames, rt, sc.pos);
  if (!a || !latest) return;
  const P: [number, number] = [0, 0];

  // ----- you -----
  const mine = d.mySlot;
  const me = sc.pred;
  const myStatus = mine >= 0 ? Number(latest.st[mine] ?? 0) : ST_OUT;
  const myCarry = mine >= 0 && latest.g[1 - d.myTeam]?.[0] === mine;
  const predicting = canSteer && mine >= 0 && myStatus !== ST_OUT && latest.xy.length > mine * 2 + 1;
  if (predicting) {
    const sx = latest.xy[mine * 2];
    const sy = latest.xy[mine * 2 + 1];
    if (!me.ready || me.n !== latest.n) {
      Object.assign(me, { x: sx, y: sy, vx: 0, vy: 0, ready: true, n: latest.n, at: now, stillMs: 0 });
      sc.trail.clear();
    }
    const sdt = Math.min(0.1, Math.max(0, (now - me.at) / 1000));
    me.at = now;
    const steps = Math.max(1, Math.ceil(sdt / 0.0125));
    const speed = speedOf(myStatus, myCarry);
    for (let i = 0; i < steps; i++) stepBody(me, sc.ix, sc.iy, sdt / steps, speed, d.myTeam, myCarry);
    const prev = frames[frames.length - 2];
    const serverStill = !!prev && prev.n === latest.n && prev.xy[mine * 2] === sx && prev.xy[mine * 2 + 1] === sy;
    const localStill = sc.ix === 0 && sc.iy === 0 && Math.hypot(me.vx, me.vy) < 1;
    me.stillMs = localStill ? me.stillMs + sdt * 1000 : 0;
    sc.trail.push(now, me.x, me.y);
    reconcile(me, sc.trail, sx, sy, sdt * 1000, { ...RECONCILE, still: serverStill && me.stillMs > 100 }, sc.err);
    debugFrame("flags", { t: now, x: me.x, y: me.y, rt });
    sc.pos[mine * 2] = me.x;
    sc.pos[mine * 2 + 1] = me.y;
  } else me.ready = false;

  // ----- background -----
  const bgKey = `${S.W}x${S.H}|${S.flip}|${d.teamColors.join()}`;
  if (!S.bg || S.bgKey !== bgKey) {
    S.bg = renderBackground(S, d);
    S.bgKey = bgKey;
  }
  const shakeAge = now - sc.shakeAt;
  const shake = shakeAge < 320 && !d.reduced ? (1 - shakeAge / 320) * 6 * S.dpr : 0;
  g.setTransform(1, 0, 0, 1, shake ? Math.sin(now / 17) * shake : 0, shake ? Math.cos(now / 23) * shake : 0);
  g.clearRect(-20, -20, S.W + 40, S.H + 40);
  g.drawImage(S.bg, 0, 0);
  const u = S.s;
  const flagH = 46 * u;

  // ----- flags at home / dropped -----
  for (const team of [0, 1]) {
    const ft = a.g[team];
    if (!ft) continue;
    const col = d.teamColors[team];
    if (ft[0] === FLAG_HOME) {
      toS(S, BASES[team][0], BASES[team][1], P);
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.beginPath();
      g.ellipse(P[0], P[1], 10 * u, 4 * u, 0, 0, TAU);
      g.fill();
      drawFlag(g, P[0], P[1], flagH, col, now);
    } else if (ft[0] === FLAG_DROPPED) {
      toS(S, ft[1], ft[2], P);
      const left = sc.droppedAt[team] ? clamp01(1 - (rt - sc.droppedAt[team]) / FLAG_RETURN_MS) : 1;
      const pulse = 0.5 + 0.5 * Math.sin(now / 140);
      g.strokeStyle = rgba(col, 0.35 + pulse * 0.4);
      g.lineWidth = 3 * S.dpr;
      g.beginPath();
      g.arc(P[0], P[1], 26 * u, -Math.PI / 2, -Math.PI / 2 + TAU * left);
      g.stroke();
      g.save();
      g.translate(P[0], P[1]);
      g.rotate(-0.5);
      drawFlag(g, 0, 8 * u, flagH * 0.8, col, now, 0.3);
      g.restore();
    }
  }

  // ----- power-up -----
  if (a.u) {
    toS(S, a.u[0], a.u[1], P);
    const bob = Math.sin(now / 220) * 3 * u;
    const glow = g.createRadialGradient(P[0], P[1] + bob, 0, P[0], P[1] + bob, POWER_R * 2.4 * u);
    glow.addColorStop(0, "rgba(250,204,21,0.55)");
    glow.addColorStop(1, "rgba(250,204,21,0)");
    g.fillStyle = glow;
    g.beginPath();
    g.arc(P[0], P[1] + bob, POWER_R * 2.4 * u, 0, TAU);
    g.fill();
    g.fillStyle = "#facc15";
    g.beginPath();
    g.arc(P[0], P[1] + bob, POWER_R * u, 0, TAU);
    g.fill();
    g.font = `${Math.round(POWER_R * 1.3 * u)}px ${SANS}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("⚡", P[0], P[1] + bob + 1);
  }

  // ----- carrier ribbons -----
  for (const team of [0, 1]) {
    const ft = a.g[team];
    if (!ft || ft[0] < 0) {
      continue;
    }
    const slot = ft[0];
    const x = sc.pos[slot * 2];
    const y = sc.pos[slot * 2 + 1];
    if (x === undefined) continue;
    let rib = sc.ribbons.get(slot);
    if (!rib) sc.ribbons.set(slot, (rib = []));
    rib.push({ x, y, t: now });
    while (rib.length && now - rib[0].t > 550) rib.shift();
    if (rib.length > 1 && !d.reduced) {
      const col = d.teamColors[team];
      for (let i = 1; i < rib.length; i++) {
        const k = i / rib.length;
        toS(S, rib[i - 1].x, rib[i - 1].y, P);
        const x0 = P[0];
        const y0 = P[1];
        toS(S, rib[i].x, rib[i].y, P);
        g.strokeStyle = rgba(col, k * 0.75);
        g.lineWidth = PLAYER_R * 1.4 * u * k;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(P[0], P[1]);
        g.stroke();
      }
    }
  }
  for (const slot of [...sc.ribbons.keys()]) if (a.g[0][0] !== slot && a.g[1][0] !== slot) sc.ribbons.delete(slot);

  // ----- players -----
  const n = view.ids.length;
  const order: number[] = [];
  for (let i = 0; i < n; i++) if (i !== mine) order.push(i);
  if (mine >= 0) order.push(mine);
  const R = PLAYER_R * u;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const slot of order) {
    const st = Number(a.st[slot] ?? 0);
    if (st === ST_OUT) continue;
    const wx = sc.pos[slot * 2];
    const wy = sc.pos[slot * 2 + 1];
    if (wx === undefined || wy === undefined) continue;
    toS(S, wx, wy, P);
    const [x, y] = P;
    const team = view.team[slot] ?? 0;
    const col = d.teamColors[team];
    const exposed = !teamHalf(team, wy);
    const carry = a.g[1 - team]?.[0] === slot;
    // Shadow.
    g.fillStyle = "rgba(0,0,0,0.4)";
    g.beginPath();
    g.ellipse(x, y + R * 0.8, R * 0.95, R * 0.4, 0, 0, TAU);
    g.fill();
    // Turbo streaks.
    if (st === ST_TURBO) {
      g.strokeStyle = "rgba(250,204,21,0.8)";
      g.lineWidth = 2 * S.dpr;
      for (let i = 0; i < 3; i++) {
        const ang = now / 90 + (i * TAU) / 3;
        g.beginPath();
        g.arc(x, y, R * 1.45, ang, ang + 0.9);
        g.stroke();
      }
    }
    // On enemy ground: a red danger ring that pulses.
    if (exposed) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 110);
      g.strokeStyle = `rgba(255,255,255,${0.5 + pulse * 0.45})`;
      g.lineWidth = 2.5 * S.dpr;
      g.setLineDash([5 * S.dpr, 4 * S.dpr]);
      g.beginPath();
      g.arc(x, y, R * 1.45 + 2 * S.dpr, now / 400, now / 400 + TAU);
      g.stroke();
      g.setLineDash([]);
    }
    // Body.
    g.fillStyle = col;
    g.beginPath();
    g.arc(x, y, R, 0, TAU);
    g.fill();
    g.fillStyle = "rgba(10,12,20,0.55)";
    g.beginPath();
    g.arc(x, y, R * 0.8, 0, TAU);
    g.fill();
    drawAvatar(g, d.avatars[slot], x, y, R * 1.55);
    if (slot === mine) {
      g.strokeStyle = "#ffffff";
      g.lineWidth = 3 * S.dpr;
      g.beginPath();
      g.arc(x, y, R + 3 * S.dpr, 0, TAU);
      g.stroke();
    }
    if (carry) drawFlag(g, x + R * 0.5, y - R * 0.6, flagH * 0.85, d.teamColors[1 - team], now, 1.4);
    // Name.
    const label = slot === mine ? "YOU" : (d.names[slot] ?? "").slice(0, 10);
    g.font = `800 ${Math.max(9 * S.dpr, Math.round(11 * u))}px ${SANS}`;
    const ly = y + R + 10 * u;
    g.lineWidth = 3 * S.dpr;
    g.strokeStyle = "rgba(5,6,10,0.85)";
    g.strokeText(label, x, ly);
    g.fillStyle = slot === mine ? "#ffffff" : col;
    g.fillText(label, x, ly);
  }

  // ----- particles & pops -----
  for (const p of sc.particles) {
    const age = (now - p.t0) / p.life;
    if (age >= 1) continue;
    const t = (now - p.t0) / 1000;
    toS(S, p.x + p.vx * t * (1 - age * 0.5), p.y + p.vy * t * (1 - age * 0.5), P);
    g.globalAlpha = 1 - age;
    g.fillStyle = p.color;
    g.beginPath();
    g.arc(P[0], P[1], p.size * S.dpr * (1 - age * 0.4), 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
  sc.particles = sc.particles.filter((p) => now - p.t0 < p.life);
  for (const p of sc.pops) {
    const age = (now - p.t0) / 1300;
    if (age >= 1) continue;
    toS(S, p.x, p.y, P);
    const size = (p.big ? 22 : 15) * (age < 0.12 ? 0.6 + age * 3.4 : 1);
    g.globalAlpha = age > 0.7 ? (1 - age) / 0.3 : 1;
    g.font = `900 ${Math.round(size * S.dpr)}px ${DISPLAY}`;
    g.lineWidth = 4 * S.dpr;
    g.strokeStyle = "rgba(5,6,10,0.9)";
    const yy = P[1] - age * 30 * S.dpr;
    g.strokeText(p.text, P[0], yy);
    g.fillStyle = p.color;
    g.fillText(p.text, P[0], yy);
  }
  g.globalAlpha = 1;
  sc.pops = sc.pops.filter((p) => now - p.t0 < 1300);

  // ----- your flag is out: alarm border -----
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (d.myTeam >= 0 && view.phase === "play") {
    const own = a.g[d.myTeam];
    if (own && own[0] !== FLAG_HOME) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 150);
      g.strokeStyle = `rgba(255,59,59,${0.35 + pulse * 0.5})`;
      g.lineWidth = 8 * S.dpr;
      g.strokeRect(4 * S.dpr, 4 * S.dpr, S.W - 8 * S.dpr, S.H - 8 * S.dpr);
    }
  }
  if (sc.flash) {
    const age = (now - sc.flash.t0) / 600;
    if (age >= 1 || d.reduced) sc.flash = null;
    else {
      g.fillStyle = rgba(sc.flash.color.startsWith("#") ? sc.flash.color : "#ffffff", 0.35 * (1 - age));
      g.fillRect(0, 0, S.W, S.H);
    }
  }

  // ----- joystick -----
  const st = sc.stick;
  if (st && canSteer) {
    const Rr = 52 * S.dpr;
    const ox = st.ox * S.dpr;
    const oy = st.oy * S.dpr;
    let kx = (st.kx - st.ox) * S.dpr;
    let ky = (st.ky - st.oy) * S.dpr;
    const m = Math.hypot(kx, ky);
    if (m > Rr) [kx, ky] = [(kx / m) * Rr, (ky / m) * Rr];
    g.fillStyle = "rgba(255,255,255,0.08)";
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.lineWidth = 2 * S.dpr;
    g.beginPath();
    g.arc(ox, oy, Rr, 0, TAU);
    g.fill();
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.beginPath();
    g.arc(ox + kx, oy + ky, Rr * 0.42, 0, TAU);
    g.fill();
  }
}

// ---------- component ----------

export function Field({
  data,
  act,
  onEvent,
  canSteer,
  label,
  children,
  hint,
}: {
  data: FieldData;
  act: (a: FlagAction) => void;
  onEvent: (fn: (e: unknown) => void) => () => void;
  canSteer: boolean;
  label: string;
  children?: ReactNode;
  hint?: ReactNode;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scene = useRef<Scene>(newScene());
  const surface = useRef<Surface | null>(null);
  const { view } = data;
  const flip = data.myTeam === 1;

  const onSnap = useEffectEvent((snap: Snap) => pushFrame(scene.current, snap, performance.now()));
  useEffect(() => {
    if (isSnap(view.snap)) onSnap(view.snap);
  }, [view]);
  const onServerEvent = useEffectEvent((e: unknown) => {
    if (isSnap(e)) onSnap(e);
  });
  useEffect(() => onEvent((e) => onServerEvent(e)), [onEvent]);

  // ----- canvas size -----
  useEffect(() => {
    const holder = holderRef.current;
    const canvas = canvasRef.current;
    if (!holder || !canvas) return;
    const fit = () => {
      const r = holder.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      const dpr = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
      const W = Math.round(r.width * dpr);
      const H = Math.round(r.height * dpr);
      const cur = surface.current;
      if (cur && cur.W === W && cur.H === H && cur.dpr === dpr && cur.flip === flip) return;
      canvas.width = W;
      canvas.height = H;
      surface.current = layout(W, H, dpr, flip);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(holder);
    return () => ro.disconnect();
  }, [flip]);

  // ----- the loop -----
  const paint = useEffectEvent((now: number) => {
    const canvas = canvasRef.current;
    const S = surface.current;
    const sc = scene.current;
    if (!canvas || !S || !sc.frames.length) return;
    const g = canvas.getContext("2d");
    if (!g) return;
    drawScene(g, sc, S, data, now, canSteer);
  });
  useEffect(() => {
    let raf = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      paint(t);
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) {
        scene.current.clock.pause();
        scene.current.last = -1;
        scene.current.pred.at = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };
    raf = requestAnimationFrame(loop);
    document.addEventListener("visibilitychange", onVisibility);
    const sc = scene.current;
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      if (sc.sendTimer) clearTimeout(sc.sendTimer);
    };
  }, []);

  // ----- input -----
  const sendInput = (force = false) => {
    const sc = scene.current;
    if (sc.sendTimer) clearTimeout(sc.sendTimer);
    sc.sendTimer = null;
    let x = 0;
    let y = 0;
    if (sc.stick) {
      const R = 52;
      const dx = (sc.stick.kx - sc.stick.ox) / R;
      const dy = (sc.stick.ky - sc.stick.oy) / R;
      const m = Math.hypot(dx, dy);
      if (m > 0.2) [x, y] = m > 1 ? [dx / m, dy / m] : [dx, dy];
    } else {
      if (sc.keys.has("left")) x -= 1;
      if (sc.keys.has("right")) x += 1;
      if (sc.keys.has("up")) y -= 1;
      if (sc.keys.has("down")) y += 1;
      const m = Math.hypot(x, y);
      if (m > 1) [x, y] = [x / m, y / m];
    }
    const [wx, wy] = toWorldDir(surface.current, x, y);
    const ix = canSteer ? Math.round(wx * 100) : 0;
    const iy = canSteer ? Math.round(wy * 100) : 0;
    [sc.ix, sc.iy] = inputDir(ix, iy);
    const key = `${ix},${iy}`;
    if (key === sc.sent && !force) return;
    const now = perfNow();
    if (!force && now - sc.sentAt < SEND_GAP) {
      sc.sendTimer = setTimeout(() => sendInput(), SEND_GAP - (now - sc.sentAt));
      return;
    }
    sc.sent = key;
    sc.sentAt = now;
    if (data.mySlot >= 0) act({ type: "in", x: ix, y: iy });
  };

  const onKey = useEffectEvent((e: KeyboardEvent, down: boolean) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const k = e.key.toLowerCase();
    const dir =
      k === "w" || k === "arrowup" ? "up" : k === "s" || k === "arrowdown" ? "down" : k === "a" || k === "arrowleft" ? "left" : k === "d" || k === "arrowright" ? "right" : null;
    if (!dir) return;
    if (data.mySlot >= 0) e.preventDefault();
    const sc = scene.current;
    if (down) sc.keys.add(dir);
    else sc.keys.delete(dir);
    sendInput();
  });
  const onLetGo = useEffectEvent(() => {
    scene.current.keys.clear();
    scene.current.stick = null;
    sendInput(true);
  });
  useEffect(() => {
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    const blur = () => onLetGo();
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur);
    };
  }, []);
  // A new phase or line-up: the server forgot your stick, so say it again.
  const onSteerChange = useEffectEvent(() => sendInput(true));
  useEffect(() => {
    onSteerChange();
  }, [canSteer, view.phase, view.n]);

  const local = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (data.mySlot < 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointers can't be captured */
    }
    const [x, y] = local(e);
    scene.current.stick = { id: e.pointerId, ox: x, oy: y, kx: x, ky: y };
    sendInput();
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const st = scene.current.stick;
    if (!st || st.id !== e.pointerId) return;
    const [x, y] = local(e);
    st.kx = x;
    st.ky = y;
    sendInput();
  };
  const onUp = (e: PointerEvent<HTMLCanvasElement>) => {
    const st = scene.current.stick;
    if (!st || st.id !== e.pointerId) return;
    scene.current.stick = null;
    sendInput();
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={holderRef} className="fr-stage relative w-full overflow-hidden rounded-2xl border border-line bg-ink shadow-[0_10px_40px_-12px_rgba(0,0,0,0.8)]">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={label}
          className="absolute inset-0 h-full w-full touch-none select-none"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onContextMenu={(e) => e.preventDefault()}
        />
        {children}
      </div>
      {hint && <p className="text-center text-xs text-muted">{hint}</p>}
    </div>
  );
}

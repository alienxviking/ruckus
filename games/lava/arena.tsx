"use client";

// Canvas renderer, playback buffer and touch stick for Floor is Lava.
//
// The server sends a frame every 50 ms (positions plus tile changes). The renderer keeps a short
// buffer and draws the world a little in the past, blending the two frames around that moment
// with a cubic Hermite curve, so players glide at display refresh rate. The playback clock maps
// the frames' server timestamps onto performance.now(), follows the quickest deliveries and slews
// gently; how far in the past adapts to the measured jitter (55-120 ms). Tile changes and effects
// ride in the frames and are applied when playback reaches them, so a tile drops exactly when a
// player standing on it does.
//
// Your own avatar is the exception: predict.ts replays your inputs on top of its newest snapshot,
// so it moves (and jumps) on the very frame you press. Server corrections (a bump you didn't see
// coming) are blended out over ~120 ms, and your fall shows the moment the server reports it.

import { useEffect, useEffectEvent, useRef, type PointerEvent, type ReactNode, type RefObject } from "react";
import type { LavaView } from "./server";
import type { Kin } from "./physics";
import type { LavaPredictor, PredictedContact, World, WorldRunner } from "./predict";
import {
  APOTHEM,
  CAMP_MS,
  CENTER,
  COLLAPSE_EVERY_MS,
  COLLAPSE_START_MS,
  F_FLOAT,
  F_FLOAT_LOW,
  F_OFFLINE,
  FX_FALL,
  FX_HIT,
  FX_JUMP,
  FX_PICKUP,
  FX_SHOCK,
  FX_SINK,
  GONE,
  JUMP_CD_MS,
  JUMP_HEIGHT,
  JUMP_MS,
  PLAYER_R,
  POWER_INFO,
  POWER_KINDS,
  SUB_MS,
  TICK_MS,
  TILE,
  board,
  jumpAge,
  tileAt,
  type Board,
  type FxTuple,
  type PlayerTuple,
  type Snap,
  HIT_FX_MIN,
  decodeStick,
} from "./shared";
import { Spring2D, Timeline, debugFrame } from "../snakes/netsmooth";
import { avatarImage, drawAvatar } from "@/lib/avatar-art";
import { isAvatarId } from "@/shared/types";
import { buzz, feedback, sfx } from "@/lib/feedback";

const TAU = Math.PI * 2;
const DELAY_MS = 100;
export const CORR_MS = 100;
export const CORR_SNAP = 160;
/** Other players: their corrections are bigger (dead reckoning), so they fade a little slower. */
export const OTHERS_CORR_MS = 140;
const EXTRAP_MS = 150;
const KEEP_MS = 400;
const MAX_FRAMES = 120;
const FALL_MS = 1_000;
const TILE_FALL_MS = 650;
const TILE_RISE_MS = 420;
/** Tiles are drawn a touch smaller than the grid, so glowing lava seams show between them. */
const TILE_GAP = 1.6;
/** Tile thickness (world units) for the extruded side. */
const THICK = 8;
/** World margin around the arena. */
const MARGIN = 26;
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const SANS = "ui-sans-serif, system-ui, sans-serif";
/** Avatar sprite resolution: radius in sprite pixels. */
const SPR = 64;
const SPR_PAD = 8;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeOutBack = (t: number) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);

/** Width / height of the arena box for radius R (the holder uses this aspect ratio). */
export function arenaAspect(R: number) {
  const b = board(R);
  return (b.halfW + MARGIN) / (b.halfH + MARGIN);
}

// ---------- frames & clock ----------

/** A player tuple with the trailing zeros put back (the stick: -1 when centred / not sent). */
type Full = [number, number, number, number, number, number, number, number];

interface Frame {
  n: number;
  t: number;
  d: (Full | undefined)[];
  u: [number, number][];
  fx: FxTuple[] | null;
  c: number[] | null;
  /** The whole board (from a view): replaces the tiles when playback reaches it. */
  board: string | null;
  acks?: [number, number, number, number?][];
}

function toFrame(s: Snap, boardStr: string | null): Frame {
  const d: (Full | undefined)[] = [];
  for (const p of s.p as PlayerTuple[]) {
    if (Array.isArray(p) && p.length >= 5 && p[0] >= 0 && p[0] < 16)
      d[p[0]] = [p[0], p[1], p[2], p[3], p[4], p[5] ?? 0, p[6] ?? 0, p[7] ?? -1];
  }
  return {
    n: s.n,
    t: s.t,
    d,
    u: Array.isArray(s.u) ? s.u : [],
    fx: Array.isArray(s.fx) ? s.fx : null,
    c: Array.isArray(s.c) ? s.c : null,
    board: boardStr,
  };
}

/**
 * Maps server time onto performance.now(), smoothly (see snakes/netsmooth.ts): playback follows
 * the quickest recent delivery, runs behind it by an adaptive delay that covers the measured
 * jitter (rising promptly, falling only after a calm spell), and slews by a few percent at most.
 */
class Clock extends Timeline {
  constructor() {
    super({ period: TICK_MS, start: DELAY_MS, min: TICK_MS + 15, max: 650 });
  }

  /**
   * Playback time for this animation frame: at most a tick's worth of extrapolation past the newest
   * frame in hand; if the buffer runs drier than that, playback waits (up to 200 ms) instead of
   * extrapolating further and snapping back, then carries on smoothly.
   */
  play(now: number, frames: { t: number }[]) {
    return this.tick(now, frames.length ? frames[frames.length - 1].t : Infinity, TICK_MS, 200);
  }
}

// ---------- scene state ----------

export interface Sample {
  x: number;
  y: number;
  vx: number;
  vy: number;
  flags: number;
  cd: number;
  /** Server time of the frame the cooldown came from. */
  cdAt: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  color: string;
  /** 0 spark streak, 1 ember, 2 blob, 3 smoke (grows, rises). */
  kind: number;
  drag: number;
}

interface Ring {
  x: number;
  y: number;
  t0: number;
  dur: number;
  r0: number;
  r1: number;
  w: number;
  color: string;
}

interface Pop {
  slot: number;
  x: number;
  y: number;
  t0: number;
  text: string;
  color: string;
}

interface Ghost {
  slot: number;
  x: number;
  y: number;
  t0: number;
}

interface Bubble {
  x: number;
  y: number;
  t0: number;
  life: number;
  r: number;
}

export interface InputState {
  x: number;
  y: number;
}

interface Stick {
  id: number;
  ox: number;
  oy: number;
  kx: number;
  ky: number;
}

interface Scene {
  clock: Clock;
  frames: Frame[];
  /** Newest frame time whose tiles/effects have been applied. */
  cursor: number;
  rt: number;
  round: number;
  roundAt: number;
  R: number;
  /** Tile stages as on screen, when each last changed (render time), and what it was before. */
  tiles: number[];
  tileAt: number[];
  tileWas: number[];
  particles: Particle[];
  rings: Ring[];
  pops: Pop[];
  ghosts: Ghost[];
  bubbles: Bubble[];
  shakeAt: number;
  shakeAmp: number;
  hurtAt: number;
  camK: number;
  sx: number[];
  sy: number[];
  sr: number[];
  stick: Stick | null;
  tapAt: number;
  tapX: number;
  tapY: number;
  coarse: boolean;
  stillKey: string;
  wall: number;
  perf: number;
  my: Kin;
  myOn: boolean;
  /** Your leftover correction, fading out like a critically damped spring (no twitch). */
  corr: Spring2D;
  myX: number;
  myY: number;
  myGone: number;
  jumpSeen: number;
  /** Your tile as drawn, and since when (performance.now()): the no-camping meter. */
  myTile: number;
  myTileAt: number;
  /**
   * A player sees everyone at one moment, the present (`rt` = your clock + lead): all of you
   * predicted from the newest snapshot (predict.ts), bumps included. Spectators watch the playback.
   */
  present: boolean;
  mySlot: number;
  worldBase: World | null;
  world: (Kin | undefined)[];
  /** Other players' leftover corrections, per slot (yours is `corr`). */
  springs: Spring2D[];
  /** Where each player was drawn lately (render time), for effects and falls. */
  hist: { t: number; x: number; y: number; vx: number; vy: number }[][];
  contacts: PredictedContact[];
  localHit: Map<string, number>;
  wx: number[];
  wy: number[];
  powerSeen: Map<number, number>;
}

export function newScene(): Scene {
  return {
    clock: new Clock(),
    frames: [],
    cursor: Infinity,
    rt: 0,
    round: -1,
    roundAt: -1e9,
    R: 0,
    tiles: [],
    tileAt: [],
    tileWas: [],
    particles: [],
    rings: [],
    pops: [],
    ghosts: [],
    bubbles: [],
    shakeAt: -1e9,
    shakeAmp: 0,
    hurtAt: -1e9,
    camK: 1,
    sx: [],
    sy: [],
    sr: [],
    stick: null,
    tapAt: -1e9,
    tapX: 0,
    tapY: 0,
    coarse: false,
    stillKey: "",
    wall: -1,
    perf: 0,
    my: { x: 0, y: 0, vx: 0, vy: 0 },
    myOn: false,
    corr: new Spring2D(CORR_MS),
    myX: NaN,
    myY: NaN,
    myGone: -1,
    jumpSeen: 0,
    myTile: -1,
    myTileAt: 0,
    wx: [],
    wy: [],
    powerSeen: new Map(),
    present: false,
    mySlot: -1,
    worldBase: null,
    world: [],
    springs: [],
    hist: [],
    contacts: [],
    localHit: new Map(),
  };
}

/** A frame as everyone to predict from. */
function worldOf(f: Frame): World {
  const runners: WorldRunner[] = [];
  for (const t of f.d) {
    if (!t) continue;
    const [ix, iy] = t[7] >= 0 ? decodeStick(t[7]) : [0, 0];
    runners.push({ slot: t[0], x: t[1], y: t[2], vx: t[3], vy: t[4], ix, iy, cd: t[6] });
  }
  return { n: f.n, t: f.t, runners };
}

const springOf = (sc: Scene, slot: number) =>
  slot === sc.mySlot ? sc.corr : (sc.springs[slot] ??= new Spring2D(OTHERS_CORR_MS));

const shownBefore: (Kin | undefined)[] = [];
const shownAfter: (Kin | undefined)[] = [];

/** The predicted players changed under you (`shownBefore` = what was shown): fade every difference out. */
function blendWorld(sc: Scene, pred: Mine["pred"], w: World, T: number, mine: number) {
  pred.predictWorld(T, w, mine, shownAfter);
  for (let slot = 0; slot < shownAfter.length; slot++) {
    const a = shownBefore[slot];
    const b = shownAfter[slot];
    if (!a || !b) continue;
    const sp = springOf(sc, slot);
    sp.add(a.x - b.x, a.y - b.y, (a.vx - b.vx) / 1000, (a.vy - b.vy) / 1000);
    if (sp.size > CORR_SNAP) sp.reset();
  }
}

export interface Mine {
  pred: LavaPredictor;
  slot: number;
  data: ArenaData;
}


/** Replace the whole board (a view, or a new round). */
function setBoard(sc: Scene, str: string, R: number, rt: number) {
  sc.R = R;
  const n = board(R).tiles.length;
  if (sc.tiles.length !== n) {
    sc.tiles = new Array(n).fill(0);
    sc.tileAt = new Array(n).fill(-1e9);
    sc.tileWas = new Array(n).fill(0);
  }
  for (let i = 0; i < n; i++) {
    const v = str.charCodeAt(i) - 48;
    const stage = v >= 0 && v <= GONE ? v : 0;
    if (stage !== sc.tiles[i]) setStage(sc, i, stage, rt, false);
  }
}

function setStage(sc: Scene, i: number, stage: number, rt: number, animate: boolean) {
  if (i < 0 || i >= sc.tiles.length || sc.tiles[i] === stage) return;
  sc.tileWas[i] = sc.tiles[i];
  sc.tiles[i] = stage;
  sc.tileAt[i] = animate ? rt : -1e9;
}

/** Hand a frame to your predictor: acknowledgements, your newest state, your fall. */
function feedMine(sc: Scene, f: Frame, newest: boolean, prev: Frame | undefined, me: Mine, now: number) {
  const { pred, slot } = me;
  sc.mySlot = slot;
  // What you see right now, before this frame changes anything. A new snapshot and the
  // acknowledgements it carries move the predicted players (you included): blend that out.
  const T = sc.clock.serverNow(now) + pred.lead(now);
  const old = sc.worldBase;
  const had = sc.clock.ready && !!old;
  if (had) pred.predictWorld(T, old!, slot, shownBefore);
  if (Array.isArray(f.acks)) {
    for (const a of f.acks) if (a[0] === slot) pred.ack(a[1], f.t + a[2], typeof a[3] === "number" ? f.t + a[3] : undefined, now);
  }
  if (!newest) {
    if (had) blendWorld(sc, pred, old!, T, slot);
    return;
  }
  sc.worldBase = worldOf(f);
  const dt = f.d[slot];
  if (!dt) {
    if (prev && prev.n === f.n && prev.d[slot] && sc.myGone !== f.n && !Number.isNaN(sc.myX)) {
      sc.myGone = f.n;
      fallFx(sc, slot, sc.myX, sc.myY, sc.rt, me.data);
    }
    pred.setBase(null);
    if (had && old!.n === f.n) blendWorld(sc, pred, sc.worldBase, T, slot);
    return;
  }
  const base = { n: f.n, t: f.t, x: dt[1], y: dt[2], vx: dt[3], vy: dt[4], cd: dt[6] };
  const ownBase = pred.base;
  pred.setBase(base);
  if (!ownBase || ownBase.n !== f.n || !sc.clock.ready) {
    sc.corr.reset();
    for (const sp of sc.springs) sp?.reset();
    return;
  }
  // Same moment, two answers: keep showing the old one and fade the difference out.
  if (had && old!.n === f.n) blendWorld(sc, pred, sc.worldBase, T, slot);
}

/** Add a server frame to the playback buffer (and, for a player, to their predictor). */
export function pushFrame(sc: Scene, snap: Snap, now: number, R: number, boardStr: string | null, me?: Mine) {
  const f = toFrame(snap, boardStr);
  if (Array.isArray(snap.a)) f.acks = snap.a;
  const frames = sc.frames;
  const newestBefore: Frame | undefined = frames[frames.length - 1];
  let last: Frame | undefined = newestBefore;
  if (!last || f.n !== last.n) {
    if (last && f.n < last.n && f.t < last.t) return;
    frames.length = 0;
    last = undefined;
    // A first frame or a new round: its board is the state of play right now.
    if (boardStr !== null) setBoard(sc, boardStr, R, sc.rt);
    f.board = null;
    sc.cursor = f.t - 1;
    if (!newestBefore) sc.cursor = f.t;
  }
  if (!last || f.t > last.t) {
    sc.clock.observe(f.t, now);
    if (last && snap.q === 1 && f.t - last.t > TICK_MS * 1.5) {
      frames.push({ ...last, t: f.t - TICK_MS, fx: null, c: null, board: null });
    }
    frames.push(f);
  } else if (!frames.some((x) => x.t === f.t)) {
    const i = frames.findIndex((x) => x.t > f.t);
    frames.splice(i, 0, f);
  }
  if (frames.length > MAX_FRAMES) frames.splice(0, frames.length - MAX_FRAMES);
  if (me && me.slot >= 0) feedMine(sc, f, frames[frames.length - 1] === f, newestBefore, me, now);
}

/**
 * Where a player is drawn at render time `time`. A player (the present): the prediction plus
 * the leftover correction this frame, and where they were drawn for moments just past. Watching:
 * the playback of the frames themselves.
 */
function sampleAt(sc: Scene, slot: number, time: number, o: Sample): boolean {
  const frames = sc.frames;
  if (!sc.present) return samplePlayer(frames, slot, time, o);
  const latest = frames[frames.length - 1];
  const tup = latest?.d[slot];
  if (!latest || !tup) return false;
  o.flags = tup[5];
  o.cd = tup[6];
  o.cdAt = latest.t;
  const h = sc.hist[slot];
  if (time < sc.rt - 1 && h && h.length) {
    let i = h.length - 1;
    while (i > 0 && h[i].t > time) i--;
    const a = h[i];
    const b = h[i + 1];
    const u = !b || a.t >= time ? 0 : (time - a.t) / (b.t - a.t);
    o.x = a.x + ((b ?? a).x - a.x) * u;
    o.y = a.y + ((b ?? a).y - a.y) * u;
    o.vx = a.vx;
    o.vy = a.vy;
    return true;
  }
  const w = sc.world[slot];
  if (!w) return false;
  const sp = springOf(sc, slot);
  o.x = w.x + sp.x;
  o.y = w.y + sp.y;
  o.vx = w.vx;
  o.vy = w.vy;
  return true;
}

/** Where a player is at server time `time`. False when they aren't in the arena. */
export function samplePlayer(frames: Frame[], slot: number, time: number, o: Sample): boolean {
  const n = frames.length;
  if (!n) return false;
  let i = n - 1;
  while (i > 0 && frames[i].t > time) i--;
  const a = frames[i];
  const da = a.d[slot];
  if (!da) return false;
  o.flags = da[5];
  o.cd = da[6];
  o.cdAt = a.t;
  if (a.t >= time) {
    o.x = da[1];
    o.y = da[2];
    o.vx = da[3];
    o.vy = da[4];
    return true;
  }
  const b = i + 1 < n ? frames[i + 1] : null;
  const db = b ? b.d[slot] : undefined;
  if (!b || !db) {
    const e = Math.min(time - a.t, b ? b.t - a.t : EXTRAP_MS) / 1000;
    o.x = da[1] + da[3] * e;
    o.y = da[2] + da[4] * e;
    o.vx = da[3];
    o.vy = da[4];
    return true;
  }
  const gap = b.t - a.t;
  const k = (time - a.t) / gap;
  o.vx = da[3] + (db[3] - da[3]) * k;
  o.vy = da[4] + (db[4] - da[4]) * k;
  if (gap > TICK_MS * 2.5) {
    o.x = da[1] + (db[1] - da[1]) * k;
    o.y = da[2] + (db[2] - da[2]) * k;
    return true;
  }
  const h = gap / 1000;
  const k2 = k * k;
  const k3 = k2 * k;
  const h00 = 2 * k3 - 3 * k2 + 1;
  const h10 = k3 - 2 * k2 + k;
  const h01 = 3 * k2 - 2 * k3;
  const h11 = k3 - k2;
  o.x = h00 * da[1] + h10 * h * da[3] + h01 * db[1] + h11 * h * db[3];
  o.y = h00 * da[2] + h10 * h * da[4] + h01 * db[2] + h11 * h * db[4];
  return true;
}

/** 0..1 through a jump at time `t`, or -1 when on the ground. */
function jumpPhase(cd: number, cdAt: number, t: number) {
  const age = jumpAge(cd);
  if (age < 0) return -1;
  const p = (t - (cdAt - age * SUB_MS)) / JUMP_MS;
  return p >= 0 && p < 1 ? p : -1;
}

// ---------- sprites ----------

interface Surface {
  W: number;
  H: number;
  dpr: number;
  /** World -> device px at full zoom-out. */
  fit: number;
  bg: HTMLCanvasElement;
  hurt: HTMLCanvasElement;
  shadow: HTMLCanvasElement;
  glow: HTMLCanvasElement;
  /** Tile sprites [variant][stage 0-3] and their resolution (sprite px per world unit). */
  tiles: HTMLCanvasElement[][];
  tileK: number;
}

function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0x94a3b8;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(hex: string, to: number, f: number) {
  const [r, g, b] = hexRgb(hex);
  const c = (v: number) => Math.round(v + (to - v) * f);
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
}

function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function hexPath(g: CanvasRenderingContext2D | Path2D, x: number, y: number, r: number) {
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    if (k === 0) g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.closePath();
}

/** Molten background: dark crust, glowing rivers, fixed. */
function renderBackground(W: number, H: number) {
  const c = makeCanvas(W, H);
  const g = c.getContext("2d");
  if (!g) return c;
  const grad = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
  grad.addColorStop(0, "#ff7a1a");
  grad.addColorStop(0.45, "#e2430c");
  grad.addColorStop(1, "#7a1405");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  const rnd = seeded(31);
  const unit = Math.max(W, H) / 40;
  // Dark crust plates drifting on the lava.
  for (let i = 0; i < 46; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = unit * (0.8 + rnd() * 2.2);
    g.beginPath();
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU + rnd() * 0.5;
      const rr = r * (0.6 + rnd() * 0.5);
      if (k === 0) g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      else g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
    g.fillStyle = `rgba(70, 12, 4, ${0.25 + rnd() * 0.3})`;
    g.fill();
  }
  // Bright molten streaks.
  g.lineCap = "round";
  for (let i = 0; i < 28; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    g.strokeStyle = `rgba(255, 214, 102, ${0.15 + rnd() * 0.25})`;
    g.lineWidth = unit * (0.15 + rnd() * 0.3);
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + (rnd() - 0.5) * unit * 4, y + (rnd() - 0.5) * unit * 2, x + (rnd() - 0.5) * unit * 6, y + (rnd() - 0.5) * unit * 3);
    g.stroke();
  }
  return c;
}

function renderHurt() {
  const c = makeCanvas(96, 96);
  const g = c.getContext("2d");
  if (!g) return c;
  const v = g.createRadialGradient(48, 48, 26, 48, 48, 70);
  v.addColorStop(0, "rgba(255, 80, 20, 0)");
  v.addColorStop(1, "rgba(255, 80, 20, 0.55)");
  g.fillStyle = v;
  g.fillRect(0, 0, 96, 96);
  return c;
}

function renderShadow() {
  const c = makeCanvas(64, 64);
  const g = c.getContext("2d");
  if (!g) return c;
  const v = g.createRadialGradient(32, 32, 6, 32, 32, 32);
  v.addColorStop(0, "rgba(20, 6, 2, 0.6)");
  v.addColorStop(0.6, "rgba(20, 6, 2, 0.28)");
  v.addColorStop(1, "rgba(20, 6, 2, 0)");
  g.fillStyle = v;
  g.fillRect(0, 0, 64, 64);
  return c;
}

function renderGlow() {
  const c = makeCanvas(64, 64);
  const g = c.getContext("2d");
  if (!g) return c;
  const v = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  v.addColorStop(0, "rgba(255, 220, 140, 0.9)");
  v.addColorStop(0.35, "rgba(255, 150, 50, 0.35)");
  v.addColorStop(1, "rgba(255, 120, 30, 0)");
  g.fillStyle = v;
  g.fillRect(0, 0, 64, 64);
  return c;
}

/** One basalt tile (top plus extruded side) with the cracks of `stage`, at k sprite px per unit. */
function renderTile(k: number, variant: number, stage: number): HTMLCanvasElement {
  const pad = 4;
  const r = TILE - TILE_GAP;
  const w = 2 * r * k + pad * 2;
  const h = (2 * APOTHEM - TILE_GAP * 1.7 + THICK) * k + pad * 2;
  const c = makeCanvas(w, h);
  const g = c.getContext("2d");
  if (!g) return c;
  const cx = w / 2;
  const cy = pad + (APOTHEM - TILE_GAP * 0.85) * k;
  const R = r * k;
  const T = THICK * k;
  const corner = (i: number, dy = 0): [number, number] => [cx + Math.cos((i / 6) * TAU) * R, cy + Math.sin((i / 6) * TAU) * R + dy];
  // Side: the bottom three edges pushed down.
  g.beginPath();
  const side = [corner(3), corner(2), corner(1), corner(0), corner(0, T), corner(1, T), corner(2, T), corner(3, T)];
  side.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  const sg = g.createLinearGradient(0, cy, 0, cy + R + T);
  sg.addColorStop(0, "#3b2a24");
  sg.addColorStop(1, "#1a0f0c");
  g.fillStyle = sg;
  g.fill();
  // Lava light on the lower lip.
  g.strokeStyle = "rgba(255, 120, 40, 0.55)";
  g.lineWidth = Math.max(1, k * 1.2);
  g.beginPath();
  [corner(0, T), corner(1, T), corner(2, T), corner(3, T)].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  // Top.
  const heat = stage === 0 ? 0 : stage === 1 ? 0.14 : stage === 2 ? 0.2 : 0.38;
  const tones = [
    ["#8b7d74", "#5d524c", "#3c3430"],
    ["#857a72", "#5a4f4a", "#3a312d"],
    ["#90837a", "#625650", "#41372f"],
  ][variant % 3];
  const tg = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  tg.addColorStop(0, tones[0]);
  tg.addColorStop(0.5, tones[1]);
  tg.addColorStop(1, tones[2]);
  g.beginPath();
  hexPath(g, cx, cy, R);
  g.fillStyle = tg;
  g.fill();
  g.save();
  g.clip();
  // Speckles and pits.
  const rnd = seeded(101 + variant * 977);
  for (let i = 0; i < 14; i++) {
    const a = rnd() * TAU;
    const d = Math.sqrt(rnd()) * R * 0.85;
    g.fillStyle = rnd() < 0.5 ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.16)";
    g.beginPath();
    g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, k * (0.8 + rnd() * 2.2), 0, TAU);
    g.fill();
  }
  if (heat > 0) {
    const hg = g.createRadialGradient(cx, cy, 0, cx, cy, R);
    hg.addColorStop(0, `rgba(255, 110, 30, ${heat})`);
    hg.addColorStop(1, `rgba(255, 60, 10, ${heat * 1.6})`);
    g.fillStyle = hg;
    g.fillRect(cx - R, cy - R, R * 2, R * 2);
  }
  // Cracks: more, longer and hotter with each stage.
  if (stage > 0) {
    const cr = seeded(7 + variant * 131);
    const n = stage === 1 ? 3 : stage === 2 ? 5 : 8;
    const path = new Path2D();
    for (let i = 0; i < n; i++) {
      let a = (i / n) * TAU + cr() * 0.6;
      let x = cx + (cr() - 0.5) * R * 0.25;
      let y = cy + (cr() - 0.5) * R * 0.25;
      path.moveTo(x, y);
      const len = R * (stage === 1 ? 0.45 : stage === 2 ? 0.75 : 1.05);
      const segs = 3 + Math.floor(cr() * 2);
      for (let sgi = 0; sgi < segs; sgi++) {
        a += (cr() - 0.5) * 0.9;
        x += Math.cos(a) * (len / segs);
        y += Math.sin(a) * (len / segs);
        path.lineTo(x, y);
        if (stage >= 2 && cr() < 0.35) {
          path.lineTo(x + Math.cos(a + 1.1) * len * 0.22, y + Math.sin(a + 1.1) * len * 0.22);
          path.moveTo(x, y);
        }
      }
    }
    g.lineCap = "round";
    g.lineJoin = "round";
    if (stage >= 2) {
      g.strokeStyle = stage === 3 ? "rgba(255, 170, 60, 0.75)" : "rgba(255, 120, 40, 0.45)";
      g.lineWidth = k * (stage === 3 ? 4.2 : 3);
      g.stroke(path);
    }
    g.strokeStyle = stage === 3 ? "#ffe08a" : stage === 2 ? "#ff8a3d" : "rgba(20, 8, 4, 0.85)";
    g.lineWidth = k * (stage === 1 ? 1.6 : 1.4);
    g.stroke(path);
  }
  g.restore();
  // Bevel: light top-left rim, dark bottom-right rim.
  g.lineWidth = Math.max(1, k * 1.6);
  g.strokeStyle = "rgba(255, 255, 255, 0.22)";
  g.beginPath();
  [corner(3), corner(4), corner(5), corner(0)].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  g.strokeStyle = stage === 3 ? "rgba(255, 200, 90, 0.9)" : "rgba(0, 0, 0, 0.3)";
  g.beginPath();
  [corner(0), corner(1), corner(2), corner(3)].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  return c;
}

const spriteCache = new Map<string, HTMLCanvasElement>();
/** A glossy token in the player's colour with their avatar on top. */
function avatarSprite(color: string, avatar: string): HTMLCanvasElement {
  const key = `${color}|${avatar}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  // Wait for the avatar art before baking it into a cached sprite.
  const ready = !isAvatarId(avatar) || avatarImage(avatar) !== null;
  const size = (SPR + SPR_PAD) * 2;
  const c = makeCanvas(size, size);
  const g = c.getContext("2d");
  if (!g) return c;
  const m = size / 2;
  g.beginPath();
  g.arc(m, m, SPR, 0, TAU);
  g.fillStyle = mix(color, 0, 0.55);
  g.fill();
  const body = g.createRadialGradient(m - SPR * 0.35, m - SPR * 0.4, SPR * 0.1, m, m, SPR * 0.92);
  body.addColorStop(0, mix(color, 255, 0.45));
  body.addColorStop(0.55, color);
  body.addColorStop(1, mix(color, 0, 0.25));
  g.beginPath();
  g.arc(m, m, SPR * 0.86, 0, TAU);
  g.fillStyle = body;
  g.fill();
  g.font = `${Math.round(SPR * 0.95)}px ${EMOJI_FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  drawAvatar(g, avatar, m, m, SPR * 1.3);
  g.beginPath();
  g.ellipse(m - SPR * 0.28, m - SPR * 0.42, SPR * 0.42, SPR * 0.2, -0.5, 0, TAU);
  g.fillStyle = "rgba(255, 255, 255, 0.28)";
  g.fill();
  if (ready) spriteCache.set(key, c);
  return c;
}

// ---------- drawing ----------

export interface ArenaData {
  view: LavaView;
  mySlot: number;
  colors: string[];
  names: string[];
  avatars: string[];
  reduced: boolean;
  steerable: boolean;
  accent: string;
}

const tmp: Sample = { x: 0, y: 0, vx: 0, vy: 0, flags: 0, cd: 0, cdAt: 0 };
const tmp2: Sample = { x: 0, y: 0, vx: 0, vy: 0, flags: 0, cd: 0, cdAt: 0 };

function spark(
  sc: Scene,
  x: number,
  y: number,
  n: number,
  speed: number,
  color: string,
  kind: number,
  spread: number,
  dirX = 0,
  dirY = 0,
) {
  if (sc.particles.length > 320) return;
  for (let i = 0; i < n; i++) {
    let a = Math.random() * TAU;
    if (dirX || dirY) a = Math.atan2(dirY, dirX) + (Math.random() - 0.5) * spread;
    const v = speed * (0.4 + Math.random() * 0.8);
    sc.particles.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      age: 0,
      life: kind === 3 ? 700 + Math.random() * 500 : 320 + Math.random() * 420,
      size: kind === 3 ? 6 + Math.random() * 5 : kind === 1 ? 3 + Math.random() * 3 : kind === 0 ? 3 + Math.random() * 2 : 4 + Math.random() * 3,
      color,
      kind,
      drag: kind === 3 ? 0.96 : kind === 1 ? 0.94 : 0.9,
    });
  }
}

/** Smoke puffs rising from a spot. */
function smoke(sc: Scene, x: number, y: number, n: number) {
  for (let i = 0; i < n; i++) {
    spark(sc, x + (Math.random() - 0.5) * 20, y + (Math.random() - 0.5) * 10, 1, 40, i % 2 ? "#4b4542" : "#6b625e", 3, 1.2, 0, -1);
  }
}

/** Apply the tile changes carried by a frame (always) and fire its effects (if still fresh). */
/** A frame's tile changes and effects, shown at render time `at` (the frame's own time when watching). */
function applyFrame(sc: Scene, f: Frame, d: ArenaData, fresh: boolean, at = f.t) {
  const b = board(sc.R || d.view.R);
  if (f.board !== null) setBoard(sc, f.board, d.view.R, at);
  if (f.c) {
    for (let k = 0; k + 1 < f.c.length; k += 2) {
      const i = f.c[k];
      const stage = f.c[k + 1];
      if (!Number.isInteger(i) || !Number.isInteger(stage) || stage < 0 || stage > GONE) continue;
      const was = sc.tiles[i];
      setStage(sc, i, stage, at, fresh);
      const h = b.tiles[i];
      if (!fresh || !h) continue;
      if (stage === GONE && !d.reduced) {
        spark(sc, h.x, h.y, 4, 120, "#ffb347", 1, TAU);
        smoke(sc, h.x, h.y, 2);
      } else if (stage === 0 && was === GONE) {
        spark(sc, h.x, h.y, 3, 90, "#fde68a", 2, TAU);
      }
    }
  }
  if (!fresh || !f.fx) return;
  const reduced = d.reduced;
  for (const e of f.fx) {
    if (!Array.isArray(e)) continue;
    const type = e[0];
    if (type === FX_HIT) {
      let [, x, y] = e;
      const [, , , j, a, bb] = e;
      if (sc.present) {
        // Already shown when the two met on screen (predict.ts resolves bumps too)?
        const shown = sc.localHit.get(a < bb ? `${a},${bb}` : `${bb},${a}`);
        if (shown !== undefined && Math.abs(at - shown) < 900) continue;
        // Otherwise where they are drawn, if they're close: the bump lines up with the players.
        if (sampleAt(sc, a, at, tmp) && sampleAt(sc, bb, at, tmp2) && Math.hypot(tmp2.x - tmp.x, tmp2.y - tmp.y) < PLAYER_R * 4) {
          x = (tmp.x + tmp2.x) / 2;
          y = (tmp.y + tmp2.y) / 2;
        }
      }
      hitFx(sc, d, x, y, j, a, bb, at);
    } else if (type === FX_FALL) {
      const [, slot, x, y] = e;
      if (slot === d.mySlot && sc.myGone === f.n) continue;
      const hh = sc.present ? sc.hist[slot] : undefined;
      const lastSeen = hh && hh.length ? hh[hh.length - 1] : null;
      fallFx(sc, slot, lastSeen ? lastSeen.x : x, lastSeen ? lastSeen.y : y, at, d);
    } else if (type === FX_PICKUP) {
      const [, slot, k, tile] = e;
      const kind = POWER_KINDS[k] ?? "rebuild";
      const info = POWER_INFO[kind];
      const h = b.tiles[tile];
      const px = sampleAt(sc, slot, at, tmp) ? tmp.x : (h?.x ?? CENTER);
      const py = sampleAt(sc, slot, at, tmp) ? tmp.y : (h?.y ?? CENTER);
      sc.rings.push({ x: px, y: py, t0: at, dur: 520, r0: 20, r1: kind === "rebuild" ? 160 : 90, w: 7, color: info.color });
      sc.pops.push({ slot, x: px, y: py, t0: at, text: `${info.icon} ${info.label.toUpperCase()}!`, color: info.color });
      if (!reduced) spark(sc, px, py, 10, 220, info.color, 2, TAU);
      if (slot === d.mySlot) feedback("score");
      else sfx("pop");
    } else if (type === FX_JUMP) {
      const [, slot] = e;
      if (slot === d.mySlot) continue; // yours showed when you pressed
      if (!reduced && sampleAt(sc, slot, at, tmp)) spark(sc, tmp.x, tmp.y + 8, 5, 70, "#8a7f78", 3, TAU);
    } else if (type === FX_SHOCK) {
      const [, slot] = e;
      if (sampleAt(sc, slot, at, tmp)) {
        sc.rings.push({ x: tmp.x, y: tmp.y, t0: at, dur: 700, r0: 20, r1: 700, w: 14, color: POWER_INFO.shock.color });
        sc.rings.push({ x: tmp.x, y: tmp.y, t0: at + 120, dur: 700, r0: 20, r1: 520, w: 8, color: "#fde68a" });
      }
      for (let s2 = 0; s2 < d.view.ids.length; s2++) {
        if (s2 === slot || !sampleAt(sc, s2, at, tmp)) continue;
        sc.rings.push({ x: tmp.x, y: tmp.y, t0: at + 200, dur: 500, r0: 10, r1: 80, w: 6, color: POWER_INFO.shock.color });
        if (s2 === d.mySlot) {
          sc.shakeAt = at + 200;
          sc.shakeAmp = 0.8;
          buzz("hit");
        }
      }
      sfx("hit");
      sc.shakeAt = Math.max(sc.shakeAt, at);
      sc.shakeAmp = Math.max(sc.shakeAmp, 0.5);
    } else if (type === FX_SINK) {
      const h = b.tiles[e[1]];
      if (h) sc.rings.push({ x: h.x, y: h.y, t0: at, dur: 600, r0: 6, r1: 40, w: 4, color: "#ffd166" });
    }
  }
}

/** A bump between a and bb at (x, y), impulse j, shown at render time `at`. */
function hitFx(sc: Scene, d: ArenaData, x: number, y: number, j: number, a: number, bb: number, at: number) {
  const reduced = d.reduced;
  const hard = clamp01((j - 120) / 500);
  const n = reduced ? 3 : 6 + Math.round(hard * 10);
  spark(sc, x, y, n, 220 + hard * 380, "#fde047", 0, TAU);
  if (!reduced) {
    spark(sc, x, y, 3, 160, d.colors[a] ?? "#fff", 2, TAU);
    spark(sc, x, y, 3, 160, d.colors[bb] ?? "#fff", 2, TAU);
  }
  sc.rings.push({ x, y, t0: at, dur: 360, r0: 8, r1: 40 + hard * 50, w: 5, color: "rgba(255, 240, 200, 0.8)" });
  const mine = a === d.mySlot || bb === d.mySlot;
  const amp = Math.min(1, (j / 600) * (mine ? 1.3 : 0.7));
  if (amp > 0.15 && (at - sc.shakeAt > 120 || amp > sc.shakeAmp)) {
    sc.shakeAt = at;
    sc.shakeAmp = amp;
  }
  if (j > 320) sc.pops.push({ slot: -1, x, y, t0: at, text: j > 480 ? "💥 BONK!" : "💥", color: "#fde047" });
  // Sound for every real bump; a buzz only when it's you (hard = hit, glancing = bump).
  if (mine) feedback(j > 320 ? "hit" : "bump");
  else if (j > 200) sfx("bump");
}

/** A player drops into the lava: sinking ghost, splash, smoke, and a red flash if it's you. */
function fallFx(sc: Scene, slot: number, x: number, y: number, t0: number, d: ArenaData) {
  sc.ghosts.push({ slot, x, y, t0 });
  sc.rings.push({ x, y, t0: t0 + 120, dur: 700, r0: 10, r1: 70, w: 7, color: "#ffd166" });
  sc.rings.push({ x, y, t0: t0 + 300, dur: 700, r0: 6, r1: 46, w: 4, color: "#ff8a3d" });
  if (!d.reduced) {
    spark(sc, x, y, 12, 200, "#ffb347", 1, TAU);
    smoke(sc, x, y, 6);
  }
  if (slot === d.mySlot) {
    sc.hurtAt = t0;
    feedback("out");
  } else sfx("out");
}

function drawRoundedRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function busy(sc: Scene) {
  const last = sc.frames[sc.frames.length - 1];
  return (
    sc.particles.length > 0 ||
    sc.rings.length > 0 ||
    sc.pops.length > 0 ||
    sc.ghosts.length > 0 ||
    !last ||
    sc.rt < last.t + 250 ||
    sc.stick !== null
  );
}

/** Tile draw order: back (top of the screen) to front, so extruded sides overlap correctly. */
const orderCache = new Map<number, number[]>();
function tileOrder(b: Board) {
  let o = orderCache.get(b.R);
  if (!o) {
    o = b.tiles.map((_, i) => i).sort((p, q) => b.tiles[p].y - b.tiles[q].y || b.tiles[p].x - b.tiles[q].x);
    orderCache.set(b.R, o);
  }
  return o;
}

function drawScene(
  g: CanvasRenderingContext2D,
  sc: Scene,
  s: Surface,
  d: ArenaData,
  input: InputState,
  now: number,
  pred: LavaPredictor | null,
) {
  const frames = sc.frames;
  const playT = sc.clock.play(now, sc.frames);
  const wallDt = sc.wall < 0 ? 16 : Math.min(60, Math.max(0, now - sc.wall));
  sc.wall = now;
  sc.perf = now;
  const { W, H, dpr } = s;
  const reduced = d.reduced;
  const phase = d.view.phase;
  const mySlot = d.mySlot;
  const slots = d.view.ids.length;
  const newestFrame = frames[frames.length - 1];

  // A player sees everyone at one moment, the present: when an input pressed now takes effect.
  // All of you are predicted to then (you replayed, the others dead-reckoned, bumps resolved), so a
  // bump on screen is the server's bump. Spectators watch the playback.
  sc.present = !!pred && mySlot >= 0 && sc.clock.ready && !!sc.worldBase && sc.worldBase.n === newestFrame?.n;
  const prevRt = sc.rt;
  const rt = sc.present ? Math.max(prevRt, sc.clock.serverNow(now) + pred!.lead(now)) : playT;
  sc.rt = rt;
  if (sc.present) {
    pred!.decided = phase !== "fight";
    sc.contacts.length = 0;
    pred!.predictWorld(rt, sc.worldBase!, sc.myGone === newestFrame!.n ? -1 : mySlot, sc.world, sc.contacts);
    sc.corr.step(wallDt);
    for (const sp of sc.springs) sp?.step(wallDt);
    for (const c of sc.contacts) {
      if (c.t <= prevRt || c.t > rt || c.j < HIT_FX_MIN) continue;
      const key = c.a < c.b ? `${c.a},${c.b}` : `${c.b},${c.a}`;
      const last = sc.localHit.get(key);
      if (last !== undefined && rt - last < 300) continue;
      sc.localHit.set(key, rt);
      const sa = springOf(sc, c.a);
      const sb = springOf(sc, c.b);
      hitFx(sc, d, c.x + (sa.x + sb.x) / 2, c.y + (sa.y + sb.y) / 2, c.j, c.a, c.b, rt);
    }
  }
  const R = d.view.R;
  const b = board(R);
  if (sc.R !== R || sc.tiles.length !== b.tiles.length) setBoard(sc, d.view.board, R, rt);

  // Apply frames that playback has reached (effects only while fresh).
  for (const f of frames) {
    if (f.t <= sc.cursor) continue;
    if (f.t > rt) break;
    applyFrame(sc, f, d, f.t > rt - (sc.present ? 1_500 : 600), sc.present ? rt : f.t);
    sc.cursor = f.t;
  }
  while (frames.length > 2 && frames[1].t < rt - KEEP_MS) frames.shift();

  const latest = frames[frames.length - 1];
  if (latest && latest.n !== sc.round) {
    sc.round = latest.n;
    sc.roundAt = now;
    sc.ghosts.length = 0;
    sc.pops.length = 0;
    sc.rings.length = 0;
    sc.powerSeen.clear();
    sc.hist.length = 0;
    sc.localHit.clear();
    for (const sp of sc.springs) sp?.reset();
  }

  // ----- your avatar: replayed from its newest snapshot up to where your inputs land -----
  sc.myOn = false;
  const myNewest = latest && mySlot >= 0 ? latest.d[mySlot] : undefined;
  if (pred && myNewest && phase !== "countdown" && pred.base && pred.base.n === latest!.n && sc.myGone !== latest!.n) {
    pred.decided = phase !== "fight";
    const w = sc.present ? sc.world[mySlot] : undefined;
    if (w) {
      // Predicted with everyone else (bumps included) above.
      sc.my.x = w.x;
      sc.my.y = w.y;
      sc.my.vx = w.vx;
      sc.my.vy = w.vy;
      sc.myOn = true;
    } else if (!sc.present && pred.predict(sc.clock.serverNow(now) + pred.lead(now), sc.my)) {
      sc.corr.step(wallDt);
      sc.myOn = true;
    }
  }

  // ----- camera: fit the arena, zooming in a little as the edges crumble -----
  const fightMs = d.view.fightAt ? rt - d.view.fightAt : 0;
  const ring = phase === "fight" && fightMs >= COLLAPSE_START_MS ? Math.max(1, R - Math.floor((fightMs - COLLAPSE_START_MS) / COLLAPSE_EVERY_MS)) : R + 1;
  const wantK = ring > R ? 1 : 1 - (1 - Math.max(0.45, ring / (R + 1))) * 0.6;
  sc.camK += (wantK - sc.camK) * clamp01(wallDt / 500);
  const scale = s.fit / sc.camK;
  let shx = 0;
  let shy = 0;
  const shakeAge = rt - sc.shakeAt;
  if (!reduced && shakeAge >= 0 && shakeAge < 320) {
    const f = sc.shakeAmp * (1 - shakeAge / 320);
    const amp = f * 7 * dpr;
    shx = Math.sin(shakeAge * 0.11) * amp;
    shy = Math.cos(shakeAge * 0.137) * amp;
  }
  const ox = W / 2 + shx;
  const oy = H / 2 + shy;
  const toX = (x: number) => ox + (x - CENTER) * scale;
  const toY = (y: number) => oy + (y - CENTER) * scale;
  const world = () => g.setTransform(scale, 0, 0, scale, ox - CENTER * scale, oy - CENTER * scale);

  // ----- lava -----
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.drawImage(s.bg, 0, 0);
  if (!reduced) {
    // Slow glowing swells.
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 4; i++) {
      const t = now / (5200 + i * 900) + i * 1.7;
      const x = W * (0.5 + 0.38 * Math.sin(t * 1.3 + i));
      const y = H * (0.5 + 0.38 * Math.cos(t + i * 2.1));
      const r = Math.max(W, H) * (0.22 + 0.06 * Math.sin(t * 2));
      g.globalAlpha = 0.22;
      g.drawImage(s.glow, x - r, y - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
  }
  world();
  // Bubbles: grow, then pop into a ring.
  if (!reduced && sc.bubbles.length < 26 && Math.random() < wallDt / 90) {
    const hw = b.halfW + MARGIN * 3;
    const hh = b.halfH + MARGIN * 3;
    sc.bubbles.push({
      x: CENTER + (Math.random() * 2 - 1) * hw,
      y: CENTER + (Math.random() * 2 - 1) * hh,
      t0: now,
      life: 700 + Math.random() * 900,
      r: 4 + Math.random() * 8,
    });
  }
  for (let i = sc.bubbles.length - 1; i >= 0; i--) {
    const bu = sc.bubbles[i];
    const p = (now - bu.t0) / bu.life;
    if (p >= 1) {
      sc.bubbles.splice(i, 1);
      continue;
    }
    if (p < 0.8) {
      const r = bu.r * easeOut(p / 0.8);
      g.globalAlpha = 0.85;
      g.fillStyle = "#ffcf5c";
      g.beginPath();
      g.arc(bu.x, bu.y, r, 0, TAU);
      g.fill();
      g.fillStyle = "#fff3c4";
      g.beginPath();
      g.arc(bu.x - r * 0.3, bu.y - r * 0.3, r * 0.35, 0, TAU);
      g.fill();
    } else {
      const q = (p - 0.8) / 0.2;
      g.globalAlpha = 1 - q;
      g.strokeStyle = "#ffe08a";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(bu.x, bu.y, bu.r * (1 + q * 1.2), 0, TAU);
      g.stroke();
    }
  }
  g.globalAlpha = 1;

  // ----- tiles -----
  const kspr = s.tileK;
  const r = TILE - TILE_GAP;
  const sprW = (2 * r * kspr + 8) / kspr;
  const sprH = (2 * APOTHEM - TILE_GAP * 1.7 + THICK) * kspr + 8;
  const sprTop = (4 + (APOTHEM - TILE_GAP * 0.85) * kspr) / kspr;
  const sprHw = sprH / kspr;
  // The next ring to crumble, and how long until it goes.
  const nextD = Math.min(ring, R + 1) - 1;
  const nextIn = phase === "fight" && nextD >= 0 ? COLLAPSE_START_MS + (R - nextD) * COLLAPSE_EVERY_MS - fightMs : Infinity;
  for (const i of tileOrder(b)) {
    const h = b.tiles[i];
    const stage = sc.tiles[i] ?? 0;
    const age = rt - (sc.tileAt[i] ?? -1e9);
    let k = 1;
    let dy = 0;
    let alpha = 1;
    let spr: HTMLCanvasElement;
    const variant = (h.q * 7 + h.r * 13 + 99) % 3;
    if (stage === GONE) {
      if (age < 0 || age >= TILE_FALL_MS || reduced) continue;
      const p = age / TILE_FALL_MS;
      k = 1 - 0.45 * easeOut(p);
      dy = 14 * p * p;
      alpha = 1 - p;
      spr = s.tiles[variant][3];
    } else {
      spr = s.tiles[variant][stage];
      if (stage === 0 && sc.tileWas[i] === GONE && age >= 0 && age < TILE_RISE_MS && !reduced) {
        const p = age / TILE_RISE_MS;
        k = Math.max(0.3, easeOutBack(p));
        dy = (1 - p) * 10;
        alpha = clamp01(p * 2);
      }
      if (stage === 3 && !reduced) {
        dy += Math.sin(now / 30 + i) * 0.9;
      }
    }
    g.globalAlpha = alpha;
    const w = sprW * k;
    const hh = sprHw * k;
    g.drawImage(spr, h.x - w / 2, h.y + dy - sprTop * k, w, hh);
    // The next ring to crumble glows a warning in the last moments before it goes.
    if (stage === 0 && h.d === nextD && nextIn < 1500 && nextIn > 0) {
      g.globalAlpha = reduced ? 0.35 : 0.25 + 0.25 * Math.sin(now / 70);
      g.fillStyle = "#ff5a1f";
      g.beginPath();
      hexPath(g, h.x, h.y, r);
      g.fill();
    }
  }
  g.globalAlpha = 1;

  // ----- power-ups -----
  const frameA = (() => {
    let i = frames.length - 1;
    while (i > 0 && frames[i].t > rt) i--;
    return frames[i];
  })();
  if (frameA && phase === "fight") {
    for (const [kindIdx, tile] of frameA.u) {
      const h = b.tiles[tile];
      if (!h || sc.tiles[tile] === GONE) continue;
      const kind = POWER_KINDS[kindIdx] ?? "rebuild";
      const info = POWER_INFO[kind];
      const key = tile * 8 + kindIdx;
      if (!sc.powerSeen.has(key)) sc.powerSeen.set(key, rt);
      const grow = reduced ? 1 : easeOutBack(clamp01((rt - (sc.powerSeen.get(key) ?? rt)) / 450));
      const bob = reduced ? 0 : Math.sin(now / 260 + tile) * 3;
      const pr = 17 * grow;
      if (pr < 0.5) continue;
      g.globalAlpha = 0.9;
      g.drawImage(s.glow, h.x - pr * 2.4, h.y - pr * 2.4 + bob, pr * 4.8, pr * 4.8);
      g.globalAlpha = 1;
      g.beginPath();
      g.arc(h.x, h.y - 4 + bob, pr, 0, TAU);
      g.fillStyle = "rgba(14, 12, 29, 0.82)";
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = info.color;
      g.stroke();
      if (!reduced) {
        const ringP = (now % 1200) / 1200;
        g.globalAlpha = 0.7 * (1 - ringP);
        g.beginPath();
        g.arc(h.x, h.y - 4 + bob, pr * (1 + ringP * 0.8), 0, TAU);
        g.stroke();
        g.globalAlpha = 1;
      }
      g.font = `${Math.round(20 * grow)}px ${EMOJI_FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(info.icon, h.x, h.y - 3 + bob);
    }
  }

  // ----- falling players: shrink, sink, smoke -----
  for (let i = sc.ghosts.length - 1; i >= 0; i--) {
    const gh = sc.ghosts[i];
    const age = rt - gh.t0;
    if (age > FALL_MS) {
      sc.ghosts.splice(i, 1);
      continue;
    }
    if (age < 0) continue;
    const p = age / FALL_MS;
    const k = Math.max(0.05, 1 - easeOut(p) * 0.85);
    const rr = PLAYER_R * k;
    const spr = avatarSprite(d.colors[gh.slot] ?? "#94a3b8", d.avatars[gh.slot] ?? "🙂");
    const sz = rr * ((SPR + SPR_PAD) / SPR);
    g.save();
    g.globalAlpha = clamp01(1.2 - p * 1.2);
    g.translate(gh.x, gh.y + p * 10);
    if (!reduced) g.rotate(Math.sin(p * 9) * 0.4);
    g.drawImage(spr, -sz, -sz, sz * 2, sz * 2);
    g.globalAlpha = clamp01(p * 1.1);
    g.beginPath();
    g.arc(0, 0, rr, 0, TAU);
    g.fillStyle = "#ff6a1f";
    g.fill();
    g.restore();
    if (!reduced && Math.random() < wallDt / 90 && p < 0.8) smoke(sc, gh.x, gh.y, 1);
  }

  // ----- players -----
  const crowned = (slot: number) => {
    const id = d.view.ids[slot];
    if (phase === "final") return !!d.view.champions?.includes(id);
    return phase === "roundOver" && d.view.lastWinner === id;
  };
  const spawn = reduced ? 1 : clamp01((now - sc.roundAt) / 450);
  for (let slot = 0; slot < slots; slot++) {
    sc.sx[slot] = NaN;
    sc.wx[slot] = NaN;
  }
  type Draw = { slot: number; x: number; y: number; vx: number; vy: number; flags: number; jp: number; cd: number; cdAt: number };
  const draws: Draw[] = [];
  for (let slot = 0; slot < slots; slot++) {
    if (slot === mySlot && latest && sc.myGone === latest.n) continue;
    if (slot === mySlot && sc.myOn && myNewest) {
      const x = sc.my.x + sc.corr.x;
      const y = sc.my.y + sc.corr.y;
      const jp = pred && Number.isFinite(pred.jumpT) ? (sc.clock.serverNow(now) + pred.lead(now) - pred.jumpT) / JUMP_MS : -1;
      draws.push({ slot, x, y, vx: sc.my.vx, vy: sc.my.vy, flags: myNewest[5], jp: jp >= 0 && jp < 1 ? jp : -1, cd: myNewest[6], cdAt: latest!.t });
      continue;
    }
    if (!sampleAt(sc, slot, rt, tmp)) continue;
    draws.push({ slot, x: tmp.x, y: tmp.y, vx: tmp.vx, vy: tmp.vy, flags: tmp.flags, jp: jumpPhase(tmp.cd, tmp.cdAt, rt), cd: tmp.cd, cdAt: tmp.cdAt });
  }
  // Where everyone was drawn (render time), for effects and falls in the present.
  if (sc.present) {
    for (const dr of draws) {
      const h = (sc.hist[dr.slot] ??= []);
      if (h.length && h[h.length - 1].t >= rt) h.pop();
      h.push({ t: rt, x: dr.x, y: dr.y, vx: dr.vx, vy: dr.vy });
      while (h.length > 2 && h[0].t < rt - 500) h.shift();
    }
  }
  {
    // ?debug=1: you and the first other player as drawn, and the render clock.
    const mine = draws.find((x) => x.slot === mySlot);
    const other = draws.find((x) => x.slot !== mySlot);
    debugFrame("lava", { t: now, x: mine?.x ?? NaN, y: mine?.y ?? NaN, ox: other?.x ?? NaN, oy: other?.y ?? NaN, rt, present: sc.present ? 1 : 0 });
  }
  // Airborne players draw last (they're above everyone); otherwise back to front.
  draws.sort((p, q) => (p.jp >= 0 ? 1 : 0) - (q.jp >= 0 ? 1 : 0) || p.y - q.y);

  // Your jump shows the moment you press it.
  if (pred && pred.jumps !== sc.jumpSeen) {
    sc.jumpSeen = pred.jumps;
    const mine = draws.find((x) => x.slot === mySlot);
    if (mine && phase === "fight" && !reduced) spark(sc, mine.x, mine.y + 8, 6, 80, "#8a7f78", 3, TAU);
  }

  let myJumpLeft = -1;
  for (const dr of draws) {
    const { slot, x, y } = dr;
    const isMe = slot === mySlot;
    const color = d.colors[slot] ?? "#94a3b8";
    const floating = (dr.flags & F_FLOAT) !== 0;
    const low = (dr.flags & F_FLOAT_LOW) !== 0;
    const offline = (dr.flags & F_OFFLINE) !== 0;
    const grow = spawn < 1 ? Math.max(0.05, easeOutBack(spawn)) : 1;
    let lift = 0;
    if (dr.jp >= 0) lift = Math.sin(dr.jp * Math.PI) * JUMP_HEIGHT;
    if (floating) lift = Math.max(lift, 12 + (reduced ? 0 : Math.sin(now / 180 + slot) * 3));
    const Rd = PLAYER_R * grow * (1 + lift / 110);
    sc.wx[slot] = x;
    sc.wy[slot] = y;

    // Shadow on the floor (shrinks as you rise).
    const shK = 1 - lift / 70;
    g.globalAlpha = offline ? 0.4 : 0.8 * shK;
    g.drawImage(s.shadow, x - PLAYER_R * 1.3 * shK, y - PLAYER_R * 0.9 * shK + 6, PLAYER_R * 2.6 * shK, PLAYER_R * 1.8 * shK);
    g.globalAlpha = 1;

    // Your tile is crumbling: a hot pulsing ring at your feet.
    if (isMe && phase === "fight" && !floating && dr.jp < 0) {
      const ti = tileAt(b, x, y);
      if (ti !== sc.myTile) {
        sc.myTile = ti;
        sc.myTileAt = now;
      }
      const st = ti >= 0 ? sc.tiles[ti] : GONE;
      if (st >= 1 && st < GONE) {
        g.globalAlpha = 0.55 + 0.35 * Math.sin(now / 60);
        g.strokeStyle = "#ff4d1a";
        g.lineWidth = 3;
        g.beginPath();
        g.ellipse(x, y + 4, PLAYER_R * 1.5, PLAYER_R * 1.05, 0, 0, TAU);
        g.stroke();
        g.globalAlpha = 1;
      } else if (ti >= 0 && now - sc.myTileAt > 350) {
        // No-camping meter: fills while you stand still on one tile.
        const p = clamp01((now - sc.myTileAt) / CAMP_MS);
        g.globalAlpha = 0.85;
        g.strokeStyle = p > 0.7 ? "#ff8a3d" : "rgba(255, 255, 255, 0.65)";
        g.lineWidth = 2.5;
        g.beginPath();
        g.ellipse(x, y + 4, PLAYER_R * 1.45, PLAYER_R, 0, -Math.PI / 2, -Math.PI / 2 + TAU * p);
        g.stroke();
        g.globalAlpha = 1;
      }
    } else if (isMe) {
      sc.myTile = -1;
      sc.myTileAt = now;
    }

    const by = y - lift;
    if (crowned(slot)) {
      g.globalAlpha = 0.55 + (reduced ? 0 : 0.2 * Math.sin(now / 200));
      g.drawImage(s.glow, x - Rd * 2.2, by - Rd * 2.2, Rd * 4.4, Rd * 4.4);
      g.globalAlpha = 1;
    }
    // Float: wings and a cool halo (blinking when it's about to run out).
    if (floating) {
      const blink = low && !reduced ? (Math.floor(now / 110) % 2 === 0 ? 0.35 : 1) : 1;
      g.globalAlpha = 0.35 * blink;
      g.fillStyle = POWER_INFO.float.color;
      g.beginPath();
      g.ellipse(x, by, Rd * 1.7, Rd * 1.35, 0, 0, TAU);
      g.fill();
      g.globalAlpha = 0.9 * blink;
      g.strokeStyle = "#e0f2fe";
      g.lineWidth = 2;
      g.stroke();
      g.globalAlpha = blink;
      const flap = reduced ? 0 : Math.sin(now / 80) * 0.25;
      const ws = Math.round(Rd * 1.7);
      g.font = `${ws}px ${EMOJI_FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.save();
      g.translate(x - Rd * 1.25, by - Rd * 0.25);
      g.rotate(-0.3 - flap);
      g.scale(-1, 1);
      g.fillText("🪽", 0, 0);
      g.restore();
      g.save();
      g.translate(x + Rd * 1.25, by - Rd * 0.25);
      g.rotate(0.3 + flap);
      g.fillText("🪽", 0, 0);
      g.restore();
      g.globalAlpha = 1;
    }
    const spr = avatarSprite(color, d.avatars[slot] ?? "🙂");
    const sz = Rd * ((SPR + SPR_PAD) / SPR);
    g.save();
    g.translate(x, by);
    if (!reduced && dr.jp < 0 && !floating) {
      // A little waddle while running.
      const sp = Math.hypot(dr.vx, dr.vy);
      if (sp > 40) g.rotate(Math.sin(now / 70 + slot) * Math.min(0.14, sp / 1500));
    }
    if (offline) g.globalAlpha = 0.55;
    g.drawImage(spr, -sz, -sz, sz * 2, sz * 2);
    g.restore();

    if (isMe) {
      g.strokeStyle = "#ffffff";
      g.lineWidth = 2.5;
      g.globalAlpha = 0.95;
      g.beginPath();
      g.arc(x, by, Rd + 4, 0, TAU);
      g.stroke();
      g.globalAlpha = 1;
      if (d.steerable && phase !== "final") {
        const m = Math.hypot(input.x, input.y);
        if (m > 0.1) {
          const ux = input.x / m;
          const uy = input.y / m;
          const base = Rd + 8;
          const tip = base + 7 + 7 * Math.min(1, m);
          g.fillStyle = "#ffffff";
          g.beginPath();
          g.moveTo(x + ux * tip, by + uy * tip);
          g.lineTo(x + ux * base - uy * 6, by + uy * base + ux * 6);
          g.lineTo(x + ux * base + uy * 6, by + uy * base - ux * 6);
          g.closePath();
          g.fill();
        }
      }
      const left = pred ? pred.jumpLeft(now) : 0;
      myJumpLeft = left;
      if (left > 0 && phase === "fight") {
        g.strokeStyle = d.accent;
        g.lineWidth = 3;
        g.globalAlpha = 0.9;
        g.beginPath();
        g.arc(x, by, Rd + 8, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - Math.min(1, left / JUMP_CD_MS)));
        g.stroke();
        g.globalAlpha = 1;
      }
    }
    sc.sx[slot] = toX(x);
    sc.sy[slot] = toY(by);
    sc.sr[slot] = Rd * scale;
  }
  if (mySlot >= 0 && !draws.some((x) => x.slot === mySlot)) myJumpLeft = -1;

  // ----- effects -----
  world();
  if (sc.rings.length) {
    for (let i = sc.rings.length - 1; i >= 0; i--) {
      const rg = sc.rings[i];
      const p = (rt - rg.t0) / rg.dur;
      if (p >= 1) {
        sc.rings.splice(i, 1);
        continue;
      }
      if (p < 0) continue;
      g.globalAlpha = (1 - p) * 0.9;
      g.strokeStyle = rg.color;
      g.lineWidth = rg.w * (1 - p * 0.7);
      g.beginPath();
      g.arc(rg.x, rg.y, rg.r0 + (rg.r1 - rg.r0) * easeOut(p), 0, TAU);
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  // Embers drifting up off the lava now and then.
  if (!reduced && sc.particles.length < 200 && Math.random() < wallDt / 120) {
    spark(sc, CENTER + (Math.random() * 2 - 1) * b.halfW, CENTER + (Math.random() * 2 - 1) * b.halfH, 1, 30, "#ffb347", 1, 0.8, 0, -1);
  }
  if (sc.particles.length) {
    const dt = wallDt / 1000;
    g.lineCap = "round";
    for (let i = sc.particles.length - 1; i >= 0; i--) {
      const q = sc.particles[i];
      q.age += wallDt;
      if (q.age >= q.life) {
        sc.particles.splice(i, 1);
        continue;
      }
      const drag = Math.pow(q.drag, wallDt / 16.7);
      q.vx *= drag;
      q.vy *= drag;
      if (q.kind === 3) q.vy -= 30 * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      const a = 1 - q.age / q.life;
      if (q.kind === 0) {
        g.globalAlpha = a;
        g.strokeStyle = q.color;
        g.lineWidth = q.size;
        g.beginPath();
        g.moveTo(q.x, q.y);
        g.lineTo(q.x - q.vx * 0.04, q.y - q.vy * 0.04);
        g.stroke();
      } else if (q.kind === 1) {
        g.globalAlpha = a;
        g.fillStyle = q.color;
        const z = q.size * (0.4 + a * 0.6);
        g.fillRect(q.x - z / 2, q.y - z / 2, z, z);
      } else if (q.kind === 3) {
        g.globalAlpha = a * 0.5;
        g.fillStyle = q.color;
        g.beginPath();
        g.arc(q.x, q.y, q.size * (1 + (1 - a) * 1.6), 0, TAU);
        g.fill();
      } else {
        g.globalAlpha = a;
        g.fillStyle = q.color;
        g.beginPath();
        g.arc(q.x, q.y, q.size * (0.35 + 0.65 * a), 0, TAU);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  }

  // ----- screen space: heat shimmer, labels, pops, stick, hurt -----
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (!reduced) {
    for (let i = 0; i < 3; i++) {
      const p = ((now / 4200 + i / 3) % 1 + 1) % 1;
      const y = H * (1.1 - p * 1.3);
      const grad = g.createLinearGradient(0, y - H * 0.06, 0, y + H * 0.06);
      grad.addColorStop(0, "rgba(255, 170, 80, 0)");
      grad.addColorStop(0.5, `rgba(255, 170, 80, ${0.05 * Math.sin(p * Math.PI)})`);
      grad.addColorStop(1, "rgba(255, 170, 80, 0)");
      g.fillStyle = grad;
      g.fillRect(0, y - H * 0.06, W, H * 0.12);
    }
  }
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  const cssW = W / dpr;
  const intro = phase === "countdown" || (phase === "fight" && fightMs < 2200);
  const labelPx = Math.round(Math.max(10, Math.min(13, cssW / 34)) * dpr);
  g.font = `700 ${labelPx}px ${SANS}`;
  for (const dr of draws) {
    const slot = dr.slot;
    const x = sc.sx[slot];
    if (Number.isNaN(x)) continue;
    const y = sc.sy[slot];
    const rr = sc.sr[slot];
    const isMe = slot === mySlot;
    if (isMe && intro) {
      const bob = reduced ? 0 : Math.sin(now / 200) * 2 * dpr;
      const font = Math.round(Math.max(10, Math.min(13, cssW / 36)) * dpr);
      g.font = `800 ${font}px ${SANS}`;
      const tw = g.measureText("YOU").width + font * 0.9;
      const th = font * 1.5;
      const top = y - rr - th - 9 * dpr + bob;
      g.fillStyle = "#ffffff";
      drawRoundedRect(g, x - tw / 2, top, tw, th, th / 2);
      g.fill();
      g.beginPath();
      g.moveTo(x - 5 * dpr, top + th - 1);
      g.lineTo(x + 5 * dpr, top + th - 1);
      g.lineTo(x, top + th + 5 * dpr);
      g.fill();
      g.fillStyle = "#1c0f0a";
      g.fillText("YOU", x, top + th / 2 + 1);
      g.font = `700 ${labelPx}px ${SANS}`;
    }
    const name = (d.names[slot] ?? "").slice(0, 10);
    if (name) {
      const ly = y + rr + labelPx * 0.9;
      g.strokeStyle = "rgba(28, 8, 4, 0.9)";
      g.lineWidth = Math.max(2, labelPx * 0.32);
      g.strokeText(name, x, ly);
      g.fillStyle = isMe ? "#ffffff" : (d.colors[slot] ?? "#ffffff");
      g.fillText(name, x, ly);
    }
    if (crowned(slot)) {
      const cs = Math.round(Math.max(14 * dpr, rr * 1.1));
      g.font = `${cs}px ${EMOJI_FONT}`;
      const lift = reduced ? 0 : Math.sin(now / 240) * 2 * dpr;
      g.fillText("👑", x, y - rr - cs * 0.55 + lift);
      g.font = `700 ${labelPx}px ${SANS}`;
    }
    if (dr.flags & F_OFFLINE) {
      const bs = Math.round(Math.max(12 * dpr, rr * 0.8));
      g.font = `${bs}px ${EMOJI_FONT}`;
      g.fillText("💤", x + rr, y - rr);
      g.font = `700 ${labelPx}px ${SANS}`;
    }
  }

  for (let i = sc.pops.length - 1; i >= 0; i--) {
    const pp = sc.pops[i];
    const age = rt - pp.t0;
    if (age > 1100) {
      sc.pops.splice(i, 1);
      continue;
    }
    if (age < 0) continue;
    const p = age / 1100;
    let x = toX(pp.x);
    let y = toY(pp.y);
    if (pp.slot >= 0 && !Number.isNaN(sc.sx[pp.slot])) {
      x = sc.sx[pp.slot];
      y = sc.sy[pp.slot] - (sc.sr[pp.slot] ?? 0);
    }
    const size = Math.round((cssW < 420 ? 15 : 18) * dpr);
    const pop = reduced ? 1 : p < 0.15 ? 0.6 + (p / 0.15) * 0.55 : p < 0.25 ? 1.15 - ((p - 0.15) / 0.1) * 0.15 : 1;
    g.save();
    g.globalAlpha = 1 - p * p;
    // Keep the text on screen near the edges.
    g.font = `900 ${size}px ${SANS}`;
    const half = g.measureText(pp.text).width / 2 + 6 * dpr;
    x = Math.min(W - half, Math.max(half, x));
    g.translate(x, Math.max(size, y - (reduced ? 18 : 12 + 34 * easeOut(p)) * dpr));
    g.scale(pop, pop);
    g.strokeStyle = "rgba(28, 8, 4, 0.92)";
    g.lineWidth = Math.max(2, size * 0.22);
    g.strokeText(pp.text, 0, 0);
    g.fillStyle = pp.color;
    g.fillText(pp.text, 0, 0);
    g.restore();
  }

  if (sc.coarse && d.steerable && phase === "countdown") {
    g.globalAlpha = 0.9;
    g.font = `800 ${Math.round(11 * dpr)}px ${SANS}`;
    g.fillStyle = "rgba(28, 8, 4, 0.6)";
    drawRoundedRect(g, 8 * dpr, H - 30 * dpr, W / 2 - 16 * dpr, 22 * dpr, 11 * dpr);
    g.fill();
    drawRoundedRect(g, W / 2 + 8 * dpr, H - 30 * dpr, W / 2 - 16 * dpr, 22 * dpr, 11 * dpr);
    g.fill();
    g.fillStyle = "#ffffff";
    g.fillText("🕹️ hold & drag to run", W / 4, H - 19 * dpr);
    g.fillText("👆 tap to jump", (W * 3) / 4, H - 19 * dpr);
    g.globalAlpha = 1;
  }
  const st = sc.stick;
  if (st) {
    const SR = stickRadius(cssW) * dpr;
    const x0 = st.ox * dpr;
    const y0 = st.oy * dpr;
    g.globalAlpha = 0.9;
    g.fillStyle = "rgba(255, 255, 255, 0.14)";
    g.strokeStyle = "rgba(255, 255, 255, 0.55)";
    g.lineWidth = 2 * dpr;
    g.beginPath();
    g.arc(x0, y0, SR, 0, TAU);
    g.fill();
    g.stroke();
    let kx = (st.kx - st.ox) * dpr;
    let ky = (st.ky - st.oy) * dpr;
    const m = Math.hypot(kx, ky);
    if (m > SR) {
      kx = (kx / m) * SR;
      ky = (ky / m) * SR;
    }
    g.fillStyle = d.accent;
    g.beginPath();
    g.arc(x0 + kx, y0 + ky, SR * 0.45, 0, TAU);
    g.fill();
    g.strokeStyle = "rgba(255, 255, 255, 0.9)";
    g.stroke();
    g.globalAlpha = 1;
  }
  const tapAge = now - sc.tapAt;
  if (tapAge >= 0 && tapAge < 350) {
    g.globalAlpha = 1 - tapAge / 350;
    g.strokeStyle = d.accent;
    g.lineWidth = 3 * dpr;
    g.beginPath();
    g.arc(sc.tapX * dpr, sc.tapY * dpr, (18 + tapAge / 8) * dpr, 0, TAU);
    g.stroke();
    g.globalAlpha = 1;
  }
  const hurt = rt - sc.hurtAt;
  if (hurt >= 0 && hurt < 800) {
    g.globalAlpha = (1 - hurt / 800) * (reduced ? 0.6 : 1);
    g.drawImage(s.hurt, 0, 0, W, H);
    g.globalAlpha = 1;
  }
  return { myJumpLeft };
}

const stickRadius = (cssW: number) => Math.max(34, Math.min(56, cssW * 0.12));

// ---------- component ----------

export function Arena({
  data,
  input,
  pred,
  onEvent,
  onStick,
  onJump,
  controls,
  label,
  ringColor,
  children,
}: {
  data: ArenaData;
  input: RefObject<InputState>;
  pred: LavaPredictor | null;
  onEvent: (fn: (e: unknown) => void) => () => void;
  onStick: (x: number, y: number) => void;
  onJump: () => void;
  controls: { enabled: boolean; presses: number; hint: ReactNode } | null;
  label: string;
  ringColor: string;
  children?: ReactNode;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const meterRef = useRef<HTMLButtonElement>(null);
  const scene = useRef<Scene>(newScene());
  const surface = useRef<Surface | null>(null);
  const { view } = data;
  const R = view.R;

  const onSnap = useEffectEvent((snap: Snap, boardStr: string | null) => {
    const mine = pred && data.mySlot >= 0 ? { pred, slot: data.mySlot, data } : undefined;
    pushFrame(scene.current, snap, performance.now(), data.view.R, boardStr, mine);
  });
  useEffect(() => {
    if (view.snap && typeof view.snap === "object") onSnap(view.snap, typeof view.board === "string" ? view.board : null);
  }, [view]);
  useEffect(
    () =>
      onEvent((e) => {
        const s = e as Snap | null;
        if (s && typeof s === "object" && s.k === "s" && typeof s.t === "number" && Array.isArray(s.p)) onSnap(s, null);
      }),
    [onEvent],
  );
  useEffect(() => pred?.attachClock(scene.current.clock), [pred]);

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
      if (cur && cur.W === W && cur.H === H && cur.dpr === dpr) return;
      canvas.width = W;
      canvas.height = H;
      const b = board(R);
      const fitK = Math.min(W / (2 * (b.halfW + MARGIN)), H / (2 * (b.halfH + MARGIN)));
      // Tile sprites at the most zoomed-in scale, so they stay crisp when the camera closes in.
      const tileK = Math.min(4, fitK / 0.73);
      surface.current = {
        W,
        H,
        dpr,
        fit: fitK,
        bg: renderBackground(W, H),
        hurt: renderHurt(),
        shadow: cur?.shadow ?? renderShadow(),
        glow: cur?.glow ?? renderGlow(),
        tiles: [0, 1, 2].map((v) => [0, 1, 2, 3].map((st) => renderTile(tileK, v, st))),
        tileK,
      };
      scene.current.stillKey = "";
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(holder);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [R]);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const set = () => {
      scene.current.coarse = mq.matches;
    };
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);

  const paint = useEffectEvent((now: number) => {
    const canvas = canvasRef.current;
    const s = surface.current;
    const sc = scene.current;
    if (!canvas || !s || !sc.frames.length) return;
    if (data.view.phase === "final" && !busy(sc)) {
      const key = `${s.W}x${s.H}|${data.reduced}|${data.view.snap.t}`;
      if (sc.stillKey === key) return;
      sc.stillKey = key;
    } else {
      sc.stillKey = "";
    }
    const g = canvas.getContext("2d");
    if (!g) return;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    const me = drawScene(g, sc, s, data, input.current ?? { x: 0, y: 0 }, now, pred);
    const meter = meterRef.current;
    if (meter) {
      const left = Math.max(0, me.myJumpLeft);
      const frac = Math.min(1, left / JUMP_CD_MS);
      const v = frac.toFixed(3);
      if (meter.style.getPropertyValue("--lava-cd") !== v) meter.style.setProperty("--lava-cd", v);
      const ready = left <= 0 && me.myJumpLeft >= 0 ? "1" : "0";
      if (meter.getAttribute("data-ready") !== ready) meter.setAttribute("data-ready", ready);
    }
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
        scene.current.clock.at = -1;
        scene.current.wall = -1;
        raf = requestAnimationFrame(loop);
      }
    };
    raf = requestAnimationFrame(loop);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // ----- touch stick (left half) & tap-to-jump (right half); a mouse drags the stick anywhere -----
  const stickTo = (st: Stick, w: number) => {
    const SR = stickRadius(w);
    let x = (st.kx - st.ox) / SR;
    let y = (st.ky - st.oy) / SR;
    const m = Math.hypot(x, y);
    if (m < 0.12) return onStick(0, 0);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    onStick(x, y);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!data.steerable || (e.pointerType === "mouse" && e.button !== 0)) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const sc = scene.current;
    if (e.pointerType !== "mouse" && x > r.width / 2) {
      sc.tapAt = performance.now();
      sc.tapX = x;
      sc.tapY = y;
      onJump();
      return;
    }
    if (sc.stick) return;
    sc.stick = { id: e.pointerId, ox: x, oy: y, kx: x, ky: y };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured; the stick still works.
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const st = scene.current.stick;
    if (!st || st.id !== e.pointerId) return;
    const r = e.currentTarget.getBoundingClientRect();
    st.kx = e.clientX - r.left;
    st.ky = e.clientY - r.top;
    stickTo(st, r.width);
  };
  const release = (e: PointerEvent<HTMLDivElement>) => {
    const st = scene.current.stick;
    if (!st || st.id !== e.pointerId) return;
    scene.current.stick = null;
    onStick(0, 0);
  };

  const aspect = arenaAspect(R);
  return (
    <>
      <div
        ref={holderRef}
        className="relative mx-auto w-full overflow-hidden rounded-2xl ring-2 transition-[box-shadow] duration-300 select-none"
        style={{
          aspectRatio: String(aspect),
          maxWidth: `min(100%, ${(64 * aspect).toFixed(1)}vh)`,
          background: "#7a1405",
          touchAction: data.steerable ? "none" : "auto",
          ["--tw-ring-color" as string]: ringColor,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
      >
        <canvas ref={canvasRef} role="img" aria-label={label} className="absolute inset-0 h-full w-full" />
        {children}
      </div>
      {controls && (
        <div className="flex items-center gap-3">
          <button
            ref={meterRef}
            type="button"
            aria-label="Jump"
            aria-keyshortcuts="Space Shift"
            disabled={!controls.enabled}
            className="lava-jump btn h-16 w-40 shrink-0 touch-none rounded-2xl text-lg font-black tracking-wide shadow-lg shadow-black/30 select-none @md:w-48"
            style={{
              ["--lava-accent" as string]: data.accent,
              borderColor: controls.enabled ? data.accent + "aa" : undefined,
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              onJump();
            }}
            onClick={(e) => {
              if (e.detail === 0) onJump();
            }}
          >
            <span className="lava-jump-fill" aria-hidden />
            <span key={controls.presses} className={controls.presses ? "animate-pop" : ""} aria-hidden>
              🦘
            </span>
            JUMP
          </button>
          <p className="min-w-0 flex-1 text-xs text-muted">{controls.hint}</p>
        </div>
      )}
    </>
  );
}

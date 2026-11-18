"use client";

// Canvas renderer, playback buffer and touch stick for Ice Sumo.
//
// The server sends a physics frame every 50ms. Drawing frames as they land would stutter,
// so the renderer keeps a short buffer and draws the world a little in the past, blending
// the two frames around that moment with a cubic Hermite curve (positions + velocities),
// so discs glide on smooth curves at display refresh rate. The playback clock maps the
// frames' server timestamps onto performance.now(): it follows the fastest deliveries
// and slews gently, so network jitter never shows up as a jerk. How far in the past adapts
// to the measured jitter (up to 650 ms on a bursty Wi-Fi link; see snakes/netsmooth.ts). If frames run late it extrapolates
// for a moment. Effects (sparks, falls, dashes) ride in the frames and fire when playback
// reaches them, so they line up exactly with the motion.
//
// Your own disc is the exception: predict.ts replays your inputs on top of its newest
// snapshot, so it moves on the very frame you steer or dash. Server corrections (a hit you
// didn't see coming) are blended out over ~120ms, it never sinks into another disc as drawn,
// and your own dashes and falls show the moment they happen for you.

import { useEffect, useEffectEvent, useRef, type PointerEvent, type ReactNode, type RefObject } from "react";
import type { SumoView } from "./server";
import type { Kin } from "./physics";
import type { PredictedContact, SumoPredictor, World, WorldDisc } from "./predict";
import {
  CENTER,
  DASH_CD_MS,
  DISC_R,
  F_DASH,
  F_HEAVY,
  F_OFFLINE,
  F_TURBO,
  FX_DASH,
  FX_FALL,
  FX_HIT,
  FX_MELT,
  FX_PICKUP,
  HEAVY_SCALE,
  POWER_INFO,
  POWER_KINDS,
  RINK_MIN,
  RINK_R,
  SHRINK_END_MS,
  SHRINK_START_MS,
  TICK_MS,
  TURBO_CD_MS,
  type DiscTuple,
  type FxTuple,
  type Snap,
  decodeStick,
  rinkRadius,
  HIT_FX_MIN,
} from "./shared";
import { Spring2D, Timeline, debugFrame } from "../snakes/netsmooth";
import { avatarImage, drawAvatar } from "@/lib/avatar-art";
import { isAvatarId } from "@/shared/types";
import { feedback, sfx } from "@/lib/feedback";

const TAU = Math.PI * 2;
/** Playback starts this far behind the newest frame the network could have delivered (then adapts). */
const DELAY_MS = 100;
/** Your disc: server corrections fade out like a critically damped spring with this time constant (ms; ~95% gone in 5x)... */
export const CORR_MS = 100;
/** Other discs: their corrections are bigger (dead reckoning), so they fade a little slower. */
export const OTHERS_CORR_MS = 140;
/** ...unless they're this big (units): then it just jumps. */
export const CORR_SNAP = 160;
/** Late frames: keep sliding along the last known velocity for at most this long. */
const EXTRAP_MS = 150;
const TRAIL_MS = 150;
const TRAIL_STEPS = 7;
/** Frames older than this (behind playback) are dropped. */
const KEEP_MS = 400;
const MAX_FRAMES = 120;
const FALL_MS = 900;
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const SANS = "ui-sans-serif, system-ui, sans-serif";
/** Sprite resolution: disc radius in sprite pixels. */
const SPR = 72;
const SPR_PAD = 10;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeOutBack = (t: number) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);

// ---------- frames & clock ----------

/** A disc tuple with the trailing zeros put back (the stick: -1 when centred / not sent). */
type Full = [number, number, number, number, number, number, number, number];

interface Frame {
  n: number;
  t: number;
  r: number;
  /** Disc tuple per slot (undefined = not on the ice). */
  d: (Full | undefined)[];
  u: Snap["u"];
  fx: FxTuple[] | null;
  /** Input acknowledgements carried by the snapshot (see Snap.a). */
  fxAcks?: [number, number, number, number?][];
}

function toFrame(s: Snap): Frame {
  const d: (Full | undefined)[] = [];
  for (const p of s.p as DiscTuple[]) {
    if (Array.isArray(p) && p.length >= 5 && p[0] >= 0 && p[0] < 16) d[p[0]] = [p[0], p[1], p[2], p[3], p[4], p[5] ?? 0, p[6] ?? 0, p[7] ?? -1];
  }
  return {
    n: s.n,
    t: s.t,
    r: typeof s.r === "number" ? s.r : RINK_R,
    d,
    u: s.u ?? 0,
    fx: Array.isArray(s.fx) ? s.fx : null,
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
  /** 0 spark streak, 1 ice chip, 2 round blob. */
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

/** A comic-book impact star at the point of contact. */
interface Flash {
  x: number;
  y: number;
  t0: number;
  size: number;
  rot: number;
}

interface Pop {
  slot: number;
  x: number;
  y: number;
  t0: number;
  text: string;
  color: string;
  big: boolean;
}

interface Ghost {
  slot: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t0: number;
}

interface Squash {
  t0: number;
  nx: number;
  ny: number;
  amt: number;
}

export interface InputState {
  /** Current stick/keys direction, magnitude <= 1 (drawn on your disc right away). */
  x: number;
  y: number;
}

interface Stick {
  id: number;
  /** Origin and knob in CSS pixels, relative to the canvas. */
  ox: number;
  oy: number;
  kx: number;
  ky: number;
  at: number;
}

interface Scene {
  clock: Clock;
  frames: Frame[];
  fxCursor: number;
  /** Render time (server ms) of the last drawn frame. */
  rt: number;
  round: number;
  roundAt: number;
  particles: Particle[];
  rings: Ring[];
  flashes: Flash[];
  pops: Pop[];
  ghosts: Ghost[];
  squash: (Squash | undefined)[];
  dashAt: number[];
  dashDir: [number, number][];
  heavyAt: number[];
  turboAt: number[];
  shakeAt: number;
  shakeAmp: number;
  hurtAt: number;
  /** Disc radius as drawn (eases when Heavy kicks in or wears off). */
  radius: number[];
  camR: number;
  lastR: number;
  powerKey: string;
  powerAt: number;
  /** Screen position of each disc this frame (device px), for labels. */
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
  /** performance.now() of the frame being drawn. */
  perf: number;
  /** Your disc: predicted this frame (world units), the correction still fading out, where it was drawn. */
  my: Kin;
  myOn: boolean;
  /** Your leftover correction, fading out like a critically damped spring (no twitch). */
  corr: Spring2D;
  myX: number;
  myY: number;
  /** Where your disc was drawn lately (for its trail). */
  myTrail: { at: number; x: number; y: number }[];
  /** Round in which your fall was already shown (as soon as the server reported it). */
  myGone: number;
  /** Local dashes already given their instant effect, and when the last one was shown (performance.now()). */
  dashSeen: number;
  myDashAt: number;
  /** Other discs as drawn this frame (world units), so yours never sinks into one. */
  wx: number[];
  wy: number[];
  wr: number[];
  /**
   * A player sees everything at one moment, the present (`rt` = your clock + lead): the whole rink
   * predicted from the newest snapshot (predict.ts), contacts included. Spectators watch the
   * smooth past playback instead.
   */
  present: boolean;
  mySlot: number;
  /** The newest snapshot as a rink to predict from. */
  worldBase: World | null;
  /** The rink predicted for this frame, per slot. */
  world: (Kin | undefined)[];
  /** Other discs' leftover corrections, per slot (yours is `corr`). */
  springs: Spring2D[];
  /** Where each disc was drawn lately (render time), for trails and effects. */
  hist: { t: number; x: number; y: number; vx: number; vy: number }[][];
  contacts: PredictedContact[];
  /** Render time each pair last got a hit effect from the prediction ("a,b"). */
  localHit: Map<string, number>;
}

export function newScene(): Scene {
  return {
    clock: new Clock(),
    frames: [],
    fxCursor: Infinity,
    rt: 0,
    round: -1,
    roundAt: -1e9,
    particles: [],
    rings: [],
    flashes: [],
    pops: [],
    ghosts: [],
    squash: [],
    dashAt: [],
    dashDir: [],
    heavyAt: [],
    turboAt: [],
    shakeAt: -1e9,
    shakeAmp: 0,
    hurtAt: -1e9,
    radius: [],
    camR: RINK_R + 80,
    lastR: RINK_R,
    powerKey: "",
    powerAt: -1e9,
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
    myTrail: [],
    myGone: -1,
    dashSeen: 0,
    myDashAt: -1e9,
    wx: [],
    wy: [],
    wr: [],
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

/** A frame as a rink to predict from. */
function worldOf(f: Frame): World {
  const discs: WorldDisc[] = [];
  for (const t of f.d) {
    if (!t) continue;
    const [ix, iy] = t[7] >= 0 ? decodeStick(t[7]) : [0, 0];
    discs.push({ slot: t[0], x: t[1], y: t[2], vx: t[3], vy: t[4], ix, iy, heavy: (t[5] & F_HEAVY) !== 0 });
  }
  return { n: f.n, t: f.t, r: f.r, discs };
}

const springOf = (sc: Scene, slot: number) =>
  slot === sc.mySlot ? sc.corr : (sc.springs[slot] ??= new Spring2D(OTHERS_CORR_MS));

/** Your side of a frame: the predictor and who you are (players only). */
export interface Mine {
  pred: SumoPredictor;
  slot: number;
  data: RinkData;
}


/** Hand a frame to your predictor: acknowledgements, your disc's newest state, your fall. */
function feedMine(sc: Scene, f: Frame, newest: boolean, prev: Frame | undefined, me: Mine, now: number) {
  const { pred, slot } = me;
  sc.mySlot = slot;
  // What you see right now, before this frame changes anything. A new snapshot and the
  // acknowledgements it carries move the predicted rink (yours and everyone else's disc), and
  // that change has to be blended out, not shown as a jump.
  const T = sc.clock.serverNow(now) + pred.lead(now);
  const old = sc.worldBase;
  const had = sc.clock.ready && !!old;
  if (had) pred.predictWorld(T, old!, slot, shownBefore);
  if (Array.isArray(f.fxAcks)) {
    for (const a of f.fxAcks) if (a[0] === slot) pred.ack(a[1], f.t + a[2], typeof a[3] === "number" ? f.t + a[3] : undefined, now);
  }
  if (!newest) {
    if (had) blendWorld(sc, pred, old!, T, slot);
    return;
  }
  sc.worldBase = worldOf(f);
  const dt = f.d[slot];
  if (!dt) {
    // Gone from the ice: show your fall now (you've been running ahead of the playback).
    if (prev && prev.n === f.n && prev.d[slot] && sc.myGone !== f.n && !Number.isNaN(sc.myX)) {
      const fall = f.fx?.find((e) => e[0] === FX_FALL && e[1] === slot);
      const vx = fall ? fall[4] : sc.my.vx;
      const vy = fall ? fall[5] : sc.my.vy;
      sc.myGone = f.n;
      fallFx(sc, slot, sc.myX, sc.myY, vx, vy, sc.rt, me.data);
    }
    pred.setBase(null);
    if (had && old!.n === f.n) blendWorld(sc, pred, sc.worldBase, T, slot);
    return;
  }
  pred.serverReadyAt = f.t + dt[6] * 100 - 60;
  pred.turbo = (dt[5] & F_TURBO) !== 0;
  const base = { n: f.n, t: f.t, x: dt[1], y: dt[2], vx: dt[3], vy: dt[4], heavy: (dt[5] & F_HEAVY) !== 0, r: f.r };
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

const shownBefore: (Kin | undefined)[] = [];
const shownAfter: (Kin | undefined)[] = [];

/** The predicted rink changed under you (`shownBefore` = what was shown): fade every difference out. */
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

/** Add a server frame to the playback buffer (and, for a player, to their predictor). */
export function pushFrame(sc: Scene, snap: Snap, now: number, me?: Mine) {
  const f = toFrame(snap);
  if (Array.isArray(snap.a)) f.fxAcks = snap.a;
  const frames = sc.frames;
  const newestBefore: Frame | undefined = frames[frames.length - 1];
  let last: Frame | undefined = newestBefore;
  if (!last) {
    // First frame ever: whatever happened before we arrived is history.
    sc.fxCursor = f.t;
  } else if (f.n !== last.n) {
    if (f.n < last.n && f.t < last.t) return; // a stale frame from an older round
    frames.length = 0;
    sc.fxCursor = f.t - 1;
    last = undefined;
  }
  if (!last || f.t > last.t) {
    sc.clock.observe(f.t, now);
    // The server skipped identical frames: the world stood still until one tick before this.
    if (last && snap.q === 1 && f.t - last.t > TICK_MS * 1.5) {
      frames.push({ ...last, t: f.t - TICK_MS, fx: null });
    }
    frames.push(f);
  } else if (!frames.some((x) => x.t === f.t)) {
    // An older frame (a view that arrived after newer events): slot it in.
    const i = frames.findIndex((x) => x.t > f.t);
    frames.splice(i, 0, f);
  }
  if (frames.length > MAX_FRAMES) frames.splice(0, frames.length - MAX_FRAMES);
  if (me && me.slot >= 0) feedMine(sc, f, frames[frames.length - 1] === f, newestBefore, me, now);
}

/** Where a disc is at server time `time`. False when it isn't on the ice. */
export function sampleDisc(frames: Frame[], slot: number, time: number, o: Sample): boolean {
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
    // Before the oldest frame: hold it.
    o.x = da[1];
    o.y = da[2];
    o.vx = da[3];
    o.vy = da[4];
    return true;
  }
  const b = i + 1 < n ? frames[i + 1] : null;
  const db = b ? b.d[slot] : undefined;
  if (!b || !db) {
    // Late frame (or the disc falls in before the next one): keep sliding a moment.
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
    // A long gap (skipped ahead): plain blend.
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

/**
 * Where a disc is drawn at render time `time`. A player (the present): the predicted rink plus the
 * disc's leftover correction this frame, and where it was drawn for moments just past (trails,
 * effects). Watching: the playback of the frames themselves.
 */
function sampleAt(sc: Scene, slot: number, time: number, o: Sample): boolean {
  const frames = sc.frames;
  if (!sc.present) return sampleDisc(frames, slot, time, o);
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

/** Rink radius at render time `time` (in the present: where the shrink has got to by then). */
function radiusAt(sc: Scene, d: RinkData, time: number): number {
  if (sc.present && d.view.phase === "fight" && d.view.fightAt) return Math.min(sampleRadius(sc.frames, time), rinkRadius(time - d.view.fightAt));
  return sampleRadius(sc.frames, time);
}

function sampleRadius(frames: Frame[], time: number): number {
  const n = frames.length;
  if (!n) return RINK_R;
  let i = n - 1;
  while (i > 0 && frames[i].t > time) i--;
  const a = frames[i];
  const b = frames[i + 1];
  if (!b || a.t >= time) return a.r;
  return a.r + (b.r - a.r) * ((time - a.t) / (b.t - a.t));
}

// ---------- sprites ----------

interface Surface {
  W: number;
  H: number;
  dpr: number;
  bg: HTMLCanvasElement;
  hurt: HTMLCanvasElement;
  shadow: HTMLCanvasElement;
  glow: HTMLCanvasElement;
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

function renderBackground(W: number, H: number) {
  const c = makeCanvas(W, H);
  const g = c.getContext("2d");
  if (!g) return c;
  const grad = g.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
  grad.addColorStop(0, "#123a5c");
  grad.addColorStop(0.55, "#0b2240");
  grad.addColorStop(1, "#060f22");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // Faint glints on the dark water.
  let seed = 9;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 70; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    g.fillStyle = `rgba(165, 243, 252, ${0.04 + rnd() * 0.08})`;
    g.fillRect(x, y, 1 + rnd() * W * 0.03, Math.max(1, W * 0.002));
  }
  return c;
}

function renderHurt() {
  const c = makeCanvas(96, 96);
  const g = c.getContext("2d");
  if (!g) return c;
  const v = g.createRadialGradient(48, 48, 30, 48, 48, 70);
  v.addColorStop(0, "rgba(255, 60, 90, 0)");
  v.addColorStop(1, "rgba(255, 60, 90, 0.42)");
  g.fillStyle = v;
  g.fillRect(0, 0, 96, 96);
  return c;
}

function renderShadow() {
  const c = makeCanvas(64, 64);
  const g = c.getContext("2d");
  if (!g) return c;
  const v = g.createRadialGradient(32, 32, 8, 32, 32, 32);
  v.addColorStop(0, "rgba(4, 24, 48, 0.55)");
  v.addColorStop(0.6, "rgba(4, 24, 48, 0.25)");
  v.addColorStop(1, "rgba(4, 24, 48, 0)");
  g.fillStyle = v;
  g.fillRect(0, 0, 64, 64);
  return c;
}

function renderGlow() {
  const c = makeCanvas(64, 64);
  const g = c.getContext("2d");
  if (!g) return c;
  const v = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  v.addColorStop(0, "rgba(255, 255, 255, 0.9)");
  v.addColorStop(0.3, "rgba(255, 255, 255, 0.35)");
  v.addColorStop(1, "rgba(255, 255, 255, 0)");
  g.fillStyle = v;
  g.fillRect(0, 0, 64, 64);
  return c;
}

const spriteCache = new Map<string, HTMLCanvasElement>();
/** A glossy disc in the player's colour with their avatar on top. */
function discSprite(color: string, avatar: string): HTMLCanvasElement {
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
  // Rim.
  g.beginPath();
  g.arc(m, m, SPR, 0, TAU);
  g.fillStyle = mix(color, 0, 0.55);
  g.fill();
  // Body: lit from the top left.
  const body = g.createRadialGradient(m - SPR * 0.35, m - SPR * 0.4, SPR * 0.1, m, m, SPR * 0.92);
  body.addColorStop(0, mix(color, 255, 0.45));
  body.addColorStop(0.55, color);
  body.addColorStop(1, mix(color, 0, 0.25));
  g.beginPath();
  g.arc(m, m, SPR * 0.86, 0, TAU);
  g.fillStyle = body;
  g.fill();
  // Inner bevel.
  g.beginPath();
  g.arc(m, m, SPR * 0.66, 0, TAU);
  g.strokeStyle = "rgba(255, 255, 255, 0.22)";
  g.lineWidth = SPR * 0.05;
  g.stroke();
  // Avatar.
  g.font = `${Math.round(SPR * 0.95)}px ${EMOJI_FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  drawAvatar(g, avatar, m, m, SPR * 1.3);
  // Gloss.
  g.save();
  g.beginPath();
  g.ellipse(m - SPR * 0.28, m - SPR * 0.42, SPR * 0.42, SPR * 0.2, -0.5, 0, TAU);
  g.fillStyle = "rgba(255, 255, 255, 0.28)";
  g.fill();
  g.restore();
  if (ready) spriteCache.set(key, c);
  return c;
}

/** Fixed fractures and skate scratches in world coordinates. */
function makeCracks(): Path2D {
  const p = new Path2D();
  let seed = 4242;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 9; i++) {
    const a0 = rnd() * TAU;
    let r = 120 + rnd() * 300;
    let a = a0;
    let x = CENTER + Math.cos(a) * r;
    let y = CENTER + Math.sin(a) * r;
    p.moveTo(x, y);
    const segs = 3 + Math.floor(rnd() * 4);
    for (let k = 0; k < segs; k++) {
      a += (rnd() - 0.5) * 0.5;
      r += (rnd() - 0.3) * 40;
      const len = 18 + rnd() * 34;
      const dir = a0 + (rnd() - 0.5) * 1.6;
      x += Math.cos(dir) * len;
      y += Math.sin(dir) * len;
      p.lineTo(x, y);
      if (rnd() < 0.4) {
        const bx = x + Math.cos(dir + 1.2) * len * 0.6;
        const by = y + Math.sin(dir + 1.2) * len * 0.6;
        p.moveTo(x, y);
        p.lineTo(bx, by);
        p.moveTo(x, y);
      }
    }
  }
  return p;
}

function makeScratches(): Path2D {
  const p = new Path2D();
  let seed = 777;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 22; i++) {
    const r = 60 + rnd() * 360;
    const a = rnd() * TAU;
    const span = 0.15 + rnd() * 0.5;
    const cx = CENTER + (rnd() - 0.5) * 80;
    const cy = CENTER + (rnd() - 0.5) * 80;
    p.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    p.arc(cx, cy, r, a, a + span);
  }
  return p;
}

// ---------- drawing ----------

export interface RinkData {
  view: SumoView;
  mySlot: number;
  colors: string[];
  names: string[];
  avatars: string[];
  reduced: boolean;
  steerable: boolean;
  accent: string;
}

interface Statics {
  cracks: Path2D | null;
  scratches: Path2D | null;
}
const statics: Statics = { cracks: null, scratches: null };

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
  if (sc.particles.length > 360) return;
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
      life: 320 + Math.random() * 420,
      size: kind === 1 ? 6 + Math.random() * 7 : kind === 0 ? 4 + Math.random() * 3 : 5 + Math.random() * 4,
      color,
      kind,
      drag: kind === 1 ? 0.93 : 0.9,
    });
  }
}

/** Fire the effects carried by a frame (the moment playback reaches it). */
/** Effects carried by a frame, shown at render time `at` (the frame's own time when watching the past). */
function applyFx(sc: Scene, f: Frame, d: RinkData, at = f.t) {
  if (!f.fx) return;
  const reduced = d.reduced;
  for (const e of f.fx) {
    if (!Array.isArray(e)) continue;
    const type = e[0];
    if (type === FX_HIT) {
      let [, x, y] = e;
      const [, , , j, a, b] = e;
      if (sc.present) {
        // Already shown when the two met on screen (predict.ts resolves contacts too)?
        const shown = sc.localHit.get(a < b ? `${a},${b}` : `${b},${a}`);
        if (shown !== undefined && Math.abs(at - shown) < 900) continue;
        // Otherwise where they are drawn, if they're close: the hit lines up with the discs.
        if (sampleAt(sc, a, at, tmp) && sampleAt(sc, b, at, tmp2) && Math.hypot(tmp2.x - tmp.x, tmp2.y - tmp.y) < DISC_R * 3) {
          x = (tmp.x + tmp2.x) / 2;
          y = (tmp.y + tmp2.y) / 2;
        }
      }
      hitFx(sc, d, x, y, j, a, b, at);
    } else if (type === FX_FALL) {
      const [, slot, x, y, vx, vy] = e;
      if (slot === d.mySlot && sc.myGone === f.n) continue; // already shown, the moment it happened for you
      const h = sc.present ? sc.hist[slot] : undefined;
      const last = h && h.length ? h[h.length - 1] : null;
      if (last) fallFx(sc, slot, last.x, last.y, last.vx, last.vy, at, d);
      else fallFx(sc, slot, x, y, vx, vy, at, d);
    } else if (type === FX_PICKUP) {
      const [, slot, k] = e;
      const kind = POWER_KINDS[k] ?? "heavy";
      const info = POWER_INFO[kind];
      if (kind === "heavy") sc.heavyAt[slot] = at;
      else sc.turboAt[slot] = at;
      if (slot === d.mySlot) feedback("score");
      else sfx("pop");
      if (sampleAt(sc, slot, at, tmp)) {
        sc.rings.push({ x: tmp.x, y: tmp.y, t0: at, dur: 520, r0: 30, r1: 120, w: 8, color: info.color });
        sc.pops.push({
          slot,
          x: tmp.x,
          y: tmp.y,
          t0: at,
          text: `${info.icon} ${info.label.toUpperCase()}!`,
          color: info.color,
          big: true,
        });
      }
    } else if (type === FX_DASH) {
      const [, slot, dx, dy] = e;
      if (slot === d.mySlot && sc.perf - sc.myDashAt < 900) continue; // shown when you pressed it
      sc.dashAt[slot] = at;
      sc.dashDir[slot] = [dx / 100, dy / 100];
      if (sampleAt(sc, slot, at, tmp)) {
        sc.rings.push({ x: tmp.x, y: tmp.y, t0: at, dur: 300, r0: 30, r1: 70, w: 6, color: d.colors[slot] ?? "#fff" });
        if (!reduced) spark(sc, tmp.x - (dx / 100) * 26, tmp.y - (dy / 100) * 26, 8, 300, "#ffffff", 0, 0.9, -dx, -dy);
      }
    } else if (type === FX_MELT) {
      const [, x, y] = e;
      sc.rings.push({ x, y, t0: at, dur: 600, r0: 10, r1: 60, w: 5, color: "#a5f3fc" });
    }
  }
}

/** A hit between discs a and b at (x, y), impulse j, shown at render time `at`. */
function hitFx(sc: Scene, d: RinkData, x: number, y: number, j: number, a: number, b: number, at: number) {
  const reduced = d.reduced;
  const hard = clamp01((j - 140) / 700);
  const ca = d.colors[a] ?? "#ffffff";
  const cb = d.colors[b] ?? "#ffffff";
  // Spray sideways along the contact (perpendicular to the line between the discs).
  let nx = 1;
  let ny = 0;
  if (sampleAt(sc, a, at, tmp) && sampleAt(sc, b, at, tmp2)) {
    const dx = tmp2.x - tmp.x;
    const dy = tmp2.y - tmp.y;
    const len = Math.hypot(dx, dy) || 1;
    nx = dx / len;
    ny = dy / len;
  }
  const n = reduced ? 3 : 6 + Math.round(hard * 14);
  spark(sc, x, y, Math.ceil(n / 2), 260 + hard * 520, "#fbbf24", 0, 1.3, -ny, nx);
  spark(sc, x, y, Math.ceil(n / 2), 260 + hard * 520, "#ffffff", 0, 1.3, ny, -nx);
  if (!reduced) {
    spark(sc, x, y, 2 + Math.round(hard * 4), 200, ca, 2, TAU);
    spark(sc, x, y, 2 + Math.round(hard * 4), 200, cb, 2, TAU);
  }
  sc.rings.push({
    x,
    y,
    t0: at,
    dur: 420,
    r0: 14,
    r1: 60 + hard * 90,
    w: 6 + hard * 6,
    color: "rgba(12, 52, 92, 0.6)",
  });
  sc.flashes.push({ x, y, t0: at, size: 22 + hard * 30, rot: Math.random() * TAU });
  const amt = Math.min(0.3, 0.08 + j / 2600);
  sc.squash[a] = { t0: at, nx, ny, amt };
  sc.squash[b] = { t0: at, nx, ny, amt };
  const mine = a === d.mySlot || b === d.mySlot;
  const amp = Math.min(1, (j / 900) * (mine ? 1.3 : 0.8));
  if (amp > 0.12 && (at - sc.shakeAt > 120 || amp > sc.shakeAmp)) {
    sc.shakeAt = at;
    sc.shakeAmp = amp;
  }
  if (j > 760)
    sc.pops.push({ slot: -1, x, y, t0: at, text: j > 1100 ? "💥 WHAM!" : "💥", color: "#fde047", big: j > 1100 });
  // Sound for every real collision; a buzz only when it's your disc (hard = hit, glancing = bump).
  if (mine) feedback(j > 500 ? "hit" : "bump");
  else if (j > 300) sfx("bump");
}

/** A disc slides into the water: ghost, splash rings, ice chips, and a red flash if it's you. */
function fallFx(sc: Scene, slot: number, x: number, y: number, vx: number, vy: number, t0: number, d: RinkData) {
  sc.ghosts.push({ slot, x, y, vx, vy, t0 });
  const len = Math.hypot(x - CENTER, y - CENTER) || 1;
  const r = sampleRadius(sc.frames, t0);
  const ex = CENTER + ((x - CENTER) / len) * r;
  const ey = CENTER + ((y - CENTER) / len) * r;
  sc.rings.push({ x: ex, y: ey, t0: t0 + 150, dur: 700, r0: 20, r1: 110, w: 8, color: "#a5f3fc" });
  sc.rings.push({ x: ex, y: ey, t0: t0 + 320, dur: 700, r0: 10, r1: 70, w: 5, color: "#a5f3fc" });
  if (!d.reduced) spark(sc, ex, ey, 14, 260, "#cff6ff", 1, 1.6, (x - CENTER) / len, (y - CENTER) / len);
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

/** True while something is still moving or fading (the final screen can then idle). */
function busy(sc: Scene) {
  const last = sc.frames[sc.frames.length - 1];
  return (
    sc.particles.length > 0 ||
    sc.rings.length > 0 ||
    sc.flashes.length > 0 ||
    sc.pops.length > 0 ||
    sc.ghosts.length > 0 ||
    !last ||
    sc.rt < last.t + 250 ||
    sc.stick !== null
  );
}

function drawScene(
  g: CanvasRenderingContext2D,
  sc: Scene,
  s: Surface,
  d: RinkData,
  input: InputState,
  now: number,
  pred: SumoPredictor | null,
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

  // A player sees the whole rink at one moment, the present: when an input pressed now takes
  // effect. Every disc is predicted to then (yours replayed, the others dead-reckoned, contacts
  // resolved), so what touches on screen touches on the server. Spectators watch the playback.
  sc.present = !!pred && mySlot >= 0 && sc.clock.ready && !!sc.worldBase && sc.worldBase.n === newestFrame?.n;
  const prevRt = sc.rt;
  const rt = sc.present ? Math.max(prevRt, sc.clock.serverNow(now) + pred!.lead(now)) : playT;
  sc.rt = rt;
  if (sc.present) {
    pred!.decided = phase !== "fight";
    sc.contacts.length = 0;
    const gone = sc.myGone === newestFrame!.n;
    pred!.predictWorld(rt, sc.worldBase!, gone ? -1 : mySlot, sc.world, sc.contacts);
    sc.corr.step(wallDt);
    for (const sp of sc.springs) sp?.step(wallDt);
    // Hits the prediction reached this frame show now, where the discs meet on screen.
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

  // Fire effects that playback has reached (skip stale ones after a hidden tab). In the present
  // that's as soon as their frame arrives, shown from now.
  for (const f of frames) {
    if (f.t <= sc.fxCursor) continue;
    if (f.t > rt) break;
    if (f.t > rt - (sc.present ? 1_500 : 600)) applyFx(sc, f, d, sc.present ? rt : f.t);
    sc.fxCursor = f.t;
  }
  // Drop frames we're well past (keep enough for trails).
  while (frames.length > 2 && frames[1].t < rt - KEEP_MS) frames.shift();

  const latest = frames[frames.length - 1];
  if (latest && latest.n !== sc.round) {
    sc.round = latest.n;
    sc.roundAt = now;
    sc.ghosts.length = 0;
    sc.pops.length = 0;
    sc.squash.length = 0;
    sc.heavyAt.length = 0;
    sc.turboAt.length = 0;
    sc.dashAt.length = 0;
    sc.myTrail.length = 0;
    sc.hist.length = 0;
    sc.localHit.clear();
    for (const sp of sc.springs) sp?.reset();
  }

  // ----- your disc: replayed from its newest snapshot up to where your inputs are landing -----
  sc.myOn = false;
  const myNewest = latest && mySlot >= 0 ? latest.d[mySlot] : undefined;
  if (pred && myNewest && phase !== "countdown" && pred.base && pred.base.n === latest!.n && sc.myGone !== latest!.n) {
    pred.decided = phase !== "fight";
    const w = sc.present ? sc.world[mySlot] : undefined;
    if (w) {
      // Predicted with everyone else (contacts included) above.
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

  // ----- camera: zoom in as the rink shrinks -----
  const rinkR = radiusAt(sc, d, rt);
  // Zoom in part of the way as the rink shrinks: the shrink stays visible, discs get bigger.
  const fullCam = RINK_R + 48;
  const wantCam = fullCam - (fullCam - Math.max(rinkR + 48, 200)) * 0.62;
  sc.camR += (wantCam - sc.camR) * (Math.abs(wantCam - sc.camR) > 200 ? 1 : clamp01(wallDt / 260));
  const scale = Math.min(W, H) / (2 * sc.camR);
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

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.drawImage(s.bg, 0, 0);

  // Ripples spreading from the rink into the water.
  if (!reduced && rinkR > 4) {
    g.setTransform(scale, 0, 0, scale, ox - CENTER * scale, oy - CENTER * scale);
    for (let i = 0; i < 2; i++) {
      const p = (((now / 3200 + i / 2) % 1) + 1) % 1;
      g.globalAlpha = 0.16 * (1 - p);
      g.strokeStyle = "#7dd3fc";
      g.lineWidth = 3;
      g.beginPath();
      g.arc(CENTER, CENTER, rinkR + 16 + p * 90, 0, TAU);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  g.setTransform(scale, 0, 0, scale, ox - CENTER * scale, oy - CENTER * scale);
  const fightMs = d.view.fightAt ? rt - d.view.fightAt : 0;
  const shrinking = phase === "fight" && fightMs > SHRINK_START_MS && fightMs <= SHRINK_END_MS;
  const sudden = phase === "fight" && fightMs > SHRINK_END_MS;

  if (rinkR > 0.5) {
    // Slab edge (thickness) and a dark lip.
    g.beginPath();
    g.arc(CENTER, CENTER + 10, rinkR + 2, 0, TAU);
    g.fillStyle = "#0f3b5c";
    g.fill();
    g.beginPath();
    g.arc(CENTER, CENTER + 5, rinkR + 1, 0, TAU);
    g.fillStyle = "#3a87b3";
    g.fill();

    // Ice top.
    g.save();
    g.beginPath();
    g.arc(CENTER, CENTER, rinkR, 0, TAU);
    g.clip();
    const ice = g.createRadialGradient(CENTER - 140, CENTER - 170, 30, CENTER, CENTER, RINK_R * 1.05);
    ice.addColorStop(0, "#e8f9ff");
    ice.addColorStop(0.45, "#b4e2f4");
    ice.addColorStop(0.8, "#86c6e3");
    ice.addColorStop(1, "#5ea9d1");
    g.fillStyle = ice;
    g.fillRect(CENTER - RINK_R, CENTER - RINK_R, RINK_R * 2, RINK_R * 2);
    statics.cracks ??= makeCracks();
    statics.scratches ??= makeScratches();
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "rgba(255, 255, 255, 0.35)";
    g.lineWidth = 1.6;
    g.stroke(statics.scratches);
    g.strokeStyle = "rgba(40, 110, 160, 0.28)";
    g.lineWidth = 2.6;
    g.save();
    g.translate(1.5, 1.5);
    g.stroke(statics.cracks);
    g.restore();
    g.strokeStyle = "rgba(255, 255, 255, 0.75)";
    g.lineWidth = 1.4;
    g.stroke(statics.cracks);
    // Dohyo marks: a ring and the two start lines.
    g.strokeStyle = "rgba(255, 255, 255, 0.4)";
    g.lineWidth = 4;
    g.beginPath();
    g.arc(CENTER, CENTER, 92, 0, TAU);
    g.stroke();
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(CENTER - 34, CENTER - 22);
    g.lineTo(CENTER - 34, CENTER + 22);
    g.moveTo(CENTER + 34, CENTER - 22);
    g.lineTo(CENTER + 34, CENTER + 22);
    g.stroke();
    // Where the rink will end up.
    if ((phase === "countdown" || phase === "fight") && rinkR > RINK_MIN + 4) {
      g.setLineDash([14, 14]);
      g.lineDashOffset = reduced ? 0 : -now / 60;
      g.strokeStyle = shrinking ? "rgba(251, 146, 60, 0.55)" : "rgba(30, 90, 140, 0.25)";
      g.lineWidth = 3;
      g.beginPath();
      g.arc(CENTER, CENTER, RINK_MIN, 0, TAU);
      g.stroke();
      g.setLineDash([]);
    }
    // Sheen.
    const sheen = g.createLinearGradient(CENTER - rinkR, CENTER - rinkR, CENTER + rinkR * 0.2, CENTER + rinkR * 0.2);
    sheen.addColorStop(0, "rgba(255, 255, 255, 0.28)");
    sheen.addColorStop(0.45, "rgba(255, 255, 255, 0)");
    g.fillStyle = sheen;
    g.fillRect(CENTER - rinkR, CENTER - rinkR, rinkR * 2, rinkR * 2);
    g.restore();

    // Glowing edge: icy blue, orange while shrinking, pulsing red in sudden death.
    const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(now / (sudden ? 110 : 260));
    const edge = sudden ? "#f87171" : shrinking ? "#fb923c" : "#a5f3fc";
    g.strokeStyle = edge;
    g.globalAlpha = shrinking || sudden ? 0.22 + 0.2 * pulse : 0.18;
    g.lineWidth = 16;
    g.beginPath();
    g.arc(CENTER, CENTER, rinkR, 0, TAU);
    g.stroke();
    g.globalAlpha = 1;
    g.lineWidth = shrinking || sudden ? 5 : 4;
    g.stroke();
    g.strokeStyle = "rgba(255, 255, 255, 0.8)";
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(CENTER, CENTER, rinkR - 3, 0, TAU);
    g.stroke();

    // Chunks breaking off the shrinking edge.
    if ((shrinking || sudden) && !reduced && rinkR < sc.lastR - 0.01 && Math.random() < wallDt / 70) {
      const a = Math.random() * TAU;
      spark(
        sc,
        CENTER + Math.cos(a) * rinkR,
        CENTER + Math.sin(a) * rinkR,
        2,
        60,
        "#d8f6ff",
        1,
        0.8,
        Math.cos(a),
        Math.sin(a),
      );
    }
  }
  sc.lastR = rinkR;

  // ----- power-up on the floor -----
  const frameA = (() => {
    let i = frames.length - 1;
    while (i > 0 && frames[i].t > rt) i--;
    return frames[i];
  })();
  const u = frameA?.u ?? 0;
  if (u !== 0 && phase === "fight") {
    const key = u.join(",");
    if (key !== sc.powerKey) {
      sc.powerKey = key;
      sc.powerAt = rt;
    }
    const kind = POWER_KINDS[u[0]] ?? "heavy";
    const info = POWER_INFO[kind];
    const grow = reduced ? 1 : easeOutBack(clamp01((rt - sc.powerAt) / 450));
    const bob = reduced ? 0 : Math.sin(now / 260) * 3;
    const px = u[1];
    const py = u[2] + bob;
    const pr = 34 * grow;
    if (pr > 0.5) {
      const halo = g.createRadialGradient(px, py, pr * 0.6, px, py, pr * 2.4);
      halo.addColorStop(0, info.color + "88");
      halo.addColorStop(1, info.color + "00");
      g.fillStyle = halo;
      g.fillRect(px - pr * 2.4, py - pr * 2.4, pr * 4.8, pr * 4.8);
      g.beginPath();
      g.arc(px, py, pr, 0, TAU);
      g.fillStyle = "rgba(14, 12, 29, 0.78)";
      g.fill();
      g.lineWidth = 5;
      g.strokeStyle = info.color;
      g.stroke();
      if (!reduced) {
        const ring = (now % 1200) / 1200;
        g.globalAlpha = 0.7 * (1 - ring);
        g.beginPath();
        g.arc(px, py, pr * (1 + ring * 0.9), 0, TAU);
        g.stroke();
        g.globalAlpha = 1;
      }
      g.font = `${Math.round(40 * grow)}px ${EMOJI_FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(info.icon, px, py + 2);
    }
  } else {
    sc.powerKey = "";
  }

  // ----- falling discs: slide on, shrink, sink -----
  for (let i = sc.ghosts.length - 1; i >= 0; i--) {
    const gh = sc.ghosts[i];
    const age = rt - gh.t0;
    if (age > FALL_MS) {
      sc.ghosts.splice(i, 1);
      continue;
    }
    if (age < 0) continue;
    const p = age / FALL_MS;
    const slide = (1 - Math.pow(1 - Math.min(1, age / 700), 2)) * 0.45;
    const x = gh.x + gh.vx * slide;
    const y = gh.y + gh.vy * slide + p * p * 40;
    const k = Math.max(0.05, 1 - easeOut(p) * 0.85);
    const r = DISC_R * k;
    const spr = discSprite(d.colors[gh.slot] ?? "#94a3b8", d.avatars[gh.slot] ?? "🙂");
    const sz = r * ((SPR + SPR_PAD) / SPR);
    g.save();
    g.globalAlpha = clamp01(1.2 - p * 1.2);
    g.translate(x, y);
    if (!reduced) g.rotate(p * 2.4 * (gh.vx >= 0 ? 1 : -1));
    g.drawImage(spr, -sz, -sz, sz * 2, sz * 2);
    // Darken as it sinks.
    g.globalAlpha = clamp01(p * 0.9);
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.fillStyle = "#06243d";
    g.fill();
    g.restore();
  }

  // ----- discs -----
  const crowned = (slot: number) => {
    const id = d.view.ids[slot];
    if (phase === "final") return !!d.view.champions?.includes(id);
    return phase === "roundOver" && d.view.lastWinner === id;
  };
  const spawn = reduced ? 1 : clamp01((now - sc.roundAt) / 450);
  const order: number[] = [];
  for (let slot = 0; slot < slots; slot++) if (slot !== mySlot) order.push(slot);
  if (mySlot >= 0) order.push(mySlot);
  for (let slot = 0; slot < slots; slot++) {
    sc.sx[slot] = NaN;
    sc.wx[slot] = NaN;
  }

  // Where everyone is: the others from playback, yours from the predictor.
  for (const slot of order) {
    if (slot === mySlot && sc.myOn) continue;
    if (!sampleAt(sc, slot, rt, tmp)) continue;
    sc.wx[slot] = tmp.x;
    sc.wy[slot] = tmp.y;
    sc.wr[slot] = sc.radius[slot] ?? DISC_R;
  }
  if (sc.myOn) {
    let x = sc.my.x + sc.corr.x;
    let y = sc.my.y + sc.corr.y;
    const R = sc.radius[mySlot] ?? DISC_R;
    // Collisions are the server's call; as drawn, your disc just never sinks into another one.
    for (let slot = 0; slot < slots; slot++) {
      if (slot === mySlot || Number.isNaN(sc.wx[slot])) continue;
      const min = R + sc.wr[slot];
      let dx = x - sc.wx[slot];
      let dy = y - sc.wy[slot];
      let dist = Math.hypot(dx, dy);
      if (dist >= min) continue;
      if (dist < 1e-3) {
        // Dead centre: back out the way you came.
        dx = (Number.isNaN(sc.myX) ? x : sc.myX) - sc.wx[slot];
        dy = (Number.isNaN(sc.myY) ? y + 1 : sc.myY) - sc.wy[slot];
        dist = Math.hypot(dx, dy) || 1;
      }
      x = sc.wx[slot] + (dx / dist) * min;
      y = sc.wy[slot] + (dy / dist) * min;
    }
    sc.myX = x;
    sc.myY = y;
    sc.wx[mySlot] = x;
    sc.wy[mySlot] = y;
    sc.myTrail.push({ at: now, x, y });
    while (sc.myTrail.length > 2 && now - sc.myTrail[0].at > TRAIL_MS + 60) sc.myTrail.shift();
  } else if (sc.myTrail.length) sc.myTrail.length = 0;

  // Where everyone was drawn (render time), for trails and effects in the present.
  if (sc.present) {
    for (let slot = 0; slot < slots; slot++) {
      if (Number.isNaN(sc.wx[slot])) continue;
      const w = slot === mySlot && sc.myOn ? sc.my : sc.world[slot];
      const h = (sc.hist[slot] ??= []);
      if (h.length && h[h.length - 1].t >= rt) h.pop();
      h.push({ t: rt, x: sc.wx[slot], y: sc.wy[slot], vx: w?.vx ?? 0, vy: w?.vy ?? 0 });
      while (h.length > 2 && h[0].t < rt - 500) h.shift();
    }
  }
  {
    // ?debug=1: your disc and the nearest other one as drawn, and the render clock.
    let other = -1;
    for (let slot = 0; slot < slots; slot++) if (slot !== mySlot && !Number.isNaN(sc.wx[slot])) other = other < 0 ? slot : other;
    debugFrame("sumo", {
      t: now,
      x: sc.myOn ? sc.wx[mySlot] : NaN,
      y: sc.myOn ? sc.wy[mySlot] : NaN,
      ox: other >= 0 ? sc.wx[other] : NaN,
      oy: other >= 0 ? sc.wy[other] : NaN,
      rt,
      present: sc.present ? 1 : 0,
    });
  }

  // Your dash shows the moment you press it.
  if (pred && pred.dashes !== sc.dashSeen) {
    sc.dashSeen = pred.dashes;
    if (mySlot >= 0 && !Number.isNaN(sc.wx[mySlot]) && phase === "fight") {
      const v = sc.myOn ? sc.my : { x: 0, y: 0, vx: 0, vy: 0 };
      const [dx, dy] = pred.dashDir(input.x, input.y, v);
      const x = sc.wx[mySlot];
      const y = sc.wy[mySlot];
      sc.myDashAt = now;
      sc.dashAt[mySlot] = rt;
      sc.dashDir[mySlot] = [dx, dy];
      sc.rings.push({ x, y, t0: rt, dur: 300, r0: 30, r1: 70, w: 6, color: d.colors[mySlot] ?? "#fff" });
      if (!reduced) spark(sc, x - dx * 26, y - dy * 26, 8, 300, "#ffffff", 0, 0.9, -dx, -dy);
    }
  }

  // Trails first, so every disc sits on top of every trail.
  if (!reduced) {
    for (const slot of order) {
      if (slot === mySlot && sc.myOn) {
        // Yours: through where it was actually drawn.
        const speed = Math.hypot(sc.my.vx, sc.my.vy);
        const dashing = now - sc.myDashAt < 300;
        if (speed < 140 && !dashing) continue;
        const R = sc.radius[slot] ?? DISC_R;
        const tr = sc.myTrail;
        g.lineCap = "round";
        for (let k = tr.length - 2, n = 1; k >= 0 && now - tr[k].at <= TRAIL_MS; k--, n++) {
          const f = 1 - (now - tr[k].at) / (TRAIL_MS + 20);
          g.globalAlpha = (dashing ? 0.6 : 0.42) * f * clamp01((speed - 100) / 220 + (dashing ? 0.6 : 0));
          g.strokeStyle = dashing ? "#ffffff" : (d.colors[slot] ?? "#ffffff");
          g.lineWidth = R * 1.7 * f;
          g.beginPath();
          g.moveTo(tr[k + 1].x, tr[k + 1].y);
          g.lineTo(tr[k].x, tr[k].y);
          g.stroke();
        }
        g.globalAlpha = 1;
        continue;
      }
      if (!sampleAt(sc, slot, rt, tmp)) continue;
      const speed = Math.hypot(tmp.vx, tmp.vy);
      const dashing = (tmp.flags & F_DASH) !== 0;
      if (speed < 140 && !dashing) continue;
      const color = d.colors[slot] ?? "#ffffff";
      const R = sc.radius[slot] ?? DISC_R;
      let px = tmp.x;
      let py = tmp.y;
      const steps = dashing ? TRAIL_STEPS + 3 : TRAIL_STEPS;
      g.lineCap = "round";
      for (let k = 1; k <= steps; k++) {
        if (!sampleAt(sc, slot, rt - (k * TRAIL_MS) / TRAIL_STEPS, tmp2)) break;
        const f = 1 - k / (steps + 1);
        g.globalAlpha = (dashing ? 0.6 : 0.42) * f * clamp01((speed - 100) / 220 + (dashing ? 0.6 : 0));
        g.strokeStyle = dashing ? "#ffffff" : color;
        g.lineWidth = R * 1.7 * f;
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(tmp2.x, tmp2.y);
        g.stroke();
        px = tmp2.x;
        py = tmp2.y;
      }
      g.globalAlpha = 1;
    }
  }

  let myCd = -1;
  let myCdAt = 0;
  let myTurbo = false;
  for (const slot of order) {
    const isMe = slot === mySlot;
    if (isMe && latest && sc.myGone === latest.n) continue; // fallen in: the ghost has it
    if (isMe && sc.myOn && myNewest) {
      tmp.x = sc.myX;
      tmp.y = sc.myY;
      tmp.vx = sc.my.vx;
      tmp.vy = sc.my.vy;
      tmp.flags = (myNewest[5] & ~F_DASH) | (now - sc.myDashAt < 260 ? F_DASH : 0);
      tmp.cd = myNewest[6];
      tmp.cdAt = latest!.t;
    } else if (!sampleAt(sc, slot, rt, tmp)) continue;
    const color = d.colors[slot] ?? "#94a3b8";
    const heavy = (tmp.flags & F_HEAVY) !== 0;
    const turbo = (tmp.flags & F_TURBO) !== 0;
    const dashing = (tmp.flags & F_DASH) !== 0;
    const offline = (tmp.flags & F_OFFLINE) !== 0;
    const wantR = heavy ? DISC_R * HEAVY_SCALE : DISC_R;
    const R0 = sc.radius[slot] ?? wantR;
    const R = (sc.radius[slot] = R0 + (wantR - R0) * clamp01(wallDt / 90));
    const x = tmp.x;
    const y = tmp.y;
    if (isMe) {
      myCd = tmp.cd;
      myCdAt = tmp.cdAt;
      myTurbo = turbo;
      sc.myX = x;
      sc.myY = y;
    }
    const grow = spawn < 1 ? Math.max(0.05, easeOutBack(spawn)) : 1;
    const Rd = R * grow;

    // Shadow.
    g.globalAlpha = offline ? 0.4 : 0.85;
    g.drawImage(s.shadow, x - Rd * 1.25 + 4, y - Rd * 1.25 + 8, Rd * 2.5, Rd * 2.5);
    g.globalAlpha = 1;

    // Dash / champion glow.
    const dashAge = rt - (sc.dashAt[slot] ?? -1e9);
    if (dashing || dashAge < 300 || crowned(slot)) {
      const k = crowned(slot)
        ? 0.55 + (reduced ? 0 : 0.2 * Math.sin(now / 200))
        : clamp01(1 - dashAge / 300) * 0.9 + (dashing ? 0.3 : 0);
      g.globalAlpha = Math.min(1, k);
      g.drawImage(s.glow, x - Rd * 2, y - Rd * 2, Rd * 4, Rd * 4);
      g.globalAlpha = 1;
    }

    // Body with squash (impacts) or stretch (speed).
    const spr = discSprite(color, d.avatars[slot] ?? "🙂");
    const sz = Rd * ((SPR + SPR_PAD) / SPR);
    let ang = 0;
    let sxk = 1;
    let syk = 1;
    const sq = sc.squash[slot];
    const sqAge = sq ? rt - sq.t0 : 1e9;
    if (sq && sqAge >= 0 && sqAge < 320 && !reduced) {
      const p = sqAge / 320;
      const f = sq.amt * Math.exp(-4 * p) * Math.cos(p * Math.PI * 2.5);
      ang = Math.atan2(sq.ny, sq.nx);
      sxk = 1 - f;
      syk = 1 + f * 0.7;
    } else if (!reduced) {
      const sp = Math.hypot(tmp.vx, tmp.vy);
      if (sp > 60) {
        const f = Math.min(0.1, sp / 6000);
        ang = Math.atan2(tmp.vy, tmp.vx);
        sxk = 1 + f;
        syk = 1 - f * 0.7;
      }
    }
    g.save();
    g.translate(x, y);
    if (sxk !== 1 || syk !== 1) {
      g.rotate(ang);
      g.scale(sxk, syk);
      g.rotate(-ang);
    }
    if (offline) g.globalAlpha = 0.55;
    g.drawImage(spr, -sz, -sz, sz * 2, sz * 2);
    g.restore();

    // Heavy: a thick iron band. Turbo: crackling yellow.
    if (heavy) {
      g.strokeStyle = "rgba(40, 22, 8, 0.85)";
      g.lineWidth = 9;
      g.beginPath();
      g.arc(x, y, Rd + 2, 0, TAU);
      g.stroke();
      g.strokeStyle = POWER_INFO.heavy.color;
      g.lineWidth = 4;
      g.stroke();
      g.fillStyle = "#fff7ed";
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU + Math.PI / 6;
        g.beginPath();
        g.arc(x + Math.cos(a) * (Rd + 2), y + Math.sin(a) * (Rd + 2), 2.4, 0, TAU);
        g.fill();
      }
    }
    if (turbo) {
      g.strokeStyle = POWER_INFO.turbo.color;
      g.lineWidth = 3;
      g.globalAlpha = reduced ? 0.9 : 0.55 + 0.45 * Math.abs(Math.sin(now / 45 + slot));
      g.setLineDash([7, 6]);
      g.lineDashOffset = reduced ? 0 : now / 25;
      g.beginPath();
      g.arc(x, y, Rd + 5, 0, TAU);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }

    // You: a white ring, the stick direction, and the dash recharge.
    if (isMe) {
      const live = phase === "fight" || phase === "roundOver" || phase === "countdown";
      g.strokeStyle = "#ffffff";
      g.lineWidth = 3;
      g.globalAlpha = 0.95;
      g.beginPath();
      g.arc(x, y, Rd + (heavy ? 9 : 6), 0, TAU);
      g.stroke();
      g.globalAlpha = 1;
      if (live && d.steerable) {
        const m = Math.hypot(input.x, input.y);
        if (m > 0.1) {
          const ux = input.x / m;
          const uy = input.y / m;
          const base = Rd + 12;
          const tip = base + 10 + 10 * Math.min(1, m);
          g.fillStyle = "#ffffff";
          g.beginPath();
          g.moveTo(x + ux * tip, y + uy * tip);
          g.lineTo(x + ux * base - uy * 9, y + uy * base + ux * 9);
          g.lineTo(x + ux * base + uy * 9, y + uy * base - ux * 9);
          g.closePath();
          g.fill();
        }
      }
      // Recharge arc (the server's word, or your own press if that's newer; matches the DASH button).
      const total = turbo ? TURBO_CD_MS : DASH_CD_MS;
      const left = pred
        ? pred.dashLeft(now, total)
        : Math.max(0, tmp.cd * 100 - (sc.clock.serverNow(now) - tmp.cdAt));
      if (left > 0 && phase !== "final") {
        g.strokeStyle = d.accent;
        g.lineWidth = 4;
        g.globalAlpha = 0.9;
        g.beginPath();
        g.arc(x, y, Rd + (heavy ? 15 : 12), -Math.PI / 2, -Math.PI / 2 + TAU * (1 - Math.min(1, left / total)));
        g.stroke();
        g.globalAlpha = 1;
      }
    }
    sc.sx[slot] = toX(x);
    sc.sy[slot] = toY(y);
    sc.sr[slot] = Rd * scale;
  }

  // ----- effects -----
  g.setTransform(scale, 0, 0, scale, ox - CENTER * scale, oy - CENTER * scale);
  for (let i = sc.flashes.length - 1; i >= 0; i--) {
    const fl = sc.flashes[i];
    const p = (rt - fl.t0) / 300;
    if (p >= 1) {
      sc.flashes.splice(i, 1);
      continue;
    }
    if (p < 0) continue;
    const k = reduced ? 1 : p < 0.3 ? Math.max(0.2, easeOutBack(p / 0.3)) : 1 - ((p - 0.3) / 0.7) * 0.35;
    const outer = fl.size * k;
    g.globalAlpha = p < 0.55 ? 1 : 1 - (p - 0.55) / 0.45;
    g.beginPath();
    for (let q = 0; q < 16; q++) {
      const rr = q % 2 ? outer * 0.48 : outer * (q % 4 ? 0.85 : 1);
      const a = fl.rot + (q / 16) * TAU;
      g.lineTo(fl.x + Math.cos(a) * rr, fl.y + Math.sin(a) * rr);
    }
    g.closePath();
    g.fillStyle = "#fde047";
    g.fill();
    g.lineJoin = "round";
    g.lineWidth = 3;
    g.strokeStyle = "#ea580c";
    g.stroke();
    g.beginPath();
    g.arc(fl.x, fl.y, outer * 0.3, 0, TAU);
    g.fillStyle = "#ffffff";
    g.fill();
  }
  g.globalAlpha = 1;
  if (sc.rings.length) {
    for (let i = sc.rings.length - 1; i >= 0; i--) {
      const r = sc.rings[i];
      const p = (rt - r.t0) / r.dur;
      if (p >= 1) {
        sc.rings.splice(i, 1);
        continue;
      }
      if (p < 0) continue;
      g.globalAlpha = (1 - p) * 0.9;
      g.strokeStyle = r.color;
      g.lineWidth = r.w * (1 - p * 0.7);
      g.beginPath();
      g.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * easeOut(p), 0, TAU);
      g.stroke();
    }
    g.globalAlpha = 1;
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
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      const a = 1 - q.age / q.life;
      g.globalAlpha = a;
      if (q.kind === 0) {
        g.strokeStyle = q.color;
        g.lineWidth = q.size;
        g.beginPath();
        g.moveTo(q.x, q.y);
        g.lineTo(q.x - q.vx * 0.045, q.y - q.vy * 0.045);
        g.stroke();
      } else if (q.kind === 1) {
        g.fillStyle = q.color;
        const z = q.size * (0.5 + a * 0.5);
        g.fillRect(q.x - z / 2, q.y - z / 2, z, z);
      } else {
        g.fillStyle = q.color;
        g.beginPath();
        g.arc(q.x, q.y, q.size * (0.35 + 0.65 * a), 0, TAU);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  }

  // ----- screen-space labels -----
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  const cssW = W / dpr;
  const intro = phase === "countdown" || (phase === "fight" && fightMs < 2200);
  const labelPx = Math.round(Math.max(9, Math.min(13, cssW / 42)) * dpr);
  g.font = `700 ${labelPx}px ${SANS}`;
  for (const slot of order) {
    const x = sc.sx[slot];
    if (Number.isNaN(x)) continue;
    const y = sc.sy[slot];
    const r = sc.sr[slot];
    const isMe = slot === mySlot;
    const name = (d.names[slot] ?? "").slice(0, 10);
    if (isMe && intro) {
      // A bobbing YOU tag.
      const bob = reduced ? 0 : Math.sin(now / 200) * 2 * dpr;
      const font = Math.round(Math.max(11, Math.min(14, cssW / 34)) * dpr);
      g.font = `800 ${font}px ${SANS}`;
      const tw = g.measureText("YOU").width + font * 0.9;
      const th = font * 1.5;
      const top = y - r - th - 10 * dpr + bob;
      g.fillStyle = "#ffffff";
      drawRoundedRect(g, x - tw / 2, top, tw, th, th / 2);
      g.fill();
      g.beginPath();
      g.moveTo(x - 5 * dpr, top + th - 1);
      g.lineTo(x + 5 * dpr, top + th - 1);
      g.lineTo(x, top + th + 5 * dpr);
      g.fill();
      g.fillStyle = "#0e0c1d";
      g.fillText("YOU", x, top + th / 2 + 1);
      g.font = `700 ${labelPx}px ${SANS}`;
    }
    if (!name) continue;
    const ly = y + r + labelPx * 0.95;
    g.strokeStyle = "rgba(6, 15, 34, 0.85)";
    g.lineWidth = Math.max(2, labelPx * 0.3);
    g.strokeText(name, x, ly);
    g.fillStyle = isMe ? "#ffffff" : (d.colors[slot] ?? "#ffffff");
    g.fillText(name, x, ly);
    if (crowned(slot)) {
      const cs = Math.round(Math.max(14, r * 1.1));
      g.font = `${cs}px ${EMOJI_FONT}`;
      const lift = reduced ? 0 : Math.sin(now / 240) * 2 * dpr;
      g.fillText("👑", x, y - r - cs * 0.55 + lift);
      g.font = `700 ${labelPx}px ${SANS}`;
    }
    // Badges: power-ups and offline.
    const t = tmp;
    if (sampleAt(sc, slot, rt, t)) {
      const badges: string[] = [];
      if (t.flags & F_HEAVY) badges.push(POWER_INFO.heavy.icon);
      if (t.flags & F_TURBO) badges.push(POWER_INFO.turbo.icon);
      if (t.flags & F_OFFLINE) badges.push("💤");
      if (badges.length) {
        const bs = Math.round(Math.max(13 * dpr, r * 0.8));
        g.font = `${bs}px ${EMOJI_FONT}`;
        badges.forEach((b, i) => {
          const bx = x + r * 0.95 + i * bs * 1.05;
          const by = y - r * 0.9;
          g.fillStyle = "rgba(6, 15, 34, 0.8)";
          g.beginPath();
          g.arc(bx, by, bs * 0.68, 0, TAU);
          g.fill();
          g.fillStyle = "#ffffff";
          g.fillText(b, bx, by + bs * 0.06);
        });
        g.font = `700 ${labelPx}px ${SANS}`;
      }
    }
  }

  // Floating texts.
  if (sc.pops.length) {
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
      const size = Math.round((pp.big ? 17 : 22) * dpr * (cssW < 420 ? 0.85 : 1));
      const pop = reduced ? 1 : p < 0.15 ? 0.6 + (p / 0.15) * 0.55 : p < 0.25 ? 1.15 - ((p - 0.15) / 0.1) * 0.15 : 1;
      g.save();
      g.globalAlpha = 1 - p * p;
      g.translate(x, y - (reduced ? 20 : 14 + 36 * easeOut(p)) * dpr);
      g.scale(pop, pop);
      g.font = `900 ${size}px ${SANS}`;
      g.strokeStyle = "rgba(6, 15, 34, 0.9)";
      g.lineWidth = Math.max(2, size * 0.22);
      g.strokeText(pp.text, 0, 0);
      g.fillStyle = pp.color;
      g.fillText(pp.text, 0, 0);
      g.restore();
    }
  }

  // Touch hints and the stick.
  if (sc.coarse && d.steerable && phase === "countdown") {
    g.globalAlpha = 0.85;
    g.font = `800 ${Math.round(11 * dpr)}px ${SANS}`;
    g.fillStyle = "rgba(6, 15, 34, 0.55)";
    drawRoundedRect(g, 8 * dpr, H - 30 * dpr, W / 2 - 16 * dpr, 22 * dpr, 11 * dpr);
    g.fill();
    drawRoundedRect(g, W / 2 + 8 * dpr, H - 30 * dpr, W / 2 - 16 * dpr, 22 * dpr, 11 * dpr);
    g.fill();
    g.fillStyle = "#ffffff";
    g.fillText("🕹️ hold & drag to steer", W / 4, H - 19 * dpr);
    g.fillText("👆 tap to dash", (W * 3) / 4, H - 19 * dpr);
    g.globalAlpha = 1;
  }
  const st = sc.stick;
  if (st) {
    const R = stickRadius(cssW) * dpr;
    const x0 = st.ox * dpr;
    const y0 = st.oy * dpr;
    g.globalAlpha = 0.9;
    g.fillStyle = "rgba(255, 255, 255, 0.12)";
    g.strokeStyle = "rgba(255, 255, 255, 0.5)";
    g.lineWidth = 2 * dpr;
    g.beginPath();
    g.arc(x0, y0, R, 0, TAU);
    g.fill();
    g.stroke();
    let kx = (st.kx - st.ox) * dpr;
    let ky = (st.ky - st.oy) * dpr;
    const m = Math.hypot(kx, ky);
    if (m > R) {
      kx = (kx / m) * R;
      ky = (ky / m) * R;
    }
    g.fillStyle = d.accent;
    g.beginPath();
    g.arc(x0 + kx, y0 + ky, R * 0.45, 0, TAU);
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

  // Red flash at the edges when you fall in.
  const hurt = rt - sc.hurtAt;
  if (hurt >= 0 && hurt < 700) {
    g.globalAlpha = (1 - hurt / 700) * (reduced ? 0.6 : 1);
    g.drawImage(s.hurt, 0, 0, W, H);
    g.globalAlpha = 1;
  }

  const myTotal = myTurbo ? TURBO_CD_MS : DASH_CD_MS;
  const myLeft =
    myCd < 0 ? -1 : pred ? pred.dashLeft(now, myTotal) : Math.max(0, myCd * 100 - (sc.clock.serverNow(now) - myCdAt));
  return { myLeft, myTotal };
}

const stickRadius = (cssW: number) => Math.max(34, Math.min(56, cssW * 0.12));

// ---------- component ----------

export function Rink({
  data,
  input,
  pred,
  onEvent,
  onStick,
  onDash,
  controls,
  label,
  ringColor,
  children,
}: {
  data: RinkData;
  /** Your current stick direction (written by the client's input handling). */
  input: RefObject<InputState>;
  /** Your disc's predictor (players only); the client records inputs into it. */
  pred: SumoPredictor | null;
  onEvent: (fn: (e: unknown) => void) => () => void;
  /** Touch stick moved: direction with magnitude <= 1 (0, 0 = released). */
  onStick: (x: number, y: number) => void;
  onDash: () => void;
  /** The DASH button row under the rink (players only). */
  controls: { enabled: boolean; presses: number; hint: ReactNode } | null;
  label: string;
  ringColor: string;
  children?: ReactNode;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** The DASH button: the loop keeps its --sumo-cd (0..1 recharge left) current. */
  const meterRef = useRef<HTMLButtonElement>(null);
  const scene = useRef<Scene>(newScene());
  const surface = useRef<Surface | null>(null);
  const { view } = data;

  // Frames arrive two ways: snapshot events (20/s) and the view (on big moments).
  const onSnap = useEffectEvent((snap: Snap) => {
    const mine = pred && data.mySlot >= 0 ? { pred, slot: data.mySlot, data } : undefined;
    pushFrame(scene.current, snap, performance.now(), mine);
  });
  useEffect(() => {
    if (view.snap && typeof view.snap === "object") onSnap(view.snap);
  }, [view]);
  useEffect(
    () =>
      onEvent((e) => {
        const s = e as Snap | null;
        if (s && typeof s === "object" && s.k === "s" && typeof s.t === "number" && Array.isArray(s.p)) onSnap(s);
      }),
    [onEvent],
  );
  // Your inputs are stamped with the playback clock's idea of server time.
  useEffect(() => pred?.attachClock(scene.current.clock), [pred]);

  // Crisp backing store at any devicePixelRatio.
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
      surface.current = {
        W,
        H,
        dpr,
        bg: renderBackground(W, H),
        hurt: renderHurt(),
        shadow: cur?.shadow ?? renderShadow(),
        glow: cur?.glow ?? renderGlow(),
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
  }, []);

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
    // Once the match is over and everything has settled, stop redrawing.
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
      const left = Math.max(0, me.myLeft);
      const frac = Math.min(1, left / me.myTotal);
      const v = frac.toFixed(3);
      if (meter.style.getPropertyValue("--sumo-cd") !== v) meter.style.setProperty("--sumo-cd", v);
      const ready = left <= 0 && me.myLeft >= 0 ? "1" : "0";
      if (meter.getAttribute("data-ready") !== ready) meter.setAttribute("data-ready", ready);
    }
  });

  // One animation loop; it pauses with the tab and picks up at the newest frame.
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

  // ----- touch stick (left half) & tap-to-dash (right half); a mouse drags the stick anywhere -----
  const stickTo = (st: Stick, w: number) => {
    const R = stickRadius(w);
    let x = (st.kx - st.ox) / R;
    let y = (st.ky - st.oy) / R;
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
      onDash();
      return;
    }
    if (sc.stick) return;
    sc.stick = { id: e.pointerId, ox: x, oy: y, kx: x, ky: y, at: performance.now() };
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

  return (
    <>
      <div
        ref={holderRef}
        className="relative mx-auto aspect-square w-full overflow-hidden rounded-2xl ring-2 transition-[box-shadow] duration-300 select-none"
        style={{
          maxWidth: "min(100%, 64vh)",
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
          {/* Phones: a visible thumb stick (holding the left half of the rink works too). */}
          <ThumbStick enabled={controls.enabled && data.steerable} accent={data.accent} onStick={onStick} />
          <button
            ref={meterRef}
            type="button"
            aria-label="Dash"
            aria-keyshortcuts="Space Shift"
            disabled={!controls.enabled}
            className="sumo-dash btn h-16 w-40 shrink-0 touch-none rounded-2xl text-lg font-black tracking-wide shadow-lg shadow-black/30 select-none @md:w-48"
            style={{
              ["--sumo-accent" as string]: data.accent,
              borderColor: controls.enabled ? data.accent + "aa" : undefined,
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              onDash();
            }}
            onClick={(e) => {
              // Keyboard activation (pointer presses were handled on pointerdown).
              if (e.detail === 0) onDash();
            }}
          >
            <span className="sumo-dash-fill" aria-hidden />
            <span key={controls.presses} className={controls.presses ? "animate-pop" : ""} aria-hidden>
              💨
            </span>
            DASH
          </button>
          <p className="min-w-0 flex-1 text-xs text-muted pointer-coarse:hidden">{controls.hint}</p>
        </div>
      )}
    </>
  );
}

/** On-screen thumb stick for touch screens: drag from the centre, release to let go. */
function ThumbStick({ enabled, accent, onStick }: { enabled: boolean; accent: string; onStick: (x: number, y: number) => void }) {
  const padRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLSpanElement>(null);
  const active = useRef<number | null>(null);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const el = padRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const R = r.width / 2;
    let x = (e.clientX - (r.left + R)) / R;
    let y = (e.clientY - (r.top + R)) / R;
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    // A small dead zone so a resting thumb doesn't drift the disc.
    const live = m > 0.15;
    onStick(live ? x : 0, live ? y : 0);
    if (knobRef.current) knobRef.current.style.transform = `translate(${x * R * 0.55}px, ${y * R * 0.55}px)`;
  };
  const release = (e: PointerEvent<HTMLDivElement>) => {
    if (active.current !== e.pointerId) return;
    active.current = null;
    onStick(0, 0);
    if (knobRef.current) knobRef.current.style.transform = "";
  };
  return (
    <div
      ref={padRef}
      role="presentation"
      aria-hidden
      className={`relative hidden size-28 shrink-0 touch-none place-items-center rounded-full border-2 bg-white/5 select-none pointer-coarse:grid ${
        enabled ? "" : "opacity-40"
      }`}
      style={{ borderColor: enabled ? accent + "aa" : "var(--color-line)" }}
      onPointerDown={(e) => {
        if (!enabled) return;
        e.preventDefault();
        active.current = e.pointerId;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic pointers can't be captured */
        }
        move(e);
      }}
      onPointerMove={(e) => {
        if (active.current === e.pointerId) move(e);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <span className="pointer-events-none absolute inset-3 rounded-full border border-dashed border-white/20" />
      <span
        ref={knobRef}
        className="pointer-events-none size-12 rounded-full border-2 border-white/90 shadow-[0_4px_12px_rgb(0_0_0/0.45)] transition-transform duration-75"
        style={{ background: accent }}
      />
    </div>
  );
}

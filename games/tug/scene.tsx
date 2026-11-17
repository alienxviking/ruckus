"use client";

// The rope: a canvas scene with both teams heaving on a wobbly rope over a mud pit, a flag in the
// middle and a crowd going wild behind them. It eases toward the server's rope position with a
// slightly springy follow (so every heave overshoots a touch), shakes with tension, sends waves
// down the rope on big pulls, and dunks the losers in the mud when a round is decided.

import { useEffect, useEffectEvent, useRef } from "react";
import { drawAvatar, preloadAvatars } from "@/lib/avatar-art";
import { TEAMS } from "@/shared/teams";
import { LINE, isSnap, type Phase, type Snap } from "./shared";

export interface SceneData {
  phase: Phase;
  round: number;
  ids: string[];
  team: number[];
  avatars: string[];
  offline: boolean[];
  mySlot: number;
  frenzy: boolean;
  reduced: boolean;
  /** Team that took the round on show (roundOver / final), -1 = draw or none. */
  winner: number;
  accent: string;
  snap: Snap;
}

/** Your own taps, for an instant twitch before the server answers. */
export interface Kick {
  n: number;
  team: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  r: number;
  g: number;
}
interface Pop {
  x: number;
  y: number;
  text: string;
  color: string;
  t0: number;
}
interface Wave {
  t0: number;
  amp: number;
}

interface SceneState {
  x: number;
  v: number;
  target: number;
  round: number;
  snapT: number;
  strain: number[];
  popAt: number[];
  force: [number, number];
  excite: [number, number];
  parts: Particle[];
  pops: Pop[];
  waves: Wave[];
  kicks: number;
  shake: number;
  phase: Phase | "";
  phaseAt: number;
  last: number;
  dustAt: number;
}

const TAU = Math.PI * 2;
const ROPE = "#d6a85c";
const ROPE_DARK = "#8a6430";

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function RopeScene({
  data,
  onEvent,
  kickRef,
  label,
}: {
  data: SceneData;
  onEvent: (fn: (e: unknown) => void) => () => void;
  kickRef: { current: Kick };
  label: string;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const st = useRef<SceneState>({
    x: 0,
    v: 0,
    target: 0,
    round: 0,
    snapT: 0,
    strain: [],
    popAt: [],
    force: [0, 0],
    excite: [0, 0],
    parts: [],
    pops: [],
    waves: [],
    kicks: 0,
    shake: 0,
    phase: "",
    phaseAt: 0,
    last: -1,
    dustAt: 0,
  });

  const take = useEffectEvent((snap: Snap) => {
    const s = st.current;
    if (snap.n < s.round || (snap.n === s.round && snap.t <= s.snapT)) return;
    if (snap.n !== s.round) {
      s.round = snap.n;
      s.x = snap.p / 10;
      s.v = 0;
      s.waves = [];
    }
    s.snapT = snap.t;
    s.target = snap.p / 10;
    s.force = [snap.f[0] / 10, snap.f[1] / 10];
    const now = performance.now();
    const big = Math.max(s.force[0], s.force[1]);
    if (big > 6) s.waves.push({ t0: now, amp: Math.min(1, big / 25) });
    if (s.waves.length > 6) s.waves.shift();
    for (let i = 0; i < snap.w.length; i++) {
      const w = Number(snap.w[i]) || 0;
      s.strain[i] = Math.max(s.strain[i] ?? 0, w / 6);
    }
  });

  useEffect(() => {
    if (isSnap(data.snap)) take(data.snap);
  }, [data.snap]);
  useEffect(() => onEvent((e) => isSnap(e) && take(e)), [onEvent]);

  const paint = useEffectEvent((now: number) => {
    const c = canvas.current;
    if (!c || c.width < 4) return;
    const g = c.getContext("2d");
    if (!g) return;
    draw(g, c.width, c.height, Math.min(2.5, Math.max(1, window.devicePixelRatio || 1)), st.current, data, kickRef.current, now);
  });

  useEffect(() => {
    preloadAvatars();
    const h = holder.current;
    const c = canvas.current;
    if (!h || !c) return;
    const fit = () => {
      const r = h.getBoundingClientRect();
      const dpr = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
      const W = Math.round(r.width * dpr);
      const H = Math.round(r.height * dpr);
      if (W > 0 && H > 0 && (c.width !== W || c.height !== H)) {
        c.width = W;
        c.height = H;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(h);
    let raf = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      paint(t);
    };
    raf = requestAnimationFrame(loop);
    const vis = () => {
      st.current.last = -1;
    };
    document.addEventListener("visibilitychange", vis);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);

  return (
    <div ref={holder} className="tw-scene relative w-full overflow-hidden rounded-2xl border border-line bg-[#0c1020]">
      <canvas ref={canvas} role="img" aria-label={label} className="absolute inset-0 h-full w-full" />
    </div>
  );
}

// ---------- drawing ----------

function burst(s: SceneState, x: number, y: number, n: number, color: string, speed: number, size: number, grav = 600) {
  for (let i = 0; i < n && s.parts.length < 260; i++) {
    const a = Math.random() * TAU;
    const sp = speed * (0.35 + Math.random() * 0.65);
    s.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - speed * 0.5, life: 0, max: 0.6 + Math.random() * 0.7, color, r: size * (0.5 + Math.random()), g: grav });
  }
}

function draw(g: CanvasRenderingContext2D, W: number, H: number, dpr: number, s: SceneState, d: SceneData, kick: Kick, now: number) {
  const dt = s.last < 0 ? 0 : Math.min(0.05, (now - s.last) / 1000);
  s.last = now;
  const t = now / 1000;
  const motion = d.reduced ? 0.25 : 1;
  const cx = W / 2;
  const L = W * 0.2;
  const groundY = H * 0.8;
  const size = Math.max(20 * dpr, Math.min(44 * dpr, W / 15, H / 5.2));
  const ropeY = groundY - size * 1.45;

  // ----- phase changes -----
  if (d.phase !== s.phase) {
    const was = s.phase;
    s.phase = d.phase;
    s.phaseAt = now;
    if ((d.phase === "roundOver" || d.phase === "final") && was === "pull" && d.winner >= 0) {
      const col = TEAMS[d.winner].color;
      burst(s, d.winner === 0 ? cx - L : cx + L, ropeY, d.reduced ? 10 : 60, col, 520 * dpr, 3 * dpr, 500 * dpr);
      burst(s, cx, groundY, d.reduced ? 6 : 26, "#7a5230", 380 * dpr, 4 * dpr, 900 * dpr);
      s.shake = 1;
    }
    if (d.phase === "countdown") {
      s.x = 0;
      s.v = 0;
      s.target = 0;
    }
  }

  // ----- your own taps: an instant twitch your way -----
  if (kick.n !== s.kicks) {
    const add = kick.n - s.kicks;
    s.kicks = kick.n;
    if (add > 0 && add < 50 && d.phase === "pull") s.v += (kick.team === 0 ? -1 : 1) * Math.min(4, add) * 9;
  }

  // ----- rope physics (display only): a springy follow of the server's flag -----
  const k = 70;
  const damp = 2 * Math.sqrt(k) * 0.62;
  s.v += ((s.target - s.x) * k - s.v * damp) * dt;
  s.x += s.v * dt;
  s.x = Math.max(-LINE * 1.08, Math.min(LINE * 1.08, s.x));
  const decay = Math.exp(-dt * 3.2);
  for (let i = 0; i < s.strain.length; i++) s.strain[i] = (s.strain[i] ?? 0) * decay;
  for (const tm of [0, 1] as const) {
    const share = s.force[tm] / (s.force[0] + s.force[1] + 3);
    s.excite[tm] += (share - s.excite[tm]) * Math.min(1, dt * 4);
  }
  s.force[0] *= Math.exp(-dt * 6);
  s.force[1] *= Math.exp(-dt * 6);
  s.shake *= Math.exp(-dt * 5);

  const flagX = cx + (s.x / LINE) * L;
  const shift = flagX - cx;
  const tension = Math.min(1, (Math.abs(s.v) / 40 + (s.force[0] + s.force[1]) / 30) * 0.8);
  const decided = d.phase === "roundOver" || d.phase === "final";
  const since = (now - s.phaseAt) / 1000;

  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  const sh = s.shake * 6 * dpr * motion;
  if (sh > 0.2) g.translate(Math.sin(t * 61) * sh, Math.cos(t * 47) * sh);

  // ----- sky & crowd -----
  const sky = g.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, d.frenzy && d.phase === "pull" ? `rgba(120, 40, 10, ${0.55 + 0.25 * Math.sin(t * 9)})` : "#0b1024");
  sky.addColorStop(1, "#1a1530");
  g.fillStyle = sky;
  g.fillRect(-20, -20, W + 40, groundY + 20);
  const side = [rgba(TEAMS[0].color, 0.16), rgba(TEAMS[1].color, 0.16)];
  g.fillStyle = side[0];
  g.fillRect(-20, 0, cx - L + 20, groundY);
  g.fillStyle = side[1];
  g.fillRect(cx + L, 0, W - cx - L + 20, groundY);

  const fanR = Math.max(4 * dpr, W / 90);
  const rows = 3;
  for (let row = 0; row < rows; row++) {
    const y0 = H * 0.12 + row * fanR * 2.3;
    const step = fanR * 2.4;
    for (let x = fanR + (row % 2) * fanR * 1.2; x < W; x += step) {
      const tm = x < cx ? 0 : 1;
      const mid = Math.abs(x - cx) < L * 0.5;
      const hype = decided ? (d.winner === tm ? 1 : 0.1) : s.excite[tm];
      const seed = Math.sin(x * 12.9898 + row * 78.233) * 43758.5453;
      const ph = seed - Math.floor(seed);
      const jump = Math.max(0, Math.sin(t * (6 + hype * 8) + ph * TAU)) * (1 + hype * 7) * dpr * motion;
      g.fillStyle = mid ? "rgba(200, 200, 230, 0.18)" : rgba(TEAMS[tm].color, 0.25 + 0.35 * ph);
      g.beginPath();
      g.arc(x, y0 - jump, fanR, 0, TAU);
      g.fill();
      if (hype > 0.55 && ph > 0.6) {
        g.fillRect(x - fanR * 0.15, y0 - jump - fanR * 3, fanR * 0.3, fanR * 2);
      }
    }
  }

  // ----- ground & mud -----
  const gr = g.createLinearGradient(0, groundY, 0, H);
  gr.addColorStop(0, "#2d5a2c");
  gr.addColorStop(1, "#16301a");
  g.fillStyle = gr;
  g.fillRect(-20, groundY, W + 40, H - groundY + 20);
  g.fillStyle = "#5b3b1f";
  g.beginPath();
  g.ellipse(cx, groundY + (H - groundY) * 0.32, L * 0.62, (H - groundY) * 0.3, 0, 0, TAU);
  g.fill();
  g.fillStyle = "rgba(255, 220, 170, 0.12)";
  g.beginPath();
  g.ellipse(cx - L * 0.12, groundY + (H - groundY) * 0.24, L * 0.3, (H - groundY) * 0.08, 0, 0, TAU);
  g.fill();

  // ----- win lines -----
  for (const tm of [0, 1] as const) {
    const lx = tm === 0 ? cx - L : cx + L;
    const col = TEAMS[tm].color;
    const near = tm === 0 ? Math.max(0, -s.x / LINE) : Math.max(0, s.x / LINE);
    g.strokeStyle = rgba(col, 0.45 + 0.5 * near);
    g.lineWidth = (2 + 3 * near) * dpr;
    g.setLineDash([6 * dpr, 6 * dpr]);
    g.lineDashOffset = -t * 20 * dpr;
    g.beginPath();
    g.moveTo(lx, H * 0.36);
    g.lineTo(lx, H);
    g.stroke();
    g.setLineDash([]);
    if (near > 0.7 && d.phase === "pull") {
      g.fillStyle = rgba(col, (near - 0.7) * (0.5 + 0.5 * Math.sin(t * 14)));
      g.fillRect(lx - 10 * dpr, H * 0.36, 20 * dpr, H);
    }
    g.font = `800 ${Math.round(Math.max(9 * dpr, size * 0.32))}px system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "bottom";
    g.fillStyle = col;
    g.fillText(TEAMS[tm].name.toUpperCase(), lx, H * 0.36 - 2 * dpr);
  }

  // ----- rope -----
  const wav = (x: number) => {
    let y = 0;
    const tens = 0.4 + tension;
    y += Math.sin(x * 0.045 / dpr - t * 9) * 1.2 * dpr * tens * motion;
    for (const w of s.waves) {
      const age = (now - w.t0) / 1000;
      if (age > 0.7) continue;
      const front = age * W * 1.4;
      const dist = Math.abs(Math.abs(x - flagX) - front);
      y += Math.exp(-(dist * dist) / (2 * (30 * dpr) ** 2)) * w.amp * 7 * dpr * (1 - age / 0.7) * motion;
    }
    if (decided) y += Math.sin(x * 0.02 / dpr) * 3 * dpr * Math.exp(-since * 2);
    return ropeY + y;
  };
  g.lineCap = "round";
  g.strokeStyle = "rgba(0,0,0,0.35)";
  g.lineWidth = size * 0.22;
  g.beginPath();
  for (let x = -10; x <= W + 10; x += 6 * dpr) {
    if (x === -10) g.moveTo(x, wav(x) + 4 * dpr);
    else g.lineTo(x, wav(x) + 4 * dpr);
  };
  g.stroke();
  g.strokeStyle = ROPE;
  g.lineWidth = size * 0.18;
  g.beginPath();
  for (let x = -10; x <= W + 10; x += 6 * dpr) {
    if (x === -10) g.moveTo(x, wav(x));
    else g.lineTo(x, wav(x));
  };
  g.stroke();
  // Twist marks slide with the rope, so you can see it move.
  g.strokeStyle = ROPE_DARK;
  g.lineWidth = size * 0.07;
  g.setLineDash([size * 0.12, size * 0.22]);
  g.lineDashOffset = -shift;
  g.beginPath();
  for (let x = -10; x <= W + 10; x += 6 * dpr) {
    if (x === -10) g.moveTo(x, wav(x));
    else g.lineTo(x, wav(x));
  };
  g.stroke();
  g.setLineDash([]);

  // ----- pullers -----
  const strainOf = (slot: number) => Math.min(1, s.strain[slot] ?? 0);
  for (const tm of [0, 1] as const) {
    const dir = tm === 0 ? -1 : 1;
    const members = d.ids.map((_, i) => i).filter((i) => d.team[i] === tm);
    const n = members.length;
    const g0 = Math.max(W * 0.075, size * 0.9);
    const room = cx - g0 - size * 0.6;
    const sp = Math.min(size * 1.05, room / Math.max(1, n - 1));
    const lost = decided && d.winner >= 0 && d.winner !== tm;
    const won = decided && d.winner === tm;
    members.forEach((slot, i) => {
      let px = cx + dir * (g0 + i * sp) + shift;
      // Bunch up at the edge rather than walk off it.
      const edge = size * 0.5 + (n - 1 - i) * size * 0.3;
      px = Math.max(edge, Math.min(W - edge, px));
      const str = d.phase === "pull" ? Math.max(strainOf(slot), 0.2 + 0.25 * s.excite[tm]) : d.phase === "countdown" ? 0.15 : 0.1;
      let lean = dir * (0.3 + 0.5 * str);
      let feetY = groundY;
      let bob = 0;
      if (lost && i < 2) {
        // The front two topple into the mud.
        const p = Math.min(1, since * 2.2);
        lean = -dir * 1.2 * p;
        feetY = groundY + (H - groundY) * 0.25 * p;
        if (p < 1 && Math.random() < 0.3 * motion) burst(s, px, groundY + 4 * dpr, 1, "#7a5230", 200 * dpr, 3 * dpr, 900 * dpr);
      } else if (won) {
        bob = Math.abs(Math.sin(t * 10 + slot)) * size * 0.4 * motion;
        lean = dir * 0.1;
      } else if (d.phase === "pull" && str > 0.45) {
        bob = (Math.random() - 0.5) * 1.6 * dpr * motion;
      }
      const body = size * 1.0;
      const hipX = px + Math.sin(lean) * body * 0.35;
      const hipY = feetY - body * 0.45 - bob;
      const shX = px + Math.sin(lean) * body;
      const shY = feetY - Math.cos(lean) * body - bob;
      const col = TEAMS[tm].color;
      g.globalAlpha = d.offline[slot] ? 0.35 : 1;
      // Legs braced against the pull.
      g.strokeStyle = "#0b0e18";
      g.lineWidth = size * 0.2;
      g.beginPath();
      g.moveTo(hipX, hipY);
      g.lineTo(px - dir * size * 0.32, feetY);
      g.moveTo(hipX, hipY);
      g.lineTo(px + dir * size * 0.12, feetY);
      g.stroke();
      // Torso.
      g.strokeStyle = col;
      g.lineWidth = size * 0.36;
      g.beginPath();
      g.moveTo(hipX, hipY);
      g.lineTo(shX, shY);
      g.stroke();
      // Arms to the rope.
      const handX = px - dir * size * 0.55;
      const handY = lost && i < 2 ? shY + size * 0.3 : wav(handX);
      g.strokeStyle = col;
      g.lineWidth = size * 0.14;
      g.beginPath();
      g.moveTo(shX, shY);
      g.lineTo(handX, handY);
      g.stroke();
      g.fillStyle = "#f3d2b3";
      g.beginPath();
      g.arc(handX, handY, size * 0.1, 0, TAU);
      g.fill();
      // Head.
      const hx = shX + Math.sin(lean) * size * 0.35;
      const hy = shY - Math.cos(lean) * size * 0.35 - size * 0.12;
      drawAvatar(g, d.avatars[slot], hx, hy, size * 0.95);
      g.globalAlpha = 1;
      if (slot === d.mySlot) {
        g.fillStyle = "#fff";
        g.font = `900 ${Math.round(size * 0.32)}px system-ui, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "bottom";
        const ay = hy - size * 0.6 - Math.abs(Math.sin(t * 4)) * 3 * dpr * motion;
        g.fillText("YOU", hx, ay);
        g.beginPath();
        g.moveTo(hx - 4 * dpr, ay + 1 * dpr);
        g.lineTo(hx + 4 * dpr, ay + 1 * dpr);
        g.lineTo(hx, ay + 6 * dpr);
        g.fill();
      }
      // Effort pops and dust.
      if (d.phase === "pull" && (s.strain[slot] ?? 0) > 0.5 && now - (s.popAt[slot] ?? 0) > 450) {
        s.popAt[slot] = now;
        s.pops.push({ x: hx + (Math.random() - 0.5) * size * 0.4, y: hy - size * 0.55, text: Math.random() < 0.5 ? "💪" : "HUP!", color: col, t0: now });
        if (s.pops.length > 24) s.pops.shift();
        burst(s, px - dir * size * 0.3, feetY, d.reduced ? 1 : 3, "#9b7b52", 120 * dpr, 2.2 * dpr, 500 * dpr);
      }
    });
  }

  // ----- the flag -----
  const fy = wav(flagX);
  const glow = g.createRadialGradient(flagX, fy, 0, flagX, fy, size * 1.6);
  const lead = s.x < -3 ? TEAMS[0].color : s.x > 3 ? TEAMS[1].color : d.accent;
  glow.addColorStop(0, rgba(lead, 0.45));
  glow.addColorStop(1, rgba(lead, 0));
  g.fillStyle = glow;
  g.fillRect(flagX - size * 1.6, fy - size * 1.6, size * 3.2, size * 3.2);
  const fl = size * 1.2;
  const flap = Math.sin(t * 12) * size * 0.12 * motion;
  g.fillStyle = d.accent;
  g.strokeStyle = "#fff";
  g.lineWidth = 1.5 * dpr;
  g.beginPath();
  g.moveTo(flagX - size * 0.22, fy);
  g.lineTo(flagX + size * 0.22, fy);
  g.quadraticCurveTo(flagX + size * 0.3 + flap, fy + fl * 0.6, flagX + flap * 1.6, fy + fl);
  g.quadraticCurveTo(flagX - size * 0.3 + flap, fy + fl * 0.6, flagX - size * 0.22, fy);
  g.fill();
  g.stroke();
  g.fillStyle = "#fff";
  g.beginPath();
  g.arc(flagX, fy, size * 0.15, 0, TAU);
  g.fill();

  // Momentum arrow over the flag.
  if (d.phase === "pull" && Math.abs(s.v) > 4) {
    const tm = s.v < 0 ? 0 : 1;
    const len = Math.min(size * 2.4, Math.abs(s.v) * dpr * 0.9);
    const ay = ropeY - size * 1.9;
    const dir = tm === 0 ? -1 : 1;
    g.strokeStyle = TEAMS[tm].color;
    g.fillStyle = TEAMS[tm].color;
    g.lineWidth = 4 * dpr;
    g.beginPath();
    g.moveTo(flagX, ay);
    g.lineTo(flagX + dir * len, ay);
    g.stroke();
    g.beginPath();
    g.moveTo(flagX + dir * (len + 9 * dpr), ay);
    g.lineTo(flagX + dir * len, ay - 6 * dpr);
    g.lineTo(flagX + dir * len, ay + 6 * dpr);
    g.fill();
  }

  // ----- particles & pops -----
  for (const p of s.parts) {
    p.life += dt;
    p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const a = 1 - p.life / p.max;
    if (a <= 0) continue;
    g.globalAlpha = a;
    g.fillStyle = p.color;
    g.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
  }
  g.globalAlpha = 1;
  s.parts = s.parts.filter((p) => p.life < p.max);
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const p of s.pops) {
    const age = (now - p.t0) / 700;
    if (age >= 1) continue;
    g.globalAlpha = 1 - age;
    g.font = `900 ${Math.round(size * 0.36)}px system-ui, sans-serif`;
    g.fillStyle = p.color;
    g.fillText(p.text, p.x, p.y - age * size * 0.8);
  }
  g.globalAlpha = 1;
  s.pops = s.pops.filter((p) => now - p.t0 < 700);

  // Celebration confetti keeps falling while a win is on screen.
  if (decided && d.winner >= 0 && since < 3 && Math.random() < 0.6 * motion) {
    const col = Math.random() < 0.5 ? TEAMS[d.winner].color : "#ffe14d";
    s.parts.push({ x: Math.random() * W, y: -5, vx: (Math.random() - 0.5) * 60 * dpr, vy: 60 * dpr, life: 0, max: 2.2, color: col, r: 2.5 * dpr, g: 90 * dpr });
  }
  g.restore();
}

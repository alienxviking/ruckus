"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameClientProps } from "@/shared/client-game";
import { Note, PlayerChip, useSecondsLeft, useTicker } from "@/components/game-ui";
import type { Player } from "@/shared/types";
import { feedback, sfx } from "@/lib/feedback";
import {
  BLOCK_H,
  GAP_MS,
  KEEP,
  RESTART_MS,
  land,
  motion,
  offsetAt,
  slidingRect,
  towerPoints,
  type Rect,
  type Row,
  type StackAction,
  type StackEvent,
  type StackView,
  type TowerView,
} from "./shared";

type Props = GameClientProps<StackView, StackAction>;

const C30 = Math.cos(Math.PI / 6);
const S30 = 0.5;
const hueOf = (lv: number) => (38 + lv * 9) % 360;

const CSS = `
.ts-stage { position: relative; overflow: hidden; border-radius: .9rem; touch-action: manipulation; user-select: none; -webkit-user-select: none; cursor: pointer;
  height: clamp(380px, 68vh, 640px); background: #070815; }
.ts-stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.ts-hud { position: absolute; inset: 0; pointer-events: none; display: flex; flex-direction: column; align-items: center; padding: 14px 12px; text-align: center; }
.ts-h { font-family: var(--font-display); font-weight: 900; font-size: clamp(3rem, 12vw, 4.6rem); line-height: 1; color: #fff;
  text-shadow: 0 4px 30px rgb(0 0 0 / .6), 0 0 24px color-mix(in oklab, var(--acc) 60%, transparent); }
.ts-pop { animation: ts-pop .28s cubic-bezier(.2,1.8,.4,1) both; }
@keyframes ts-pop { from { transform: scale(1.35); } to { transform: none; } }
.ts-perfect { position: absolute; top: 34%; left: 50%; transform: translateX(-50%); font-family: var(--font-display); font-weight: 900; letter-spacing: .06em;
  font-size: 1.6rem; color: #fff; text-shadow: 0 0 18px #fff, 0 0 40px var(--acc); animation: ts-rise 1s ease-out both; white-space: nowrap; }
@keyframes ts-rise { 0% { opacity: 0; transform: translate(-50%, 12px) scale(.7); } 20% { opacity: 1; transform: translate(-50%, 0) scale(1.08); } 100% { opacity: 0; transform: translate(-50%, -40px) scale(1); } }
.ts-big { font-family: var(--font-display); font-weight: 900; font-size: clamp(2.4rem, 9vw, 3.6rem); color: #fff; text-shadow: 0 0 30px var(--acc); }
.ts-count { animation: ts-count .9s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes ts-count { 0% { transform: scale(2); opacity: 0; } 30% { transform: scale(1); opacity: 1; } 100% { opacity: .8; } }
.ts-chip { background: rgb(7 8 21 / .55); border: 1px solid rgb(255 255 255 / .12); border-radius: 999px; padding: 3px 10px; font-family: var(--font-mono); font-size: 12px; color: #dfe3f0; backdrop-filter: blur(4px); }
.ts-tap { animation: ts-blink 1.6s ease-in-out infinite; }
@keyframes ts-blink { 50% { opacity: .45; } }
`;

/** The tower as this client believes it to be (server view plus our own predicted drops). */
interface Local extends TowerView {
  predictedAt: number;
}

type Hud = Pick<TowerView, "n" | "lv" | "score" | "combo" | "alive" | "restartAt">;

interface Fx {
  kind: "chip" | "ring";
  rect: Rect;
  lv: number;
  born: number;
  vy: number;
}

export default function TowerStack({ view, me, byId, isPlayer, act, serverNow, onEvent, accent, players }: Props) {
  useTicker(250);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const localRef = useRef<Local | null>(null);
  const fxRef = useRef<Fx[]>([]);
  const viewRef = useRef<StackView | null>(view);
  const [hud, setHud] = useState<Hud | null>(null);
  const commit = useCallback((next: Local) => {
    localRef.current = next;
    setHud({ n: next.n, lv: next.lv, score: next.score, combo: next.combo, alive: next.alive, restartAt: next.restartAt });
  }, []);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  const [fallNote, setFallNote] = useState<{ text: string; n: number } | null>(null);
  const toastN = useRef(0);

  const src: TowerView | null = view?.me?.tower ?? view?.watch?.tower ?? null;
  const mine = !!view?.me && isPlayer;

  // Adopt the server's tower when it has caught up with (or overruled) our prediction.
  useEffect(() => {
    viewRef.current = view;
    if (!src) return;
    const L = localRef.current;
    const adopt =
      !L ||
      !mine ||
      src.n !== L.n ||
      src.lv >= L.lv ||
      !src.alive ||
      performance.now() - L.predictedAt > 1500;
    if (!adopt) return;
    if (L && src.n === L.n && src.lv > L.lv) {
      // A drop we didn't predict (idle fall, or someone we're watching): a little ring.
      fxRef.current.push({ kind: "ring", rect: src.top[src.top.length - 1], lv: src.lv - 1, born: performance.now(), vy: 0 });
      if (!mine) sfx("bump");
    }
    commit({ ...src, top: src.top.slice(), predictedAt: L?.predictedAt ?? 0 });
  }, [view, src, mine, commit]);

  useEffect(
    () =>
      onEvent((e) => {
        const ev = e as StackEvent;
        if (ev?.t !== "fall" || ev.id === me) return;
        const p = byId[ev.id];
        if (p) setFallNote({ text: `${p.name}'s tower toppled at ${ev.h}`, n: ++toastN.current });
      }),
    [onEvent, me, byId],
  );

  const playing = !!view && view.phase === "play";

  const drop = useCallback(() => {
    const v = viewRef.current;
    const L = localRef.current;
    if (!v || !L || !mine || v.phase !== "play" || !L.alive) return;
    const t = serverNow() - L.spawnAt;
    if (t < 0) return;
    const m = motion(v.seed, L.lv, v.speed);
    const top = L.top[L.top.length - 1];
    const off = offsetAt(m, t);
    const res = land(top, m, off, L.combo);
    act({ type: "drop", lv: L.lv, t });
    const now = performance.now();
    if (res.chip) fxRef.current.push({ kind: "chip", rect: res.chip, lv: L.lv, born: now, vy: 0 });
    if (res.rect) {
      const top2 = [...L.top, res.rect];
      const cut = Math.max(0, top2.length - KEEP);
      const perfects = L.perfects + (res.kind === "perfect" ? 1 : 0);
      commit({
        ...L,
        top: top2.slice(cut),
        from: L.from + cut,
        lv: L.lv + 1,
        combo: res.combo,
        perfects,
        score: towerPoints(L.lv, perfects),
        spawnAt: L.spawnAt + t + GAP_MS,
        predictedAt: now,
      });
      if (res.kind === "perfect") {
        fxRef.current.push({ kind: "ring", rect: res.rect, lv: L.lv, born: now, vy: 0 });
        setToast({ text: res.combo >= 2 ? `PERFECT ×${res.combo}` : "PERFECT!", n: ++toastN.current });
        feedback("score");
      } else {
        sfx("bump");
      }
    } else {
      const left = v.me?.triesLeft ?? 0;
      commit({ ...L, alive: false, combo: 0, restartAt: left > 0 ? L.spawnAt + t + RESTART_MS : null, predictedAt: now });
      feedback("out");
    }
  }, [mine, serverNow, act, commit]);

  // Keys: Space / Enter / ↓ drop.
  useEffect(() => {
    if (!mine || !playing) return;
    const onKey = (e: KeyboardEvent) => {
      const tEl = e.target as HTMLElement | null;
      if (tEl && (tEl.tagName === "INPUT" || tEl.tagName === "TEXTAREA" || tEl.isContentEditable)) return;
      if (e.key === " " || e.key === "Enter" || e.key === "ArrowDown") {
        if (tEl && tEl.tagName === "BUTTON" && e.key !== "ArrowDown") return;
        e.preventDefault();
        if (!e.repeat) drop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mine, playing, drop]);

  // Countdown and go cues.
  const phase = view?.phase;
  const prevPhase = useRef(phase);
  useEffect(() => {
    if (prevPhase.current === "ready" && phase === "play") feedback("go");
    prevPhase.current = phase;
  }, [phase]);

  // The render loop: everything visual lives in refs, so React only re-renders for the HUD.
  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const ctx2 = canvas.getContext("2d");
    if (!ctx2) return;
    let W = 0;
    let H = 0;
    let dpr = 1;
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = stage.clientWidth;
      H = stage.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(stage);
    const stars = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.3 + 0.3, a: Math.random() * 0.6 + 0.2 }));
    let camY = 0;
    let last = performance.now();
    let flash = 0;
    let raf = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const v = viewRef.current;
      const L = localRef.current;
      const g = ctx2;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const k = Math.min((W * 0.6) / 173, H / 260);
      const cx = W / 2;
      const baseY = H * 0.72;
      const topLv = L ? L.lv - 1 : 0;
      const target = Math.max(0, topLv - 3) * BLOCK_H;
      camY += (target - camY) * Math.min(1, dt * 5);

      // Sky: deepens and shifts hue as the tower climbs.
      const sh = (230 + camY * 0.12) % 360;
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, `hsl(${sh} 55% 7%)`);
      sky.addColorStop(1, `hsl(${(sh + 40) % 360} 45% 14%)`);
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
      for (const s of stars) {
        const y = (((s.y * H + camY * 0.35 * k) % H) + H) % H;
        g.globalAlpha = s.a;
        g.fillStyle = "#fff";
        g.fillRect(s.x * W, y, s.r, s.r);
      }
      g.globalAlpha = 1;
      // Soft glow behind the top of the tower.
      const glow = g.createRadialGradient(cx, baseY - 70 * k, 10, cx, baseY - 70 * k, Math.max(W, H) * 0.6);
      glow.addColorStop(0, `hsla(${hueOf(topLv)}, 90%, 60%, .16)`);
      glow.addColorStop(1, "transparent");
      g.fillStyle = glow;
      g.fillRect(0, 0, W, H);

      const P = (x: number, y: number, z: number): [number, number] => [cx + (x - z) * C30 * k, baseY + (x + z) * S30 * k - (y - camY) * k];
      const poly = (pts: [number, number][], fill: string | CanvasGradient) => {
        g.beginPath();
        g.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
        g.closePath();
        g.fillStyle = fill;
        g.fill();
      };
      const box = (r: Rect, y0: number, y1: number, hue: number, alpha = 1, white = 0, sat = 1) => {
        const x0 = r[0] - r[2] / 2;
        const x1 = r[0] + r[2] / 2;
        const z0 = r[1] - r[3] / 2;
        const z1 = r[1] + r[3] / 2;
        g.globalAlpha = alpha;
        const lt = (l: number) => Math.min(96, l + white * (96 - l));
        const edge = `hsla(${hue}, 60%, 12%, .45)`;
        g.lineWidth = 1;
        g.strokeStyle = edge;
        poly([P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1), P(x1, y0, z0)], `hsl(${hue} ${72 * sat}% ${lt(46)}%)`);
        g.stroke();
        poly([P(x0, y1, z1), P(x1, y1, z1), P(x1, y0, z1), P(x0, y0, z1)], `hsl(${hue} ${68 * sat}% ${lt(34)}%)`);
        g.stroke();
        const a = P(x0, y1, z0);
        const c = P(x1, y1, z1);
        const top = g.createLinearGradient(a[0], a[1], c[0], c[1]);
        top.addColorStop(0, `hsl(${hue} ${85 * sat}% ${lt(72)}%)`);
        top.addColorStop(1, `hsl(${hue} ${78 * sat}% ${lt(60)}%)`);
        poly([a, P(x1, y1, z0), c, P(x0, y1, z1)], top);
        g.strokeStyle = `hsla(${hue}, 100%, 88%, .35)`;
        g.lineWidth = 1;
        g.stroke();
        g.globalAlpha = 1;
      };

      // Pedestal.
      if (L) {
        const base: Rect = L.from === 0 ? L.top[0] : [0, 0, 100, 100];
        // Plinth: dark, so the coloured tower pops.
        {
          const e = 56;
          poly([P(e, 0, -e), P(e, 0, e), P(e, -60 * BLOCK_H, e), P(e, -60 * BLOCK_H, -e)], "#191c2e");
          poly([P(-e, 0, e), P(e, 0, e), P(e, -60 * BLOCK_H, e), P(-e, -60 * BLOCK_H, e)], "#10121f");
          poly([P(-e, 0, -e), P(e, 0, -e), P(e, 0, e), P(-e, 0, e)], "#262a42");
        }
        if (L.from === 0) box(base, 0, BLOCK_H, hueOf(0), 1);
        // Tower blocks (skip what's far below the camera).
        const start = L.from === 0 ? 1 : 0;
        for (let i = start; i < L.top.length; i++) {
          const lv = L.from + i;
          if ((lv + 1) * BLOCK_H < camY - 30 * BLOCK_H) continue;
          const isTop = i === L.top.length - 1;
          box(L.top[i], lv * BLOCK_H, (lv + 1) * BLOCK_H, hueOf(lv), 1, isTop ? flash : 0);
        }
        // Sliding block and its landing shadow.
        if (v && v.phase === "play" && L.alive) {
          const t = serverNow() - L.spawnAt;
          if (t >= 0) {
            const m = motion(v.seed, L.lv, v.speed);
            const topR = L.top[L.top.length - 1];
            const mr = slidingRect(topR, m, offsetAt(m, t));
            const y0 = L.lv * BLOCK_H;
            // Shadow of the overlap on the tower top.
            const ix0 = Math.max(mr[0] - mr[2] / 2, topR[0] - topR[2] / 2);
            const ix1 = Math.min(mr[0] + mr[2] / 2, topR[0] + topR[2] / 2);
            const iz0 = Math.max(mr[1] - mr[3] / 2, topR[1] - topR[3] / 2);
            const iz1 = Math.min(mr[1] + mr[3] / 2, topR[1] + topR[3] / 2);
            if (ix1 > ix0 && iz1 > iz0) poly([P(ix0, y0, iz0), P(ix1, y0, iz0), P(ix1, y0, iz1), P(ix0, y0, iz1)], "rgba(0,0,0,.22)");
            box(mr, y0 + 1.5, y0 + BLOCK_H + 1.5, hueOf(L.lv), 1);
          }
        }
      }
      flash = Math.max(0, flash - dt * 3);

      // Effects: falling chips and perfect rings.
      const keep: Fx[] = [];
      for (const f of fxRef.current) {
        const age = (now - f.born) / 1000;
        if (f.kind === "chip") {
          if (age > 1.6) continue;
          f.vy += 900 * dt;
          const drop = (f.vy * age) / 2 / k;
          box(f.rect, f.lv * BLOCK_H - drop, (f.lv + 1) * BLOCK_H - drop, hueOf(f.lv), Math.max(0, 1 - age / 1.6));
        } else {
          if (age > 0.7) continue;
          if (age < 0.02) flash = 1;
          const s = 1 + age * 0.9;
          const r = f.rect;
          const y = (f.lv + 1) * BLOCK_H;
          const w = (r[2] / 2) * s;
          const d = (r[3] / 2) * s;
          g.beginPath();
          const pts = [P(r[0] - w, y, r[1] - d), P(r[0] + w, y, r[1] - d), P(r[0] + w, y, r[1] + d), P(r[0] - w, y, r[1] + d)];
          g.moveTo(pts[0][0], pts[0][1]);
          for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
          g.closePath();
          g.strokeStyle = `rgba(255,255,255,${1 - age / 0.7})`;
          g.lineWidth = 3;
          g.shadowColor = "#fff";
          g.shadowBlur = 16;
          g.stroke();
          g.shadowBlur = 0;
        }
        keep.push(f);
      }
      fxRef.current = keep;
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [serverNow]);

  if (!view) return <Note>Clearing the building site…</Note>;
  const L = hud;
  const watching = !mine && view.watch ? byId[view.watch.id] : undefined;
  const solo = players.length === 1;
  const now = serverNow();
  const myRow = view.rows.find((r) => r.id === me);

  return (
    <div className="@container mx-auto w-full max-w-[1000px]" style={{ "--acc": accent } as React.CSSProperties}>
      <style href="ruckus-stack" precedence="default">
        {CSS}
      </style>
      <div className="flex flex-col gap-3 @3xl:flex-row @3xl:items-start">
        <div className="min-w-0 flex-1">
          <div
            ref={stageRef}
            className="ts-stage card"
            onPointerDown={(e) => {
              if (e.button === 0) drop();
            }}
            role="button"
            aria-label={mine ? "Drop the block (tap, or press Space)" : "Tower"}
            tabIndex={-1}
          >
            <canvas ref={canvasRef} aria-hidden />
            <div className="ts-hud">
              {watching && (
                <div className="mb-1 flex items-center gap-1.5 text-xs text-muted">
                  Watching <PlayerChip player={watching} size="sm" />
                </div>
              )}
              <div key={`h${hud?.lv ?? 0}`} className="ts-h ts-pop" aria-live="polite">
                {Math.max(0, (L?.lv ?? 1) - 1)}
              </div>
              <div className="mt-1 flex flex-wrap justify-center gap-1.5">
                <span className="ts-chip">{L?.score ?? 0} pts</span>
                {mine && view.tries > 1 && (
                  <span className="ts-chip">
                    tower {Math.min(view.tries, (L?.n ?? 0) + 1)}/{view.tries}
                    {view.me && view.me.best > 0 ? ` · best ${view.me.best}` : ""}
                  </span>
                )}
                {L && L.combo >= 2 && <span className="ts-chip" style={{ color: accent }}>🔥 combo {L.combo}</span>}
              </div>
              {toast && (
                <div key={`t${toast.n}`} className="ts-perfect">
                  {toast.text}
                </div>
              )}
              <div className="flex flex-1 flex-col items-center justify-center">
                {view.phase === "ready" && <Countdown at={view.startsAt} serverNow={serverNow} />}
                {view.phase === "play" && L && !L.alive && (
                  <div className="animate-rise">
                    <div className="ts-big">Toppled!</div>
                    <div className="mt-1 text-sm text-[#dfe3f0]">
                      {L.lv - 1} blocks · {L.score} pts
                    </div>
                    {L.restartAt !== null ? (
                      <div className="mt-2 text-sm font-semibold text-[#dfe3f0]">
                        Next tower in {Math.max(0, Math.ceil((L.restartAt - now) / 1000))}…
                      </div>
                    ) : mine ? (
                      <div className="mt-2 text-sm font-semibold text-[#dfe3f0]">
                        {solo ? "" : "Waiting for the others…"}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
              {fallNote && (
                <div key={`f${fallNote.n}`} className="ts-chip animate-rise mb-2">
                  {fallNote.text}
                </div>
              )}
              {mine && view.phase === "play" && L?.alive && L.lv <= 3 && (
                <div className="ts-tap text-sm font-semibold text-[#dfe3f0]">Tap or press Space to drop</div>
              )}
              {view.phase === "over" && myRow && (
                <div className="ts-chip mb-1">
                  Final: {myRow.best} pts
                </div>
              )}
            </div>
          </div>
        </div>
        {(!solo || !isPlayer) && <Skyline rows={view.rows} byId={byId} me={me} />}
      </div>
    </div>
  );
}

function Countdown({ at, serverNow }: { at: number; serverNow: () => number }) {
  const secs = useSecondsLeft(at, serverNow);
  useEffect(() => {
    if (secs > 0) sfx("tick");
  }, [secs]);
  return (
    <div key={secs} className="ts-count ts-big text-7xl">
      {secs || "GO"}
    </div>
  );
}

function Skyline({ rows, byId, me }: { rows: Row[]; byId: Record<string, Player>; me: string }) {
  const sorted = rows.slice().sort((a, b) => Math.max(b.best, b.score) - Math.max(a.best, a.score) || b.h - a.h);
  const maxH = Math.max(8, ...rows.map((r) => r.h));
  return (
    <aside className="card flex flex-col gap-2 p-3 @3xl:w-72 @3xl:shrink-0">
      <div className="label">Towers</div>
      <ol className="flex flex-col gap-1.5">
        {sorted.map((r, i) => {
          const p = byId[r.id];
          return (
            <li key={r.id} className={`rounded-md px-2 py-1.5 ${r.id === me ? "bg-panel-2 shadow-[inset_2px_0_0_var(--acc)]" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="w-4 font-mono text-xs text-muted">{i + 1}</span>
                  <PlayerChip player={p} size="sm" dim={!p?.connected} />
                </span>
                <span className="font-mono text-sm font-bold">{Math.max(r.best, r.score)}</span>
              </div>
              <div className="mt-1 flex items-center gap-2 pl-6">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2">
                  <div
                    className="h-full rounded-full transition-[width] duration-300"
                    style={{
                      width: `${(r.h / maxH) * 100}%`,
                      background: `linear-gradient(90deg, hsl(${hueOf(0)} 85% 60%), hsl(${hueOf(r.h)} 85% 62%))`,
                      opacity: r.alive ? 1 : 0.45,
                    }}
                  />
                </div>
                <span className="w-20 text-right font-mono text-xs text-muted">
                  {r.alive ? `${r.h} high` : r.done ? "done" : "toppled"}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

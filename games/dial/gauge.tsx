"use client";

// The semicircle dial: 0 at the left end, 100 at the right end. Pure SVG.
//
// Needles are positioned imperatively by a small spring engine (not by React):
// remote needles arrive ~12 times a second and glide between updates on a
// critically damped spring, your own needle is pinned straight to the pointer
// (painted inside the pointer event, so it never lags), and avatar badges ease
// between rings when needles crowd each other. The reveal is a timed sequence:
// the target pointer swings in, the scoring bands open around it, distance arcs
// draw from every needle to the target, then the points pop.

import { useId, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { BANDS } from "./shared";
import { SvgAvatar } from "@/components/Avatar";

export const VB_W = 400;
export const VB_H = 224;
export const CX = 200;
export const CY = 204;
export const R = 176;

/** Badge rings, outermost first. Close needles get pushed to inner rings. */
const LANE_R = [R - 21, R - 51, R - 81, R - 111];
const BADGE_R = 13;

/** Scoring band colours keyed by points (warm, so they pop on the cool face). */
export const BAND_COLOR: Record<number, string> = { 1: "#f97316", 2: "#fb923c", 3: "#fbbf24", 4: "#fde047" };
const BAND_OPACITY: Record<number, number> = { 1: 0.42, 2: 0.58, 3: 0.78, 4: 0.96 };

export const LEFT_COLOR = "#67e8f9";
export const RIGHT_COLOR = "#f9a8d4";

/** Reveal timeline (seconds from the start of the reveal), shared with the client. */
export const REVEAL_T = {
  /** Target pointer swings from the middle to the target. */
  swing: 0.55,
  /** Scoring bands start opening (innermost first). */
  bands: 0.38,
  /** Distance arcs start drawing. */
  arcs: 0.95,
  /** Points chips start popping. */
  chips: 1.25,
  /** Bullseye burst / results. */
  done: 1.5,
} as const;

export interface GaugeNeedle {
  id: string;
  v: number;
  color: string;
  avatar: string;
  label: string;
  me?: boolean;
  locked?: boolean;
  /** Not touched yet: dashed, pulsing. */
  ghost?: boolean;
  /** Reveal: points this needle earned. */
  pts?: number | null;
  /** Owner is disconnected: drawn faded. */
  away?: boolean;
}

/** Imperative handle: lets the drag handler move a needle without waiting for React. */
export interface GaugeApi {
  /** Pin a needle to an exact (fractional) value, painted immediately; null lets it settle on its prop value. */
  pin(id: string, v: number | null): void;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const REDUCED = "(prefers-reduced-motion: reduce)";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.(REDUCED).matches;
}

function polar(v: number, r: number): [number, number] {
  const a = Math.PI * (1 - v / 100);
  return [round2(CX + r * Math.cos(a)), round2(CY - r * Math.sin(a))];
}

function wedgePath(from: number, to: number): string {
  const [x1, y1] = polar(Math.max(0, from), R);
  const [x2, y2] = polar(Math.min(100, to), R);
  return `M${CX} ${CY}L${x1} ${y1}A${R} ${R} 0 0 1 ${x2} ${y2}Z`;
}

function arcPath(from: number, to: number, r: number): string {
  const [x1, y1] = polar(from, r);
  const [x2, y2] = polar(to, r);
  return `M${x1} ${y1}A${r} ${r} 0 0 ${from < to ? 1 : 0} ${x2} ${y2}`;
}

/** Slight overshoot, then settle. */
function easeOutBack(p: number, s = 1.4): number {
  const q = p - 1;
  return 1 + q * q * ((s + 1) * q + s);
}

const FACE = `M${CX - R} ${CY}A${R} ${R} 0 0 1 ${CX + R} ${CY}Z`;
const RIM = `M${CX - R} ${CY}A${R} ${R} 0 0 1 ${CX + R} ${CY}`;

const TICKS = Array.from({ length: 21 }, (_, i) => {
  const v = i * 5;
  const major = v % 25 === 0;
  const [x1, y1] = polar(v, R - (major ? 11 : 6));
  const [x2, y2] = polar(v, R - 1);
  return (
    <line
      key={v}
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={major ? "#7c74b0" : "#4a4377"}
      strokeWidth={major ? 2 : 1.5}
      strokeLinecap="round"
    />
  );
});

/** Minimum gap (in dial units) between two badges sharing a ring. */
const laneGap = (lane: number) => ((2 * BADGE_R + 5) / LANE_R[lane] / Math.PI) * 100;

/** Greedy ring assignment: sorted by value, each badge takes the outermost ring with room. */
function assignLanes(needles: { id: string; v: number; idx: number }[]): Map<string, number> {
  const sorted = needles.slice().sort((a, b) => a.v - b.v || a.idx - b.idx);
  const lastInLane: number[] = [];
  const lanes = new Map<string, number>();
  for (const n of sorted) {
    let lane = 0;
    while (lane < LANE_R.length - 1 && lastInLane[lane] !== undefined && n.v - lastInLane[lane] < laneGap(lane)) lane++;
    lastInLane[lane] = n.v;
    lanes.set(n.id, lane);
  }
  return lanes;
}

// ---------- the needle engine ----------

/** Spring stiffness (1/s). Critically damped: no overshoot, continuous velocity between updates. */
const SPRING_REMOTE = 24;
const SPRING_OWN = 44;
/** Time constant for badges moving between rings (s). */
const LANE_TAU = 0.09;

interface Sim {
  v: number;
  vel: number;
  r: number;
  goal: number;
  k: number;
  idx: number;
}

class NeedleEngine {
  private sims = new Map<string, Sim>();
  private pins = new Map<string, number>();
  private lines = new Map<string, SVGGElement>();
  private badges = new Map<string, SVGGElement>();
  private instant = false;
  private raf = 0;
  private last = 0;

  setInstant(on: boolean) {
    this.instant = on;
  }

  /** Ref callback helper: registers a needle's DOM node, returns the cleanup. */
  attach(kind: "line" | "badge", id: string, el: SVGGElement | null) {
    if (!el) return;
    const map = kind === "line" ? this.lines : this.badges;
    map.set(id, el);
    this.paintOne(id);
    return () => {
      if (map.get(id) === el) map.delete(id);
    };
  }

  /** New goals from React (every render). */
  sync(list: { id: string; v: number; me: boolean }[]) {
    const seen = new Set<string>();
    list.forEach((n, idx) => {
      seen.add(n.id);
      let s = this.sims.get(n.id);
      if (!s) {
        // A needle we haven't drawn yet appears where it is (no glide in from the middle).
        s = { v: this.pins.get(n.id) ?? n.v, vel: 0, r: -1, goal: n.v, k: SPRING_REMOTE, idx };
        this.sims.set(n.id, s);
      }
      s.goal = n.v;
      s.k = n.me ? SPRING_OWN : SPRING_REMOTE;
      s.idx = idx;
    });
    for (const id of [...this.sims.keys()]) {
      if (!seen.has(id)) {
        this.sims.delete(id);
        this.pins.delete(id);
      }
    }
    this.advance(0);
    this.paint();
    this.kick();
  }

  pin(id: string, v: number | null) {
    if (v === null) {
      this.pins.delete(id);
    } else {
      const x = Math.max(0, Math.min(100, v));
      this.pins.set(id, x);
    }
    this.advance(0);
    this.paint(); // synchronously, inside the pointer event: zero lag
    this.kick(); // badges may need to change rings; released needles settle
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.last = 0;
  }

  private kick() {
    if (this.raf || typeof requestAnimationFrame === "undefined") return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (t: number) => {
    this.raf = 0;
    const dt = this.last ? Math.min(0.064, Math.max(0, (t - this.last) / 1000)) : 1 / 60;
    this.last = t;
    const moving = this.advance(dt);
    this.paint();
    if (moving) this.raf = requestAnimationFrame(this.frame);
    else this.last = 0;
  };

  /** Steps every spring by dt seconds (0 = just apply pins and rings). True while anything still moves. */
  private advance(dt: number): boolean {
    let moving = false;
    for (const [id, s] of this.sims) {
      const pin = this.pins.get(id);
      if (pin !== undefined || this.instant) {
        s.v = pin ?? s.goal;
        s.vel = 0;
        continue;
      }
      if (dt > 0) {
        // Exact solution of a critically damped spring: stable for any frame time.
        const c1 = s.v - s.goal;
        const c2 = s.vel + s.k * c1;
        const e = Math.exp(-s.k * dt);
        s.v = s.goal + (c1 + c2 * dt) * e;
        s.vel = (c2 - s.k * (c1 + c2 * dt)) * e;
      }
      if (Math.abs(s.v - s.goal) < 0.01 && Math.abs(s.vel) < 0.05) {
        s.v = s.goal;
        s.vel = 0;
      } else moving = true;
    }
    const lanes = assignLanes([...this.sims].map(([id, s]) => ({ id, v: s.v, idx: s.idx })));
    const a = dt > 0 ? 1 - Math.exp(-dt / LANE_TAU) : 0;
    for (const [id, s] of this.sims) {
      const goal = LANE_R[lanes.get(id) ?? 0];
      if (s.r < 0 || this.instant) s.r = goal;
      else s.r += (goal - s.r) * a;
      if (Math.abs(goal - s.r) < 0.05) s.r = goal;
      else moving = true;
    }
    return moving;
  }

  private paint() {
    for (const id of this.sims.keys()) this.paintOne(id);
  }

  private paintOne(id: string) {
    const s = this.sims.get(id);
    if (!s || s.r < 0) return;
    this.lines.get(id)?.setAttribute("transform", `rotate(${round2((s.v - 50) * 1.8)} ${CX} ${CY})`);
    const [x, y] = polar(s.v, s.r);
    this.badges.get(id)?.setAttribute("transform", `translate(${round2(x - CX)} ${round2(y - CY)})`);
  }
}

// ---------- styles ----------

const EASE_POP = "cubic-bezier(.2,1.5,.4,1)";
const CSS = `
.dial-in{transform-box:fill-box;transform-origin:center;animation:dial-in .35s ${EASE_POP} both}
@keyframes dial-in{from{transform:scale(.3);opacity:0}}
.dial-pop{transform-box:fill-box;transform-origin:center;animation:dial-pop .45s ${EASE_POP} both}
@keyframes dial-pop{from{transform:scale(0)}to{transform:scale(1)}}
.dial-fade{animation:dial-fade .35s ease-out both}
@keyframes dial-fade{from{opacity:0}}
.dial-pulse{transform-box:fill-box;transform-origin:center;animation:dial-pulse 1.6s ease-out infinite}
@keyframes dial-pulse{from{transform:scale(.8);opacity:.9}to{transform:scale(1.45);opacity:0}}
.dial-flash{animation:dial-flash .8s ease-in-out ${REVEAL_T.arcs}s 2}
@keyframes dial-flash{50%{opacity:.3}}
.dial-arc{stroke-dasharray:1;stroke-dashoffset:0;animation:dial-arc .5s cubic-bezier(.3,.7,.3,1) both}
@keyframes dial-arc{from{stroke-dashoffset:1}}
.dial-hide{transition:opacity .35s ease}
.dial-roll{display:inline-grid;overflow:hidden;vertical-align:bottom}
.dial-roll>*{grid-area:1/1}
.dial-roll-out{animation:dial-roll-out .3s ease-in both}
@keyframes dial-roll-out{to{transform:translateY(-100%);opacity:0}}
.dial-roll-in{animation:dial-roll-in .45s ${EASE_POP} both}
@keyframes dial-roll-in{from{transform:translateY(100%);opacity:0}}
.dial-grow{transform-origin:left;animation:dial-grow .9s cubic-bezier(.2,.8,.2,1) .25s both}
@keyframes dial-grow{from{transform:scaleX(0)}}
.dial-burst{position:absolute;left:50%;top:38%;font-size:1.25rem;pointer-events:none;animation:dial-burst 1.1s cubic-bezier(.15,.7,.3,1) both}
@keyframes dial-burst{from{transform:translate(-50%,-50%) scale(.3);opacity:0}12%{opacity:1}70%{opacity:1}to{transform:translate(calc(-50% + var(--dx)),calc(-50% + var(--dy))) scale(1.1) rotate(var(--rot));opacity:0}}
@media (prefers-reduced-motion:reduce){.dial-in,.dial-pop,.dial-fade,.dial-flash,.dial-arc,.dial-grow,.dial-roll-in{animation:none}.dial-pulse,.dial-burst,.dial-roll-out{display:none}.dial-hide{transition:none}}
`;

/** Scoped keyframes for the dial (React hoists and de-duplicates it by href). */
export function DialStyles() {
  return (
    <style href="ruckus-dial-gauge" precedence="default">
      {CSS}
    </style>
  );
}

// ---------- target wedge ----------

const BANDS_OUTER_FIRST = [...BANDS].reverse();

function Wedge({ target, animate }: { target: number; animate: boolean }) {
  const bandRefs = useRef<(SVGPathElement | null)[]>([]);
  const pointerRef = useRef<SVGGElement>(null);

  // The reveal: React renders the final picture; this rewinds it before the first
  // paint and plays it forward (pointer swing, then bands opening inner to outer).
  useLayoutEffect(() => {
    if (!animate || prefersReducedMotion()) return;
    const pointer = pointerRef.current;
    const draw = (t: number) => {
      const p = clamp01(t / REVEAL_T.swing);
      const v = 50 + (target - 50) * easeOutBack(p, 1.6);
      pointer?.setAttribute("transform", `rotate(${round2((v - 50) * 1.8)} ${CX} ${CY})`);
      pointer?.setAttribute("opacity", String(round2(clamp01(t / 0.12))));
      BANDS_OUTER_FIRST.forEach((b, i) => {
        const k = BANDS.length - 1 - i; // innermost band opens first
        const q = clamp01((t - REVEAL_T.bands - k * 0.07) / 0.48);
        const hw = Math.max(0, (b.d + 0.5) * easeOutBack(q, 1.3));
        bandRefs.current[i]?.setAttribute("d", wedgePath(target - hw, target + hw));
      });
    };
    const end = REVEAL_T.bands + BANDS.length * 0.07 + 0.5;
    const t0 = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      draw(t);
      raf = t < end ? requestAnimationFrame(frame) : 0;
    };
    draw(0);
    raf = requestAnimationFrame(frame);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [animate, target]);

  const labels: { v: number; pts: number }[] = [{ v: target, pts: BANDS[0].pts }];
  for (let i = 1; i < BANDS.length; i++) {
    const off = (BANDS[i - 1].d + BANDS[i].d) / 2 + 0.5;
    labels.push({ v: target - off, pts: BANDS[i].pts }, { v: target + off, pts: BANDS[i].pts });
  }
  return (
    <g className={animate ? undefined : "dial-fade"}>
      {BANDS_OUTER_FIRST.map((b, i) => (
        <path
          key={b.pts}
          ref={(el) => {
            bandRefs.current[i] = el;
          }}
          d={wedgePath(target - b.d - 0.5, target + b.d + 0.5)}
          fill={BAND_COLOR[b.pts]}
          fillOpacity={BAND_OPACITY[b.pts]}
        />
      ))}
      <g className={animate ? "dial-fade" : undefined} style={animate ? { animationDelay: "0.8s" } : undefined}>
        {labels
          .filter((l) => l.v >= 0 && l.v <= 100)
          .map((l) => {
            const [x, y] = polar(l.v, R + 11);
            return (
              <text
                key={`${l.pts}-${l.v}`}
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={13}
                fontWeight={800}
                fill={BAND_COLOR[l.pts]}
              >
                {l.pts}
              </text>
            );
          })}
      </g>
      <g ref={pointerRef} transform={`rotate(${round2((target - 50) * 1.8)} ${CX} ${CY})`}>
        <g className={animate ? "dial-flash" : undefined}>
          <line x1={CX} y1={CY} x2={CX} y2={CY - R - 3} stroke="#fff" strokeWidth={2.5} strokeLinecap="round" />
        </g>
      </g>
    </g>
  );
}

/** Reveal: an arc from every needle to the target, each on its own ring so they never overlap. */
function DistanceArcs({ needles, target }: { needles: GaugeNeedle[]; target: number }) {
  const arcs = needles
    .filter((n) => n.pts != null && Math.abs(n.v - target) >= 0.75)
    .sort((a, b) => Math.abs(a.v - target) - Math.abs(b.v - target));
  if (arcs.length === 0) return null;
  // Just inside the outer ring of badges, nested inward: the farthest miss sweeps widest.
  const step = Math.min(9, 72 / arcs.length);
  return (
    <g fill="none" strokeLinecap="round">
      {arcs.map((n, i) => {
        const d = arcPath(n.v, target, R - 40 - (arcs.length - 1 - i) * step);
        // Farthest arcs start first; the closest (most exciting) finish last.
        const delay = `${(REVEAL_T.arcs + (arcs.length - 1 - i) * 0.05).toFixed(2)}s`;
        const miss = !n.pts;
        return (
          <g key={n.id} opacity={miss ? 0.4 : 1}>
            <path
              d={d}
              pathLength={1}
              className="dial-arc"
              style={{ animationDelay: delay }}
              stroke="#0e0c1d"
              strokeOpacity={0.7}
              strokeWidth={n.me ? 6.5 : 5}
            />
            <path
              d={d}
              pathLength={1}
              className="dial-arc"
              style={{ animationDelay: delay }}
              stroke={n.color}
              strokeWidth={n.me ? 3.5 : 2.5}
            />
          </g>
        );
      })}
    </g>
  );
}

// ---------- the gauge ----------

export function Gauge({
  needles,
  target,
  animateWedge,
  hidden,
  accent,
  svgRef,
  apiRef,
}: {
  needles: GaugeNeedle[];
  /** Draw the target wedge (clue-giver view, or the reveal). */
  target: number | null;
  /** Play the reveal sequence. */
  animateWedge: boolean;
  /** Show the "target hidden" mark. */
  hidden: boolean;
  accent: string;
  svgRef?: Ref<SVGSVGElement>;
  apiRef?: Ref<GaugeApi>;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [engine] = useState(() => new NeedleEngine());

  useLayoutEffect(() => {
    const mq = window.matchMedia?.(REDUCED);
    const apply = () => engine.setInstant(!!mq?.matches);
    apply();
    mq?.addEventListener?.("change", apply);
    return () => {
      mq?.removeEventListener?.("change", apply);
      engine.stop();
    };
  }, [engine]);

  // Hand every render's needle goals to the engine before the browser paints.
  useLayoutEffect(() => {
    engine.sync(needles.map((n) => ({ id: n.id, v: n.v, me: !!n.me })));
  });

  useImperativeHandle(apiRef, () => ({ pin: (id, v) => engine.pin(id, v) }), [engine]);

  // Points chips get noisy in a crowd; the results list carries them anyway.
  const chips = needles.length <= 7;
  // Own needle drawn last so it sits on top.
  const ordered = [...needles].sort((a, b) => Number(!!a.me) - Number(!!b.me));
  // Chips pop lowest score first, so the best guesses land last.
  const chipOrder = new Map(
    needles
      .filter((n) => n.pts != null && n.pts > 0)
      .sort((a, b) => (a.pts ?? 0) - (b.pts ?? 0) || Math.abs(b.v - (target ?? 0)) - Math.abs(a.v - (target ?? 0)))
      .map((n, i) => [n.id, i]),
  );
  const showArcs = animateWedge && target !== null;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className="block h-auto w-full select-none"
      aria-hidden
      focusable="false"
    >
      <defs>
        <linearGradient id={`${uid}-face`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={LEFT_COLOR} stopOpacity="0.26" />
          <stop offset="0.5" stopColor={accent} stopOpacity="0.05" />
          <stop offset="1" stopColor={RIGHT_COLOR} stopOpacity="0.26" />
        </linearGradient>
        <radialGradient id={`${uid}-glow`} cx="0.5" cy="1" r="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.07" />
          <stop offset="0.7" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      <path d={FACE} fill="#1a1631" />
      <path d={FACE} fill={`url(#${uid}-face)`} />
      <path d={FACE} fill={`url(#${uid}-glow)`} />

      {target !== null && <Wedge key={animateWedge ? "reveal" : "peek"} target={target} animate={animateWedge} />}

      {TICKS}
      <path d={RIM} fill="none" stroke="#5b5391" strokeWidth={2.5} />
      <line x1={CX - R} y1={CY} x2={CX + R} y2={CY} stroke="#3a3363" strokeWidth={2} />

      <text
        x={CX}
        y={CY - 78}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={64}
        fontWeight={800}
        fill="#ffffff"
        fillOpacity={0.08}
        className="dial-hide"
        opacity={hidden ? 1 : 0}
      >
        ?
      </text>

      {showArcs && <DistanceArcs needles={needles} target={target} />}

      {ordered.map((n) => (
        <g key={n.id} ref={(el) => engine.attach("line", n.id, el)} opacity={n.away ? 0.4 : 1}>
          <line
            x1={CX}
            y1={CY}
            x2={CX}
            y2={CY - R + 7}
            stroke={n.color}
            strokeWidth={n.me ? 4 : 3}
            strokeLinecap="round"
            strokeDasharray={n.ghost ? "5 7" : undefined}
            strokeOpacity={n.ghost ? 0.7 : 0.92}
          />
        </g>
      ))}

      {ordered.map((n) => {
        const k = chipOrder.get(n.id);
        return (
          <g key={n.id} ref={(el) => engine.attach("badge", n.id, el)} opacity={n.away ? 0.45 : 1}>
            <title>{n.label}</title>
            <g className="dial-in">
              {n.ghost && (
                <circle className="dial-pulse" cx={CX} cy={CY} r={BADGE_R + 4} fill="none" stroke={n.color} strokeWidth={2} />
              )}
              {n.me && <circle cx={CX} cy={CY} r={BADGE_R + 3.5} fill="none" stroke="#ffffff" strokeWidth={1.75} />}
              <circle cx={CX} cy={CY} r={BADGE_R} fill="#17142b" stroke={n.color} strokeWidth={3} />
              <SvgAvatar id={n.avatar} x={CX} y={CY} size={20} />
              {n.locked && n.pts == null && (
                <g className="dial-pop">
                  <circle cx={CX + 11} cy={CY - 11} r={7.5} fill="#0e0c1d" />
                  <text x={CX + 11} y={CY - 10.5} textAnchor="middle" dominantBaseline="central" fontSize={9}>
                    🔒
                  </text>
                </g>
              )}
              {chips && k !== undefined && n.pts != null && (
                <g className="dial-pop" style={{ animationDelay: `${(REVEAL_T.chips + k * 0.09).toFixed(2)}s` }}>
                  <circle cx={CX + 12} cy={CY - 12} r={9} fill={BAND_COLOR[n.pts]} stroke="#0e0c1d" strokeWidth={1.5} />
                  <text
                    x={CX + 12}
                    y={CY - 11.5}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={10}
                    fontWeight={800}
                    fill="#1a0f14"
                  >
                    +{n.pts}
                  </text>
                </g>
              )}
            </g>
          </g>
        );
      })}

      <circle cx={CX} cy={CY} r={12} fill={accent} />
      <circle cx={CX} cy={CY} r={5} fill="#0e0c1d" />
    </svg>
  );
}

/** A number that rolls from `from` to `to` after `delay` seconds (CSS only; instant with reduced motion). */
export function Roll({ from, to, delay }: { from: number; to: number; delay: number }) {
  if (from === to) return <>{to}</>;
  const style = { animationDelay: `${delay.toFixed(2)}s` };
  return (
    <span className="dial-roll">
      <span aria-hidden className="dial-roll-out" style={style}>
        {from}
      </span>
      <span className="dial-roll-in" style={style}>
        {to}
      </span>
    </span>
  );
}

/** Small celebratory emoji burst (skipped with reduced motion). */
export function Burst({ emoji = ["🎯", "✨", "🎉", "⭐"] }: { emoji?: string[] }) {
  const parts = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2 + 0.3;
    const dist = 70 + (i % 3) * 28;
    return {
      dx: `${Math.round(Math.cos(angle) * dist)}px`,
      dy: `${Math.round(Math.sin(angle) * dist * 0.7 - 20)}px`,
      rot: `${(i % 2 ? 1 : -1) * (30 + i * 9)}deg`,
      delay: `${(REVEAL_T.done + (i % 4) * 0.05).toFixed(2)}s`,
      e: emoji[i % emoji.length],
    };
  });
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {parts.map((p, i) => (
        <span
          key={i}
          className="dial-burst"
          style={{ ["--dx" as string]: p.dx, ["--dy" as string]: p.dy, ["--rot" as string]: p.rot, animationDelay: p.delay }}
        >
          {p.e}
        </span>
      ))}
    </div>
  );
}

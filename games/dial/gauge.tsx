"use client";

// The semicircle dial: 0 at the left end, 100 at the right end. Pure SVG,
// driven entirely by props. Needles rotate around the hub with CSS transforms,
// so remote needles glide between the ~12 updates per second they arrive at.

import { useId, type Ref } from "react";
import { BANDS } from "./shared";

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
  /** Glide between positions (needles moved by someone else). */
  smooth?: boolean;
  /** Reveal: points this needle earned. */
  pts?: number | null;
  /** Owner is disconnected: drawn faded. */
  away?: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function polar(v: number, r: number): [number, number] {
  const a = Math.PI * (1 - v / 100);
  return [round2(CX + r * Math.cos(a)), round2(CY - r * Math.sin(a))];
}

function wedgePath(from: number, to: number): string {
  const [x1, y1] = polar(Math.max(0, from), R);
  const [x2, y2] = polar(Math.min(100, to), R);
  return `M${CX} ${CY}L${x1} ${y1}A${R} ${R} 0 0 1 ${x2} ${y2}Z`;
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
function assignLanes(needles: GaugeNeedle[]): Map<string, number> {
  const sorted = needles.map((n, i) => ({ n, i })).sort((a, b) => a.n.v - b.n.v || a.i - b.i);
  const lastInLane: number[] = [];
  const lanes = new Map<string, number>();
  for (const { n } of sorted) {
    let lane = 0;
    while (lane < LANE_R.length - 1 && lastInLane[lane] !== undefined && n.v - lastInLane[lane] < laneGap(lane)) lane++;
    lastInLane[lane] = n.v;
    lanes.set(n.id, lane);
  }
  return lanes;
}

const CSS = `
.dial-fan{transform-origin:${CX}px ${CY}px;animation:dial-fan .75s cubic-bezier(.2,1.25,.35,1) both}
@keyframes dial-fan{from{transform:rotate(-40deg) scale(.1);opacity:0}to{transform:none;opacity:1}}
.dial-pop{transform-box:fill-box;transform-origin:center;animation:dial-pop .45s cubic-bezier(.2,1.6,.4,1) both}
@keyframes dial-pop{from{transform:scale(0)}to{transform:scale(1)}}
.dial-pulse{transform-box:fill-box;transform-origin:center;animation:dial-pulse 1.6s ease-out infinite}
@keyframes dial-pulse{from{transform:scale(.8);opacity:.9}to{transform:scale(1.45);opacity:0}}
.dial-flash{animation:dial-flash .9s ease-in-out .6s 2}
@keyframes dial-flash{50%{opacity:.25}}
.dial-glide{transition:transform .12s linear}
.dial-burst{position:absolute;left:50%;top:38%;font-size:1.25rem;pointer-events:none;animation:dial-burst 1.1s cubic-bezier(.15,.7,.3,1) both}
@keyframes dial-burst{from{transform:translate(-50%,-50%) scale(.3);opacity:0}12%{opacity:1}70%{opacity:1}to{transform:translate(calc(-50% + var(--dx)),calc(-50% + var(--dy))) scale(1.1) rotate(var(--rot));opacity:0}}
@media (prefers-reduced-motion:reduce){.dial-fan,.dial-pop,.dial-flash{animation:none}.dial-pulse,.dial-burst{display:none}.dial-glide{transition:none}}
`;

/** Scoped keyframes for the dial (React hoists and de-duplicates it by href). */
export function DialStyles() {
  return (
    <style href="ruckus-dial-gauge" precedence="default">
      {CSS}
    </style>
  );
}

function Wedge({ target, animate }: { target: number; animate: boolean }) {
  const outerFirst = [...BANDS].reverse();
  const labels: { v: number; pts: number }[] = [{ v: target, pts: BANDS[0].pts }];
  for (let i = 1; i < BANDS.length; i++) {
    const off = (BANDS[i - 1].d + BANDS[i].d) / 2 + 0.5;
    labels.push({ v: target - off, pts: BANDS[i].pts }, { v: target + off, pts: BANDS[i].pts });
  }
  const [tx, ty] = polar(target, R + 3);
  return (
    <g className={animate ? "dial-fan" : undefined}>
      {outerFirst.map((b) => (
        <path
          key={b.pts}
          d={wedgePath(target - b.d - 0.5, target + b.d + 0.5)}
          fill={BAND_COLOR[b.pts]}
          fillOpacity={BAND_OPACITY[b.pts]}
        />
      ))}
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
      <g className={animate ? "dial-flash" : undefined}>
        <line x1={CX} y1={CY} x2={tx} y2={ty} stroke="#fff" strokeWidth={2.5} strokeLinecap="round" />
      </g>
    </g>
  );
}

function needleStyle(deg: number) {
  return { transform: `rotate(${deg}deg)`, transformOrigin: `${CX}px ${CY}px` };
}

export function Gauge({
  needles,
  target,
  animateWedge,
  hidden,
  accent,
  svgRef,
}: {
  needles: GaugeNeedle[];
  /** Draw the target wedge (clue-giver view, or the reveal). */
  target: number | null;
  /** Fan the wedge open (the reveal). */
  animateWedge: boolean;
  /** Show the "target hidden" mark. */
  hidden: boolean;
  accent: string;
  svgRef?: Ref<SVGSVGElement>;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const lanes = assignLanes(needles);
  // Points chips get noisy in a crowd; the results list carries them anyway.
  const chips = needles.length <= 7;
  // Own needle drawn last so it sits on top.
  const ordered = [...needles].sort((a, b) => Number(!!a.me) - Number(!!b.me));

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

      {hidden && (
        <text
          x={CX}
          y={CY - 78}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={64}
          fontWeight={800}
          fill="#ffffff"
          fillOpacity={0.08}
        >
          ?
        </text>
      )}

      {ordered.map((n) => (
        <g
          key={n.id}
          className={n.smooth ? "dial-glide" : undefined}
          style={needleStyle((n.v - 50) * 1.8)}
          opacity={n.away ? 0.4 : 1}
        >
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

      {ordered.map((n, i) => {
        const deg = (n.v - 50) * 1.8;
        const laneR = LANE_R[lanes.get(n.id) ?? 0];
        return (
          <g
            key={n.id}
            className={n.smooth ? "dial-glide" : undefined}
            style={{
              transform: `rotate(${deg}deg) translateY(${-laneR}px) rotate(${-deg}deg)`,
              transformOrigin: `${CX}px ${CY}px`,
            }}
            opacity={n.away ? 0.45 : 1}
          >
            <title>{n.label}</title>
            {n.ghost && (
              <circle className="dial-pulse" cx={CX} cy={CY} r={BADGE_R + 4} fill="none" stroke={n.color} strokeWidth={2} />
            )}
            {n.me && <circle cx={CX} cy={CY} r={BADGE_R + 3.5} fill="none" stroke="#ffffff" strokeWidth={1.75} />}
            <circle cx={CX} cy={CY} r={BADGE_R} fill="#17142b" stroke={n.color} strokeWidth={3} />
            <text x={CX} y={CY + 1} textAnchor="middle" dominantBaseline="central" fontSize={15}>
              {n.avatar}
            </text>
            {n.locked && n.pts == null && (
              <g>
                <circle cx={CX + 11} cy={CY - 11} r={7.5} fill="#0e0c1d" />
                <text x={CX + 11} y={CY - 10.5} textAnchor="middle" dominantBaseline="central" fontSize={9}>
                  🔒
                </text>
              </g>
            )}
            {chips && n.pts != null && n.pts > 0 && (
              <g className="dial-pop" style={{ animationDelay: `${0.55 + i * 0.07}s` }}>
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
        );
      })}

      <circle cx={CX} cy={CY} r={12} fill={accent} />
      <circle cx={CX} cy={CY} r={5} fill="#0e0c1d" />
    </svg>
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
      delay: `${0.6 + (i % 4) * 0.05}s`,
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

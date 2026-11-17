"use client";

// The round's price chart (an SVG polyline of trades over time, with the fair value
// stepping as street cards flip) and the trade tape.

import type { Trade } from "./shared";
import { CARD_MEAN, STREET, cardValue, signed } from "./shared";
import { cardShort } from "./cards";
import { Name, Panel, type WhoFn } from "./ui";

const W = 320;
const H = 132;
const X0 = 26;
const X1 = 312;
const Y0 = 10;
const Y1 = 112;

/** Fair value (or a trader's estimate, with `own`) once k street cards are known. */
function stepValue(street: (number | null)[], players: number, k: number, own: number | null): number {
  let known = 0;
  for (let i = 0; i < k; i++) known += cardValue(street[i] ?? 0);
  const unseen = players + STREET - k;
  return own === null ? known + CARD_MEAN * unseen : known + own + CARD_MEAN * (unseen - 1);
}

export function PriceChart({
  chart,
  street,
  players,
  own,
  ownColor,
  settle,
  accent,
  tradeMs,
  flipMs,
}: {
  chart: number[];
  street: (number | null)[];
  players: number;
  /** My card's value (null for spectators). */
  own: number | null;
  ownColor: string;
  /** Settlement value once the bell has rung. */
  settle: number | null;
  accent: string;
  /** Round length and street flip times (ms after the open). */
  tradeMs: number;
  flipMs: number[];
}) {
  const T_END = tradeMs / 100;
  const flipped = street.filter((c) => c !== null).length;
  const bounds = [0, ...flipMs.map((ms) => ms / 100), T_END];
  const fair: { t0: number; t1: number; v: number }[] = [];
  const mine: { t0: number; t1: number; v: number }[] = [];
  for (let k = 0; k <= flipped; k++) {
    fair.push({ t0: bounds[k], t1: bounds[k + 1], v: stepValue(street, players, k, null) });
    if (own !== null) mine.push({ t0: bounds[k], t1: bounds[k + 1], v: stepValue(street, players, k, own) });
  }
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < chart.length; i += 2) pts.push([chart[i], chart[i + 1]]);

  const values = [...pts.map((p) => p[1]), ...fair.map((f) => f.v), ...mine.map((f) => f.v)];
  if (settle !== null) values.push(settle);
  let lo = Math.min(...values) - 3;
  let hi = Math.max(...values) + 3;
  if (hi - lo < 12) {
    const mid = (hi + lo) / 2;
    lo = mid - 6;
    hi = mid + 6;
  }
  const x = (t: number) => X0 + (Math.min(T_END, Math.max(0, t)) / T_END) * (X1 - X0);
  const y = (v: number) => Y1 - ((v - lo) / (hi - lo)) * (Y1 - Y0);
  const steps = (segs: typeof fair) =>
    segs.map((s, i) => `${i === 0 ? "M" : "L"}${x(s.t0).toFixed(1)},${y(s.v).toFixed(1)} L${x(s.t1).toFixed(1)},${y(s.v).toFixed(1)}`).join(" ");
  const line = pts.map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const gridVals = [lo, (lo + hi) / 2, hi].map((v) => Math.round(v));

  return (
    <Panel
      title="Price chart"
      label="Price chart"
      aside={
        <span className="flex flex-wrap justify-end gap-x-2">
          <span>
            <span aria-hidden style={{ color: accent }}>●</span> trades
          </span>
          <span>
            <span aria-hidden className="text-muted">┅</span> fair
          </span>
          {own !== null && (
            <span>
              <span aria-hidden style={{ color: ownColor }}>┈</span> you
            </span>
          )}
        </span>
      }
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={chartLabel(pts, settle)}>
        {gridVals.map((v, i) => (
          <g key={i}>
            <line x1={X0} x2={X1} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={0.6} />
            <text x={X0 - 4} y={y(v) + 3} textAnchor="end" fontSize={8.5} fill="var(--color-muted)" className="tabular-nums">
              {v}
            </text>
          </g>
        ))}
        {flipMs.map((ms, i) => {
          const c = street[i];
          return (
            <g key={i}>
              <line x1={x(ms / 100)} x2={x(ms / 100)} y1={Y0 - 4} y2={Y1} stroke="var(--color-line)" strokeDasharray="2 3" />
              <text x={x(ms / 100)} y={H - 6} textAnchor="middle" fontSize={9} fontWeight={700} fill={c === null ? "var(--color-muted)" : accent}>
                {c === null ? `#${i + 1}` : cardShort(c)}
              </text>
            </g>
          );
        })}
        <text x={X0} y={H - 6} textAnchor="middle" fontSize={8.5} fill="var(--color-muted)">
          0:00
        </text>
        <text x={X1} y={H - 6} textAnchor="middle" fontSize={9}>
          🔔
        </text>
        <path d={steps(fair)} fill="none" stroke="var(--color-muted)" strokeWidth={1.2} strokeDasharray="5 3" opacity={0.8} />
        {own !== null && <path d={steps(mine)} fill="none" stroke={ownColor} strokeWidth={1.2} strokeDasharray="1.5 2.5" />}
        {settle !== null && (
          <g>
            <line x1={X0} x2={X1} y1={y(settle)} y2={y(settle)} stroke={accent} strokeWidth={1.6} />
            <text x={X1 - 2} y={y(settle) - 3} textAnchor="end" fontSize={9} fontWeight={800} fill={accent}>
              settled {settle}
            </text>
          </g>
        )}
        {pts.length > 1 && <polyline points={line} fill="none" stroke={accent} strokeWidth={1.8} strokeLinejoin="round" />}
        {pts.map(([t, v], i) => (
          <circle key={i} cx={x(t)} cy={y(v)} r={i === pts.length - 1 ? 3.2 : 1.8} fill={accent} />
        ))}
        {last && (
          <text x={Math.min(x(last[0]) + 5, X1 - 14)} y={y(last[1]) - 5} fontSize={9.5} fontWeight={800} fill="var(--color-text)">
            {last[1]}
          </text>
        )}
        {pts.length === 0 && (
          <text x={(X0 + X1) / 2} y={(Y0 + Y1) / 2} textAnchor="middle" fontSize={10} fill="var(--color-muted)">
            No trades yet this round
          </text>
        )}
      </svg>
    </Panel>
  );
}

function chartLabel(pts: [number, number][], settle: number | null): string {
  if (!pts.length) return "Price chart: no trades yet this round";
  const prices = pts.map((p) => p[1]);
  return `Price chart: ${pts.length} trades between ${Math.min(...prices)} and ${Math.max(...prices)}, last at ${prices[prices.length - 1]}${
    settle !== null ? `; settled at ${settle}` : ""
  }`;
}

const clock = (ds: number) => {
  const s = Math.floor(ds / 10);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function Tape({ tape, nt, me, who, accent }: { tape: Trade[]; nt: number; me: number; who: WhoFn; accent: string }) {
  const rows = tape.map((tr, i) => ({ tr, n: nt - (tape.length - 1 - i) })).reverse();
  return (
    <Panel title="Trade tape" label="Trade tape" aside={nt ? `${nt} trade${nt === 1 ? "" : "s"} this round` : null}>
      {rows.length === 0 ? (
        <p className="py-2 text-center text-xs text-muted">Every trade shows up here: who bought, who sold, at what price.</p>
      ) : (
        <ol className="flex max-h-52 flex-col gap-1 overflow-y-auto pr-1">
          {rows.map(({ tr, n }, i) => {
            const [b, s, price, qty, t] = tr;
            const mineB = b === me;
            const mineS = s === me;
            const tone = mineB || mineS;
            return (
              <li
                key={n}
                className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-xs ${i === 0 ? "mk-in mk-flash" : ""}`}
                style={{
                  background: tone ? `${accent}1c` : "var(--color-panel-2)",
                  ["--mk-flash" as string]: `${accent}55`,
                }}
              >
                <span className="w-8 shrink-0 font-mono text-[10px] text-muted tabular-nums">{clock(t)}</span>
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1">
                  <Name p={who(b)} you={mineB} />
                  <span className="text-muted">bought</span>
                  <b className="font-mono tabular-nums">
                    {qty} @ {price}
                  </b>
                  <span className="text-muted">from</span>
                  <Name p={who(s)} you={mineS} />
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

/** One line: what the bell did to this trader. */
export function pnlLine(pos: number, settle: number, pnl: number): string {
  if (pos === 0) return pnl === 0 ? "didn't trade" : `flat, locked in ${signed(pnl)}`;
  return `${pos > 0 ? "long" : "short"} ${Math.abs(pos)} at the bell (${settle})`;
}

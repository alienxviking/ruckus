"use client";

// Boards for the newer microgames. Each renders both PLAY and RESULT for its puzzle.

import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { sfx } from "@/lib/feedback";
import { DIR_NAMES, INKS, angleGap, fmtSecs, fmtTime, spinAngle, type ResLine } from "./shared";
import { ArrowIcon, GOLD, GREEN, ROSE, arrowOf, cssVars, digitOf, personOf, useKeys } from "./ui";
import { CellGrid, Choices, Drain, Em, Prompt, ResultList, numPick, useElapsed, type BoardProps, type Pz } from "./kit";

const GO_GREEN = "#22c55e";
const STOP_RED = "#f43f5e";

/** Space / Enter, no auto-repeat. */
const isPress = (e: KeyboardEvent) => !e.repeat && (e.key === " " || e.key === "Enter");

/** A big round action button (stop, tap...). */
function BigButton({
  onPress,
  disabled,
  color,
  children,
  label,
  data,
}: {
  onPress: () => void;
  disabled: boolean;
  color: string;
  children: ReactNode;
  label?: string;
  data?: string;
}) {
  return (
    <button
      type="button"
      data-action={data}
      disabled={disabled}
      onPointerDown={(e) => {
        if (e.button === 0 && !disabled) onPress();
      }}
      onKeyDown={(e) => {
        // Space/Enter are handled globally; don't double-fire from the focused button.
        if (e.key === " " || e.key === "Enter") e.preventDefault();
      }}
      aria-label={label}
      aria-keyshortcuts="Space"
      className="relative h-16 w-full max-w-xs touch-manipulation rounded-full border-2 font-display text-2xl font-black tracking-wider transition-transform select-none active:scale-95 disabled:opacity-40"
      style={{ borderColor: color, background: `radial-gradient(circle at 50% 30%, ${color}55, ${color}22)` }}
    >
      {children}
    </button>
  );
}

// ---------- green light ----------

export function GreenBoard(props: BoardProps<Pz<"green">>) {
  const { pz, phase, canAnswer, answered, isPlayer, submit, view, me, serverNow, result, byId } = props;
  const [early, setEarly] = useState(false);
  const waiting = phase === "play" && pz.go === null;
  const t = useElapsed(view.phaseAt, serverNow, waiting && !!pz.decoy);
  const decoyOn = waiting && pz.decoy !== null && t >= pz.decoy[0] && t < pz.decoy[0] + 550;
  const tap = () => {
    if (!canAnswer) return;
    setEarly(pz.go === null);
    submit({ type: "hit", r: view.round }, null);
  };
  useKeys(canAnswer, me, (e) => {
    if (!isPress(e)) return false;
    tap();
    return true;
  });

  if (phase === "result" && result) {
    return (
      <div className="flex flex-col gap-3">
        <Prompt>Reaction times</Prompt>
        <ResultList
          result={result}
          byId={byId}
          me={me}
          value={(l) => (l.ok === false ? "🚫 too early" : l.ms !== null ? fmtSecs(l.ms) : "–")}
          order={(l) => (l.ms !== null ? l.ms : l.ok === false ? 1e6 : 1e7)}
        />
      </div>
    );
  }
  const color = pz.go !== null ? GO_GREEN : decoyOn && pz.decoy ? INKS[pz.decoy[1]].hex : STOP_RED;
  const go = pz.go !== null;
  return (
    <div className="flex flex-col items-center gap-3">
      <Prompt>{answered ? (early ? "🚫 Too early!" : "✋ Got it!") : go ? "NOW!" : "Wait for green…"}</Prompt>
      <button
        type="button"
        data-action="hit"
        disabled={!canAnswer}
        onPointerDown={(e) => {
          if (e.button === 0) tap();
        }}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") e.preventDefault();
        }}
        aria-label={go ? "Green! Tap now" : "Red light. Wait"}
        aria-keyshortcuts="Space"
        className={`grid size-48 touch-manipulation place-items-center rounded-full border-8 font-display text-4xl font-black select-none disabled:cursor-default ${go && !answered ? "blz-pop" : ""}`}
        style={{
          borderColor: color,
          background: `radial-gradient(circle at 50% 35%, ${color}${go ? "ee" : "88"}, ${color}${go ? "66" : "22"} 70%)`,
          boxShadow: go ? `0 0 60px -6px ${color}` : `0 0 30px -12px ${color}`,
          color: go ? "#052e16" : "var(--color-text)",
          opacity: answered ? 0.55 : 1,
        }}
      >
        {go ? "TAP!" : decoyOn ? "…" : "WAIT"}
      </button>
      {isPlayer && canAnswer && <p className="hidden text-xs text-muted sm:block">Space or Enter when it turns green</p>}
    </div>
  );
}

// ---------- simon says ----------

function SimonChip({ pz, i }: { pz: Pz<"simon">; i: number }) {
  const o = pz.options[i];
  if (pz.style === "emoji") return <span className="text-[1.5em] leading-none">{o}</span>;
  const hex = INKS.find((k) => k.name === o)?.hex ?? "#fff";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="size-[0.8em] shrink-0 rounded-full ring-2 ring-white/20" style={{ background: hex }} />
      <span style={{ color: hex }}>{o}</span>
    </span>
  );
}

export function SimonBoard(props: BoardProps<Pz<"simon">>) {
  const { pz, phase, result } = props;
  const lead = pz.lead;
  const verb = lead ? "tap" : "Tap";
  const heldRight = phase === "result" && result?.answer === -1;
  return (
    <div className="flex flex-col gap-4">
      {phase === "result" && (
        <p className="blz-in text-center text-sm font-bold" style={{ color: heldRight ? GOLD : GREEN }}>
          {heldRight ? "Simon never said it! Hands off was right ✋" : "Simon said it, so tapping was right"}
        </p>
      )}
      <div className="blz-pop flex flex-wrap items-center justify-center gap-x-2 gap-y-1 py-1 text-center font-display text-3xl font-black @md/stage:text-4xl">
        {lead && <span>{lead}</span>}
        <span>{verb}</span>
        <SimonChip pz={pz} i={pz.ask} />
      </div>
      <Choices
        props={props}
        labels={pz.options}
        items={pz.options.map((_, i) => (
          <span key={i} className="text-xl">
            <SimonChip pz={pz} i={i} />
          </span>
        ))}
      />
    </div>
  );
}

// ---------- what's missing ----------

function EmojiRow({ items, size, mark, label }: { items: string[]; size: string; mark?: string | null; label: string }) {
  return (
    <div className="flex flex-wrap justify-center gap-2" role="img" aria-label={label}>
      {items.map((e, i) => (
        <span
          key={`${e}${i}`}
          className="blz-pop grid place-items-center rounded-xl leading-none"
          style={{
            fontSize: size,
            padding: "0.15em",
            background: mark === e ? GREEN + "26" : undefined,
            boxShadow: mark === e ? `0 0 0 2px ${GREEN}` : undefined,
            ...cssVars({ "--d": `${i * 60}ms` }),
          }}
        >
          {e}
        </span>
      ))}
    </div>
  );
}

export function GoneBoard(props: BoardProps<Pz<"gone">>) {
  const { pz, phase, view, serverNow, color, result } = props;
  if (phase === "play" && pz.shown) {
    return (
      <div className="flex flex-col gap-4">
        <Prompt>Remember these!</Prompt>
        <EmojiRow items={pz.shown} size="clamp(2rem, 11cqw, 3.2rem)" label={`Emoji to remember: ${pz.shown.join(" ")}`} />
        {view.opensAt !== null && <Drain until={view.opensAt} serverNow={serverNow} color={color} />}
      </div>
    );
  }
  const missing = phase === "result" && typeof result?.answer === "number" && pz.options ? pz.options[result.answer] : null;
  return (
    <div className="flex flex-col gap-3">
      <Prompt>{missing ? "This one vanished:" : "Which one vanished?"}</Prompt>
      {missing && pz.shown ? (
        <EmojiRow items={pz.shown} size="clamp(1.5rem, 8cqw, 2.3rem)" mark={missing} label={`They were ${pz.shown.join(" ")}`} />
      ) : (
        pz.left && (
          <div className="rounded-2xl border border-dashed border-line bg-ink/40 py-2">
            <EmojiRow items={pz.left} size="clamp(1.4rem, 7cqw, 2rem)" label={`Still here: ${pz.left.join(" ")}`} />
          </div>
        )
      )}
      {pz.options && (
        <Choices
          props={props}
          labels={pz.options}
          items={pz.options.map((o) => (
            <span key={o} className="text-4xl leading-none">
              {o}
            </span>
          ))}
        />
      )}
    </div>
  );
}

// ---------- shades ----------

export function ShadeBoard(props: BoardProps<Pz<"shade">>) {
  const { pz, phase, result, myPick, submit, view, canAnswer, color } = props;
  const mine = numPick(myPick);
  const side = Math.round(Math.sqrt(pz.cells.length));
  const word = pz.ask === "dark" ? "DARKEST" : "LIGHTEST";
  return (
    <div className="flex flex-col gap-3">
      <Prompt>
        {phase === "play" ? (
          <>
            Tap the <Em color={color}>{word}</Em> square
          </>
        ) : (
          <>The {word.toLowerCase()} one:</>
        )}
      </Prompt>
      <CellGrid
        props={props}
        cells={pz.cells.map(() => "")}
        cols={side}
        maxWidth={side === 3 ? "min(100%, 16rem)" : side === 4 ? "min(100%, 19rem)" : "min(100%, 21rem)"}
        selected={mine === null ? [] : [mine]}
        answers={phase === "result" && typeof result?.answer === "number" ? [result.answer] : []}
        onCell={(i) => canAnswer && submit({ type: "pick", r: view.round, c: i }, i)}
        tileBg={(i) => `hsl(${pz.hue} 62% ${pz.cells[i]}%)`}
        cellLabel={(i) => `Square ${i + 1}`}
        label="Grid of shaded squares"
      />
    </div>
  );
}

// ---------- long lines ----------

export function LinesBoard(props: BoardProps<Pz<"lines">>) {
  const { pz, phase, color } = props;
  const word = pz.ask === "long" ? "LONGEST" : "SHORTEST";
  return (
    <div className="flex flex-col gap-3">
      <Prompt>
        {phase === "play" ? (
          <>
            Tap the <Em color={color}>{word}</Em> line
          </>
        ) : (
          <>The {word.toLowerCase()} line:</>
        )}
      </Prompt>
      <Choices
        props={props}
        cols="grid-cols-1"
        className="mx-auto w-full max-w-md gap-y-3"
        labels={pz.lines.map((_, i) => `Line ${i + 1}`)}
        items={pz.lines.map(([len, off], i) => (
          <span key={i} className="relative block h-3 w-full pr-1 pl-7">
            <span className="relative block h-full w-full">
              <span
                className="blz-bar absolute inset-y-0 rounded-full"
                style={{ left: `${off}%`, width: `${len}%`, background: "var(--color-text)", ...cssVars({ "--d": `${i * 70}ms` }) }}
              />
            </span>
          </span>
        ))}
      />
    </div>
  );
}

// ---------- number flash ----------

function BigNumber({ num, color }: { num: string; color?: string }) {
  return (
    <div
      className="blz-pop py-2 text-center font-mono font-black tracking-[0.12em] tabular-nums"
      style={{ fontSize: "clamp(2.6rem, 13cqw, 4.4rem)", color }}
    >
      {num}
    </div>
  );
}

export function DigitsBoard(props: BoardProps<Pz<"digits">>) {
  const { pz, phase, view, serverNow, color } = props;
  if (phase === "play" && pz.num) {
    return (
      <div className="flex flex-col gap-3">
        <Prompt>Remember this number!</Prompt>
        <BigNumber num={pz.num} />
        {view.opensAt !== null && <Drain until={view.opensAt} serverNow={serverNow} color={color} />}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <Prompt>{phase === "result" && pz.num ? "It was" : "Which number was it?"}</Prompt>
      {phase === "result" && pz.num ? (
        <BigNumber num={pz.num} color={GREEN} />
      ) : (
        <div className="grid h-16 place-items-center text-4xl" aria-hidden>
          🙈
        </div>
      )}
      {pz.options && (
        <Choices
          props={props}
          labels={pz.options}
          items={pz.options.map((o) => (
            <span key={o} className="font-mono text-2xl tracking-wider tabular-nums">
              {o}
            </span>
          ))}
        />
      )}
    </div>
  );
}

// ---------- spell check ----------

export function SpellBoard(props: BoardProps<Pz<"spell">>) {
  const { pz, phase } = props;
  return (
    <div className="flex flex-col gap-3">
      <Prompt>{phase === "play" ? "Which one is spelled right?" : "The right spelling:"}</Prompt>
      <Choices
        props={props}
        cols="grid-cols-1 @md/stage:grid-cols-2"
        labels={pz.options}
        items={pz.options.map((w) => (
          <span key={w} className="text-lg tracking-wide break-all @sm/stage:text-xl">
            {w}
          </span>
        ))}
      />
    </div>
  );
}

// ---------- rhyme time ----------

export function RhymeBoard(props: BoardProps<Pz<"rhyme">>) {
  const { pz, color } = props;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-2">
        <Prompt>Which word rhymes with</Prompt>
        <span
          className="blz-pop rounded-2xl border-2 px-5 py-1.5 font-display text-4xl font-black tracking-wide"
          style={{ borderColor: color, background: color + "1c" }}
        >
          {pz.word}
        </span>
      </div>
      <Choices
        props={props}
        labels={pz.options}
        items={pz.options.map((w) => (
          <span key={w} className="text-xl tracking-wide">
            {w}
          </span>
        ))}
      />
    </div>
  );
}

// ---------- dice duel ----------

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function Die({ n, i }: { n: number; i: number }) {
  return (
    <span
      className="blz-pop grid size-9 grid-cols-3 grid-rows-3 gap-[2px] rounded-lg bg-white p-[5px] shadow-md @md/stage:size-11"
      style={cssVars({ "--d": `${i * 50}ms` })}
      aria-hidden
    >
      {Array.from({ length: 9 }, (_, k) => (
        <span key={k} className="rounded-full" style={{ background: PIPS[n]?.includes(k) ? "#1e1b4b" : "transparent" }} />
      ))}
    </span>
  );
}

export function DiceBoard(props: BoardProps<Pz<"dice">>) {
  const { pz, phase } = props;
  const sums = pz.hands.map((h) => h.reduce((a, b) => a + b, 0));
  return (
    <div className="flex flex-col gap-3">
      <Prompt>{phase === "play" ? "Which hand adds up to MORE?" : "The bigger hand:"}</Prompt>
      <div className="relative">
        <Choices
          props={props}
          hints={["1", "2"]}
          keyMap={(e) => (e.key === "ArrowLeft" ? 0 : e.key === "ArrowRight" ? 1 : -1)}
          labels={pz.hands.map((h) => `Dice: ${h.join(", ")}`)}
          items={pz.hands.map((h, i) => (
            <span key={i} className="flex flex-col items-center gap-2 py-3">
              <span className={`grid gap-1.5 ${h.length === 4 ? "grid-cols-2" : "grid-cols-3"}`}>
                {h.map((n, k) => (
                  <Die key={k} n={n} i={k + i * 4} />
                ))}
              </span>
              {phase === "result" && <span className="font-mono text-sm text-muted">= {sums[i]}</span>}
            </span>
          ))}
          className="[&_button]:min-h-36"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute top-[calc(50%-0.5rem)] left-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-line bg-ink text-xs font-black text-muted"
        >
          VS
        </span>
      </div>
    </div>
  );
}

// ---------- what's next ----------

export function NextBoard(props: BoardProps<Pz<"next">>) {
  const { pz, phase, result, color } = props;
  const ans = phase === "result" && typeof result?.answer === "number" ? pz.options[result.answer] : null;
  const tiles = [...pz.seq.map(String), ans !== null ? String(ans) : "?"];
  return (
    <div className="flex flex-col gap-4">
      <Prompt>What comes next?</Prompt>
      <div
        className="flex flex-wrap items-center justify-center gap-1.5 font-display font-black tabular-nums"
        aria-label={`Sequence: ${pz.seq.join(", ")}, then what?`}
      >
        {tiles.map((v, i) => {
          const last = i === tiles.length - 1;
          return (
            <span
              key={i}
              aria-hidden
              className="blz-pop grid min-w-12 place-items-center rounded-xl border-2 px-2 py-1"
              style={{
                fontSize: "clamp(1.4rem, 7cqw, 2.2rem)",
                borderColor: last ? (ans !== null ? GREEN : color) : "var(--color-line)",
                background: last ? (ans !== null ? GREEN : color) + "22" : "var(--color-panel-2)",
                color: last && ans === null ? color : undefined,
                ...cssVars({ "--d": `${i * 70}ms` }),
              }}
            >
              {v}
            </span>
          );
        })}
      </div>
      <Choices
        props={props}
        labels={pz.options.map(String)}
        items={pz.options.map((o) => (
          <span key={o} className="text-3xl tabular-nums">
            {o}
          </span>
        ))}
      />
    </div>
  );
}

// ---------- what time ----------

function ClockDial({ h, m, color }: { h: number; m: number; color: string }) {
  const hourDeg = ((h % 12) + m / 60) * 30;
  const minDeg = m * 6;
  return (
    <svg viewBox="0 0 200 200" className="blz-pop mx-auto size-44 @md/stage:size-52" role="img" aria-label="An analogue clock">
      <circle cx="100" cy="100" r="94" fill="var(--color-panel-2)" stroke={color} strokeWidth="5" />
      {Array.from({ length: 60 }, (_, i) => {
        const major = i % 5 === 0;
        const a = (i * 6 * Math.PI) / 180;
        const r1 = major ? 78 : 84;
        return (
          <line
            key={i}
            x1={100 + r1 * Math.sin(a)}
            y1={100 - r1 * Math.cos(a)}
            x2={100 + 88 * Math.sin(a)}
            y2={100 - 88 * Math.cos(a)}
            stroke="var(--color-text)"
            strokeOpacity={major ? 0.9 : 0.3}
            strokeWidth={major ? 3 : 1.5}
            strokeLinecap="round"
          />
        );
      })}
      {Array.from({ length: 12 }, (_, i) => {
        const n = i + 1;
        const a = (n * 30 * Math.PI) / 180;
        return (
          <text
            key={n}
            x={100 + 64 * Math.sin(a)}
            y={100 - 64 * Math.cos(a)}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="15"
            fontWeight="800"
            fill="var(--color-text)"
            opacity={n % 3 === 0 ? 1 : 0.55}
          >
            {n}
          </text>
        );
      })}
      {/* Hour hand: short and thick. Minute hand: long and thin. */}
      <line x1="100" y1="100" x2="100" y2="54" stroke={color} strokeWidth="9" strokeLinecap="round" transform={`rotate(${hourDeg} 100 100)`} />
      <line x1="100" y1="100" x2="100" y2="22" stroke="var(--color-text)" strokeWidth="4" strokeLinecap="round" transform={`rotate(${minDeg} 100 100)`} />
      <circle cx="100" cy="100" r="6" fill="var(--color-text)" />
    </svg>
  );
}

export function TimeBoard(props: BoardProps<Pz<"time">>) {
  const { pz, phase, color } = props;
  return (
    <div className="flex flex-col gap-3">
      <Prompt>{phase === "play" ? "What time is it?" : `It's ${fmtTime(pz.h, pz.m)}`}</Prompt>
      <ClockDial h={pz.h} m={pz.m} color={color} />
      <Choices
        props={props}
        labels={pz.options}
        items={pz.options.map((o) => (
          <span key={o} className="text-2xl tabular-nums">
            {o}
          </span>
        ))}
      />
    </div>
  );
}

// ---------- spin stop ----------

const polar = (r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [100 + r * Math.sin(a), 100 - r * Math.cos(a)];
};
function arc(r: number, from: number, to: number): string {
  const [x1, y1] = polar(r, from);
  const [x2, y2] = polar(r, to);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

function SpinDial({
  pz,
  angle,
  needleRef,
  marks,
}: {
  pz: Pz<"spin">;
  angle: number | null;
  needleRef?: Ref<SVGGElement>;
  marks?: { angle: number; color: string; me: boolean }[];
}) {
  return (
    <svg viewBox="0 0 200 200" className="mx-auto size-52 @md/stage:size-60" role="img" aria-label="A spinning needle and a green zone">
      <circle cx="100" cy="100" r="86" fill="var(--color-panel-2)" stroke="var(--color-line)" strokeWidth="14" />
      <path d={arc(86, pz.zone - pz.width / 2, pz.zone + pz.width / 2)} fill="none" stroke={GO_GREEN} strokeWidth="16" />
      <path d={arc(86, pz.zone - 1.5, pz.zone + 1.5)} fill="none" stroke="#bbf7d0" strokeWidth="16" />
      {angle !== null && (
        <g ref={needleRef} transform={`rotate(${angle} 100 100)`}>
          <line x1="100" y1="100" x2="100" y2="12" stroke="var(--color-text)" strokeWidth="5" strokeLinecap="round" />
        </g>
      )}
      {marks?.map((mk, i) => {
        const [x, y] = polar(86, mk.angle);
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={mk.me ? 8 : 6}
            fill={mk.color}
            stroke={mk.me ? "#fff" : "var(--color-ink)"}
            strokeWidth={mk.me ? 3 : 2}
          />
        );
      })}
      <circle cx="100" cy="100" r="9" fill="var(--color-text)" />
    </svg>
  );
}

export function SpinBoard(props: BoardProps<Pz<"spin">>) {
  const { pz, phase, canAnswer, answered, isPlayer, submit, view, serverNow, me, color, result, byId } = props;
  const needle = useRef<SVGGElement>(null);
  const [stopped, setStopped] = useState<number | null>(null);
  const spinning = phase === "play" && stopped === null && !answered;
  const start = view.opensAt ?? view.phaseAt;
  // The needle turns per frame without React renders.
  useEffect(() => {
    if (!spinning) return;
    let raf = 0;
    const loop = () => {
      needle.current?.setAttribute("transform", `rotate(${spinAngle(pz, serverNow() - start)} 100 100)`);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [spinning, pz, serverNow, start]);
  const stop = () => {
    if (!canAnswer) return;
    const t = serverNow();
    setStopped(spinAngle(pz, t - start));
    submit({ type: "stop", r: view.round, t }, null);
  };
  useKeys(canAnswer, me, (e) => {
    if (!isPress(e)) return false;
    stop();
    return true;
  });

  if (phase === "result" && result) {
    const marks = result.res
      .filter((l): l is ResLine & { v: number } => l.v !== null)
      .map((l) => ({ angle: l.v, color: personOf(byId, l.id).color, me: l.id === me }));
    return (
      <div className="flex flex-col gap-3">
        <Prompt>Where everyone stopped</Prompt>
        <SpinDial pz={pz} angle={null} marks={marks} />
        <ResultList
          result={result}
          byId={byId}
          me={me}
          value={(l) => (l.v === null ? "–" : l.ok ? `${Math.round(angleGap(l.v, pz.zone))}° off` : "missed")}
          order={(l) => (l.v === null ? 1e7 : l.ok ? angleGap(l.v, pz.zone) : 1e6)}
        />
      </div>
    );
  }
  const frozen = stopped ?? (answered ? spinAngle(pz, serverNow() - start) : null);
  const inZone = stopped !== null && angleGap(stopped, pz.zone) <= pz.width / 2;
  return (
    <div className="flex flex-col items-center gap-3">
      <Prompt>
        {stopped !== null ? (inZone ? "🎯 In the zone!" : "😬 Missed it!") : "Stop the needle in the green zone"}
      </Prompt>
      <SpinDial pz={pz} angle={frozen ?? spinAngle(pz, serverNow() - start)} needleRef={needle} />
      {isPlayer && (
        <BigButton onPress={stop} disabled={!canAnswer} color={color} label="Stop the needle" data="stop">
          ⏹ STOP
        </BigButton>
      )}
      {isPlayer && canAnswer && <p className="hidden text-xs text-muted sm:block">Space or Enter stops it</p>}
    </div>
  );
}

// ---------- whack-a-mole ----------

/** Keys 1-9 laid out like a phone keypad: 1 is top-left. */
export function WhackBoard(props: BoardProps<Pz<"whack">>) {
  const { pz, phase, canAnswer, isPlayer, act, view, serverNow, me, result, byId, color } = props;
  const [hit, setHit] = useState<number[]>([]);
  const playing = phase === "play";
  const start = view.opensAt ?? view.phaseAt;
  const t = useElapsed(start, serverNow, playing);
  const upIn = (hole: number) =>
    pz.moles.findIndex(([h, up, down], i) => h === hole && t >= up && (t <= down || (hit.includes(i) && t <= down + 250)));
  const whack = (hole: number) => {
    if (!canAnswer) return;
    const i = upIn(hole);
    if (i < 0 || hit.includes(i)) return;
    setHit((h) => [...h, i]);
    sfx(pz.moles[i][3] ? "error" : "hit");
    act({ type: "whack", r: view.round, i });
  };
  useKeys(canAnswer && playing, me, (e) => {
    const d = digitOf(e);
    if (d < 0 || d >= pz.holes) return false;
    whack(d);
    return true;
  });

  if (phase === "result" && result) {
    const total = pz.moles.filter((m) => !m[3]).length;
    return (
      <div className="flex flex-col gap-3">
        <Prompt>
          {total} moles, {pz.moles.length - total} bomb{pz.moles.length - total === 1 ? "" : "s"}
        </Prompt>
        <ResultList
          result={result}
          byId={byId}
          me={me}
          value={(l) => {
            const bombs = (Array.isArray(l.pick) ? l.pick.length : 0) - (l.v ?? 0);
            return `${l.v ?? 0}/${total} 🐹${bombs > 0 ? ` · ${bombs} 💣` : ""}`;
          }}
          order={(l) => -l.pts - (l.v ?? 0) / 100}
        />
      </div>
    );
  }
  const moles = hit.filter((i) => !pz.moles[i][3]).length;
  const bombs = hit.length - moles;
  return (
    <div className="flex flex-col items-center gap-3">
      <Prompt>
        Whack the 🐹 · never the 💣
      </Prompt>
      <div className="grid w-full max-w-[18rem] grid-cols-3 gap-2.5" role="group" aria-label="Mole holes">
        {Array.from({ length: pz.holes }, (_, hole) => {
          const i = upIn(hole);
          const mole = i >= 0 ? pz.moles[i] : null;
          const bonked = i >= 0 && hit.includes(i);
          return (
            <button
              key={hole}
              type="button"
              data-hole={hole}
              disabled={!canAnswer}
              aria-label={`Hole ${hole + 1}${mole ? (mole[3] ? ": a bomb" : ": a mole") : ""}`}
              aria-keyshortcuts={String(hole + 1)}
              onPointerDown={(e) => {
                if (e.button === 0) whack(hole);
              }}
              className="relative grid aspect-square touch-manipulation place-items-center overflow-hidden rounded-full border-2 select-none disabled:cursor-default"
              style={{
                borderColor: bonked ? (mole?.[3] ? ROSE : GREEN) : color + "55",
                background: "radial-gradient(circle at 50% 70%, #00000088, var(--color-panel-2) 75%)",
              }}
            >
              {isPlayer && (
                <span aria-hidden className="absolute top-1 left-1/2 -translate-x-1/2 font-mono text-[10px] text-muted">
                  {hole + 1}
                </span>
              )}
              {mole && (
                <span key={i} aria-hidden className={`text-[clamp(1.8rem,11cqw,2.8rem)] leading-none ${bonked ? "blz-bonk" : "blz-mole"}`}>
                  {bonked ? "💥" : mole[3] ? "💣" : "🐹"}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {isPlayer && (
        <p className="text-sm font-bold tabular-nums">
          🔨 {moles}
          {bombs > 0 && <span style={{ color: ROSE }}> · 💣 {bombs}</span>}
        </p>
      )}
    </div>
  );
}

// ---------- spot the difference ----------

export function SpotBoard(props: BoardProps<Pz<"spot">>) {
  const { pz, phase, result, myPick, submit, view, canAnswer } = props;
  const mine = numPick(myPick);
  const cols = Math.round(Math.sqrt(pz.a.length));
  const grid = (cells: string[], side: string) => (
    <CellGrid
      props={props}
      cells={cells}
      cols={cols}
      maxWidth="100%"
      emojiSize={cols === 3 ? "clamp(1.3rem, 7cqw, 2.1rem)" : "clamp(1.05rem, 5.4cqw, 1.8rem)"}
      selected={mine === null ? [] : [mine]}
      answers={phase === "result" && typeof result?.answer === "number" ? [result.answer] : []}
      onCell={(i) => canAnswer && submit({ type: "pick", r: view.round, c: i }, i)}
      label={`${side} grid`}
    />
  );
  return (
    <div className="flex flex-col gap-3">
      <Prompt>{phase === "play" ? "One square is different. Tap it!" : "The difference:"}</Prompt>
      <div className="mx-auto grid w-full max-w-[34rem] grid-cols-2 gap-3">
        {grid(pz.a, "Left")}
        {grid(pz.b, "Right")}
      </div>
    </div>
  );
}

// ---------- middle arrow ----------

export function FlankBoard(props: BoardProps<Pz<"flank">>) {
  const { pz, phase, result, color } = props;
  const mid = Math.floor(pz.arrows.length / 2);
  const answer = phase === "result" && typeof result?.answer === "number" ? result.answer : null;
  return (
    <div className="flex flex-col gap-4">
      <Prompt>
        {phase === "play" ? (
          <>
            Which way does the <Em color={color}>MIDDLE</Em> arrow point?
          </>
        ) : (
          `The middle one points ${DIR_NAMES[answer ?? 0].toLowerCase()}`
        )}
      </Prompt>
      <div className="flex flex-col items-center gap-1 py-1" role="img" aria-label="A row of arrows">
        <div className="flex items-center justify-center gap-[clamp(0.1rem,1cqw,0.5rem)]">
          {pz.arrows.map((d, i) => (
            <span
              key={i}
              className="blz-pop"
              style={{ opacity: answer !== null && i !== mid ? 0.25 : 1, ...cssVars({ "--d": `${Math.abs(i - mid) * 40}ms` }) }}
            >
              <ArrowIcon dir={d} className="size-[clamp(2rem,10cqw,3.3rem)]" stroke={3.4} color={answer !== null && i === mid ? GREEN : "currentColor"} />
            </span>
          ))}
        </div>
        <span aria-hidden className="text-xs font-black" style={{ color }}>
          ▲
        </span>
      </div>
      <Choices
        props={props}
        cols="grid-cols-4"
        keyMap={(e) => arrowOf(e)}
        labels={DIR_NAMES.map((n) => n)}
        items={DIR_NAMES.map((name, d) => (
          <span key={d} className="flex flex-col items-center gap-0.5 pt-1">
            <ArrowIcon dir={d} className="size-7" />
            <span className="font-sans text-[11px] font-semibold text-muted">{name}</span>
          </span>
        ))}
      />
    </div>
  );
}

// ---------- odd word out ----------

export function NotinBoard(props: BoardProps<Pz<"notin">>) {
  const { pz, phase, color } = props;
  return (
    <div className="flex flex-col gap-3">
      <Prompt>
        {phase === "play" ? (
          <>
            Which one is <Em color={color}>NOT</Em> {pz.ask}?
          </>
        ) : (
          <>The odd one out ({pz.ask}):</>
        )}
      </Prompt>
      <Choices
        props={props}
        labels={pz.options}
        items={pz.options.map((o) => {
          const sp = o.indexOf(" ");
          return (
            <span key={o} className="flex flex-col items-center gap-1 py-1">
              <span className="text-4xl leading-none">{o.slice(0, sp)}</span>
              <span className="font-sans text-sm font-bold">{o.slice(sp + 1)}</span>
            </span>
          );
        })}
      />
    </div>
  );
}

"use client";

// Presentational pieces of the Sketch Storm screen.

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { PlayerChip, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import type { Player } from "@/shared/types";
import type { FeedItem, Offer, SketchAction, SketchView } from "./server";
import type { Level, SketchEvent } from "./shared";
import { isTypingTarget, Thumb, type StrokeStore } from "./canvas";

type ById = Record<string, Player>;
type Act = (a: SketchAction) => void;

export const LEVELS: Record<Level, { label: string; cls: string }> = {
  easy: { label: "Easy", cls: "bg-emerald-400/20 text-emerald-300" },
  medium: { label: "Medium", cls: "bg-amber-400/20 text-amber-300" },
  hard: { label: "Hard", cls: "bg-rose-400/20 text-rose-300" },
};

function Name({ p }: { p: Player | undefined }) {
  if (!p) return <>The artist</>;
  return (
    <span className="whitespace-nowrap">
      <span aria-hidden>{p.avatar}</span> <span style={{ color: p.color }}>{p.name}</span>
    </span>
  );
}

/** Split a word into wrap-friendly chunks: break at spaces (gap) or after hyphens. */
function chunks(chars: (string | null)[]) {
  const out: { cells: { ch: string | null; i: number }[]; space: boolean }[] = [{ cells: [], space: false }];
  chars.forEach((ch, i) => {
    const cur = out[out.length - 1];
    if (ch === " ") {
      cur.space = true;
      out.push({ cells: [], space: false });
    } else {
      cur.cells.push({ ch, i });
      if (ch === "-") out.push({ cells: [], space: false });
    }
  });
  return out.filter((c) => c.cells.length);
}

const isLetter = (ch: string | null) => ch !== null && ch !== " " && ch !== "-";

/**
 * FLIP: when the order of `[data-flip]` children changes, slide each row from
 * where it was to where it is now (transform only). Skipped with reduced motion.
 */
function useFlip(listRef: RefObject<HTMLElement | null>, order: string) {
  const tops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, number>();
    for (const row of list.querySelectorAll<HTMLElement>("[data-flip]")) {
      const id = row.dataset.flip ?? "";
      const top = row.offsetTop;
      next.set(id, top);
      const was = tops.current.get(id);
      if (!still && was !== undefined && was !== top && typeof row.animate === "function") {
        row.animate([{ transform: `translateY(${was - top}px)` }, { transform: "none" }], {
          duration: 480,
          easing: "cubic-bezier(.2,.8,.2,1)",
        });
      }
    }
    tops.current = next;
  }, [listRef, order]);
}

// ---------- header ----------

function StatusText({ view, byId }: { view: SketchView; byId: ById }) {
  const artist = <Name p={byId[view.artist]} />;
  switch (view.phase) {
    case "choose":
      return view.role === "artist" ? <>Your turn! Pick a word to draw ✏️</> : <>{artist} is choosing a word…</>;
    case "draw":
      if (view.role === "artist") return <>Draw it! Everyone’s guessing 🎨</>;
      if (view.guessed) return <>You got it! ✓ Waiting for the others…</>;
      if (view.role === "spectator") return <>{artist} is drawing</>;
      return <>What is {artist} drawing?</>;
    case "reveal":
      if (view.reason === "left") return <>{artist} left, so this turn is over</>;
      if (view.reason === "all") return <>Everyone got it! 🎉</>;
      return view.correct.length ? <>Time’s up! ⏰</> : <>Time’s up! Nobody got it 😅</>;
    default:
      return <>That’s a wrap! 🎨</>;
  }
}

function Countdown({ endsAt, serverNow, urgentAt }: { endsAt: number; serverNow: () => number; urgentAt: number }) {
  const secs = useSecondsLeft(endsAt, serverNow);
  const urgent = secs <= urgentAt;
  return (
    <span role="timer" className={`tabular-nums ${urgent ? "sk-urgent text-red-300" : ""}`} aria-label={`${secs} seconds left`}>
      ⏱ {secs}s
    </span>
  );
}

function PhaseTimer({ view, serverNow, accent }: { view: SketchView; serverNow: () => number; accent: string }) {
  const secs = useSecondsLeft(view.endsAt, serverNow);
  const color = view.phase === "draw" && secs <= 10 ? "#f87171" : view.phase === "reveal" ? "#a39dc8" : accent;
  return <TimerBar endsAt={view.endsAt} total={view.phaseMs} serverNow={serverNow} color={color} />;
}

export function Header({ view, byId, serverNow, accent }: { view: SketchView; byId: ById; serverNow: () => number; accent: string }) {
  const perLap = Math.max(1, view.turns / Math.max(1, view.laps));
  const lap = Math.floor(view.turn / perLap) + 1;
  return (
    <StatusBanner accent={accent}>
      <div className="flex items-center justify-between gap-2 font-sans text-xs font-semibold text-muted">
        <span>
          Turn {view.turn + 1} of {view.turns}
          {view.laps > 1 ? ` · lap ${lap}/${view.laps}` : ""}
        </span>
        <Countdown endsAt={view.endsAt} serverNow={serverNow} urgentAt={view.phase === "draw" ? 10 : -1} />
      </div>
      <div aria-live="polite" className="mt-1">
        <div key={`${view.turn}-${view.phase}-${view.guessed}`} className="animate-rise text-balance">
          <StatusText view={view} byId={byId} />
        </div>
      </div>
      <div className="mt-2 flex min-h-9 items-center justify-center">
        <WordRow view={view} />
      </div>
      <div className="mt-2">
        <PhaseTimer view={view} serverNow={serverNow} accent={accent} />
      </div>
      {view.soloEndsAt !== null && (
        <p role="status" className="mt-2 font-sans text-xs font-semibold text-amber-300">
          Waiting for players to come back… <Countdown endsAt={view.soloEndsAt} serverNow={serverNow} urgentAt={-1} />
        </p>
      )}
    </StatusBanner>
  );
}

function WordRow({ view }: { view: SketchView }) {
  if (view.phase === "choose") {
    return (
      <p className="font-sans text-sm font-medium text-muted">
        {view.role === "artist" ? "Choose one of the words on the canvas" : "Get ready to guess…"}
      </p>
    );
  }
  if (view.phase === "draw" && view.word) {
    return <Word word={view.word} mask={view.role === "artist" ? view.mask : null} note={view.role === "artist" ? "your word" : undefined} />;
  }
  if (view.phase === "draw" && view.mask) return <Mask mask={view.mask} />;
  if (view.phase === "reveal") {
    return view.word ? <Word word={view.word} flip /> : <p className="font-sans text-sm text-muted">No word this time</p>;
  }
  return null;
}

/** The word in full. For the artist, letters already given away as hints are underlined. */
function Word({ word, mask, note, flip }: { word: string; mask?: (string | null)[] | null; note?: string; flip?: boolean }) {
  const hinted = mask ? mask.filter((c, i) => isLetter(c) && c === word[i]).length : 0;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex flex-wrap items-baseline justify-center gap-y-0.5 font-display text-2xl font-extrabold tracking-wider text-[var(--sk-accent)] uppercase @md:text-3xl">
        {chunks(Array.from(word)).map((c, ci) => (
          <span key={ci} className={`flex ${c.space ? "mr-3" : ""}`}>
            {c.cells.map(({ ch, i }) => (
              <span
                key={i}
                className={`${flip ? "sk-flip" : ""} ${mask && isLetter(mask[i]) ? "underline decoration-2 underline-offset-4" : ""}`}
                style={flip ? { animationDelay: `${i * 40}ms` } : undefined}
              >
                {ch}
              </span>
            ))}
          </span>
        ))}
      </div>
      {note && (
        <span className="font-sans text-[11px] font-semibold tracking-wide text-muted uppercase">
          {note}
          {hinted ? ` · ${hinted} letter${hinted > 1 ? "s" : ""} hinted` : ""}
        </span>
      )}
    </div>
  );
}

function Mask({ mask }: { mask: (string | null)[] }) {
  const letters = mask.filter((c) => c === null || isLetter(c)).length;
  const spoken = mask.map((c) => (c === null ? "blank" : c === " " ? "space" : c === "-" ? "dash" : c)).join(" ");
  return (
    <div className="flex flex-wrap items-end justify-center gap-y-1.5" role="img" aria-label={`Secret word, ${letters} letters: ${spoken}`}>
      {chunks(mask).map((c, ci) => (
        <span key={ci} className={`flex items-end gap-[3px] @md:gap-1 ${c.space ? "mr-3 @md:mr-4" : "mr-[3px]"}`}>
          {c.cells.map(({ ch, i }) =>
            ch === "-" ? (
              <span key={i} className="font-mono text-lg font-bold text-muted">
                -
              </span>
            ) : (
              <span
                key={`${i}-${ch ?? ""}`}
                className={`grid h-7 w-[18px] place-items-center border-b-[3px] font-mono text-lg leading-none font-bold uppercase @md:h-8 @md:w-6 @md:text-xl ${
                  ch ? "animate-pop border-[var(--sk-accent)] text-[var(--sk-accent)]" : "border-text/60"
                }`}
              >
                {ch ?? ""}
              </span>
            ),
          )}
        </span>
      ))}
      <span className="mb-0.5 ml-1 self-end rounded-full bg-panel-2 px-2 py-0.5 font-sans text-xs font-semibold text-muted">
        {letters}
      </span>
    </div>
  );
}

// ---------- canvas overlays ----------

/** Backdrop for overlays that cover the (blank) canvas. */
const BACKDROP: CSSProperties = {
  background:
    "radial-gradient(circle at 50% 30%, color-mix(in oklab, var(--sk-accent) 26%, transparent), transparent 70%), rgb(23 20 43 / 0.96)",
};

const BURST = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  const r = 85 + (i % 3) * 22;
  return { dx: Math.round(Math.cos(a) * r), dy: Math.round(Math.sin(a) * r), e: ["🎉", "✨", "⭐", "🎨"][i % 4], delay: (i % 4) * 45 };
});

export function CanvasOverlay({ view, byId, me, act, serverNow }: { view: SketchView; byId: ById; me: string; act: Act; serverNow: () => number }) {
  if (view.phase === "choose") {
    return view.options ? (
      <ChooseWord options={view.options} act={act} endsAt={view.endsAt} serverNow={serverNow} />
    ) : (
      <Choosing artist={byId[view.artist]} watching={view.role === "spectator"} />
    );
  }
  if (view.phase === "reveal") {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-2">
        <div className="animate-pop rounded-full border border-white/15 bg-ink/90 px-4 py-1.5 text-center font-display text-lg font-extrabold tracking-wide text-[var(--sk-accent)] uppercase shadow-xl">
          {view.word ?? "Turn skipped"}
        </div>
      </div>
    );
  }
  if (view.phase !== "draw") return null;
  const last = view.correct[view.correct.length - 1];
  return (
    <>
      {view.guessed && <GotIt key={`got-${view.turn}`} gain={view.gains[me] ?? 0} />}
      {last && last !== me && (
        <div key={`${view.turn}-${last}`} className="pointer-events-none absolute inset-x-0 top-2 flex justify-center px-2" aria-hidden>
          <div className="sk-toast rounded-full bg-emerald-500 px-3 py-1 text-sm font-bold text-white shadow-lg">
            🎉 {byId[last]?.name ?? "Someone"} got it!{view.role === "artist" ? " +60 for you" : ""}
          </div>
        </div>
      )}
    </>
  );
}

function Choosing({ artist, watching }: { artist: Player | undefined; watching: boolean }) {
  return (
    <div className="sk-iris absolute inset-0 grid place-items-center rounded-xl p-4 text-center" style={BACKDROP}>
      <div className="animate-pop flex flex-col items-center gap-1">
        <div className="relative text-5xl @md:text-6xl" aria-hidden>
          {artist?.avatar ?? "🎨"}
          <span className="sk-wiggle absolute -right-6 -bottom-1 text-3xl">✏️</span>
        </div>
        <p className="mt-3 font-display text-base font-bold @md:text-lg">Choosing a secret word…</p>
        {watching && <p className="text-xs text-muted">The drawing appears here live</p>}
      </div>
    </div>
  );
}

function ChooseWord({ options, act, endsAt, serverNow }: { options: Offer[]; act: Act; endsAt: number; serverNow: () => number }) {
  const secs = useSecondsLeft(endsAt, serverNow);
  return (
    <div
      className="sk-iris absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-y-auto rounded-xl p-2 text-center @md:gap-3 @md:p-4"
      style={BACKDROP}
    >
      <p className="font-display text-base font-bold @md:text-xl">Pick a word to draw</p>
      <div className="grid w-full max-w-lg grid-cols-3 gap-1.5 @md:gap-2">
        {options.map((o, i) => (
          <button
            key={o.word}
            type="button"
            onClick={() => act({ type: "choose", index: i })}
            className="btn animate-pop min-h-16 flex-col gap-1 px-1.5 py-2 @md:min-h-20"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <span className="text-sm leading-tight font-bold break-words @md:text-base">{o.word}</span>
            <span className={`rounded-full px-2 py-px text-[10px] font-semibold tracking-wide uppercase ${LEVELS[o.level].cls}`}>
              {LEVELS[o.level].label}
            </span>
            <kbd className="hidden text-[10px] text-muted @md:block" aria-hidden>
              {i + 1}
            </kbd>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">
        Draw it, don’t write it! Auto-picks “{options[0].word}” in {secs}s
      </p>
    </div>
  );
}

function GotIt({ gain }: { gain: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden rounded-xl" aria-hidden>
      {BURST.map((b, i) => (
        <span
          key={i}
          className="sk-burst absolute top-1/2 left-1/2 text-2xl"
          style={{ "--dx": `${b.dx}px`, "--dy": `${b.dy}px`, animationDelay: `${b.delay}ms` } as CSSProperties}
        >
          {b.e}
        </span>
      ))}
      <div className="sk-float rounded-2xl bg-emerald-500 px-5 py-3 text-center text-white shadow-2xl">
        <div className="font-display text-xl font-extrabold @md:text-2xl">You got it!</div>
        <div className="font-mono text-lg font-bold">+{gain}</div>
      </div>
    </div>
  );
}

// ---------- guessing ----------

export function GuessBox({ act, onEvent }: { act: Act; onEvent: (fn: (e: unknown) => void) => () => void }) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [close, setClose] = useState<{ text: string; n: number } | null>(null);

  useEffect(
    () =>
      onEvent((raw) => {
        const e = raw as SketchEvent | null;
        if (e && e.k === "close" && typeof e.text === "string") setClose((c) => ({ text: e.text, n: (c?.n ?? 0) + 1 }));
      }),
    [onEvent],
  );

  useEffect(() => {
    if (!close) return;
    const t = window.setTimeout(() => setClose(null), 2600);
    return () => window.clearTimeout(t);
  }, [close]);

  // Start typing anywhere to guess.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.key === " " || isTypingTarget(e.target)) return;
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const guess = text.trim();
    if (!guess) return;
    act({ type: "guess", text: guess.slice(0, 80) });
    setText("");
  };

  return (
    <div className="flex flex-col gap-1">
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor={id} className="sr-only">
          Guess
        </label>
        <input
          id={id}
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={60}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="send"
          placeholder="Type your guess…"
          className="input min-h-11 text-base"
        />
        <button type="submit" className="btn btn-primary min-h-11 shrink-0 px-4" disabled={!text.trim()}>
          Send
        </button>
      </form>
      <div aria-live="polite" className="min-h-5 text-center text-sm">
        {close && (
          <span key={close.n} className="animate-pop inline-block font-semibold text-amber-300">
            🔥 “{close.text}” is close!
          </span>
        )}
      </div>
    </div>
  );
}

export function GotItNote({ word }: { word: string | null }) {
  return (
    <div className="card animate-rise flex items-center justify-center gap-2 border-emerald-400/50 bg-emerald-400/10 px-3 py-2.5 text-center text-sm font-semibold text-emerald-200">
      <span aria-hidden>✓</span>
      <span>
        You got it{word ? <> — it’s <b className="uppercase">{word}</b></> : null}. Keep it secret!
      </span>
    </div>
  );
}

// ---------- feed & scores ----------

function FeedLine({ item, byId, me }: { item: FeedItem; byId: ById; me: string }) {
  const p = byId[item.by];
  const who = item.by === me ? <b>You</b> : <b style={{ color: p?.color }}>{p?.name ?? "Someone"}</b>;
  switch (item.kind) {
    case "guess":
      return (
        <li className="animate-rise break-words">
          {who} <span className="text-text/90">{item.text}</span>
        </li>
      );
    case "correct":
      return (
        <li className="animate-rise rounded-md bg-emerald-400/15 px-2 py-0.5 font-semibold text-emerald-300">
          🎉 {who} guessed it!
        </li>
      );
    case "drawing":
      return (
        <li className="mt-1 border-t border-line pt-1.5 text-xs text-muted first:mt-0 first:border-0 first:pt-0">
          ✏️ {who} {item.by === me ? "are" : "is"} drawing
        </li>
      );
    case "word":
      return (
        <li className="text-xs text-muted">
          The word was <b className="text-text">{item.text}</b>
        </li>
      );
    case "left":
      return <li className="text-xs text-amber-300">🚪 {who} left during their turn</li>;
    case "skip":
      return <li className="text-xs text-muted">⏭️ {who} is away, turn skipped</li>;
  }
}

export function Feed({ feed, byId, me, className = "" }: { feed: FeedItem[]; byId: ById; me: string; className?: string }) {
  const listRef = useRef<HTMLOListElement>(null);
  const last = feed.length ? feed[feed.length - 1].n : 0;
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: still ? "auto" : "smooth" });
  }, [last]);
  return (
    <section className={`card flex min-h-0 flex-col p-3 ${className}`} aria-label="Guesses">
      <div className="label mb-2">Guesses</div>
      <ol
        ref={listRef}
        role="log"
        className="-mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto pt-2 pr-1 text-sm @3xl:max-h-80"
        style={{ maskImage: "linear-gradient(to bottom, transparent, #000 0.6rem)" }}
      >
        {feed.length === 0 && <li className="text-muted">Guesses show up here.</li>}
        {feed.map((item) => (
          <FeedLine key={item.n} item={item} byId={byId} me={me} />
        ))}
      </ol>
    </section>
  );
}

export function Scores({ view, byId, me, className = "" }: { view: SketchView; byId: ById; me: string; className?: string }) {
  const ids = [...view.players].sort((a, b) => (view.scores[b] ?? 0) - (view.scores[a] ?? 0));
  const listRef = useRef<HTMLOListElement>(null);
  useFlip(listRef, ids.join());
  return (
    <section className={`card p-3 ${className}`} aria-label="Scores">
      <div className="label mb-2">Scores</div>
      <ol ref={listRef} className="relative space-y-1">
        {ids.map((id, i) => {
          const p = byId[id];
          if (!p) return null;
          const gain = view.gains[id] ?? 0;
          const got = view.correct.includes(id);
          return (
            <li
              key={id}
              data-flip={id}
              className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 ${id === me ? "bg-panel-2" : ""}`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="w-4 shrink-0 text-right text-xs text-muted tabular-nums">{i + 1}</span>
                <PlayerChip player={p} size="sm" dim={!p.connected} />
                {id === view.artist && (
                  <span title="Drawing now" role="img" aria-label="drawing now">
                    ✏️
                  </span>
                )}
                {got && (
                  <span className="animate-pop font-bold text-emerald-400" title="Guessed it" role="img" aria-label="guessed it">
                    ✓
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {gain > 0 && (
                  <span key={`g${gain}`} className="animate-pop rounded-full bg-emerald-400/15 px-1.5 text-xs font-bold text-emerald-300">
                    +{gain}
                  </span>
                )}
                <span key={`s${view.scores[id] ?? 0}`} className={`font-mono font-bold tabular-nums ${gain > 0 ? "animate-pop" : ""}`}>
                  {view.scores[id] ?? 0}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function TurnResults({ view, byId, serverNow }: { view: SketchView; byId: ById; serverNow: () => number }) {
  const secs = useSecondsLeft(view.endsAt, serverNow);
  const ids = [...view.players].sort((a, b) => (view.gains[b] ?? 0) - (view.gains[a] ?? 0));
  const next = view.next ? byId[view.next] : undefined;
  return (
    <section className="card animate-rise p-3" aria-label="This turn">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="label">This turn</span>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          {next ? (
            <>
              Next up <PlayerChip player={next} size="sm" /> in {secs}s
            </>
          ) : (
            <>Final scores in {secs}s</>
          )}
        </span>
      </div>
      <ul className="grid grid-cols-1 gap-1.5 @md:grid-cols-2">
        {ids.map((id, i) => {
          const gain = view.gains[id] ?? 0;
          return (
            <li
              key={id}
              className="animate-rise flex items-center justify-between gap-2 rounded-lg bg-panel-2 px-2 py-1"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <PlayerChip player={byId[id]} size="sm" />
                {id === view.artist && (
                  <span role="img" aria-label="artist">
                    ✏️
                  </span>
                )}
              </span>
              <span className={`font-mono font-bold tabular-nums ${gain ? "text-emerald-300" : "text-muted"}`}>+{gain}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------- final screen ----------

export function Final({ view, byId, me, store }: { view: SketchView; byId: ById; me: string; store: StrokeStore }) {
  const ids = [...view.players].sort((a, b) => (view.scores[b] ?? 0) - (view.scores[a] ?? 0));
  const rankOf = (id: string) => 1 + ids.filter((x) => (view.scores[x] ?? 0) > (view.scores[id] ?? 0)).length;
  const top = view.scores[ids[0]] ?? 0;
  return (
    <div className="flex flex-col gap-3">
      <section className="card p-4" aria-label="Final standings">
        <div className="label mb-3">
          Final standings{view.endedEarly ? " · ended early" : ""}
        </div>
        <ol className="flex flex-col gap-2">
          {ids.map((id, i) => {
            const rank = rankOf(id);
            const win = rank === 1 && top > 0;
            const medal = (view.scores[id] ?? 0) > 0 ? ["🥇", "🥈", "🥉"][rank - 1] : undefined;
            return (
              <li
                key={id}
                className={`animate-rise flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${
                  win ? "border-[var(--sk-accent)] bg-[var(--sk-accent)]/10" : "border-line bg-panel-2"
                } ${id === me ? "ring-1 ring-text/30" : ""}`}
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={`w-7 shrink-0 text-center text-lg font-bold text-muted ${medal ? "animate-pop" : ""}`}
                    style={medal ? { animationDelay: `${250 + i * 60}ms` } : undefined}
                    aria-label={`rank ${rank}`}
                  >
                    {medal ?? rank}
                  </span>
                  <PlayerChip player={byId[id]}>
                    {win && (
                      <span aria-hidden className="sk-crown">
                        👑
                      </span>
                    )}
                  </PlayerChip>
                </span>
                <span className="shrink-0 font-mono text-xl font-extrabold tabular-nums">
                  {view.scores[id] ?? 0}
                  <span className="ml-1 font-sans text-xs font-semibold text-muted">pts</span>
                </span>
              </li>
            );
          })}
        </ol>
      </section>
      {view.history.length > 0 && (
        <section className="card p-3" aria-label="Gallery">
          <div className="label mb-2">Tonight’s gallery</div>
          <ul className="grid grid-cols-2 gap-2 @xl:grid-cols-3 @4xl:grid-cols-4">
            {view.history.map((h, i) => (
              <li
                key={h.turn}
                className="animate-rise flex min-w-0 flex-col gap-1.5 rounded-xl bg-panel-2 p-1.5"
                style={{ animationDelay: `${300 + i * 70}ms` }}
              >
                <Thumb store={store} turn={h.turn} label={`${byId[h.artist]?.name ?? "Someone"}’s drawing of ${h.word}`} />
                <div className="flex items-center justify-between gap-1 px-0.5">
                  <span className="truncate text-sm font-bold">{h.word.charAt(0).toUpperCase() + h.word.slice(1)}</span>
                  <span className="shrink-0 text-xs text-muted" title="Players who guessed it">
                    {h.guessers.length}/{Math.max(1, view.players.length - 1)} ✓
                  </span>
                </div>
                <span className="min-w-0 px-0.5">
                  <PlayerChip player={byId[h.artist]} size="sm" />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-center text-xs text-muted">{children}</p>;
}

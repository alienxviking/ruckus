"use client";

// Presentational pieces of the Emoji Charades screen.

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type RefObject } from "react";
import { PlayerChip, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import type { Player } from "@/shared/types";
import type { CharadesAction, CharadesView, FeedItem, Offer } from "./server";
import { CATS, isLetter, type Cat, type CharadesEvent } from "./shared";
import { emojiName } from "./emoji";
import { Avatar } from "@/components/Avatar";

type ById = Record<string, Player>;
type Act = (a: CharadesAction) => void;

export const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

function Name({ p }: { p: Player | undefined }) {
  if (!p) return <>The clue-giver</>;
  return (
    <span className="whitespace-nowrap">
      <span aria-hidden><Avatar id={p.avatar} /></span> <span style={{ color: p.color }}>{p.name}</span>
    </span>
  );
}

function CatChip({ cat, className = "" }: { cat: Cat; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-[var(--ec-accent)]/15 px-2 py-0.5 text-xs font-bold text-[var(--ec-accent)] ${className}`}>
      <span aria-hidden>{CATS[cat].emoji}</span>
      {CATS[cat].label}
    </span>
  );
}

const wordCount = (phrase: (string | null)[]) => {
  let n = 0;
  let inWord = false;
  for (const ch of phrase) {
    const w = ch !== " ";
    if (w && !inWord) n++;
    inWord = w;
  }
  return n;
};

/** Split a phrase into word chunks so it wraps between words only. */
function chunks(chars: (string | null)[]) {
  const out: { ch: string | null; i: number }[][] = [[]];
  chars.forEach((ch, i) => {
    if (ch === " ") out.push([]);
    else out[out.length - 1].push({ ch, i });
  });
  return out.filter((c) => c.length);
}

/** FLIP: slide `[data-flip]` rows to their new places when the order changes. */
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
        row.animate([{ transform: `translateY(${was - top}px)` }, { transform: "none" }], { duration: 450, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
    }
    tops.current = next;
  }, [listRef, order]);
}

// ---------- header ----------

function StatusText({ view, byId }: { view: CharadesView; byId: ById }) {
  const giver = <Name p={byId[view.giver]} />;
  switch (view.phase) {
    case "choose":
      return view.role === "giver" ? <>Your turn! Pick a phrase to act out 🎬</> : <>{giver} is picking a phrase…</>;
    case "clue":
      if (view.role === "giver") return <>Describe it with emoji only! 🤫</>;
      if (view.guessed) return <>You got it! ✓ Waiting for the others…</>;
      if (view.role === "spectator") return <>{giver} is giving a clue</>;
      return <>What is {giver} describing?</>;
    case "reveal":
      if (view.reason === "left") return <>{giver} left, so this turn is over</>;
      if (view.reason === "all") return <>Everyone got it! 🎉</>;
      return view.correct.length ? <>Time’s up! ⏰</> : <>Time’s up! Nobody got it 😅</>;
    default:
      return <>That’s a wrap! 🎬</>;
  }
}

function Countdown({ endsAt, serverNow, urgentAt }: { endsAt: number; serverNow: () => number; urgentAt: number }) {
  const secs = useSecondsLeft(endsAt, serverNow);
  return (
    <span role="timer" className={`tabular-nums ${secs <= urgentAt ? "ec-urgent text-red-300" : ""}`} aria-label={`${secs} seconds left`}>
      ⏱ {secs}s
    </span>
  );
}

function PhaseTimer({ view, serverNow, accent }: { view: CharadesView; serverNow: () => number; accent: string }) {
  const secs = useSecondsLeft(view.endsAt, serverNow);
  const color = view.phase === "clue" && secs <= 10 ? "#f87171" : view.phase === "reveal" ? "#a39dc8" : accent;
  return <TimerBar endsAt={view.endsAt} total={view.phaseMs} serverNow={serverNow} color={color} />;
}

export function Header({ view, byId, serverNow, accent }: { view: CharadesView; byId: ById; serverNow: () => number; accent: string }) {
  const perLap = Math.max(1, view.turns / Math.max(1, view.laps));
  const lap = Math.floor(view.turn / perLap) + 1;
  return (
    <StatusBanner accent={accent}>
      <div className="flex items-center justify-between gap-2 font-sans text-xs font-semibold text-muted">
        <span>
          Turn {view.turn + 1} of {view.turns}
          {view.laps > 1 ? ` · round ${lap} of ${view.laps}` : ""}
        </span>
        <Countdown endsAt={view.endsAt} serverNow={serverNow} urgentAt={view.phase === "clue" ? 10 : -1} />
      </div>
      <div aria-live="polite" className="mt-1">
        <div key={`${view.turn}-${view.phase}-${view.guessed}`} className="animate-rise text-balance">
          <StatusText view={view} byId={byId} />
        </div>
      </div>
      <PhraseRow view={view} />
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

function PhraseRow({ view }: { view: CharadesView }) {
  if (view.phase === "clue" && view.phrase) {
    return (
      <div className="mt-2 flex flex-col items-center gap-1">
        <Phrase phrase={view.phrase} mask={view.role === "giver" ? view.mask : null} />
        {view.role === "giver" && view.mask && (
          <span className="font-sans text-xs font-semibold text-muted">
            Your secret phrase{hintedCount(view.phrase, view.mask)}
          </span>
        )}
      </div>
    );
  }
  if (view.phase === "clue" && view.mask) return <Mask mask={view.mask} />;
  if (view.phase === "reveal" && view.phrase) {
    return (
      <div className="mt-2">
        <Phrase phrase={view.phrase} flip />
      </div>
    );
  }
  return null;
}

function hintedCount(phrase: string, mask: (string | null)[]) {
  const n = mask.filter((c, i) => isLetter(c) && c === phrase[i]).length;
  return n ? ` · ${n} letter${n > 1 ? "s" : ""} hinted` : "";
}

/** The phrase in full. For the clue-giver, letters already given away as hints are underlined. */
function Phrase({ phrase, mask, flip }: { phrase: string; mask?: (string | null)[] | null; flip?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-center gap-x-2.5 font-display text-xl leading-tight font-extrabold tracking-wide text-[var(--ec-accent)] uppercase @md:text-2xl">
      {chunks(Array.from(phrase)).map((c, ci) => (
        <span key={ci} className="flex">
          {c.map(({ ch, i }) => (
            <span
              key={i}
              className={`${flip ? "ec-flip" : ""} ${mask && isLetter(mask[i]) ? "underline decoration-2 underline-offset-4" : ""}`}
              style={flip ? { animationDelay: `${i * 25}ms` } : undefined}
            >
              {ch}
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}

function Mask({ mask }: { mask: (string | null)[] }) {
  const letters = mask.filter((c) => c === null || isLetter(c)).length;
  const spoken = mask.map((c) => (c === null ? "blank" : c === " " ? "space" : c)).join(" ");
  const words = chunks(mask);
  return (
    <div className="mt-2 flex flex-wrap items-end justify-center gap-x-3 gap-y-2 @md:gap-x-4" role="img" aria-label={`Secret phrase, ${words.length} words, ${letters} letters: ${spoken}`}>
      {words.map((c, ci) => (
        <span key={ci} className="flex items-end gap-[3px]">
          {c.map(({ ch, i }) =>
            ch !== null && !isLetter(ch) ? (
              <span key={i} className="font-mono text-lg font-bold text-muted">
                {ch}
              </span>
            ) : (
              <span
                key={`${i}-${ch ?? ""}`}
                className={`grid h-6 w-[15px] place-items-center border-b-[3px] font-mono text-base leading-none font-bold uppercase @md:h-7 @md:w-5 @md:text-lg ${
                  ch ? "animate-pop border-[var(--ec-accent)] text-[var(--ec-accent)]" : "border-text/55"
                }`}
              >
                {ch ?? ""}
              </span>
            ),
          )}
        </span>
      ))}
    </div>
  );
}

// ---------- the stage (the clue itself) ----------

const BURST = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  const r = 80 + (i % 3) * 22;
  return { dx: Math.round(Math.cos(a) * r), dy: Math.round(Math.sin(a) * r), e: ["🎉", "✨", "⭐", "🎬"][i % 4], delay: (i % 4) * 45 };
});

export function Stage({
  view,
  byId,
  me,
  clue,
  act,
  onRemove,
  serverNow,
}: {
  view: CharadesView;
  byId: ById;
  me: string;
  clue: string[];
  act: Act;
  /** Set for the clue-giver while they can edit: tapping an emoji removes it. */
  onRemove: ((i: number) => void) | null;
  serverNow: () => number;
}) {
  const giver = byId[view.giver];
  if (view.phase === "choose") {
    return (
      <div className="ec-stage card relative grid min-h-52 place-items-center overflow-hidden p-3">
        {view.options ? (
          <ChoosePhrase options={view.options} act={act} endsAt={view.endsAt} serverNow={serverNow} />
        ) : (
          <div className="animate-pop flex flex-col items-center gap-1 text-center">
            <div className="relative text-5xl" aria-hidden>
              <Avatar id={giver?.avatar ?? "🎬"} />
              <span className="ec-wiggle absolute -right-7 -bottom-1 text-3xl">🤔</span>
            </div>
            <p className="mt-3 font-display text-base font-bold @md:text-lg">Picking a secret phrase…</p>
            <p className="text-xs text-muted">The emoji clue appears here live</p>
          </div>
        )}
      </div>
    );
  }

  const last = view.correct[view.correct.length - 1];
  const editing = !!onRemove;
  const spoken = clue.length ? clue.map(emojiName).join(", ") : "empty";
  return (
    <section className={`ec-stage card relative overflow-hidden p-3 ${view.phase === "clue" && view.correct.length ? "pb-10" : ""}`} aria-label="The clue">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {view.cat ? <CatChip cat={view.cat} /> : <span />}
        {view.mask && (
          <span className="text-xs font-semibold text-muted">
            {wordCount(view.mask)} word{wordCount(view.mask) === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <div className="sr-only" aria-live="polite">
        Clue: {spoken}
      </div>
      <div className={`flex flex-wrap content-center items-center justify-center gap-1 ${editing ? "min-h-20 py-1.5 @md:min-h-28" : "min-h-32 py-3 @md:min-h-40"}`}>
        {clue.map((e, i) =>
          editing ? (
            <button
              key={`${i}-${e}`}
              type="button"
              onClick={() => onRemove(i)}
              aria-label={`Remove ${emojiName(e)}`}
              title="Tap to remove"
              className="ec-pop ec-removable relative grid size-14 place-items-center rounded-xl text-[2.6rem] leading-none @md:size-[4.5rem] @md:text-[3.4rem]"
            >
              {e}
              <span
                aria-hidden
                className="absolute -top-0.5 -right-0.5 grid size-5 place-items-center rounded-full border-2 border-ink bg-[#ff5d73] font-sans text-[10px] font-black text-ink"
              >
                ✕
              </span>
            </button>
          ) : (
            <span key={`${i}-${e}`} aria-hidden className="ec-pop grid size-14 place-items-center text-[2.6rem] leading-none @md:size-[4.5rem] @md:text-[3.4rem]">
              {e}
            </span>
          ),
        )}
        {view.phase === "clue" && (
          <span aria-hidden className={`ec-caret ml-1 h-11 w-[3px] rounded-full bg-[var(--ec-accent)] @md:h-14 ${clue.length ? "" : "hidden"}`} />
        )}
        {!clue.length && (
          <p className="px-4 text-center text-sm text-muted">
            {view.phase !== "clue"
              ? "No clue this time"
              : editing
                ? "Tap emoji below to build your clue. Tap one here to remove it."
                : (
                    <>
                      <span className="ec-wiggle mr-1 text-2xl" aria-hidden>
                        ⌨️
                      </span>
                      Waiting for the first emoji…
                    </>
                  )}
          </p>
        )}
      </div>
      {view.phase === "clue" && view.guessed && <GotIt key={`got-${view.turn}`} gain={view.gains[me] ?? 0} />}
      {view.phase === "clue" && last && last !== me && (
        <div key={`${view.turn}-${last}`} className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center px-2" aria-hidden>
          <div className="ec-toast rounded-full bg-emerald-500 px-3 py-1 text-sm font-bold text-white shadow-lg">
            🎉 {byId[last]?.name ?? "Someone"} got it!{view.role === "giver" ? " +50 for you" : ""}
          </div>
        </div>
      )}
    </section>
  );
}

function ChoosePhrase({ options, act, endsAt, serverNow }: { options: Offer[]; act: Act; endsAt: number; serverNow: () => number }) {
  const secs = useSecondsLeft(endsAt, serverNow);
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <div className="flex w-full flex-col items-center gap-2 text-center">
      <p className="font-display text-base font-bold @md:text-xl">Pick a phrase to describe</p>
      <div className="grid w-full max-w-xl grid-cols-1 gap-2 @md:grid-cols-3">
        {options.map((o, i) => (
          <button
            key={o.text}
            type="button"
            onClick={() => {
              setPicked(i);
              act({ type: "choose", index: i });
            }}
            disabled={picked !== null}
            className={`btn animate-pop min-h-14 justify-start gap-3 px-3 py-2 text-left @md:min-h-24 @md:flex-col @md:justify-center @md:text-center ${
              picked === i ? "border-[var(--ec-accent)] bg-[var(--ec-accent)]/15" : ""
            }`}
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <span className="text-2xl" aria-hidden>
              {CATS[o.cat].emoji}
            </span>
            <span className="flex min-w-0 flex-col @md:items-center">
              <span className="text-xs font-semibold text-muted">{CATS[o.cat].label}</span>
              <span className="text-base leading-tight font-bold break-words">{o.text}</span>
            </span>
            <kbd className="ml-auto hidden text-xs text-muted @md:ml-0 @md:block" aria-hidden>
              {i + 1}
            </kbd>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">
        Emoji only, no letters! Auto-picks “{options[0].text}” in {secs}s
      </p>
    </div>
  );
}

function GotIt({ gain }: { gain: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden" aria-hidden>
      {BURST.map((b, i) => (
        <span
          key={i}
          className="ec-burst absolute top-1/2 left-1/2 text-2xl"
          style={{ "--dx": `${b.dx}px`, "--dy": `${b.dy}px`, animationDelay: `${b.delay}ms` } as CSSProperties}
        >
          {b.e}
        </span>
      ))}
      <div className="ec-float rounded-2xl bg-emerald-500 px-5 py-3 text-center text-white shadow-2xl">
        <div className="font-display text-xl font-extrabold @md:text-2xl">You got it!</div>
        <div className="font-mono text-lg font-bold">+{gain}</div>
      </div>
    </div>
  );
}

// ---------- guessing ----------

export interface Pending {
  id: number;
  text: string;
  /** feedSeq at the time of sending: a later guess line from me with this text settles it. */
  after: number;
}

export function GuessBox({
  act,
  onEvent,
  onSent,
}: {
  act: Act;
  onEvent: (fn: (e: unknown) => void) => () => void;
  onSent: (text: string) => void;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [close, setClose] = useState<{ text: string; n: number } | null>(null);

  useEffect(
    () =>
      onEvent((raw) => {
        const e = raw as CharadesEvent | null;
        if (e && e.k === "close" && typeof e.text === "string") setClose((c) => ({ text: e.text, n: (c?.n ?? 0) + 1 }));
      }),
    [onEvent],
  );

  useEffect(() => {
    if (!close) return;
    const t = window.setTimeout(() => setClose(null), 2800);
    return () => window.clearTimeout(t);
  }, [close]);

  // Start typing anywhere to guess.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
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
    onSent(guess.slice(0, 48)); // first, so a same-tick "close" reply can settle it
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
          placeholder="Type the phrase…"
          className="input min-h-11 text-base"
        />
        <button type="submit" className="btn btn-primary min-h-11 shrink-0 px-4" disabled={!text.trim()}>
          Guess
        </button>
      </form>
      <div aria-live="polite" className="min-h-5 text-center text-sm">
        {close && (
          <span key={close.n} className="animate-pop inline-block font-semibold text-amber-300">
            🔥 “{close.text}” is close! Keep going
          </span>
        )}
      </div>
    </div>
  );
}

export function GotItNote({ phrase }: { phrase: string | null }) {
  return (
    <div className="card animate-rise flex items-center justify-center gap-2 border-emerald-400/50 bg-emerald-400/10 px-3 py-2.5 text-center text-sm font-semibold text-emerald-200">
      <span aria-hidden>✓</span>
      <span>
        You got it{phrase ? <> — it’s <b className="uppercase">{phrase}</b></> : null}. Keep it secret!
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
      return <li className="animate-rise rounded-md bg-emerald-400/15 px-2 py-0.5 font-semibold text-emerald-300">🎉 {who} guessed it!</li>;
    case "giving":
      return (
        <li className="mt-1 border-t border-line pt-1.5 text-xs text-muted first:mt-0 first:border-0 first:pt-0">
          🎬 {who} {item.by === me ? "are" : "is"} giving the clue
        </li>
      );
    case "phrase":
      return (
        <li className="text-xs text-muted">
          It was <b className="text-text">{item.text}</b>
        </li>
      );
    case "left":
      return <li className="text-xs text-amber-300">🚪 {who} left during {item.by === me ? "your" : "their"} turn</li>;
    case "skip":
      return <li className="text-xs text-muted">⏭️ {who} {item.by === me ? "were" : "was"} away, turn skipped</li>;
  }
}

export function Feed({
  feed,
  pending,
  byId,
  me,
  className = "",
}: {
  feed: FeedItem[];
  pending: Pending[];
  byId: ById;
  me: string;
  className?: string;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const last = (feed.length ? feed[feed.length - 1].n : 0) + pending.length * 1000;
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
        className="-mt-2 flex max-h-44 flex-col gap-1 overflow-y-auto pt-2 pr-1 text-sm @3xl:max-h-80"
        style={{ maskImage: "linear-gradient(to bottom, transparent, #000 0.6rem)" }}
      >
        {feed.length === 0 && !pending.length && <li className="text-muted">Guesses show up here.</li>}
        {feed.map((item) => (
          <FeedLine key={item.n} item={item} byId={byId} me={me} />
        ))}
        {pending.map((p) => (
          <li key={`p${p.id}`} className="break-words italic opacity-55">
            <b>You</b> {p.text} <span aria-hidden>…</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Scores({ view, byId, me, className = "" }: { view: CharadesView; byId: ById; me: string; className?: string }) {
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
            <li key={id} data-flip={id} className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 ${id === me ? "bg-panel-2" : ""}`}>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="w-4 shrink-0 text-right text-xs text-muted tabular-nums">{i + 1}</span>
                <PlayerChip player={p} size="sm" dim={!p.connected} />
                {id === view.giver && view.phase !== "final" && (
                  <span title="Giving the clue" role="img" aria-label="giving the clue">
                    🎬
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

export function TurnResults({ view, byId, serverNow }: { view: CharadesView; byId: ById; serverNow: () => number }) {
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
            <li key={id} className="animate-rise flex items-center justify-between gap-2 rounded-lg bg-panel-2 px-2 py-1" style={{ animationDelay: `${i * 50}ms` }}>
              <span className="flex min-w-0 items-center gap-1.5">
                <PlayerChip player={byId[id]} size="sm" />
                {id === view.giver && (
                  <span role="img" aria-label="clue-giver">
                    🎬
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

export function Final({ view, byId, me }: { view: CharadesView; byId: ById; me: string }) {
  const ids = [...view.players].sort((a, b) => (view.scores[b] ?? 0) - (view.scores[a] ?? 0));
  const rankOf = (id: string) => 1 + ids.filter((x) => (view.scores[x] ?? 0) > (view.scores[id] ?? 0)).length;
  const top = view.scores[ids[0]] ?? 0;
  const guessers = Math.max(1, view.players.length - 1);
  return (
    <div className="flex flex-col gap-3">
      <section className="card p-4" aria-label="Final standings">
        <div className="label mb-3">Final standings{view.endedEarly ? " · game ended early" : ""}</div>
        <ol className="flex flex-col gap-2">
          {ids.map((id, i) => {
            const rank = rankOf(id);
            const win = rank === 1 && top > 0;
            const medal = (view.scores[id] ?? 0) > 0 ? ["🥇", "🥈", "🥉"][rank - 1] : undefined;
            return (
              <li
                key={id}
                className={`animate-rise flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${
                  win ? "border-[var(--ec-accent)] bg-[var(--ec-accent)]/10" : "border-line bg-panel-2"
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
                      <span aria-hidden className="ec-crown">
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
        <section className="card p-3" aria-label="Tonight’s clues">
          <div className="label mb-2">Tonight’s clues</div>
          <ul className="grid grid-cols-1 gap-2 @xl:grid-cols-2">
            {view.history.map((h, i) => (
              <li key={h.turn} className="animate-rise flex min-w-0 flex-col gap-1.5 rounded-xl bg-panel-2 p-2.5" style={{ animationDelay: `${300 + i * 70}ms` }}>
                <div className="flex flex-wrap gap-0.5 text-2xl leading-none" role="img" aria-label={h.clue.length ? h.clue.map(emojiName).join(", ") : "no clue"}>
                  {h.clue.length ? h.clue.join(" ") : <span className="text-sm text-muted">(no emoji)</span>}
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 text-sm font-bold break-words">
                    {h.phrase.charAt(0).toUpperCase() + h.phrase.slice(1)}
                  </span>
                  <span className="shrink-0 text-xs text-muted" title="Players who guessed it">
                    {h.guessers.length}/{guessers} got it
                  </span>
                </div>
                <span className="flex min-w-0 items-center gap-1.5">
                  <PlayerChip player={byId[h.giver]} size="sm" />
                  <CatChip cat={h.cat} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

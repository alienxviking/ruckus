"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { MAX_MSG, QUICK, QUICK_HEIST, QUICK_PAIR, cleanText, type Choice, type DcEvent, type Msg } from "./shared";
import type { Who } from "./ui";

/** A line we sent that the server hasn't echoed yet. */
export interface Pending {
  n: number;
  t?: string;
  q?: number;
}

const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);

function parseEvent(raw: unknown): DcEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (e.k === "msg" && isInt(e.r) && isInt(e.g) && e.m && typeof e.m === "object") {
    const m = e.m as Record<string, unknown>;
    if (isInt(m.i) && isInt(m.s) && (typeof m.t === "string" || isInt(m.q))) return e as DcEvent;
    return null;
  }
  if (e.k === "chat" && isInt(e.r) && isInt(e.g) && isInt(e.c)) return e as DcEvent;
  if (e.k === "nope" && isInt(e.n)) return e as DcEvent;
  if (e.k === "pick" && isInt(e.r) && (e.c === "split" || e.c === "steal")) return e as DcEvent;
  if (e.k === "ready" && isInt(e.r) && isInt(e.s) && typeof e.v === "boolean" && isInt(e.x)) return e as DcEvent;
  if (e.k === "lock" && isInt(e.r) && isInt(e.s) && isInt(e.x)) return e as DcEvent;
  return null;
}

/**
 * Live, round-scoped state fed by events: chat lines for our table, activity
 * counters for every table, ready/lock flags, refused messages and our own pick.
 * The owner is keyed by round, so all of this resets with each new deal.
 */
export function useRoundFeed(onEvent: (fn: (e: unknown) => void) => () => void, round: number) {
  const [extra, setExtra] = useState<Msg[]>([]);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [refused, setRefused] = useState<number[]>([]);
  // Our own pick: set optimistically on tap, or by the private ack when it changes elsewhere.
  const [choice, setChoice] = useState<Choice | null>(null);
  // Ready / locked flags from events, each with its revision (newer than the view's `rev` = still news).
  const [readyEv, setReadyEv] = useState<Record<number, { v: boolean; x: number }>>({});
  const [lockEv, setLockEv] = useState<Record<number, number>>({});
  useEffect(
    () =>
      onEvent((raw) => {
        const e = parseEvent(raw);
        if (!e) return;
        if (e.k === "msg") {
          if (e.r !== round) return;
          setExtra((x) => (x.some((m) => m.i === e.m.i) ? x : [...x, e.m].slice(-80)));
        } else if (e.k === "chat") {
          if (e.r !== round) return;
          setCounts((c) => (c[e.g] !== undefined && c[e.g] >= e.c ? c : { ...c, [e.g]: e.c }));
        } else if (e.k === "nope") {
          setRefused((r) => (r.includes(e.n) ? r : [...r, e.n]));
        } else if (e.k === "pick" && e.r === round) {
          setChoice(e.c);
        } else if (e.k === "ready" && e.r === round) {
          setReadyEv((r) => (r[e.s] && r[e.s].x >= e.x ? r : { ...r, [e.s]: { v: e.v, x: e.x } }));
        } else if (e.k === "lock" && e.r === round) {
          setLockEv((l) => (l[e.s] !== undefined && l[e.s] >= e.x ? l : { ...l, [e.s]: e.x }));
        }
      }),
    [onEvent, round],
  );
  return { extra, counts, refused, choice, setChoice, readyEv, lockEv };
}

/** Server snapshot + live lines, deduplicated and in order. */
export function mergeMsgs(base: Msg[], extra: Msg[]): Msg[] {
  if (!extra.length) return base;
  const byId = new Map<number, Msg>();
  for (const m of base) byId.set(m.i, m);
  for (const m of extra) if (!byId.has(m.i)) byId.set(m.i, m);
  return [...byId.values()].sort((a, b) => a.i - b.i).slice(-60);
}

export const msgText = (m: { t?: string; q?: number }) => (m.q !== undefined ? (QUICK[m.q] ?? "…") : (m.t ?? ""));

export function ChatPanel({
  msgs,
  pending,
  refused,
  mySeat,
  who,
  heist,
  open,
  others,
  onSend,
}: {
  msgs: Msg[];
  pending: Pending[];
  refused: number[];
  mySeat: number;
  who: Who;
  heist: boolean;
  /** Talk phase: input and quick phrases shown. */
  open: boolean;
  /** The other seats at this table (for the empty state). */
  others: number[];
  onSend: (body: { t: string } | { q: number }) => void;
}) {
  const [text, setText] = useState("");
  const inputId = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const waiting = pending.filter((p) => !msgs.some((m) => m.s === mySeat && m.n === p.n));
  const lines = msgs.length + waiting.length;

  // Keep the newest line in view (scrolls the chat box only, never the page).
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, refused.length]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = cleanText(text);
    if (!clean) return;
    onSend({ t: clean });
    setText("");
  };

  const quick = heist ? QUICK_HEIST : QUICK_PAIR;
  const partnerNames = others.map((s) => who(s).name);

  return (
    <section className="card flex flex-col gap-2 p-2.5 @lg:p-3" aria-label={heist ? "Heist crew chat" : "Private table chat"}>
      <div className="flex items-center justify-between gap-2 px-0.5">
        <span className="label flex items-center gap-1.5">
          <span aria-hidden>{heist ? "💰" : "🔒"}</span>
          {heist ? "Crew chat" : "Private chat"}
        </span>
        <span className="truncate text-[11px] text-muted">
          {heist ? "everyone playing can read this" : `only you & ${partnerNames.join(" & ")} can read this`}
        </span>
      </div>

      <div
        ref={scroller}
        className={`dc-scroll flex flex-col gap-1.5 overflow-y-auto rounded-xl bg-ink/60 p-2 ${
          open ? "h-[min(34vh,300px)] min-h-36" : "max-h-36"
        }`}
        role="log"
        aria-live="polite"
        aria-label="Chat history"
      >
        {lines === 0 ? (
          <p className="m-auto max-w-[16rem] py-4 text-center text-sm text-muted">
            {open ? (
              heist ? (
                <>Everyone&apos;s here. Convince the crew to split, or don&apos;t. 🤫</>
              ) : (
                <>No messages yet. Make your pitch to {partnerNames.join(" & ")} 👇</>
              )
            ) : (
              <>Not a word was said. 🤐</>
            )}
          </p>
        ) : (
          <>
            {msgs.map((m, i) => (
              <Bubble key={m.i} m={m} mine={m.s === mySeat} who={who} first={i === 0 || msgs[i - 1].s !== m.s} />
            ))}
            {waiting.map((p) => (
              <Bubble
                key={`p${p.n}`}
                m={{ i: -1, s: mySeat, t: p.t, q: p.q }}
                mine
                who={who}
                first={false}
                state={refused.includes(p.n) ? "failed" : "pending"}
              />
            ))}
          </>
        )}
      </div>

      {open ? (
        <>
          <div className="dc-scroll -mx-0.5 flex gap-1.5 overflow-x-auto px-0.5 pb-0.5 @lg:flex-wrap" role="group" aria-label="Quick phrases">
            {quick.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onSend({ q })}
                className="min-h-10 shrink-0 rounded-full border border-line bg-panel-2 px-3 text-sm whitespace-nowrap transition-transform hover:border-muted/60 active:scale-95"
              >
                {QUICK[q]}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="flex gap-2">
            <label htmlFor={inputId} className="sr-only">
              Message
            </label>
            <input
              id={inputId}
              className="input min-w-0 flex-1 py-2"
              placeholder={heist ? "Talk to the crew…" : "Say something persuasive…"}
              value={text}
              maxLength={MAX_MSG}
              autoComplete="off"
              enterKeyHint="send"
              onChange={(e) => setText(e.target.value)}
            />
            <button type="submit" className="btn btn-primary min-h-10 shrink-0 px-4" disabled={!text.trim()}>
              Send
            </button>
          </form>
        </>
      ) : (
        <p className="px-0.5 text-center text-[11px] text-muted">🔇 The talking is over.</p>
      )}
    </section>
  );
}

function Bubble({
  m,
  mine,
  who,
  first,
  state,
}: {
  m: Msg;
  mine: boolean;
  who: Who;
  first: boolean;
  state?: "pending" | "failed";
}) {
  const p = who(m.s);
  const quick = m.q !== undefined;
  const text = msgText(m);
  return (
    <div className={`dc-fade flex max-w-full items-end gap-1.5 ${mine ? "flex-row-reverse" : ""} ${first ? "mt-1" : ""}`}>
      {!mine && (
        <span aria-hidden className={`grid size-7 shrink-0 place-items-center rounded-full text-base ${first ? "" : "invisible"}`} style={{ background: `${p.color}22` }}>
          {p.avatar}
        </span>
      )}
      <div className={`flex min-w-0 max-w-[80%] flex-col ${mine ? "items-end" : "items-start"}`}>
        {first && !mine && (
          <span className="px-1 text-[11px] font-semibold" style={{ color: p.color }}>
            {p.name}
          </span>
        )}
        <p
          className={`rounded-2xl px-3 py-1.5 text-sm break-words [overflow-wrap:anywhere] ${quick ? "font-semibold" : ""} ${
            mine ? "rounded-br-md" : "rounded-bl-md"
          } ${state === "pending" ? "dc-pending" : ""}`}
          style={{
            background: mine ? `${p.color}2e` : "var(--color-panel-2)",
            boxShadow: state === "failed" ? "inset 0 0 0 1.5px #f87171" : `inset 0 0 0 1px ${mine ? `${p.color}55` : "var(--color-line)"}`,
          }}
        >
          <span className="sr-only">{mine ? "You" : p.name}: </span>
          {text}
        </p>
        {state && (
          <span className={`px-1 text-[10px] ${state === "failed" ? "text-red-300" : "text-muted"}`}>
            {state === "failed" ? "⚠ not sent" : "sending…"}
          </span>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Player } from "@/shared/types";
import { GLYPHS, MAX_MSG, QUICK_LINES, TALK_COLORS, cleanText, type Msg } from "./shared";
import type { DefuseAction } from "./server";
import { Glyph, Swatch, cap } from "./ui";
import { Avatar } from "@/components/Avatar";

/** Server snapshot + live lines, deduplicated and in order. */
export function mergeMsgs(base: Msg[], extra: Msg[]): Msg[] {
  if (!extra.length) return base;
  const byId = new Map<number, Msg>();
  for (const m of base) byId.set(m.i, m);
  for (const m of extra) if (!byId.has(m.i)) byId.set(m.i, m);
  return [...byId.values()].sort((a, b) => a.i - b.i).slice(-40);
}

type Pending = Omit<Msg, "i" | "from"> & { n: number };

function Body({ m }: { m: Omit<Msg, "i" | "from"> }) {
  if (m.g !== undefined && GLYPHS[m.g])
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-[#f1ecdc] px-1.5 py-0.5 text-zinc-900">
        <Glyph g={m.g} className="size-5" />
        <span className="text-xs font-bold">{GLYPHS[m.g].name}</span>
      </span>
    );
  if (m.c)
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-white/5 px-1.5 py-0.5 text-xs font-bold">
        <Swatch c={m.c} className="size-3.5" />
        {m.c.toUpperCase()}
      </span>
    );
  return <span className="break-words">{m.t}</span>;
}

export function Talk({
  chat,
  extra,
  me,
  byId,
  act,
  defuser,
}: {
  chat: Msg[];
  extra: Msg[];
  me: string;
  byId: Record<string, Player>;
  act: (a: DefuseAction) => void;
  defuser: string;
}) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [text, setText] = useState("");
  const [glyphsOpen, setGlyphsOpen] = useState(false);
  const last = useRef(0);
  const nonce = useRef(1);
  const list = useRef<HTMLOListElement>(null);
  const msgs = mergeMsgs(chat, extra);
  const echoed = new Set(msgs.filter((m) => m.from === me && m.n !== undefined).map((m) => m.n));
  const waiting = pending.filter((p) => !echoed.has(p.n));

  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, waiting.length]);

  const send = (body: Omit<Pending, "n">) => {
    const now = performance.now();
    if (now - last.current < 270) return;
    last.current = now;
    const n = nonce.current++;
    setPending((p) => [...p.filter((x) => !echoed.has(x.n)), { ...body, n }].slice(-8));
    act({ type: "say", ...body, n });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = cleanText(text);
    if (!t) return;
    send({ t });
    setText("");
  };

  const who = (id: string) => byId[id];
  return (
    <section className="card flex min-w-0 flex-col gap-2 p-2.5" aria-label="Quick talk">
      <div className="flex items-center justify-between">
        <span className="label">📻 Quick talk</span>
        <span className="text-xs text-muted">squad only</span>
      </div>
      <ol ref={list} className="flex max-h-44 min-h-16 flex-col gap-1 overflow-y-auto rounded-xl bg-ink/60 p-2 text-sm" aria-live="polite" aria-label="Squad talk log">
        {msgs.length === 0 && waiting.length === 0 && <li className="m-auto text-xs text-muted">Talk it through here, or out loud.</li>}
        {msgs.map((m) => {
          const p = who(m.from);
          return (
            <li key={m.i} className="animate-rise flex items-start gap-1.5">
              <span className="shrink-0 text-xs font-bold whitespace-nowrap" style={{ color: p?.color }}>
                <Avatar id={p?.avatar ?? "🙂"} /> {p?.name ?? "?"}
              </span>
              <Body m={m} />
            </li>
          );
        })}
        {waiting.map((m) => (
          <li key={`p${m.n}`} className="flex items-start gap-1.5 opacity-55">
            <span className="shrink-0 text-xs font-bold whitespace-nowrap" style={{ color: who(me)?.color }}>
              <Avatar id={who(me)?.avatar ?? "🙂"} /> {who(me)?.name ?? "You"}
            </span>
            <Body m={m} />
          </li>
        ))}
      </ol>
      <form onSubmit={submit} className="flex gap-1.5">
        <label className="sr-only" htmlFor="df-talk">
          Message
        </label>
        <input
          id="df-talk"
          aria-label="Message"
          className="input min-w-0 flex-1 py-2 text-sm"
          maxLength={MAX_MSG}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={me === defuser ? "“Three wires: red, blue, blue…”" : "“Is the last wire blue?”"}
          autoComplete="off"
        />
        <button type="submit" className="btn btn-primary min-h-10 shrink-0 px-3 text-sm" disabled={!text.trim()}>
          Send
        </button>
      </form>
      <div className="flex flex-wrap gap-1">
        {QUICK_LINES.map((q) => (
          <button key={q} type="button" onClick={() => send({ t: q })} className="min-h-9 rounded-full border border-line bg-panel-2 px-2.5 text-xs font-semibold hover:border-muted active:scale-95">
            {q}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {TALK_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => send({ c })}
            aria-label={`Send colour ${c}`}
            title={cap(c)}
            className="grid size-10 place-items-center rounded-full border border-line bg-panel-2 hover:border-muted active:scale-90"
          >
            <Swatch c={c} className="size-5" />
          </button>
        ))}
        <button
          type="button"
          onClick={() => setGlyphsOpen((o) => !o)}
          aria-expanded={glyphsOpen}
          className="ml-auto flex min-h-10 items-center gap-1 rounded-full border border-line bg-panel-2 px-3 text-xs font-semibold hover:border-muted"
        >
          <Glyph g={2} className="size-4" /> Glyphs {glyphsOpen ? "▴" : "▾"}
        </button>
      </div>
      {glyphsOpen && (
        <div className="animate-rise grid grid-cols-6 gap-1 sm:grid-cols-8" role="group" aria-label="Send a glyph">
          {GLYPHS.map((g, i) => (
            <button
              key={g.name}
              type="button"
              onClick={() => send({ g: i })}
              aria-label={`Send glyph ${g.name}`}
              title={g.name}
              className="grid aspect-square min-h-10 place-items-center rounded-lg bg-[#f1ecdc] text-zinc-900 hover:brightness-95 active:scale-90"
            >
              <Glyph g={i} className="size-6" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

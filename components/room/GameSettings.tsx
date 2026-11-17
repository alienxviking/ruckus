"use client";

import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { GAME_CONFIG } from "@/games/config";
import { cleanWords, type ChoiceSetting, type WordsSetting } from "@/shared/settings";
import type { ClientMsg, RoomView } from "@/shared/types";

/**
 * The picked game's options. The host changes them; everyone else sees what's set.
 * Custom words sit folded away at the bottom: optional, never in the way.
 */
export function GameSettings({
  room,
  isHost,
  send,
  words,
}: {
  room: RoomView;
  isHost: boolean;
  send: (m: ClientMsg) => void;
  /** Host only: the current custom word lists (from the server). */
  words: { gameId: string; words: Record<string, string[]> } | null;
}) {
  const defs = GAME_CONFIG[room.gameId]?.settings ?? [];
  const choices = defs.filter((d): d is ChoiceSetting => d.kind === "choice");
  const lists = defs.filter((d): d is WordsSetting => d.kind === "words");
  if (!defs.length) return null;

  const value = (d: ChoiceSetting) => room.settings[d.key] ?? d.default;

  if (!isHost) {
    const changed = choices.filter((d) => value(d) !== d.default);
    const custom = lists.filter((d) => (room.wordCounts[d.key] ?? 0) >= d.min);
    if (!changed.length && !custom.length) return null;
    return (
      <p className="card animate-rise flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm text-muted">
        <SlidersHorizontal aria-hidden className="size-4 shrink-0" strokeWidth={2} />
        {changed.map((d) => (
          <span key={d.key}>
            {d.label}: <b className="text-text">{d.options.find((o) => o.value === value(d))?.label}</b>
          </span>
        ))}
        {custom.map((d) => (
          <span key={d.key}>
            <b className="text-text">{room.wordCounts[d.key]}</b> custom {d.label.toLowerCase()}
          </span>
        ))}
      </p>
    );
  }

  return (
    <div className="card animate-rise p-4">
      <h2 className="label mb-3 flex items-center gap-2">
        <SlidersHorizontal aria-hidden className="size-3.5" strokeWidth={2} /> Settings
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {choices.map((d) => (
          <div key={d.key}>
            <div id={`set-${d.key}`} className="mb-1.5 text-sm font-semibold">
              {d.label}
            </div>
            <div role="radiogroup" aria-labelledby={`set-${d.key}`} className="flex flex-wrap gap-1.5">
              {d.options.map((o) => {
                const on = value(d) === o.value;
                return (
                  <button
                    key={String(o.value)}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={`rounded-md border px-2.5 py-1 font-mono text-xs transition-colors ${
                      on ? "border-brand-2/60 bg-brand-2/15 text-text" : "border-line text-muted hover:border-text/30 hover:text-text"
                    }`}
                    onClick={() => !on && send({ t: "setting", gameId: room.gameId, key: d.key, value: o.value })}
                  >
                    {o.label}
                    {o.value === d.default && <span className="ml-1 opacity-50">·default</span>}
                  </button>
                );
              })}
            </div>
            {d.hint && <p className="mt-1 font-mono text-[10px] text-muted">{d.hint}</p>}
          </div>
        ))}
      </div>
      {lists.map((d) => (
        <WordsEditor
          key={`${room.gameId}-${d.key}`}
          def={d}
          saved={words?.gameId === room.gameId ? (words.words[d.key] ?? []) : []}
          count={room.wordCounts[d.key] ?? 0}
          onSave={(list) => send({ t: "setting", gameId: room.gameId, key: d.key, value: list })}
        />
      ))}
    </div>
  );
}

function WordsEditor({
  def,
  saved,
  count,
  onSave,
}: {
  def: WordsSetting;
  saved: string[];
  count: number;
  onSave: (list: string[]) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? saved.join("\n");
  const parsed = cleanWords(text, def);
  const dirty = draft !== null && parsed.join("\n") !== saved.join("\n");
  const active = count >= def.min;

  return (
    <details className="group mt-3 border-t border-line pt-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-muted hover:text-text">
        <ChevronDown aria-hidden className="size-3.5 transition-transform group-open:rotate-180" strokeWidth={2} />
        Use your own {def.label.toLowerCase()} <span className="opacity-60">(optional)</span>
        {active && <span className="ml-auto rounded-sm bg-brand-2/15 px-1.5 font-mono text-[10px] text-brand-2">{count} in use</span>}
      </summary>
      <textarea
        className="input mt-2 min-h-28 w-full resize-y font-mono text-sm"
        placeholder={def.placeholder}
        value={text}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={`Custom ${def.label.toLowerCase()}`}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 font-mono text-[10px] text-muted">
          {parsed.length} {parsed.length === 1 ? "entry" : "entries"}
          {parsed.length > 0 && parsed.length < def.min ? ` · need ${def.min}+ or ours are used` : ""}
          {def.hint ? ` · ${def.hint}` : ""}
        </span>
        {count > 0 && (
          <button
            type="button"
            className="btn px-3 py-1 text-xs"
            onClick={() => {
              setDraft(null);
              onSave([]);
            }}
          >
            Clear
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary px-3 py-1 text-xs"
          disabled={!dirty}
          onClick={() => onSave(parsed)}
        >
          Save
        </button>
      </div>
    </details>
  );
}

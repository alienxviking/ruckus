"use client";

// The clue-giver's emoji-only keyboard: search, categories, recently used.

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CLUE_MAX } from "./shared";
import { emojiGroups, emojiInfo, searchEmoji, type EmojiItem } from "./emoji";

const RECENT_KEY = "ruckus.emojicharades.recent";
const RECENT_MAX = 32;

function loadRecent(): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((e): e is string => typeof e === "string" && !!emojiInfo(e)).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Private mode or blocked storage: recents just won't survive a reload.
  }
}

export function EmojiPicker({
  clue,
  onChange,
}: {
  clue: string[];
  onChange: (next: string[]) => void;
}) {
  const groups = emojiGroups();
  const searchId = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [tab, setTab] = useState(() => (recent.length ? "recent" : groups[0].id));
  const [query, setQuery] = useState("");
  const full = clue.length >= CLUE_MAX;

  const items: EmojiItem[] = useMemo(() => {
    if (query.trim()) return searchEmoji(query);
    if (tab === "recent") return recent.map((e) => emojiInfo(e)).filter((x): x is EmojiItem => !!x);
    return groups.find((g) => g.id === tab)?.items ?? [];
  }, [query, tab, recent, groups]);

  const add = (e: string) => {
    if (full) return;
    onChange([...clue, e]);
    const next = [e, ...recent.filter((x) => x !== e)].slice(0, RECENT_MAX);
    setRecent(next);
    saveRecent(next);
  };
  const backspace = () => clue.length && onChange(clue.slice(0, -1));

  const pickTab = (id: string) => {
    setTab(id);
    setQuery("");
    gridRef.current?.scrollTo({ top: 0 });
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (items[0]) add(items[0].e);
    } else if (e.key === "Backspace" && !query) {
      e.preventDefault();
      backspace();
    } else if (e.key === "Escape") setQuery("");
  };

  const tabs = [{ id: "recent", label: "Recently used", icon: "🕘" }, ...groups.map((g) => ({ id: g.id, label: g.label, icon: g.icon }))];
  const heading = query.trim()
    ? items.length
      ? `Results for “${query.trim()}”`
      : `No emoji for “${query.trim()}”`
    : tab === "recent"
      ? recent.length
        ? "Recently used"
        : "Recently used: nothing yet"
      : (groups.find((g) => g.id === tab)?.label ?? "");

  return (
    <section className="card flex flex-col gap-2 p-2.5" aria-label="Emoji keyboard">
      <div className="flex gap-1.5">
        <label htmlFor={searchId} className="sr-only">
          Search emoji
        </label>
        <div className="relative min-w-0 flex-1">
          <span aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm opacity-70">
            🔎
          </span>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value.slice(0, 30))}
            onKeyDown={onSearchKey}
            placeholder="Search emoji…"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="done"
            className="input min-h-10 pl-8 text-base"
          />
        </div>
        <button
          type="button"
          className="btn min-h-10 min-w-11 shrink-0 px-2 text-lg"
          onClick={backspace}
          disabled={!clue.length}
          aria-label="Delete last emoji"
          title="Delete last emoji"
        >
          ⌫
        </button>
        <button
          type="button"
          className="btn min-h-10 shrink-0 px-2.5 text-sm"
          onClick={() => onChange([])}
          disabled={!clue.length}
          aria-label="Clear the clue"
        >
          Clear
        </button>
      </div>

      <div className="grid grid-cols-9 gap-0.5 rounded-xl bg-ink/60 p-0.5" role="tablist" aria-label="Emoji categories">
        {tabs.map((t) => {
          const on = !query.trim() && tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              aria-label={t.label}
              title={t.label}
              onClick={() => pickTab(t.id)}
              className={`grid h-10 min-w-0 place-items-center rounded-lg text-xl transition-colors ${
                on ? "bg-[var(--ec-accent)]/25 shadow-[inset_0_-2px_0_var(--ec-accent)]" : "opacity-70 hover:bg-panel-2 hover:opacity-100"
              }`}
            >
              <span aria-hidden>{t.icon}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 px-0.5 text-xs font-semibold text-muted">
        <span className="truncate">{heading}</span>
        <span className={`shrink-0 tabular-nums ${full ? "text-amber-300" : ""}`} aria-live="polite">
          {full ? "Clue full · " : ""}
          {clue.length}/{CLUE_MAX}
        </span>
      </div>

      <div
        ref={gridRef}
        role="group"
        aria-label={heading}
        style={{ maskImage: "linear-gradient(to bottom, transparent, #000 0.5rem, #000 calc(100% - 0.75rem), transparent)" }}
        className="grid h-[12.5rem] auto-rows-[2.75rem] grid-cols-[repeat(auto-fill,minmax(2.6rem,1fr))] content-start gap-0.5 overflow-y-auto overscroll-contain pr-0.5 @md:h-[14rem]"
      >
        {items.map((it) => (
          <button
            key={it.e}
            type="button"
            onClick={() => add(it.e)}
            aria-disabled={full}
            aria-label={`Add ${it.name}`}
            title={it.name}
            className={`ec-key grid place-items-center rounded-lg text-[1.65rem] leading-none select-none ${full ? "opacity-35" : ""}`}
          >
            {it.e}
          </button>
        ))}
        {tab === "recent" && !query.trim() && !recent.length && (
          <p className="col-span-full px-2 py-6 text-center text-sm text-muted">Emoji you use show up here. Try a category or search ↑</p>
        )}
      </div>
    </section>
  );
}

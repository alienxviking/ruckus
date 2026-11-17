"use client";

import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { cleanWords, type ChoiceSetting, type SettingDef, type Settings, type WordsSetting } from "@/shared/settings";

/** Settings for a local game: same options as the room's host settings, kept in this browser. */
export function LocalSettings({
  defs,
  value,
  onChange,
}: {
  defs: SettingDef[];
  /** Settings with defaults filled in (readSettings). */
  value: Settings;
  onChange: (key: string, v: number | string | string[]) => void;
}) {
  const choices = defs.filter((d): d is ChoiceSetting => d.kind === "choice");
  const lists = defs.filter((d): d is WordsSetting => d.kind === "words");
  if (!defs.length) return null;

  return (
    <div className="card p-4">
      <h2 className="label mb-3 flex items-center gap-2">
        <SlidersHorizontal aria-hidden className="size-3.5" strokeWidth={2} /> Settings
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {choices.map((d) => (
          <div key={d.key}>
            <div id={`local-set-${d.key}`} className="mb-1.5 text-sm font-semibold">
              {d.label}
            </div>
            <div role="radiogroup" aria-labelledby={`local-set-${d.key}`} className="flex flex-wrap gap-1.5">
              {d.options.map((o) => {
                const on = value[d.key] === o.value;
                return (
                  <button
                    key={String(o.value)}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={`min-h-8 rounded-md border px-2.5 py-1 font-mono text-xs transition-colors ${
                      on ? "border-brand-2/60 bg-brand-2/15 text-text" : "border-line text-muted hover:border-text/30 hover:text-text"
                    }`}
                    onClick={() => onChange(d.key, o.value)}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            {d.hint && <p className="mt-1 font-mono text-[10px] text-muted">{d.hint}</p>}
          </div>
        ))}
      </div>
      {lists.map((d) => (
        <WordsField key={d.key} def={d} saved={(value[d.key] as string[] | undefined) ?? []} onSave={(w) => onChange(d.key, w)} />
      ))}
    </div>
  );
}

function WordsField({ def, saved, onSave }: { def: WordsSetting; saved: string[]; onSave: (w: string[]) => void }) {
  const [text, setText] = useState(saved.join("\n"));
  const parsed = cleanWords(text, def);
  const active = saved.length >= def.min;
  return (
    <details className="group mt-3 border-t border-line pt-3" open={saved.length > 0 || undefined}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-muted hover:text-text">
        <ChevronDown aria-hidden className="size-3.5 transition-transform group-open:rotate-180" strokeWidth={2} />
        Use your own {def.label.toLowerCase()} <span className="opacity-60">(optional)</span>
        {active && (
          <span className="ml-auto rounded-sm bg-brand-2/15 px-1.5 font-mono text-[10px] text-brand-2">{saved.length} in use</span>
        )}
      </summary>
      <textarea
        className="input mt-2 min-h-28 w-full resize-y font-mono text-sm"
        placeholder={def.placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onSave(cleanWords(e.target.value, def));
        }}
        aria-label={`Custom ${def.label.toLowerCase()}`}
      />
      <p className="mt-1 font-mono text-[10px] text-muted">
        {parsed.length} {parsed.length === 1 ? "entry" : "entries"}
        {parsed.length > 0 && parsed.length < def.min ? ` · need ${def.min}+ or ours are used` : ""}
        {def.hint ? ` · ${def.hint}` : ""}
      </p>
    </details>
  );
}

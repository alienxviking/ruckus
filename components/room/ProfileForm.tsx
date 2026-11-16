"use client";

import { useState } from "react";
import { AVATARS, MAX_NAME, PLAYER_COLORS } from "@/shared/types";
import { randomLook } from "@/lib/identity";

export interface ProfileValues {
  name: string;
  color: string;
  avatar: string;
}

export function ProfileForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: ProfileValues;
  submitLabel: string;
  onSubmit: (v: ProfileValues) => void;
}) {
  const [look] = useState(randomLook);
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState<string>(initial?.color ?? look.color);
  const [avatar, setAvatar] = useState<string>(initial?.avatar ?? look.avatar);
  const valid = name.trim().length > 0;

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit({ name: name.trim().slice(0, MAX_NAME), color, avatar });
      }}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid size-14 shrink-0 place-items-center rounded-xl text-3xl transition-shadow duration-300"
          style={{
            background: `linear-gradient(180deg, ${color}33, ${color}10)`,
            boxShadow: `inset 0 0 0 1.5px ${color}, inset 0 0 18px -4px ${color}, 0 10px 30px -14px ${color}`,
          }}
        >
          {avatar}
        </span>
        <div className="flex-1">
          <label htmlFor="player-name" className="label">
            Name
          </label>
          <input
            id="player-name"
            className="input mt-1 text-lg font-semibold"
            style={{ color }}
            maxLength={MAX_NAME}
            autoFocus
            autoComplete="nickname"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </div>

      <fieldset>
        <legend className="label mb-2">Avatar</legend>
        <div className="grid grid-cols-8 gap-1.5">
          {AVATARS.map((a) => (
            <button
              type="button"
              key={a}
              aria-label={`Avatar ${a}`}
              aria-pressed={a === avatar}
              onClick={() => setAvatar(a)}
              className={`grid aspect-square place-items-center rounded-md text-xl transition-[background-color,transform] duration-200 active:scale-90 ${
                a === avatar ? "bg-panel-2 ring-1 ring-brand-2" : "hover:bg-panel-2"
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="label mb-2">Colour</legend>
        <div className="flex flex-wrap gap-2">
          {PLAYER_COLORS.map((c) => (
            <button
              type="button"
              key={c}
              aria-label={`Colour ${c}`}
              aria-pressed={c === color}
              onClick={() => setColor(c)}
              className={`size-8 rounded-md transition-transform duration-300 ease-[cubic-bezier(0.34,1.4,0.5,1)] ${c === color ? "scale-110 ring-2 ring-text ring-offset-2 ring-offset-panel" : "hover:scale-105"}`}
              style={{ background: c }}
            />
          ))}
        </div>
      </fieldset>

      <button className="btn btn-primary w-full py-3 text-lg" disabled={!valid}>
        {submitLabel}
      </button>
    </form>
  );
}

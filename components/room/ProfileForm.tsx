"use client";

import { Dices } from "lucide-react";
import { useState } from "react";
import { AVATARS, MAX_NAME, PLAYER_COLORS } from "@/shared/types";
import { randomLook } from "@/lib/identity";
import { Avatar, AVATAR_LABEL } from "../Avatar";

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
          key={avatar}
          className="animate-pop grid size-16 shrink-0 place-items-center rounded-2xl transition-shadow duration-300"
          style={{
            background: `radial-gradient(120% 120% at 30% 20%, ${color}55, ${color}14 70%)`,
            boxShadow: `inset 0 0 0 1.5px ${color}, inset 0 0 22px -6px ${color}, 0 12px 32px -14px ${color}`,
          }}
        >
          <Avatar id={avatar} size={46} />
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
        <div className="mb-2 flex items-center justify-between">
          <legend className="label">
            Avatar <span className="text-text/80 normal-case tracking-normal">· {AVATAR_LABEL[avatar as keyof typeof AVATAR_LABEL] ?? ""}</span>
          </legend>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:bg-panel-2 hover:text-text"
            onClick={() => {
              const next = randomLook();
              setAvatar(next.avatar);
              setColor(next.color);
            }}
          >
            <Dices aria-hidden className="size-3.5" strokeWidth={2} />
            Shuffle
          </button>
        </div>
        <div className="grid grid-cols-8 gap-1.5">
          {AVATARS.map((a) => {
            const on = a === avatar;
            return (
              <button
                type="button"
                key={a}
                aria-label={AVATAR_LABEL[a]}
                title={AVATAR_LABEL[a]}
                aria-pressed={on}
                onClick={() => setAvatar(a)}
                className={`grid aspect-square place-items-center rounded-lg transition-[background-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.34,1.4,0.5,1)] active:scale-90 ${
                  on ? "scale-105" : "hover:-translate-y-0.5 hover:bg-panel-2"
                }`}
                style={on ? { background: `${color}26`, boxShadow: `inset 0 0 0 1.5px ${color}` } : undefined}
              >
                <Avatar id={a} size="78%" />
              </button>
            );
          })}
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

"use client";

import { Ban, Dices, Lock, Trophy } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { ACCESSORIES, AVATARS, MAX_NAME, parseAvatar, PLAYER_COLORS, type AccessoryId } from "@/shared/types";
import { randomLook } from "@/lib/identity";
import { ACCESSORY_LABEL } from "@/lib/avatar-art";
import { ACHIEVEMENTS, getProgress, lockReason, subscribeProgress } from "@/lib/progress";
import { TransferProgress } from "../TransferProgress";
import { RecoveryTip } from "../RecoveryTip";
import { Avatar, AVATAR_LABEL } from "../Avatar";

const EMPTY_PROGRESS = { v: 1, wins: 0, gameWins: {}, played: {}, run: 0, bestRun: 0, bigWins: 0 } as const;
const ACHIEVEMENT_ACC = new Set<AccessoryId>(ACHIEVEMENTS.map((a) => a.accessory));

export interface ProfileValues {
  name: string;
  color: string;
  avatar: string;
}

export function ProfileForm({
  initial,
  submitLabel,
  onSubmit,
  showTransfer = true,
  recoveryTip = false,
}: {
  initial?: ProfileValues;
  submitLabel: string;
  onSubmit: (v: ProfileValues) => void;
  /** The "move your unlocks" box (off where the page shows its own). */
  showTransfer?: boolean;
  /** The "no account, save your code" tip (in the profile, not the first join). */
  recoveryTip?: boolean;
}) {
  const [look] = useState(randomLook);
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState<string>(initial?.color ?? look.color);
  const start = parseAvatar(initial?.avatar ?? look.avatar);
  const [base, setBase] = useState<string>(start?.base ?? look.avatar);
  const [acc, setAcc] = useState<AccessoryId | null>(start?.acc ?? null);
  const progress = useSyncExternalStore(subscribeProgress, getProgress, () => EMPTY_PROGRESS);
  const wins = progress.wins;
  // Locked accessories explain themselves on tap (phones have no hover titles).
  const [hint, setHint] = useState<string | null>(null);
  const avatar = acc ? `${base}+${acc}` : base;
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
            Avatar <span className="text-text/80 normal-case tracking-normal">· {AVATAR_LABEL[base as keyof typeof AVATAR_LABEL] ?? ""}
            {acc ? ` + ${ACCESSORY_LABEL[acc]}` : ""}</span>
          </legend>
          <button
            type="button"
            className="flex min-h-9 items-center gap-1.5 rounded-lg border-2 border-line px-2.5 py-1 text-xs font-bold text-text transition-colors hover:bg-panel-2"
            onClick={() => {
              const next = randomLook();
              setBase(next.avatar);
              setColor(next.color);
            }}
          >
            <Dices aria-hidden className="size-3.5" strokeWidth={2} />
            Shuffle
          </button>
        </div>
        <div className="grid grid-cols-8 gap-1.5">
          {AVATARS.map((a) => {
            const on = a === base;
            return (
              <button
                type="button"
                key={a}
                aria-label={AVATAR_LABEL[a]}
                title={AVATAR_LABEL[a]}
                aria-pressed={on}
                onClick={() => setBase(a)}
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
        <div className="mb-2 flex items-center justify-between">
          <legend className="label">Wear</legend>
          <span className="text-xs font-semibold text-muted">
            {wins} {wins === 1 ? "win" : "wins"} · win &amp; earn badges to unlock more
          </span>
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {[null, ...ACCESSORIES].map((a) => {
            const on = a === acc;
            const reason = a ? lockReason(a, progress) : null;
            const locked = reason !== null;
            const badge = a && ACHIEVEMENT_ACC.has(a);
            const label = a ? ACCESSORY_LABEL[a] : "Nothing";
            return (
              <button
                type="button"
                key={a ?? "none"}
                aria-label={locked ? `${label} (locked: ${reason})` : label}
                title={locked ? `${label}: ${reason}` : label}
                aria-pressed={on}
                aria-disabled={locked}
                onClick={() => {
                  if (locked) return setHint(`${label} · ${reason}`);
                  setHint(null);
                  setAcc(a);
                }}
                className={`relative grid aspect-square place-items-center rounded-lg transition-[background-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.34,1.4,0.5,1)] active:scale-90 aria-disabled:cursor-help ${
                  on ? "scale-105" : locked ? "" : "hover:-translate-y-0.5 hover:bg-panel-2"
                }`}
                style={on ? { background: `${color}26`, boxShadow: `inset 0 0 0 1.5px ${color}` } : undefined}
              >
                {a ? (
                  <span className={`grid size-full place-items-center ${locked ? "opacity-30 grayscale" : ""}`}>
                    <Avatar id={`${base}+${a}`} size="80%" />
                  </span>
                ) : (
                  <Ban aria-hidden className="size-6 text-muted" strokeWidth={2} />
                )}
                {locked && (
                  <span className="absolute right-0.5 bottom-0.5">
                    <span className="flex items-center gap-0.5 rounded-md bg-ink/90 px-1.5 py-0.5 text-[11px] font-bold text-text">
                      {badge ? (
                        <Trophy aria-hidden className="size-3 text-brand-2" strokeWidth={2.5} />
                      ) : (
                        <>
                          <Lock aria-hidden className="size-3" strokeWidth={2.5} />
                          {a ? lockReason(a, progress)?.match(/\((\d+)\/(\d+)\)/)?.[2] : null}
                        </>
                      )}
                    </span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {hint && <p className="mt-2 font-mono text-[11px] text-brand-2">{hint}</p>}
        {showTransfer && recoveryTip && <RecoveryTip className="mt-3" />}
        {showTransfer && <TransferProgress />}
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

"use client";

import { CircleHelp, Crown, Gamepad2, Play, Share2, Smartphone, X } from "lucide-react";
import { useSyncExternalStore } from "react";

const KEY = "ruckus:room-tips";
const listeners = new Set<() => void>();

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true;
  }
}

/** Hides the tips for good (dismissed, or a game was played here). */
export function markRoomTipsSeen() {
  try {
    if (localStorage.getItem(KEY) === "1") return;
    localStorage.setItem(KEY, "1");
  } catch {
    /* fine: they'll just see it again */
  }
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const GUEST = [
  { Icon: Crown, text: "The host picks a game and starts it" },
  { Icon: Smartphone, text: "Your phone is the controller: play right here" },
  { Icon: CircleHelp, text: "Lost? Tap How to play any time" },
];
const HOST = [
  { Icon: Gamepad2, text: "Pick a game from the list below" },
  { Icon: Share2, text: "Send friends the invite link" },
  { Icon: Play, text: "Hit Start game when everyone's in" },
];

/** A one-time "how rooms work" strip for people in their first room. */
export function FirstTimeTips({ isHost }: { isHost: boolean }) {
  // On the server (and before reading storage) assume seen, so it never flashes for regulars.
  const hide = useSyncExternalStore(subscribe, seen, () => true);
  if (hide) return null;
  const steps = isHost ? HOST : GUEST;
  return (
    <div className="animate-rise relative rounded-2xl border-2 border-dashed border-brand-2/60 bg-brand-2/5 p-3 pr-11 sm:p-4 sm:pr-12">
      <p className="marker text-lg leading-none text-brand-2">pehli baar? ye lo shortcut 👇</p>
      <ol className="mt-2.5 grid gap-2 sm:grid-cols-3">
        {steps.map(({ Icon, text }, i) => (
          <li key={i} className="animate-rise flex items-center gap-2.5 text-sm font-semibold" style={{ animationDelay: `${150 + i * 110}ms` }}>
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-lg border-2 border-ink bg-brand-2 text-ink shadow-[2px_2px_0_#000]"
            >
              <Icon className="size-4" strokeWidth={2.4} />
            </span>
            {text}
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={markRoomTipsSeen}
        aria-label="Got it, hide these tips"
        title="Got it"
        className="absolute top-2 right-2 grid size-9 place-items-center rounded-lg text-muted hover:bg-panel-2 hover:text-text"
      >
        <X aria-hidden className="size-4" strokeWidth={2.25} />
      </button>
    </div>
  );
}

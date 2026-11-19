"use client";

import { ClipboardPaste, KeyRound, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Rux } from "./Rux";

// "No account, so save your code": shown in the profile until it's dismissed or the code is opened.
const KEY = "ruckus:recovery-tip";
const listeners = new Set<() => void>();

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true;
  }
}

/** Hides the tip for good (dismissed, or they opened their code). */
export function markRecoverySeen() {
  try {
    if (localStorage.getItem(KEY) === "1") return;
    localStorage.setItem(KEY, "1");
  } catch {
    /* fine: they'll see it again */
  }
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Asks the transfer box on this page to open and show the code. */
export const SHOW_CODE_EVENT = "ruckus:show-code";
/** Asks the transfer box to open with the paste field ready (for a code from another device). */
export const PASTE_CODE_EVENT = "ruckus:paste-code";

export function RecoveryTip({ className = "" }: { className?: string }) {
  // Assume seen on the server and before storage is read, so regulars never see a flash.
  const hide = useSyncExternalStore(subscribe, seen, () => true);
  if (hide) return null;
  return (
    <div
      role="note"
      className={`animate-rise relative flex items-start gap-3 rounded-2xl border-2 border-dashed border-[#ffb020]/70 bg-[#ffb020]/8 p-3 pr-10 ${className}`}
    >
      <span aria-hidden className="bob w-11 shrink-0" style={{ "--tilt": "-8deg" } as React.CSSProperties}>
        <Rux mood="wow" className="w-full" />
      </span>
      <div className="min-w-0 text-sm">
        <p className="marker text-lg leading-none text-[#ffb020]">suno, ye zaroori hai!</p>
        <p className="mt-1 text-text/90">
          There&apos;s no account here: your name, wins, unlocks and streak live only in this browser.
        </p>
        <ul className="mt-1.5 space-y-0.5 text-xs text-muted">
          <li>
            <b className="text-text">Played before on another device?</b> Paste that code to bring everything here.
          </li>
          <li>
            <b className="text-text">New here?</b> Save your code somewhere safe (a note, or WhatsApp it to yourself).
          </li>
        </ul>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn min-h-9 px-3 text-xs font-bold"
            onClick={() => {
              markRecoverySeen();
              window.dispatchEvent(new Event(PASTE_CODE_EVENT));
            }}
          >
            <ClipboardPaste aria-hidden className="size-3.5" strokeWidth={2.25} />I have a code
          </button>
          <button
            type="button"
            className="btn min-h-9 px-3 text-xs font-bold"
            onClick={() => {
              markRecoverySeen();
              window.dispatchEvent(new Event(SHOW_CODE_EVENT));
            }}
          >
            <KeyRound aria-hidden className="size-3.5" strokeWidth={2.25} />
            Save my code
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={markRecoverySeen}
        aria-label="Got it, hide this tip"
        title="Got it"
        className="absolute top-2 right-2 grid size-8 place-items-center rounded-lg text-muted hover:bg-panel-2 hover:text-text"
      >
        <X aria-hidden className="size-4" strokeWidth={2.25} />
      </button>
    </div>
  );
}

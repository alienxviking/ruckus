"use client";

import { Download, Share, SquarePlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Rux } from "../Rux";

// "Put Ruckus on your home screen". iPhone Safari has no install popup, so it gets the two
// steps; Chrome/Edge/Android get a real Install button (their beforeinstallprompt event).
// Shows a few seconds after the home page opens, never when already installed, and stays
// away for two weeks after a dismiss.

const KEY = "ruckus:install-hint";
const QUIET_MS = 14 * 86_400_000;

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// The browser can fire this before the component mounts: keep it from the start.
let deferred: InstallEvent | null = null;
const waiting = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    for (const fn of waiting) fn();
  });
}

function installed() {
  return matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function quiet() {
  try {
    return Date.now() - Number(localStorage.getItem(KEY) ?? 0) < QUIET_MS;
  } catch {
    return true;
  }
}

function isIos() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

export function InstallHint() {
  const [mode, setMode] = useState<"ios" | "prompt" | null>(null);

  useEffect(() => {
    if (installed() || quiet()) return;
    let t: number | undefined;
    const show = (m: "ios" | "prompt") => {
      window.clearTimeout(t);
      t = window.setTimeout(() => setMode(m), 6000);
    };
    if (isIos()) show("ios");
    else if (deferred) show("prompt");
    const onReady = () => show("prompt");
    waiting.add(onReady);
    return () => {
      waiting.delete(onReady);
      window.clearTimeout(t);
    };
  }, []);

  const dismiss = () => {
    setMode(null);
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* fine */
    }
  };

  if (!mode) return null;
  return (
    <div
      role="dialog"
      aria-label="Install Ruckus"
      className="animate-rise fixed inset-x-[calc(0.75rem+env(safe-area-inset-left))] bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl border-2 border-brand-2/60 bg-panel/95 p-3 pr-10 shadow-xl shadow-black/60 backdrop-blur-md"
    >
      <span aria-hidden className="bob w-11 shrink-0" style={{ "--tilt": "-6deg" } as React.CSSProperties}>
        <Rux mood="wink" className="w-full" />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-bold">Get Ruckus on your home screen</p>
        {mode === "ios" ? (
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-muted">
            Tap <Share aria-label="Share" className="inline size-3.5 text-brand-2" strokeWidth={2.4} /> Share, then
            <span className="inline-flex items-center gap-0.5 font-semibold text-text">
              <SquarePlus aria-hidden className="size-3.5" strokeWidth={2.4} /> Add to Home Screen
            </span>
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-muted">Opens like an app, full screen, one tap away.</p>
        )}
      </div>
      {mode === "prompt" && (
        <button
          type="button"
          className="btn btn-primary min-h-10 shrink-0 px-3 text-sm font-bold"
          onClick={async () => {
            const e = deferred;
            deferred = null;
            setMode(null);
            if (!e) return;
            await e.prompt();
            const { outcome } = await e.userChoice;
            if (outcome === "dismissed") dismiss();
          }}
        >
          <Download aria-hidden className="size-4" strokeWidth={2.4} /> Install
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Not now"
        className="absolute top-1.5 right-1.5 grid size-8 place-items-center rounded-lg text-muted hover:bg-panel-2 hover:text-text"
      >
        <X aria-hidden className="size-4" strokeWidth={2.25} />
      </button>
    </div>
  );
}

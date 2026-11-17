"use client";

import { BookOpen } from "lucide-react";
import dynamic from "next/dynamic";
import { useState, useSyncExternalStore } from "react";
import { RULES } from "@/games/rules";

// The dialog (and the game's rules) load on first hover/focus, so nothing ships until asked for.
const loadRulesDialog = () => import("./RulesDialog");
const RulesDialog = dynamic(loadRulesDialog, { ssr: false });

// Games whose rules this browser has seen (opened, or played to the end): the button glows
// for the others, once, to point first-timers at it.
const SEEN_KEY = "ruckus:rules-seen";
const seenListeners = new Set<() => void>();
let seenCache: string | null = null;

function readSeen(): string {
  if (seenCache === null) {
    try {
      seenCache = localStorage.getItem(SEEN_KEY) ?? "";
    } catch {
      seenCache = "";
    }
  }
  return seenCache;
}

export function markRulesSeen(gameId: string) {
  const list = readSeen().split(",").filter(Boolean);
  if (list.includes(gameId)) return;
  seenCache = [...list, gameId].join(",");
  try {
    localStorage.setItem(SEEN_KEY, seenCache);
  } catch {
    /* not saved: it just glows again next time */
  }
  for (const fn of seenListeners) fn();
}

function useSeen(gameId: string): boolean {
  return useSyncExternalStore(
    (fn) => {
      seenListeners.add(fn);
      return () => seenListeners.delete(fn);
    },
    () => readSeen().split(",").includes(gameId),
    () => true,
  );
}

/** "How to play" button: opens the full rules for a game. Closed until clicked. */
export function HowToPlay({
  gameId,
  compact,
  className = "",
  onOpenChange,
  note,
}: {
  gameId: string;
  compact?: boolean;
  className?: string;
  /** Mid-game: opening pauses the game for everyone (see GameStage). */
  onOpenChange?: (open: boolean) => void;
  /** Line shown at the top of the dialog (e.g. "The game is paused while you read"). */
  note?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const seen = useSeen(gameId);
  const preload = () => {
    void loadRulesDialog();
    void RULES[gameId]?.();
  };
  const change = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  return (
    <>
      <button
        type="button"
        className={`btn px-3 py-1.5 text-sm ${seen ? "" : "rules-glow"} ${className}`}
        aria-haspopup="dialog"
        aria-label={compact ? "How to play" : undefined}
        title="How to play"
        onPointerEnter={preload}
        onFocus={preload}
        onClick={() => {
          setMounted(true);
          markRulesSeen(gameId);
          change(true);
        }}
      >
        <BookOpen aria-hidden className="size-4" strokeWidth={2} />
        <span className={compact ? "hidden sm:inline" : ""}>How to play</span>
      </button>
      {mounted && <RulesDialog open={open} onOpenChange={change} gameId={gameId} note={open ? note : undefined} />}
    </>
  );
}

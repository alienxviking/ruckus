"use client";

import { BookOpen } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { RULES } from "@/games/rules";

// The dialog (and the game's rules) load on first hover/focus, so nothing ships until asked for.
const loadRulesDialog = () => import("./RulesDialog");
const RulesDialog = dynamic(loadRulesDialog, { ssr: false });

/** "How to play" button: opens the full rules for a game. Closed until clicked. */
export function HowToPlay({ gameId, compact, className = "" }: { gameId: string; compact?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const preload = () => {
    void loadRulesDialog();
    void RULES[gameId]?.();
  };

  return (
    <>
      <button
        type="button"
        className={`btn px-3 py-1.5 text-sm ${className}`}
        aria-haspopup="dialog"
        aria-label={compact ? "How to play" : undefined}
        title="How to play"
        onPointerEnter={preload}
        onFocus={preload}
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
      >
        <BookOpen aria-hidden className="size-4" strokeWidth={2} />
        <span className={compact ? "hidden sm:inline" : ""}>How to play</span>
      </button>
      {mounted && <RulesDialog open={open} onOpenChange={setOpen} gameId={gameId} />}
    </>
  );
}

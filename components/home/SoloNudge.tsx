"use client";

import { ArrowRight, X } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { readMyGames, serverMyGames, subscribeMyGames } from "@/lib/my-games";

// First visit, nobody else around (a link from a post, a search): a room would sit empty, so offer
// a one-minute game against bots straight away. Gone once they've played anything, or dismissed.
const KEY = "ruckus:solo-nudge";

function dismissed() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true;
  }
}

export function SoloNudge() {
  const mine = useSyncExternalStore(subscribeMyGames, readMyGames, serverMyGames);
  // Hidden on the server and until storage is read, so regulars never see it flash.
  const hiddenStored = useSyncExternalStore(
    () => () => {},
    dismissed,
    () => true,
  );
  const [closed, setClosed] = useState(false);
  if (closed || hiddenStored || mine.recent.length > 0) return null;
  return (
    <div className="animate-rise mb-3 flex max-w-md items-center gap-2 rounded-2xl border border-brand-2/40 bg-panel/80 py-1 pr-1 pl-3 text-sm">
      <span aria-hidden>👋</span>
      <span className="min-w-0 flex-1 text-muted">
        <b className="text-text">Here alone?</b> Try a 1-minute game vs bots.
      </span>
      <Link href="/play/stack" className="btn btn-primary min-h-8 shrink-0 rounded-full px-3 text-xs font-bold">
        Play now <ArrowRight aria-hidden className="size-3.5" strokeWidth={2.5} />
      </Link>
      <button
        type="button"
        aria-label="Hide"
        title="Hide"
        onClick={() => {
          setClosed(true);
          try {
            localStorage.setItem(KEY, "1");
          } catch {
            /* fine */
          }
        }}
        className="grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-panel-2 hover:text-text"
      >
        <X aria-hidden className="size-3.5" strokeWidth={2.25} />
      </button>
    </div>
  );
}

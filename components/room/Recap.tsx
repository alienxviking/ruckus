"use client";

import { Trophy } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import type { RoomView } from "@/shared/types";
import { Avatar } from "../Avatar";
import { buildRecap } from "@/lib/recap";

const loadRecapDialog = () => import("./RecapDialog");
const RecapDialog = dynamic(loadRecapDialog, { ssr: false });

/** Lobby card once a few games are done: tonight's champion and a button for the full recap. */
export function RecapCard({ room }: { room: RoomView }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const recap = buildRecap(room.history, room.players);
  if (recap.games < 2) return null;
  const champ = recap.champions;

  return (
    <div className="card animate-rise flex items-center gap-3 px-4 py-3">
      <Trophy aria-hidden className="size-5 shrink-0 text-brand-2" strokeWidth={2} />
      <p className="min-w-0 flex-1 text-sm text-muted">
        <b className="text-text">{recap.games} games</b> tonight
        {champ.length > 0 && (
          <>
            {" · "}
            {champ.length === 1 ? "leading: " : "tied: "}
            {champ.slice(0, 3).map((c, i) => (
              <span key={c.id} className="whitespace-nowrap">
                {i > 0 && ", "}
                <Avatar id={c.avatar} /> <b style={{ color: c.color }}>{c.name}</b>
              </span>
            ))}{" "}
            ({champ[0].wins} {champ[0].wins === 1 ? "win" : "wins"})
          </>
        )}
      </p>
      <button
        className="btn shrink-0 px-3 py-1.5 text-sm"
        onPointerEnter={loadRecapDialog}
        onFocus={loadRecapDialog}
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
      >
        Recap
      </button>
      {mounted && <RecapDialog open={open} onOpenChange={setOpen} room={room} />}
    </div>
  );
}

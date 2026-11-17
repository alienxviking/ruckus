"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ArrowRight, Check, Flame } from "lucide-react";
import { CATALOG_BY_ID } from "@/games/catalog";
import { currentStreak, dailyGames, dailyNumber, readDaily, subscribeDaily, utcDay, type DailyData } from "@/lib/daily";
import { GameBadge } from "../GameBadge";

const SERVER_DATA: DailyData = { days: {}, best: {}, streak: { day: "", count: 0, best: 0 } };
const noSub = () => () => {};

/** Today's three daily games and how far you got (filled in after load: the page is static). */
export function DailyCard() {
  const day = useSyncExternalStore(noSub, () => utcDay(), () => "");
  const data = useSyncExternalStore(subscribeDaily, readDaily, () => SERVER_DATA);
  const games = day ? dailyGames(day) : [];
  const today = (day && data.days[day]) || {};
  const done = games.filter((id) => today[id] && !today[id].pending).length;
  const streak = day ? currentStreak(data, day) : 0;
  const all = games.length > 0 && done === games.length;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-2" aria-label={day ? `Today's games: ${games.map((id) => CATALOG_BY_ID[id]?.name).join(", ")}` : undefined}>
        {(games.length ? games : ["", "", ""]).map((id, i) =>
          id ? (
            <span key={id} className="relative animate-pop" style={{ animationDelay: `${i * 70}ms` }}>
              <GameBadge id={id} accent={CATALOG_BY_ID[id].accent} size="md" />
              {today[id] && !today[id].pending && (
                <span className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full bg-brand-2 text-ink ring-2 ring-panel">
                  <Check aria-hidden className="size-3" strokeWidth={3} />
                </span>
              )}
            </span>
          ) : (
            <span key={i} aria-hidden className="size-11 rounded-lg border border-line bg-ink/60" />
          ),
        )}
      </div>
      <p className="mt-3 min-h-[2.5rem] font-mono text-[11px] leading-5 text-muted">
        {day ? (
          <>
            #{dailyNumber(day)} · <span className="text-text">{done}/{games.length}</span> done
            {streak > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-text">
                <Flame aria-hidden className="size-3.5 text-brand" strokeWidth={2} />
                {streak}-day streak
              </span>
            )}
            <br />
            {games.map((id) => CATALOG_BY_ID[id]?.name).join(" · ")}
          </>
        ) : (
          "Same puzzles for everyone, new at midnight UTC."
        )}
      </p>
      <Link href="/daily" className="btn mt-auto w-full py-3">
        {all ? "See today's results" : done ? "Keep going" : "Play today's challenge"}
        <ArrowRight aria-hidden className="size-4" strokeWidth={2.25} />
      </Link>
    </div>
  );
}

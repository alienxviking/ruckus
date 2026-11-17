"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { currentStreak, dailyGames, dailyNumber, readDaily, subscribeDaily, utcDay, type DailyData } from "@/lib/daily";

const SERVER_DATA: DailyData = { days: {}, best: {}, streak: { day: "", count: 0, best: 0 } };
const noSub = () => () => {};

/** The daily challenge as a pink sticker: today's number, progress and streak (filled in after load). */
export function DailySticker() {
  const day = useSyncExternalStore(noSub, () => utcDay(), () => "");
  const data = useSyncExternalStore(subscribeDaily, readDaily, () => SERVER_DATA);
  const games = day ? dailyGames(day) : [];
  const today = (day && data.days[day]) || {};
  const done = games.filter((id) => today[id] && !today[id].pending).length;
  const streak = day ? currentStreak(data, day) : 0;

  return (
    <Link
      href="/daily"
      className="stk lift slap flex items-center gap-3 px-4 py-3"
      style={{ "--stk-bg": "var(--color-pink)", "--stk-fg": "#14101f", "--tilt": "2deg", "--lift-tilt": "3deg", animationDelay: "380ms" } as React.CSSProperties}
    >
      <span aria-hidden className="text-3xl leading-none">
        📅
      </span>
      <span className="min-w-0">
        <span className="block font-hero text-lg leading-tight font-extrabold">Daily challenge</span>
        <span className="block text-sm font-semibold opacity-80">
          {day ? (
            <>
              #{dailyNumber(day)} · {done}/{games.length || 3} done{streak > 1 ? ` · 🔥 ${streak} days` : ""}
            </>
          ) : (
            "3 games, same for everyone"
          )}
        </span>
      </span>
    </Link>
  );
}

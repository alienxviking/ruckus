"use client";

import type { DcView, RoundRec } from "./shared";
import { awards, joinNames, plural } from "./shared";
import { OUTCOME_META } from "./reveal";
import { Card, GOLD, RepRow, medal, trustLine, type Who } from "./ui";

/** Competition ranks (1,1,3...) for seats already sorted by score. */
function ranks(scores: number[], order: number[]): number[] {
  const out: number[] = [];
  order.forEach((seat, i) => {
    out.push(i > 0 && scores[order[i - 1]] === scores[seat] ? out[i - 1] : i);
  });
  return out;
}

const byScore = (scores: number[]) =>
  scores
    .map((_, seat) => seat)
    .sort((a, b) => scores[b] - scores[a] || a - b);

/** "Round 2 of 6" with pips (the heist pip is gold), plus the viewer's score. */
export function RoundTrack({ view, myScore, accent }: { view: DcView; myScore: number | null; accent: string }) {
  const final = view.phase === "final";
  const done = final ? view.rounds : view.round - (view.phase === "reveal" && view.step === 1 ? 0 : 1);
  return (
    <div className="flex items-center justify-between gap-3 px-1 text-xs text-muted">
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate font-semibold">
          {final ? "Game over" : view.heist ? "The Heist" : `Round ${view.round} of ${view.rounds}`}
        </span>
        <span className="flex shrink-0 gap-1" aria-hidden>
          {Array.from({ length: view.rounds }, (_, i) => {
            const heist = i === view.rounds - 1;
            const c = heist ? GOLD : accent;
            return (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-colors duration-300 ${heist ? "w-6" : "w-4"}`}
                style={{ background: i < done ? c : i === view.round - 1 && !final ? `${c}77` : "var(--color-line)" }}
              />
            );
          })}
        </span>
      </span>
      {myScore !== null && (
        <span className="shrink-0">
          You: <b className="font-mono text-text tabular-nums">{myScore}</b> pts
        </span>
      )}
    </div>
  );
}

/** The reputation board: everyone's 🤝/🗡️ record and points. */
export function Ledger({
  view,
  history,
  scores,
  who,
  mySeat,
  partners,
  fresh,
}: {
  view: DcView;
  history: RoundRec[];
  scores: number[];
  who: Who;
  mySeat: number;
  partners: number[];
  fresh?: number;
}) {
  const order = byScore(scores);
  const rk = ranks(scores, order);
  return (
    <Card label="Reputation and scores">
      <div className="label mb-2 flex items-center justify-between gap-2">
        <span>Reputation</span>
        <span className="font-normal tracking-normal normal-case">every choice, public after the flip</span>
      </div>
      <ol className="flex flex-col gap-0.5">
        {order.map((seat, i) => {
          const p = who(seat);
          const partner = partners.includes(seat);
          return (
            <li
              key={seat}
              className={`flex items-center gap-2 rounded-lg px-1.5 py-1 ${seat === mySeat ? "bg-panel-2" : ""}`}
              style={partner ? { boxShadow: `inset 0 0 0 1px ${p.color}66` } : undefined}
            >
              <span className="w-4 shrink-0 text-right text-xs text-muted tabular-nums">{rk[i] + 1}</span>
              <span className={`flex min-w-0 flex-1 items-center gap-1.5 ${p.connected ? "" : "opacity-50"}`}>
                <span aria-hidden>{p.avatar}</span>
                <span className="truncate text-sm font-semibold" style={{ color: p.color }}>
                  {seat === mySeat ? "You" : p.name}
                </span>
                {partner && (
                  <span className="hidden shrink-0 rounded-full bg-panel-2 px-1.5 text-[10px] text-muted @sm:inline">your table</span>
                )}
              </span>
              <RepRow history={history} seat={seat} rounds={view.rounds} size="sm" freshRound={fresh} />
              <span key={scores[seat]} className="w-8 shrink-0 text-right font-mono font-bold tabular-nums dc-pop">
                {scores[seat]}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function HeistRecap({ rec, who }: { rec: RoundRec; who: Who }) {
  const t = rec.tables[0];
  if (!t) return null;
  const thieves = t.seats.filter((_, i) => t.c[i] === "steal");
  const m = OUTCOME_META[t.out];
  let text: string;
  if (t.out === "deal") text = `Honour among thieves: everyone split, ${t.gain[0]} each.`;
  else if (t.out === "steal") text = `${who(thieves[0]).name} stole the whole ${t.pot} while everyone else split.`;
  else text = `${joinNames(thieves.map((s) => who(s).name))} all went for it. The vault stayed shut.`;
  return (
    <p className="card flex items-center gap-2 px-3 py-2 text-sm" style={{ borderColor: `${m.color}66` }}>
      <span aria-hidden className="text-xl">
        🏦
      </span>
      <span>
        <b style={{ color: GOLD }}>The Heist:</b> {text}
      </span>
    </p>
  );
}

export function Final({ view, who, mySeat }: { view: DcView; who: Who; mySeat: number }) {
  const order = byScore(view.scores);
  const rk = ranks(view.scores, order);
  const aw = awards(view.history, view.order.length);
  const heist = view.history.find((r) => r.heist);
  const top = Math.max(0, ...view.scores);
  return (
    <div className="dc-in flex flex-col gap-3">
      <Card label="Final standings">
        <div className="label mb-2">Final standings</div>
        <ol className="flex flex-col gap-1">
          {order.map((seat, i) => {
            const p = who(seat);
            const win = top > 0 && view.scores[seat] === top;
            return (
              <li
                key={seat}
                className={`dc-in flex items-center gap-2 rounded-xl px-2 py-1.5 ${seat === mySeat ? "bg-panel-2" : ""}`}
                style={{
                  animationDelay: `${i * 70}ms`,
                  ...(win ? { boxShadow: `inset 0 0 0 1.5px ${GOLD}aa`, background: `${GOLD}12` } : {}),
                }}
              >
                <span className="w-6 shrink-0 text-center text-lg leading-none">{medal(rk[i])}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span aria-hidden>{p.avatar}</span>
                    <span className="truncate font-semibold" style={{ color: p.color }}>
                      {seat === mySeat ? "You" : p.name}
                    </span>
                  </span>
                  <span className="text-[11px] text-muted">{trustLine(view.history, seat)}</span>
                </span>
                <RepRow history={view.history} seat={seat} rounds={view.rounds} size="sm" />
                <span className="w-9 shrink-0 text-right font-display text-xl font-extrabold tabular-nums" style={win ? { color: GOLD } : undefined}>
                  {view.scores[seat]}
                </span>
              </li>
            );
          })}
        </ol>
      </Card>

      {aw.length > 0 && (
        <ul className="grid gap-2 @lg:grid-cols-3" aria-label="Awards">
          {aw.map((a, i) => (
            <li key={a.key} className="card dc-pop flex items-center gap-3 p-3" style={{ animationDelay: `${300 + i * 150}ms` }}>
              <span aria-hidden className="text-3xl leading-none">
                {a.emoji}
              </span>
              <span className="min-w-0">
                <span className="label block">{a.title}</span>
                <span className="block truncate font-bold">
                  {a.seats.map((s, k) => (
                    <span key={s}>
                      {k > 0 && <span className="text-muted">{k === a.seats.length - 1 ? " & " : ", "}</span>}
                      <span style={{ color: who(s).color }}>{s === mySeat ? "You" : who(s).name}</span>
                    </span>
                  ))}
                </span>
                <span className="block text-xs text-muted">{a.why}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {heist && <HeistRecap rec={heist} who={who} />}
      {view.endedEarly && (
        <p className="text-center text-xs text-muted">
          Ended early after {plural(view.history.length, "round")}: too few players were online.
        </p>
      )}
    </div>
  );
}

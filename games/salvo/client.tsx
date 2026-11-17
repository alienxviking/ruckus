"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { Player } from "@/shared/types";
import { Note, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import { Avatar } from "@/components/Avatar";
import { buzz, feedback, sfx } from "@/lib/feedback";
import type { AimEvent, SalvoAction, SalvoView, Seat, ShipView } from "./server";
import { FLEETS, REVEAL_LEAD, SHOT_STEP, cellName, fits, randomFill, revealMs, type Ship } from "./shared";
import { FOE, Grid, Hull, MiniShip, SALVO_CSS, shipName } from "./board";

type Props = GameClientProps<SalvoView, SalvoAction>;

export default function Salvo(props: Props) {
  return (
    <>
      <style href="ruckus-salvo" precedence="default">
        {SALVO_CSS}
      </style>
      {props.view ? <Match {...props} view={props.view} /> : <Note>Charting the waters…</Note>}
    </>
  );
}

const SEATS: Seat[] = [0, 1];
const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

function fallbackPlayer(id: string, seat: Seat): Player {
  return {
    id,
    name: `Player ${seat + 1}`,
    color: seat === 0 ? "#60a5fa" : "#f472b6",
    avatar: "🙂",
    connected: false,
  };
}

function isAimEvent(e: unknown): e is AimEvent {
  if (typeof e !== "object" || e === null) return false;
  const a = e as Record<string, unknown>;
  return (
    a.type === "aim" &&
    (a.seat === 0 || a.seat === 1) &&
    typeof a.seq === "number" &&
    Array.isArray(a.cells) &&
    a.cells.every((c) => typeof c === "number")
  );
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function Match({ view, me, byId, isPlayer, act, serverNow, onEvent, accent }: Props & { view: SalvoView }) {
  const you = isPlayer ? view.you : null;
  const people = SEATS.map((seat) => byId[view.seats[seat]] ?? fallbackPlayer(view.seats[seat], seat)) as [
    Player,
    Player,
  ];
  const name = (seat: Seat) => (seat === you ? "You" : people[seat].name);
  const away = (seat: Seat) => view.forfeitAt[seat] !== null;
  const { phase, turn, seq, last, n } = view;
  const myTurn = phase === "turn" && you !== null && turn === you;
  const frozen = phase === "turn" && away(0) && away(1);

  // ---- aiming (local until fired; mirrored to the server so a timeout fires it) ----
  const [aimState, setAimState] = useState<{
    seq: number;
    cells: number[];
  } | null>(null);
  const aim = myTurn ? (aimState?.seq === seq ? aimState.cells : view.myAim) : [];
  const [sent, setSent] = useState<number | null>(null);
  const waiting = sent === seq;
  const [remote, setRemote] = useState<AimEvent | null>(null);

  useEffect(() => onEvent((e) => isAimEvent(e) && setRemote(e)), [onEvent]);
  useEffect(() => {
    if (sent === null) return;
    const id = setTimeout(() => setSent(null), 1500);
    return () => clearTimeout(id);
  }, [sent]);

  const setAim = (cells: number[]) => {
    setAimState({ seq, cells });
    act({ type: "aim", cells });
  };
  const toggleAim = (i: number) => {
    if (!myTurn || waiting || view.boards[other(turn)][i] !== ".") return;
    if (aim.includes(i)) {
      setAim(aim.filter((c) => c !== i));
      sfx("tick");
      return;
    }
    const next = aim.length >= view.shotsNow ? [...aim.slice(1), i] : [...aim, i];
    setAim(next);
    feedback("pop");
  };
  const ready = myTurn && !waiting && aim.length === view.shotsNow;
  const fireNow = () => {
    if (!ready) {
      sfx("error");
      return;
    }
    setSent(seq);
    act({ type: "fire", cells: aim });
    feedback("go");
  };
  const fireRef = useRef(fireNow);
  useEffect(() => {
    fireRef.current = fireNow;
  });
  useEffect(() => {
    if (!myTurn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.repeat || isTyping(e.target) || e.defaultPrevented) return;
      if (e.target instanceof HTMLButtonElement && !e.target.classList.contains("sv-cell")) return;
      e.preventDefault();
      fireRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [myTurn]);

  // ---- cues ----
  useEffect(() => {
    if (myTurn) feedback("turn");
  }, [myTurn]);
  const lastAt = last?.at;
  useEffect(() => {
    if (!last || lastAt === undefined) return;
    const elapsed = serverNow() - lastAt;
    if (elapsed > revealMs(last.cells.length)) return;
    const defender = you !== null && last.seat !== you;
    const timers: ReturnType<typeof setTimeout>[] = [];
    last.cells.forEach((_, k) => {
      const at = REVEAL_LEAD + k * SHOT_STEP - elapsed;
      if (at < 0) return;
      timers.push(
        setTimeout(() => {
          if (last.hits[k]) {
            sfx("hit");
            if (defender) buzz("hit");
          } else sfx("bump");
        }, at),
      );
    });
    for (const s of last.sunk) {
      const at = REVEAL_LEAD + s.shot * SHOT_STEP + 260 - elapsed;
      if (at >= 0) timers.push(setTimeout(() => (defender ? feedback("out") : sfx("score")), at));
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per salvo
  }, [lastAt]);
  useEffect(() => {
    if (phase !== "over" || you === null) return;
    feedback(view.champion === you ? "win" : "end");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once at the end
  }, [phase]);

  // ---- which sea the phone shows (desktop shows both) ----
  const autoSea: Seat =
    phase === "turn" ? other(turn) : phase === "resolve" && last ? other(last.seat) : you !== null ? other(you) : 1;
  const autoKey = `${phase}-${turn}-${seq}`;
  const [manual, setManual] = useState<{ key: string; sea: Seat } | null>(null);
  const shownSea: Seat = manual?.key === autoKey ? manual.sea : autoSea;

  if (phase === "place") {
    return (
      <PlacePhase
        key={you !== null && view.ready[you] ? "ready" : "edit"}
        view={view}
        you={you}
        people={people}
        act={act}
        serverNow={serverNow}
        accent={accent}
        me={me}
      />
    );
  }

  // ---------- words ----------
  const shots = view.shotsNow;
  let headline: ReactNode;
  let sub: ReactNode;
  let said: string;
  const gone = SEATS.find((seat) => seat !== you && away(seat) && !(phase === "turn" && seat === turn));
  const goneNote =
    gone === undefined ? null : (
      <>
        {people[gone].name} is away ·{" "}
        <Countdown at={view.forfeitAt[gone]!} serverNow={serverNow} prefix="forfeits in " />
      </>
    );
  if (phase === "turn") {
    if (frozen) {
      headline = "Both players are away";
      sub = "Paused until someone returns";
      said = "Both players are away";
    } else if (myTurn) {
      headline = (
        <>
          Your salvo: pick {shots} target{shots === 1 ? "" : "s"}
        </>
      );
      sub = goneNote ?? (aim.length === shots ? "Ready: fire away!" : `${aim.length}/${shots} aimed · tap open water`);
      said = `Your turn. Pick ${shots} targets.`;
    } else if (away(turn)) {
      headline = `${people[turn].name} is away`;
      sub = (
        <>
          Auto-fire in <Countdown at={view.endsAt} serverNow={serverNow} /> ·{" "}
          <Countdown at={view.forfeitAt[turn]!} serverNow={serverNow} prefix="forfeits in " />
        </>
      );
      said = `${people[turn].name} is away`;
    } else {
      headline = you === null ? `${people[turn].name} is aiming…` : `${people[turn].name} is aiming at you…`;
      sub = goneNote ?? `${shots} shell${shots === 1 ? "" : "s"} incoming`;
      said = `${people[turn].name} to fire.`;
    }
  } else if (phase === "resolve" && last) {
    const hits = last.hits.filter(Boolean).length;
    const mine = last.seat === you;
    headline = last.auto
      ? mine
        ? "Time's up: salvo fired for you"
        : `${people[last.seat].name}'s salvo fired`
      : mine
        ? "Salvo away!"
        : you === null
          ? `${people[last.seat].name} fires!`
          : "Incoming!";
    sub = (
      <span className="relative inline-grid">
        <span
          key={`a${last.at}`}
          className="sv-fadeout col-start-1 row-start-1"
          style={{ animationDelay: `${revealMs(last.cells.length) - 900}ms` }}
        >
          {last.cells.length} shell{last.cells.length === 1 ? "" : "s"} away ·{" "}
          {last.cells.map((c) => cellName(c, n)).join(" · ")}
        </span>
        <span
          key={`b${last.at}`}
          className="sv-pop col-start-1 row-start-1"
          style={{ animationDelay: `${revealMs(last.cells.length) - 900}ms` }}
        >
          {hits ? `${hits} hit${hits === 1 ? "" : "s"}` : "All misses"}
          {last.sunk.length ? ` · sunk ${last.sunk.map((s) => shipName(n, s.ship)).join(", ")}` : ""}
        </span>
      </span>
    );
    said = `${name(last.seat)} fired at ${last.cells.map((c) => cellName(c, n)).join(", ")}: ${hits} hits.`;
  } else {
    const champ = view.champion;
    if (view.ending === "abandoned") said = "Battle abandoned";
    else if (view.ending === "short") said = "Not enough players";
    else if (champ === null) said = "It's a draw";
    else if (champ === you) said = "Victory! Their fleet is gone";
    else if (you !== null) said = "Your fleet is sunk";
    else said = `${people[champ].name} wins`;
    headline = champ !== null && champ === you ? <>{said} 🏆</> : said;
    sub =
      view.ending === "forfeit" && view.quitter !== null
        ? `${people[view.quitter].name} left the battle`
        : champ !== null
          ? `${people[champ].name} needed ${view.salvos[champ]} salvos`
          : "";
  }

  const bannerColor = myTurn ? accent : phase === "resolve" && last && last.seat !== you && you !== null ? FOE : accent;
  const seaOrder: Seat[] = you === null ? [0, 1] : [you, other(you)];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {said}
      </p>
      <div className="mx-auto w-full max-w-xl">
        <StatusBanner accent={bannerColor}>
          <div key={`${phase}-${seq}`} className="sv-pop">
            <div className="truncate">{headline}</div>
            <div className="mt-0.5 truncate font-sans text-xs font-normal text-muted sm:text-sm">{sub}</div>
          </div>
        </StatusBanner>
      </div>

      {you === null && (
        <p className="mx-auto flex w-fit max-w-full items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted">
          <span aria-hidden>👀</span>
          <span className="truncate">
            Spectating · {people[0].name} vs {people[1].name}
          </span>
        </p>
      )}

      {phase === "over" ? (
        <Standings view={view} people={people} you={you} />
      ) : (
        <div className="mx-auto grid w-full max-w-xl grid-cols-2 gap-2">
          {SEATS.map((seat) => (
            <SeatCard
              key={seat}
              seat={seat}
              view={view}
              player={people[seat]}
              isYou={seat === you}
              active={phase === "turn" && turn === seat}
              away={away(seat)}
            />
          ))}
        </div>
      )}

      {phase !== "over" && (
        <div className="mx-auto flex h-4 w-full max-w-xl items-center gap-2">
          {phase === "turn" && !frozen ? (
            <>
              <div className="flex-1">
                <TimerBar
                  endsAt={view.endsAt}
                  total={view.timerMs}
                  serverNow={serverNow}
                  color={myTurn ? accent : people[turn].color}
                />
              </div>
              <Seconds endsAt={view.endsAt} serverNow={serverNow} urgent={myTurn} />
            </>
          ) : (
            <div className="h-2 flex-1 rounded-full bg-panel-2" aria-hidden />
          )}
        </div>
      )}

      {/* Phone: tabs to switch seas. Desktop: both side by side. */}
      <div
        className="mx-auto flex w-full max-w-xl gap-1 rounded-xl border border-line bg-panel p-1 md:hidden"
        role="tablist"
      >
        {seaOrder.map((sea) => {
          const label = you === null ? `${people[sea].name}'s sea` : sea === you ? "Your fleet" : "Enemy waters";
          const hot = sea === autoSea && phase !== "over";
          return (
            <button
              key={sea}
              role="tab"
              aria-selected={shownSea === sea}
              className={`flex-1 truncate rounded-lg px-2 py-1.5 text-sm font-semibold transition-colors ${
                shownSea === sea ? "bg-panel-2 text-text" : "text-muted"
              }`}
              onClick={() => setManual({ key: autoKey, sea })}
            >
              {label}
              {hot && shownSea !== sea && (
                <span
                  className="ml-1.5 inline-block h-2 w-2 rounded-full align-middle"
                  style={{ background: myTurn ? accent : FOE }}
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="grid w-full gap-4 md:grid-cols-2">
        {seaOrder.map((sea) => {
          const enemy = you !== null && sea !== you;
          const target = phase === "turn" && sea === other(turn);
          const title = you === null ? `${people[sea].name}'s sea` : sea === you ? "Your fleet" : `Enemy waters`;
          const incoming =
            remote &&
            remote.seq === seq &&
            phase === "turn" &&
            remote.seat === turn &&
            sea === other(turn) &&
            !(myTurn && enemy)
              ? remote.cells
              : [];
          return (
            <section
              key={sea}
              className={`card min-w-0 p-2.5 sm:p-3 ${sea === shownSea ? "" : "hidden md:block"}`}
              aria-label={title}
            >
              <header className="mb-2 flex items-center gap-2 px-0.5">
                <span aria-hidden>
                  <Avatar id={people[sea].avatar} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {title}
                  {you !== null && sea !== you && (
                    <span className="ml-1.5 font-normal text-muted">· {people[sea].name}</span>
                  )}
                </span>
                <FleetPips n={n} lens={view.lens} sunk={view.sunk[sea]} color={sea === you ? "#7aa6dd" : "#9a7cc4"} />
              </header>
              <Grid
                n={n}
                board={view.boards[sea]}
                ships={view.ships[sea]}
                sunk={view.sunk[sea]}
                tone={enemy || you === null ? "enemy" : "own"}
                aim={myTurn && enemy ? aim : []}
                incoming={incoming}
                last={last && last.seat !== sea && phase !== "over" ? last : null}
                serverNow={serverNow}
                onCell={myTurn && enemy ? toggleAim : undefined}
                clickable={myTurn && enemy && !waiting}
                glow={target && phase === "turn" ? (myTurn ? accent : FOE) : null}
                dimShips={phase === "over" && sea !== you}
                label={`${title}, ${n} by ${n}`}
              />
              {myTurn && enemy && (
                <div className="mt-2.5 flex items-center gap-2">
                  <div className="flex gap-1" aria-hidden>
                    {Array.from({ length: shots }, (_, k) => (
                      <span
                        key={k}
                        className="h-3 w-3 rounded-full transition-colors"
                        style={{
                          background: k < aim.length ? accent : "var(--color-line)",
                          boxShadow: k < aim.length ? `0 0 8px ${accent}` : undefined,
                        }}
                      />
                    ))}
                  </div>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted">
                    {aim.length ? aim.map((c) => cellName(c, n)).join(" · ") : "Tap open water to aim"}
                  </span>
                  {aim.length > 0 && (
                    <button className="btn px-3 py-2 text-sm" onClick={() => setAim([])} disabled={waiting}>
                      Clear
                    </button>
                  )}
                  <button className="btn btn-primary px-4 py-2 text-sm" onClick={fireNow} disabled={!ready}>
                    Fire{shots > 1 ? ` ${shots}` : ""} 🎯
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <p className="text-center text-xs text-muted">
        {view.mode === "fleet" ? "1 shot per ship afloat" : "3 shots per salvo"} · sink all {view.lens.length} ships to
        win
      </p>
    </div>
  );
}

// ---------- placement ----------

interface Drag {
  i: number;
  d: 0 | 1;
  /** Which segment of the ship the pointer holds. */
  k: number;
  from: "board" | "dock";
  x0: number;
  y0: number;
  x: number;
  y: number;
  moved: boolean;
  anchor: { r: number; c: number } | null;
}

function PlacePhase({
  view,
  you,
  people,
  act,
  serverNow,
  accent,
}: {
  view: SalvoView;
  you: Seat | null;
  people: [Player, Player];
  act: (a: SalvoAction) => void;
  serverNow: () => number;
  accent: string;
  me: string;
}) {
  const n = view.n;
  const lens = view.lens;
  const editing = you !== null && !view.ready[you];
  const readyCount = view.ready.filter(Boolean).length;

  const initial = (): (Ship | null)[] => {
    const out: (Ship | null)[] = lens.map(() => null);
    if (you !== null) for (const s of view.ships[you]) out[s.i] = { r: s.r, c: s.c, d: s.d, len: lens[s.i] };
    return out;
  };
  const [fleet, setFleet] = useState<(Ship | null)[]>(initial);
  const [sel, setSel] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [dockDir, setDockDir] = useState<0 | 1>(0);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [shake, setShake] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const fleetRef = useRef(fleet);
  useEffect(() => {
    fleetRef.current = fleet;
  });

  // Save the draft so a reload or the clock running out keeps your layout.
  const firstRun = useRef(true);
  useEffect(() => {
    if (!editing) return;
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const id = setTimeout(
      () =>
        act({
          type: "place",
          ships: fleet.map((s) => (s ? { r: s.r, c: s.c, d: s.d } : null)),
          ready: false,
        }),
      500,
    );
    return () => clearTimeout(id);
  }, [fleet, editing, act]);

  useEffect(() => {
    if (shake === null) return;
    const id = setTimeout(() => setShake(null), 400);
    return () => clearTimeout(id);
  }, [shake]);

  const complete = fleet.every(Boolean);

  /** Put ship i at (r, c, d), nudging it back onto the grid; returns success. */
  const tryPlace = (cur: (Ship | null)[], i: number, r: number, c: number, d: 0 | 1): (Ship | null)[] | null => {
    const len = lens[i];
    const rr = Math.max(0, Math.min(r, d ? n - len : n - 1));
    const cc = Math.max(0, Math.min(c, d ? n - 1 : n - len));
    const ship: Ship = { r: rr, c: cc, d, len };
    if (!fits(ship, cur, i, n)) return null;
    const next = cur.slice();
    next[i] = ship;
    return next;
  };

  const rotate = (i: number) => {
    const s = fleet[i];
    if (!s) return;
    const d: 0 | 1 = s.d ? 0 : 1;
    // Turn about the first cell; if blocked, try sliding it along the new axis.
    for (let shift = 0; shift < s.len; shift++) {
      const next = tryPlace(fleet, i, s.r - (d ? shift : 0), s.c - (d ? 0 : shift), d);
      if (next) {
        setFleet(next);
        setFocus(i);
        sfx("tick");
        return;
      }
    }
    setShake(i);
    sfx("error");
  };

  const cellFromPoint = (x: number, y: number) => {
    const el = gridRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return null;
    return {
      r: Math.floor(((y - rect.top) / rect.height) * n),
      c: Math.floor(((x - rect.left) / rect.width) * n),
    };
  };

  const anchorFor = (dr: Drag, x: number, y: number) => {
    const cell = cellFromPoint(x, y);
    if (!cell) return null;
    const len = lens[dr.i];
    const r = cell.r - (dr.d ? dr.k : 0);
    const c = cell.c - (dr.d ? 0 : dr.k);
    return {
      r: Math.max(0, Math.min(r, dr.d ? n - len : n - 1)),
      c: Math.max(0, Math.min(c, dr.d ? n - 1 : n - len)),
    };
  };

  const startDrag = (i: number, from: "board" | "dock", d: 0 | 1, k: number, e: ReactPointerEvent) => {
    if (!editing || e.button !== 0) return;
    e.preventDefault();
    const dr: Drag = {
      i,
      d,
      k,
      from,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      moved: false,
      anchor: null,
    };
    dragRef.current = dr;
    setDrag(dr);
  };

  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const dr = dragRef.current;
      if (!dr) return;
      const moved = dr.moved || Math.hypot(e.clientX - dr.x0, e.clientY - dr.y0) > 8;
      const next = {
        ...dr,
        x: e.clientX,
        y: e.clientY,
        moved,
        anchor: moved ? anchorFor(dr, e.clientX, e.clientY) : null,
      };
      dragRef.current = next;
      setDrag(next);
    };
    const up = () => {
      const dr = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!dr) return;
      const cur = fleetRef.current;
      if (!dr.moved) {
        if (dr.from === "board") rotate(dr.i);
        else {
          setSel((s) => (s === dr.i ? null : dr.i));
          sfx("tick");
        }
        return;
      }
      if (dr.anchor) {
        const next = tryPlace(cur, dr.i, dr.anchor.r, dr.anchor.c, dr.d);
        if (next) {
          setFleet(next);
          setFocus(dr.i);
          setSel(null);
          feedback("pop");
          return;
        }
      }
      sfx("error");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers read refs
  }, [dragging]);

  const onBoardShipDown = (i: number, e: ReactPointerEvent<HTMLDivElement>) => {
    const s = fleet[i];
    if (!s) return;
    const cell = cellFromPoint(e.clientX, e.clientY);
    const k = cell ? Math.max(0, Math.min(s.len - 1, s.d ? cell.r - s.r : cell.c - s.c)) : 0;
    setFocus(i);
    startDrag(i, "board", s.d, k, e);
  };

  const onCell = (idx: number) => {
    if (!editing || sel === null) return;
    const r = Math.floor(idx / n);
    const c = idx % n;
    const next = tryPlace(fleet, sel, r, c, dockDir) ?? tryPlace(fleet, sel, r, c, dockDir ? 0 : 1);
    if (!next) {
      sfx("error");
      return;
    }
    setFleet(next);
    setFocus(sel);
    setSel(null);
    feedback("pop");
  };

  const randomize = () => {
    setFleet(randomFill([], lens, n, Math.random));
    setSel(null);
    setFocus(null);
    feedback("pop");
  };
  const clear = () => {
    setFleet(lens.map(() => null));
    setSel(null);
    setFocus(null);
  };
  const confirm = () => {
    if (!complete) return;
    act({
      type: "place",
      ships: fleet.map((s) => (s ? { r: s.r, c: s.c, d: s.d } : null)),
      ready: true,
    });
    feedback("score");
  };

  // R turns the focused ship (or the dock direction).
  const rotateKey = useRef(() => {});
  useEffect(() => {
    rotateKey.current = () => {
      if (focus !== null && fleet[focus]) rotate(focus);
      else setDockDir((d) => (d ? 0 : 1));
    };
  });
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        rotateKey.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  const ghost =
    drag && drag.moved && drag.anchor
      ? (() => {
          const ship: Ship = {
            r: drag.anchor.r,
            c: drag.anchor.c,
            d: drag.d,
            len: lens[drag.i],
          };
          return { ship, ok: fits(ship, fleet, drag.i, n) };
        })()
      : null;
  const shownShips: ShipView[] = [];
  fleet.forEach((s, i) => s && shownShips.push({ ...s, i }));
  const names = FLEETS[n];

  // ---------- not placing: waiting / spectating ----------
  const banner =
    you === null ? (
      <>
        <div className="truncate">Admirals are hiding their fleets</div>
        <div className="mt-0.5 truncate font-sans text-xs font-normal text-muted sm:text-sm">
          {readyCount}/2 ready · battle starts when both are set
        </div>
      </>
    ) : editing ? (
      <>
        <div className="truncate">Hide your fleet</div>
        <div className="mt-0.5 truncate font-sans text-xs font-normal text-muted sm:text-sm">
          {sel !== null ? `Tap a cell for the ${names[sel].name}` : "Drag ships onto your grid · tap a ship to turn it"}
        </div>
      </>
    ) : (
      <>
        <div className="truncate">Fleet hidden ✓</div>
        <div className="mt-0.5 truncate font-sans text-xs font-normal text-muted sm:text-sm">
          {view.ready[other(you)] ? "Both ready" : `Waiting for ${people[other(you)].name} to place…`}
        </div>
      </>
    );

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3 md:max-w-3xl">
      <StatusBanner accent={accent}>
        <div key={editing ? "edit" : "ready"} className="sv-pop">
          {banner}
        </div>
      </StatusBanner>

      <div className="flex h-4 items-center gap-2">
        <div className="flex-1">
          <TimerBar endsAt={view.endsAt} total={view.timerMs} serverNow={serverNow} color={accent} />
        </div>
        <Seconds endsAt={view.endsAt} serverNow={serverNow} urgent={editing} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        {SEATS.map((seat) => (
          <div
            key={seat}
            className={`card flex min-w-0 items-center gap-2 px-2.5 py-2 ${seat === you ? "bg-panel-2" : ""} ${view.forfeitAt[seat] !== null ? "opacity-60" : ""}`}
          >
            <span aria-hidden>
              <Avatar id={people[seat].avatar} />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color: people[seat].color }}>
              {seat === you ? "You" : people[seat].name}
            </span>
            <span
              key={String(view.ready[seat])}
              className={`sv-pop shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${view.ready[seat] ? "text-ink" : "text-muted"}`}
              style={{
                background: view.ready[seat] ? accent : "var(--color-panel-2)",
              }}
            >
              {view.ready[seat] ? "READY" : view.forfeitAt[seat] !== null ? "AWAY" : "placing"}
            </span>
          </div>
        ))}
      </div>

      {you === null ? (
        <div className="card p-4 text-center text-sm text-muted">
          <div className="mb-1 text-3xl" aria-hidden>
            🌊
          </div>
          Ship positions stay secret. You&apos;ll see every shot once the battle starts.
        </div>
      ) : (
        <section
          className="card p-2.5 sm:p-3 md:grid md:grid-cols-[minmax(0,1fr)_220px] md:gap-4"
          aria-label="Your fleet"
        >
          <div className="min-w-0">
            <Grid
              n={n}
              board={".".repeat(n * n)}
              ships={shownShips}
              sunk={lens.map(() => false)}
              tone="own"
              serverNow={serverNow}
              onCell={editing ? onCell : undefined}
              clickable={editing && sel !== null}
              gridRef={gridRef}
              ghost={ghost}
              hideShip={drag && drag.moved && drag.from === "board" ? drag.i : null}
              onShipDown={editing ? onBoardShipDown : undefined}
              shake={shake}
              glow={editing && sel !== null ? accent : null}
              label={`Your sea, ${n} by ${n}`}
            />
          </div>

          <div className="flex min-w-0 flex-col">
            {editing && (
              <>
                <div className="label mt-3 mb-1.5 hidden md:mt-0 md:block">Your fleet</div>
                <div
                  className="mt-3 flex min-h-[44px] flex-wrap items-center gap-2 md:mt-0 md:flex-col md:items-stretch"
                  aria-label="Ships to place"
                >
                  {fleet.every(Boolean) ? (
                    <span className="text-xs text-muted">All ships placed. Tap one to turn it, drag to move.</span>
                  ) : (
                    lens.map((len, i) =>
                      fleet[i] ? null : (
                        <button
                          key={i}
                          type="button"
                          className={`sv-dock-ship relative flex flex-col items-start gap-1 rounded-lg border px-2 py-1.5 text-left transition-colors ${
                            sel === i ? "border-[color:var(--sel)] bg-panel-2" : "border-line bg-panel"
                          }`}
                          style={{ "--sel": accent } as React.CSSProperties}
                          onPointerDown={(e) => {
                            const rect = e.currentTarget.querySelector("[data-hull]")?.getBoundingClientRect();
                            const k = rect
                              ? Math.max(0, Math.min(len - 1, Math.floor(((e.clientX - rect.left) / rect.width) * len)))
                              : 0;
                            startDrag(i, "dock", dockDir, dockDir ? 0 : k, e);
                          }}
                          aria-pressed={sel === i}
                          aria-label={`${names[i].name}, ${len} long`}
                        >
                          <span data-hull className="relative block h-[18px]" style={{ width: len * 18 }}>
                            <Hull
                              ship={{ r: 0, c: 0, d: 0, len }}
                              n={1}
                              tone="own"
                              style={{ width: "100%", height: "100%" }}
                            />
                          </span>
                          <span className="text-xs leading-none text-muted">
                            {names[i].name} · {len}
                          </span>
                        </button>
                      ),
                    )
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 md:mt-auto md:grid md:grid-cols-2 md:pt-3">
                  <button className="btn px-3 py-2 text-sm" onClick={randomize}>
                    🎲 Random
                  </button>
                  <button
                    className="btn px-3 py-2 text-sm"
                    onClick={() => rotateKey.current()}
                    title="Turn the last ship you touched (R)"
                  >
                    ⟳ Turn
                    {(focus === null || !fleet[focus]) && !complete ? (dockDir ? " ↓" : " →") : ""}
                  </button>
                  <button className="btn px-3 py-2 text-sm" onClick={clear} disabled={!fleet.some(Boolean)}>
                    Clear
                  </button>
                  <button
                    className="btn btn-primary ml-auto px-4 py-2 text-sm md:col-span-2 md:ml-0 md:py-2.5"
                    onClick={confirm}
                    disabled={!complete}
                  >
                    {complete ? "Ready ⚓" : `${fleet.filter(Boolean).length}/${lens.length} placed`}
                  </button>
                </div>
              </>
            )}
            {!editing && (
              <div className="mt-3 flex items-center justify-between gap-2 md:mt-0 md:flex-col md:items-stretch md:justify-center md:text-center">
                <span className="text-xs text-muted">
                  Your fleet is locked in. You can still change it until both are ready.
                </span>
                <button className="btn px-3 py-2 text-sm" onClick={() => act({ type: "unready" })}>
                  Edit fleet
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {drag && drag.moved && !drag.anchor && (
        <div
          className="pointer-events-none fixed z-50"
          style={{
            left: drag.x - 9 - (drag.d ? 0 : drag.k * 18),
            top: drag.y - 9 - (drag.d ? drag.k * 18 : 0),
          }}
          aria-hidden
        >
          <span
            className="relative block"
            style={{
              width: drag.d ? 18 : lens[drag.i] * 18,
              height: drag.d ? lens[drag.i] * 18 : 18,
            }}
          >
            <Hull
              ship={{ r: 0, c: 0, d: drag.d, len: lens[drag.i] }}
              n={1}
              tone="ghost-ok"
              style={{ width: "100%", height: "100%" }}
            />
          </span>
        </div>
      )}
    </div>
  );
}

// ---------- bits ----------

function Seconds({ endsAt, serverNow, urgent }: { endsAt: number; serverNow: () => number; urgent?: boolean }) {
  const s = useSecondsLeft(endsAt, serverNow);
  const hot = urgent && s <= 5;
  return (
    <span className={`w-8 text-right font-mono text-xs tabular-nums ${hot ? "sv-urgent font-bold text-brand" : ""}`}>
      {s}s
    </span>
  );
}

function Countdown({ at, serverNow, prefix = "" }: { at: number; serverNow: () => number; prefix?: string }) {
  const s = useSecondsLeft(at, serverNow);
  return (
    <>
      {prefix}
      {s}s
    </>
  );
}

function FleetPips({ n, lens, sunk, color }: { n: number; lens: number[]; sunk: boolean[]; color: string }) {
  return (
    <span
      className="flex shrink-0 flex-wrap items-center justify-end gap-1"
      aria-label={`${sunk.filter((x) => !x).length} of ${lens.length} ships afloat`}
    >
      {lens.map((len, i) => (
        <span key={i} title={`${shipName(n, i)}${sunk[i] ? " (sunk)" : ""}`}>
          <MiniShip len={len} sunk={sunk[i]} color={color} />
        </span>
      ))}
    </span>
  );
}

function SeatCard({
  seat,
  view,
  player,
  isYou,
  active,
  away,
}: {
  seat: Seat;
  view: SalvoView;
  player: Player;
  isYou: boolean;
  active: boolean;
  away: boolean;
}) {
  const afloat = view.sunk[seat].filter((x) => !x).length;
  const acc = view.fired[seat] ? Math.round((view.hitCount[seat] / view.fired[seat]) * 100) : null;
  const color = player.color;
  return (
    <div
      className={`card relative min-w-0 px-2.5 py-2 transition-[border-color,box-shadow,opacity] duration-300 ${away ? "opacity-60" : ""} ${isYou ? "bg-panel-2" : ""}`}
      style={
        active
          ? {
              borderColor: color,
              boxShadow: `0 0 0 1px ${color}66, 0 8px 26px -14px ${color}`,
            }
          : undefined
      }
    >
      {isYou && player.name !== "You" && (
        <span className="absolute -top-2 left-3 rounded-full border border-line bg-ink px-1.5 text-xs leading-4 font-bold text-muted">
          you
        </span>
      )}
      <div className="flex min-w-0 items-center gap-1.5">
        <span aria-hidden>
          <Avatar id={player.avatar} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color }}>
          {player.name}
        </span>
        <span
          key={afloat}
          className="animate-pop font-mono text-lg leading-6 font-bold tabular-nums"
          title="Ships afloat"
        >
          {afloat}
          <span className="text-xs text-muted">⚓</span>
        </span>
      </div>
      <div className="mt-0.5 truncate text-xs leading-4 text-muted">
        {away ? (
          <>📴 away</>
        ) : active ? (
          <span className="font-semibold" style={{ color }}>
            {isYou ? "your salvo" : "aiming"}
          </span>
        ) : (
          <>
            {view.hitCount[seat]} hit{view.hitCount[seat] === 1 ? "" : "s"}
            {acc !== null ? ` · ${acc}%` : ""}
          </>
        )}
      </div>
    </div>
  );
}

function Standings({ view, people, you }: { view: SalvoView; people: [Player, Player]; you: Seat | null }) {
  const order = [...SEATS].sort((a, b) => (view.champion === b ? 1 : 0) - (view.champion === a ? 1 : 0));
  return (
    <section className="card animate-rise mx-auto w-full max-w-xl p-3" aria-label="Final standings">
      <div className="label mb-2">After action report</div>
      <ol className="space-y-1.5">
        {order.map((seat) => {
          const champ = view.champion === seat;
          const sunkIt = view.sunk[other(seat)].filter(Boolean).length;
          const acc = view.fired[seat] ? Math.round((view.hitCount[seat] / view.fired[seat]) * 100) : 0;
          return (
            <li
              key={seat}
              className="flex items-center gap-2 rounded-xl px-2 py-1.5"
              style={
                champ
                  ? {
                      background: "#60a5fa1c",
                      boxShadow: "inset 0 0 0 1px #60a5fa55",
                    }
                  : undefined
              }
            >
              <span className="w-5 shrink-0 text-center text-sm">
                {champ ? <span aria-label="Winner">🏆</span> : <span aria-hidden>⚓</span>}
              </span>
              <span aria-hidden>
                <Avatar id={people[seat].avatar} />
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold" style={{ color: people[seat].color }}>
                {people[seat].name}
                {seat === you && people[seat].name !== "You" && <span className="ml-1 text-xs font-normal text-muted">(you)</span>}
              </span>
              <span className="shrink-0 text-right text-xs leading-tight text-muted">
                {view.salvos[seat]} salvos · {acc}%
                <br />
                {view.hitCount[seat]}/{view.fired[seat]} hits
              </span>
              <span className="w-12 shrink-0 text-right font-mono text-xl font-bold tabular-nums" title="Ships sunk">
                {sunkIt}
                <span className="text-xs text-muted">/{view.lens.length}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-center text-xs text-muted">Both fleets revealed below: faded ships survived.</p>
    </section>
  );
}

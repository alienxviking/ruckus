import { assert, makeTestCtx } from "../../shared/testing";
import game, { botTargets, shotsFor, type SalvoAction, type SalvoState, type SalvoView, type Seat } from "./server";
import { AWAY_MS, FLEETS, FORFEIT_MS, PLACE_MS, fleetOk, randomFill, revealMs, shipCells, type Ship } from "./shared";

type Harness = ReturnType<typeof makeTestCtx>;

function check(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const act = (s: SalvoState, t: Harness, who: string, a: unknown) => game.action(s, who, a as SalvoAction, t.ctx);
const tick = (s: SalvoState, t: Harness) => game.tick!(s, t.ctx);
const view = (s: SalvoState, t: Harness, who: string) => game.view(s, who, t.ctx) as SalvoView;
const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

/** Ships in rows 0, 2, 4... starting at column 0 (easy to aim at). */
function rowFleet(lens: number[]) {
  return lens.map((_, i) => ({ r: i * 2, c: 0, d: 0 as const }));
}

function start(settings = {}, players = 2, bots = 0, seed = 7) {
  const t = makeTestCtx(players, seed, settings, bots);
  const s = game.setup(t.ctx);
  return { t, s };
}

function placeBoth(s: SalvoState, t: Harness) {
  for (const id of s.seats)
    check(act(s, t, id, { type: "place", ships: rowFleet(s.lens), ready: true }) === true, "place ok");
  check(s.phase === "turn", "both ready starts the shooting");
}

function finishReveal(s: SalvoState, t: Harness) {
  check(s.phase === "resolve", "in the reveal");
  t.advance(revealMs(s.last!.cells.length));
  tick(s, t);
}

// ---------- pure helpers ----------
{
  for (const n of [8, 10]) {
    const lens = FLEETS[n].map((f) => f.len);
    let r = 1;
    const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 200; k++) {
      const f = randomFill([], lens, n, rnd);
      check(f.length === lens.length && fleetOk(f, n), "random fleet valid");
      f.forEach((sh, i) => check(sh.len === lens[i], "lengths kept"));
    }
  }
  check(!fleetOk([{ r: 0, c: 8, d: 0, len: 3 }], 10), "off the edge rejected");
  check(
    !fleetOk(
      [
        { r: 0, c: 0, d: 0, len: 3 },
        { r: 0, c: 2, d: 1, len: 2 },
      ],
      10,
    ),
    "overlap rejected",
  );
  check(
    fleetOk(
      [
        { r: 0, c: 0, d: 0, len: 3 },
        { r: 1, c: 0, d: 0, len: 3 },
      ],
      10,
    ),
    "touching allowed",
  );
  console.log("✓ fleet helpers");
}

// ---------- full game, invalid actions, no leaks ----------
{
  const { t, s } = start();
  const [a, b] = s.seats;
  check(s.n === 10 && s.lens.join() === "5,4,3,3,2", "default sea is 10x10, 5 ships");
  // Junk is rejected before the fleets are in.
  const junk: unknown[] = [
    null,
    42,
    "x",
    [],
    {},
    { type: "fire", cells: [0, 1, 2] },
    { type: "place" },
    { type: "place", ships: "x", ready: true },
    { type: "place", ships: rowFleet(s.lens).slice(1), ready: true },
    {
      type: "place",
      ships: [...rowFleet(s.lens).slice(0, 4), { r: 0, c: 0, d: 0 }],
      ready: true,
    }, // overlap
    {
      type: "place",
      ships: [{ r: 0, c: 6, d: 0 }, ...rowFleet(s.lens).slice(1)],
      ready: true,
    }, // off grid
    {
      type: "place",
      ships: [{ r: 0, c: 0.5, d: 0 }, ...rowFleet(s.lens).slice(1)],
      ready: true,
    },
    {
      type: "place",
      ships: [{ r: 0, c: 0, d: 2 }, ...rowFleet(s.lens).slice(1)],
      ready: true,
    },
    { type: "place", ships: [null, ...rowFleet(s.lens).slice(1)], ready: true }, // incomplete + ready
    { type: "place", ships: rowFleet(s.lens), ready: "yes" },
  ];
  const before = JSON.stringify(s);
  for (const j of junk) check(!act(s, t, a, j), `junk rejected: ${JSON.stringify(j)}`);
  check(JSON.stringify(s) === before, "junk changed nothing");
  check(
    !act(s, t, "spectator", {
      type: "place",
      ships: rowFleet(s.lens),
      ready: true,
    }),
    "spectators can't place",
  );

  // A draft (incomplete, not ready) is kept but isn't broadcast.
  check(
    act(s, t, a, {
      type: "place",
      ships: [null, null, null, null, { r: 9, c: 0, d: 0 }],
      ready: false,
    }) === false,
    "draft is silent",
  );
  check(s.fleets[0][4]?.r === 9, "draft stored");
  check(view(s, t, b).ships[0].length === 0, "the rival doesn't see a draft");
  check(view(s, t, a).ships[0].length === 1, "you see your own draft");

  check(act(s, t, a, { type: "place", ships: rowFleet(s.lens), ready: true }) === true, "a ready");
  check(act(s, t, a, { type: "unready" }) === true, "a can edit again");
  check(act(s, t, a, { type: "place", ships: rowFleet(s.lens), ready: true }) === true, "a ready again");
  check(s.phase === "place", "still waiting for b");
  check(act(s, t, b, { type: "place", ships: rowFleet(s.lens), ready: true }) === true, "b ready");
  check(s.phase === "turn", "shooting starts");
  check(!act(s, t, a, { type: "unready" }), "no unready after the start");

  // No leaks: the rival and spectators see no ships.
  for (const who of [s.seats[other(s.turn)], "spectator"]) {
    const v = view(s, t, who);
    const seat = who === "spectator" ? null : other(s.turn);
    for (const st of [0, 1] as Seat[]) if (st !== seat) check(v.ships[st].length === 0, "no enemy ships in view");
    check(!JSON.stringify(v).includes('"fleets"'), "raw fleets never sent");
  }
  check(view(s, t, "spectator").you === null, "spectator has no seat");

  // Bad fire actions.
  const mover = s.seats[s.turn];
  const waiter = s.seats[other(s.turn)];
  check(!act(s, t, waiter, { type: "fire", cells: [0, 1, 2] }), "not your turn");
  for (const cells of [[0, 1], [0, 1, 2, 3], [0, 0, 1], [0, 1, 100], [0, 1, -1], [0, 1, 1.5], "0,1,2", [0, 1, "2"]]) {
    check(!act(s, t, mover, { type: "fire", cells }), `bad salvo rejected: ${JSON.stringify(cells)}`);
  }
  check(!act(s, t, mover, { type: "aim", cells: [0, 1, 2, 3] }), "aim capped at salvo size");
  check(act(s, t, mover, { type: "aim", cells: [5] }) === false, "aim is an event only");
  check(
    t.events.some((e) => (e.event as { type: string }).type === "aim" && e.except === mover),
    "aim relayed to others",
  );
  check(view(s, t, mover).myAim.join() === "5" && view(s, t, waiter).myAim.length === 0, "aim only in mover's view");

  // Play it out: both fire row by row; seat 0's shooter clears rows 0,2,4,6,8.
  const targets: Record<Seat, number[]> = { 0: [], 1: [] };
  for (const seat of [0, 1] as Seat[])
    for (const sh of rowFleet(s.lens).map((p, i) => ({ ...p, len: s.lens[i] })))
      targets[seat].push(...shipCells(sh, 10));
  let salvos = 0;
  while (s.phase !== "over" && salvos < 100) {
    const seat = s.turn;
    const need = shotsFor(s, seat);
    const pool = targets[seat].filter((c) => s.shots[other(seat)][c] === 0);
    // The second player wastes shots, so the first player wins.
    const waste = [...Array(100).keys()].filter((c) => !targets[seat].includes(c) && s.shots[other(seat)][c] === 0);
    const cells = (seat === 0 ? [...pool, ...waste] : waste).slice(0, need);
    check(
      act(s, t, s.seats[seat], { type: "fire", cells }) === true,
      `fire accepted ${s.phase} ${seat} ${need} ${cells}`,
    );
    check(!act(s, t, s.seats[seat], { type: "fire", cells }), "no second salvo during the reveal");
    salvos++;
    finishReveal(s, t);
  }
  check(s.phase === "over" && t.result, "game ended");
  check(t.result!.winners.length === 1 && t.result!.winners[0] === s.seats[0], "seat 0 sank everything first");
  check(t.result!.scores![s.seats[0]] === 5, "score = ships sunk");
  check(/sinks the whole fleet/.test(t.result!.headline), "headline");
  const v = view(s, t, "spectator");
  check(v.ships[0].length === 5 && v.ships[1].length === 5, "fleets revealed at the end");
  console.log(`✓ full game (${salvos} salvos), junk rejected, no leaks`);
}

// ---------- settings ----------
{
  const { s } = start({ grid: 8, salvo: "fleet", turn: 20 });
  check(s.n === 8 && s.lens.join() === "4,3,3,2", "8x8 sea with 4 ships");
  check(s.mode === "fleet" && s.turnMs === 20_000, "salvo mode and timer");
  const { s: d } = start({ grid: 99, salvo: "lots", turn: -1 });
  check(d.n === 10 && d.mode === "fixed" && d.turnMs === 30_000, "bad settings fall back to defaults");

  // "1 per ship afloat" shrinks the salvo.
  const { t, s: f } = start({ salvo: "fleet" });
  placeBoth(f, t);
  const seat = f.turn;
  check(shotsFor(f, seat) === 5, "5 ships afloat: 5 shots");
  f.sunk[seat][0] = true;
  f.sunk[seat][1] = true;
  check(shotsFor(f, seat) === 3, "3 ships afloat: 3 shots");
  console.log("✓ settings honoured");
}

// ---------- sinking reports ----------
{
  const { t, s } = start();
  placeBoth(s, t);
  const seat = s.turn;
  // Skiff (len 2) sits at row 8, cols 0-1.
  check(act(s, t, s.seats[seat], { type: "fire", cells: [80, 81, 55] }) === true, "fire");
  check(s.last!.hits.join() === "true,true,false", "hits and miss");
  check(s.last!.sunk.length === 1 && s.last!.sunk[0].ship === 4 && s.last!.sunk[0].shot === 1, "skiff sunk on shot 2");
  const v = view(s, t, "spectator");
  check(v.ships[other(seat)].length === 1 && v.ships[other(seat)][0].i === 4, "sunk ship is public");
  check(v.boards[other(seat)][80] === "x" && v.boards[other(seat)][55] === "o", "board string");
  console.log("✓ hits, misses, sunk");
}

// ---------- timers and leaving ----------
{
  // Placement timeout: the draft is kept, the rest is random.
  const { t, s } = start();
  act(s, t, s.seats[0], {
    type: "place",
    ships: [{ r: 9, c: 5, d: 0 }, null, null, null, null],
    ready: false,
  });
  t.advance(PLACE_MS);
  tick(s, t);
  check(s.phase === "turn" && s.ready[0] && s.ready[1], "placement timeout starts the game");
  check(s.fleets[0][0]!.r === 9 && s.fleets[0][0]!.c === 5, "draft ship kept");
  check(fleetOk(s.fleets[0], 10) && fleetOk(s.fleets[1], 10), "random fleets valid");

  // Turn timeout fires the aimed cell plus random ones.
  const mover = s.seats[s.turn];
  act(s, t, mover, { type: "aim", cells: [42] });
  t.advance(s.turnMs);
  tick(s, t);
  check(
    s.phase === "resolve" && s.last!.auto && s.last!.cells.includes(42) && s.last!.cells.length === 3,
    "auto salvo",
  );
  finishReveal(s, t);
  check(s.phase === "turn", "next turn");

  // The mover disconnects: fired for after AWAY_MS.
  const away = s.seats[s.turn];
  t.ctx.players.find((p) => p.id === away)!.connected = false;
  game.playerLeft!(s, away, t.ctx);
  t.advance(AWAY_MS);
  tick(s, t);
  check(s.phase === "resolve" && s.last!.auto, "away mover auto-fired");
  // Still gone: forfeits after a minute; the game always ends.
  for (let i = 0; i < 400 && s.phase !== "over"; i++) {
    t.advance(500);
    tick(s, t);
  }
  check(s.phase === "over" && s.ending === "forfeit", "forfeit ends it");
  check(t.result!.winners.length === 1 && t.result!.winners[0] !== away, "the one who stayed wins");
  console.log("✓ timeouts, away auto-fire, forfeit");
}
{
  // Disconnect during placement: random fleet after AWAY_MS, the game starts.
  const { t, s } = start();
  act(s, t, s.seats[0], {
    type: "place",
    ships: rowFleet(s.lens),
    ready: true,
  });
  t.ctx.players[1].connected = false;
  tick(s, t); // syncPresence notices
  t.advance(AWAY_MS);
  tick(s, t);
  check(s.phase === "turn" && s.ready[1], "away player's fleet placed for them");
  // Both away: frozen, then abandoned.
  t.ctx.players[0].connected = false;
  tick(s, t);
  const seq = s.seq;
  t.advance(30_000);
  tick(s, t);
  check(s.seq === seq && s.phase === "turn", "frozen while both are away");
  t.advance(FORFEIT_MS);
  tick(s, t);
  check(s.phase === "over" && t.result && t.result.winners.length === 0, "abandoned");
  console.log("✓ placement while away, both-away freeze");
}
{
  // Only one player: ends straight away.
  const { t, s } = start({}, 1);
  tick(s, t);
  check(s.phase === "over" && t.result?.headline.includes("2 players"), "short game ends");
  console.log("✓ one player");
}

// ---------- bots ----------
{
  // Targeting: after a hit it shoots next to it.
  const n = 10;
  const board = new Array(100).fill(0);
  board[44] = 2;
  let r = 3;
  const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const picks = botTargets(board, n, [5, 4, 3, 3, 2], [], [false, false, false, false, false], 3, rnd);
  check(
    picks.every((p) => [34, 54, 43, 45, 24, 64, 42, 46].includes(p)),
    `targets around the hit: ${picks}`,
  );

  for (const seed of [1, 2, 3]) {
    const { t, s } = start({}, 2, 2, seed);
    let steps = 0;
    while (s.phase !== "over" && steps < 20_000) {
      t.advance(200);
      for (const id of s.seats) {
        const a = game.bot!(s, id, t.ctx);
        if (a) check(game.action(s, id, a, t.ctx) !== undefined, "bot action");
      }
      tick(s, t);
      steps++;
      check(!s.last?.auto, "bots never time out");
    }
    check(s.phase === "over" && s.ending === "sunk", `bots finish a game (seed ${seed})`);
    const salvos = s.salvos[0] + s.salvos[1];
    console.log(
      `  bots: ${salvos} salvos, ${Math.round((steps * 200) / 1000)}s of game time, winner ${t.result!.headline}`,
    );
  }

  // Bot vs random shooter: the bot should win clearly.
  let botWins = 0;
  for (let g = 0; g < 10; g++) {
    const { t, s } = start({}, 2, 1, 100 + g);
    const human = s.seats.find((id) => !id.startsWith("bot"))!;
    act(s, t, human, {
      type: "place",
      ships: randomFill([], s.lens, 10, t.ctx.random).map(({ r, c, d }) => ({
        r,
        c,
        d,
      })),
      ready: true,
    });
    let steps = 0;
    while (s.phase !== "over" && steps < 20_000) {
      t.advance(200);
      for (const id of s.seats) {
        if (id === human) {
          if (s.phase === "turn" && s.seats[s.turn] === human) {
            const open = [...Array(100).keys()].filter((c) => s.shots[other(s.turn)][c] === 0);
            const cells: number[] = [];
            while (cells.length < shotsFor(s, s.turn)) {
              const c = open.splice(Math.floor(t.ctx.random() * open.length), 1)[0];
              cells.push(c);
            }
            act(s, t, human, { type: "fire", cells });
          }
          continue;
        }
        const a = game.bot!(s, id, t.ctx);
        if (a) game.action(s, id, a, t.ctx);
      }
      tick(s, t);
      steps++;
    }
    if (t.result?.winners[0]?.startsWith("bot")) botWins++;
  }
  check(botWins >= 8, `bot beats random shooting (${botWins}/10)`);
  console.log(`✓ bots finish games; bot beat random ${botWins}/10`);
}

// Bots in an 8x8 "fleet" game too.
{
  const { t, s } = start({ grid: 8, salvo: "fleet" }, 2, 2, 9);
  let steps = 0;
  while (s.phase !== "over" && steps < 20_000) {
    t.advance(200);
    for (const id of s.seats) {
      const a = game.bot!(s, id, t.ctx);
      if (a) game.action(s, id, a, t.ctx);
    }
    tick(s, t);
    steps++;
  }
  check(s.phase === "over", "8x8 bot game finishes");
  console.log("✓ 8x8 fleet-mode bot game");
}

const unused: Ship | null = null;
void unused;
assert(true);
console.log("✓ salvo: all tests passed");

import { assert, makeTestCtx } from "../../shared/testing";
import game, { SOLO_GRACE_MS, bookFor, type GarbleEvent, type GarbleState, type GarbleView } from "./server";
import { PROMPTS } from "./data";
import {
  BOOK_END_MS,
  DESCRIBE_MS,
  DRAW_MS,
  INK_POINTS,
  MAX_TEXT,
  NEXT_GUARD_MS,
  PAGE_DRAW_MS,
  PAGE_TEXT_MS,
  WRITE_MS,
  cleanText,
  stepKind,
} from "./shared";

type T = ReturnType<typeof makeTestCtx>;

/** Count ctx.end calls (makeTestCtx only keeps the first result). */
function countEnds(t: T) {
  let n = 0;
  const end = t.ctx.end;
  t.ctx.end = (r) => {
    n += 1;
    end(r);
  };
  return () => n;
}

const view = (s: GarbleState, id: string, t: T) => JSON.parse(JSON.stringify(game.view(s, id, t.ctx))) as GarbleView;
const act = (s: GarbleState, id: string, a: unknown, t: T) => game.action(s, id, a as never, t.ctx);
const tick = (s: GarbleState, t: T) => game.tick!(s, t.ctx);
// Read through functions: TypeScript would otherwise keep narrowing these across actions.
const stepOf = (s: GarbleState) => s.step;
const phaseOf = (s: GarbleState) => s.phase;
const setConn = (t: T, id: string, on: boolean) => {
  t.ctx.players.find((p) => p.id === id)!.connected = on;
};

/** A stroke action with `n` points starting at (x, y). */
function stroke(id: string, n: number, x = 100, y = 100, end = true) {
  const pts: number[] = [];
  for (let i = 0; i < n; i++) pts.push(Math.min(1000, x + (i % 700)), Math.min(750, y + Math.floor(i / 700)));
  return { type: "stroke", id, color: "#1c1c1e", size: 9, pts, ...(end ? { end: true } : {}) };
}

/** Play a whole step for everyone: write `text(i)` or draw a small stroke, then Done. */
function playStep(s: GarbleState, t: T, text: (i: number) => string) {
  const kind = stepKind(s.step);
  s.players.forEach((id, i) => {
    if (kind === "draw") {
      act(s, id, stroke(`s${s.step}x${i}`, 20, 10 + i, 10), t);
      act(s, id, { type: "done" }, t);
    } else {
      act(s, id, { type: "done", text: text(i) }, t);
    }
  });
}

/** Tick through the reveal until the game ends. */
function runReveal(s: GarbleState, t: T, each?: () => void) {
  let guard = 0;
  while (phaseOf(s) === "reveal" && guard++ < 500) {
    each?.();
    t.advance(BOOK_END_MS + 10);
    tick(s, t);
  }
}

// ---------- step order and passing ----------
{
  assert(stepKind(0) === "write" && stepKind(1) === "draw" && stepKind(2) === "describe" && stepKind(3) === "draw", "kinds alternate");
  // A book never visits the same player twice, and every player holds exactly one book per step.
  for (const n of [3, 5, 8, 12]) {
    const steps = Math.min(n, 8);
    for (let b = 0; b < n; b++) {
      const holders = new Set<number>();
      for (let step = 0; step < steps; step++) {
        const holder = (b + step) % n;
        assert(bookFor(n, holder, step) === b, "bookFor inverts the holder mapping");
        holders.add(holder);
      }
      assert(holders.size === steps, `book ${b} visits ${steps} different players (n=${n})`);
    }
    for (let step = 0; step < steps; step++) {
      const books = new Set(Array.from({ length: n }, (_, i) => bookFor(n, i, step)));
      assert(books.size === n, "one book per player per step");
    }
  }
  assert(PROMPTS.length >= 150, "at least 150 prompts");
  assert(new Set(PROMPTS).size === PROMPTS.length, "prompts are unique");
  assert(PROMPTS.every((p) => cleanText(p) === p && p.length <= MAX_TEXT), "prompts are clean and short");
}

// ---------- a full 3-player game ----------
{
  const t = makeTestCtx(3);
  const ends = countEnds(t);
  const s = game.setup(t.ctx);
  const [a, b, c] = t.ids;
  assert(s.steps === 3 && phaseOf(s) === "play" && stepOf(s) === 0, "3 players: 3 steps, writing first");
  assert(s.endsAt - t.ctx.now() === WRITE_MS, "write timer");

  playStep(s, t, (i) => `prompt number ${i}`);
  assert(stepOf(s) === 1 && stepKind(s.step) === "draw", "everyone done: drawing starts");
  assert(s.endsAt - t.ctx.now() === DRAW_MS, "draw timer");
  // Player a now holds book (0 - 1) mod 3 = 2 (c's book) and sees only its first page.
  const va = view(s, a, t);
  assert(va.hold && va.hold.book === 2 && va.hold.prev?.text === "prompt number 2", "drawer sees the previous page");

  playStep(s, t, () => "");
  assert(stepOf(s) === 2 && stepKind(s.step) === "describe", "describing starts");
  assert(s.endsAt - t.ctx.now() === DESCRIBE_MS, "describe timer");
  const vb = view(s, b, t);
  assert(vb.hold?.prev?.kind === "draw" && (vb.hold.prev.strokes?.length ?? 0) === 1, "describer gets the drawing");

  playStep(s, t, (i) => `a guess ${i}`);
  assert(phaseOf(s) === "reveal" && s.rb === 0 && s.rp === 0, "reveal starts at book 0, page 0");
  assert(s.endsAt - t.ctx.now() === PAGE_TEXT_MS, "text pages stay up 4s");
  assert(s.books.every((bk) => bk.pages.length === 3 && bk.pages.every((p) => !p.blank)), "every book has 3 filled pages");

  // Book 0 page 0 is a's prompt: b and c react, a can't react to their own page.
  assert(act(s, a, { type: "react", e: 0 }, t) === false && s.books[0].pages[0].react[0].length === 0, "no reacting to your own page");
  assert(act(s, b, { type: "react", e: 0 }, t) === false, "react returns false");
  assert(Number(s.books[0].pages[0].react[0].length) === 1, "reaction recorded");
  act(s, b, { type: "react", e: 0 }, t);
  assert(Number(s.books[0].pages[0].react[0].length) === 1, "once per emoji per page");
  act(s, b, { type: "react", e: 3 }, t);
  act(s, c, { type: "react", e: 0 }, t);
  const ev = t.events.filter((e) => (e.event as GarbleEvent).k === "react");
  assert(ev.length === 3 && ev.every((e) => !e.to), "reactions float up for everyone");
  // Hostile reactions.
  for (const bad of [{ type: "react" }, { type: "react", e: 4 }, { type: "react", e: -1 }, { type: "react", e: 1.5 }, { type: "react", e: "0" }])
    assert(act(s, c, bad, t) === false, `rejects ${JSON.stringify(bad)}`);
  assert(view(s, a, t).reveal!.react[0].length === 2, "the view carries reactors for the page on stage");

  // Next: only the book's author, and not instantly.
  assert(act(s, b, { type: "next" }, t) === false && s.rp === 0, "only the author skips");
  assert(act(s, a, { type: "next" }, t) === false && s.rp === 0, "not before the guard");
  t.advance(NEXT_GUARD_MS);
  assert(act(s, a, { type: "next" }, t) === true && Number(s.rp) === 1, "author skips ahead");
  assert(s.endsAt - t.ctx.now() === PAGE_DRAW_MS, "drawings stay up 6s");
  // Page 1 of book 0 was drawn by b (players[(0 + 1) % 3]).
  assert(s.books[0].pages[1].by === b, "page 1 by the next player");
  act(s, a, { type: "react", e: 1 }, t);
  act(s, c, { type: "react", e: 1 }, t);

  // The timer advances when the author is idle; then the closing beat; then book 1.
  t.advance(PAGE_DRAW_MS);
  tick(s, t);
  assert(Number(s.rp) === 2, "timer advances the page");
  t.advance(PAGE_TEXT_MS);
  tick(s, t);
  assert(Number(s.rp) === 3 && view(s, a, t).reveal!.current === null, "closing beat has no page on stage");
  assert(act(s, b, { type: "react", e: 0 }, t) === false, "no reactions during the closing beat");
  t.advance(BOOK_END_MS);
  tick(s, t);
  assert(Number(s.rb) === 1 && Number(s.rp) === 0, "next book");

  runReveal(s, t);
  assert(phaseOf(s) === "final", "final after the last book");
  assert(t.result, "game ended");
  assert(ends() === 1, "ctx.end exactly once");
  // a: 0 received; b: 2 (page 1 drawing: 🔥 x2); wait, b's drawing got a's 🔥 and c's 🔥 => 2. a's prompt got 3.
  assert(t.result.scores![a] === 3 && t.result.scores![b] === 2 && t.result.scores![c] === 0, "scores = reactions received");
  assert(t.result.winners.length === 1 && t.result.winners[0] === a, "most reactions wins");
  assert(t.result.headline.includes("Player0") && t.result.headline.includes("3 reactions"), "headline names the winner");
  const vf = view(s, c, t);
  assert(vf.final && vf.final.books.length === 3, "final view has the books");
  const json = JSON.stringify(vf);
  assert(!json.includes("pts") && !json.includes("strokes"), "final view carries no stroke data");
  const laugh = vf.final.badges.find((x) => x.e === 0);
  assert(laugh && laugh.ids[0] === a && laugh.n === 2, "most 😂 badge");
  assert(vf.final.badges.find((x) => x.e === 1)?.ids[0] === b, "most 🔥 badge");

  // Book browser: request + emit to the requester only; spectators too.
  const before = t.events.length;
  assert(act(s, b, { type: "book", b: 0 }, t) === false, "book request returns false");
  const got = t.events.slice(before);
  assert(got.length === 1 && got[0].to === b, "book goes to the requester only");
  const bookEv = got[0].event as Extract<GarbleEvent, { k: "book" }>;
  assert(bookEv.b === 0 && bookEv.pages.length === 1 && bookEv.pages[0].p === 1, "book 0 has one drawing (page 1)");
  assert(act(s, b, { type: "book", b: 1 }, t) === false && t.events.length === before + 1, "book requests are rate-limited");
  t.advance(1000);
  assert(game.spectatorAction!(s, "watcher", { type: "book", b: 2 }, t.ctx) === false, "spectator request returns false");
  assert(t.events[t.events.length - 1].to === "watcher", "spectator gets their book");
  for (const bad of [null, "book", [], { type: "book" }, { type: "book", b: 3 }, { type: "book", b: -1 }, { type: "book", b: 0.5 }, { type: "next" }]) {
    t.advance(1000);
    const n = t.events.length;
    assert(game.spectatorAction!(s, "watcher", bad, t.ctx) === false && t.events.length === n, `spectator junk ignored: ${JSON.stringify(bad)}`);
  }

  // Nothing changes after the end.
  assert(act(s, a, { type: "react", e: 0 }, t) === false, "no actions after the end");
  t.advance(60_000);
  assert(!tick(s, t), "no ticks after the end");
  assert(ends() === 1, "still ended once");
}

// ---------- deadlines, autosave and blank pages ----------
{
  const t = makeTestCtx(4, 7);
  const s = game.setup(t.ctx);
  const [a, b, c, d] = t.ids;
  act(s, a, { type: "write", text: "  a   draft\u0000 that\tautosaves  " }, t);
  act(s, b, { type: "write", text: "x".repeat(500) }, t);
  // c and d write nothing.
  assert(view(s, a, t).hold!.draft === "a draft that autosaves", "draft is sanitised and kept for refreshes");
  t.advance(WRITE_MS - 1);
  assert(!tick(s, t) && stepOf(s) === 0, "not before the deadline");
  t.advance(1);
  assert(tick(s, t) && stepOf(s) === 1, "deadline ends the step");
  const p0 = s.books.map((bk) => bk.pages[0]);
  assert(p0[0].text === "a draft that autosaves" && !p0[0].auto, "autosaved draft submitted");
  assert(p0[1].text.length === MAX_TEXT, "text capped at 80");
  assert(p0[2].auto && p0[2].text.length > 0 && !p0[2].blank, "blank prompt replaced by the game's");
  assert(p0[3].auto && p0[3].text !== p0[2].text, "auto prompts don't repeat");

  // Draw step: only a draws, nobody presses done; at the deadline whatever was drawn is the page.
  act(s, a, stroke("q1", 30, 50, 50, false), t);
  act(s, a, stroke("q1", 10, 300, 300), t); // append + end
  act(s, b, stroke("r1", 5), t);
  act(s, b, { type: "undo" }, t); // b's page ends up blank
  t.advance(DRAW_MS);
  tick(s, t);
  assert(stepOf(s) === 2, "draw deadline");
  const p1 = s.books.map((bk) => bk.pages[1]);
  const aBook = bookFor(4, 0, 1);
  const bBook = bookFor(4, 1, 1);
  assert(!p1[aBook].blank && p1[aBook].strokes[0].pts.length === 80, "a's drawing autosaved with appended points");
  assert(p1[bBook].blank && p1[bBook].strokes.length === 0, "undone drawing is blank");
  // The next holder of b's book sees a blank page.
  const next = s.players[(bBook + 2) % 4];
  const vn = view(s, next, t);
  assert(vn.hold!.prev?.blank === true && vn.hold!.prev.kind === "draw", "blank page passes along as blank");

  // Describe: c writes then edits, d leaves early.
  act(s, c, { type: "done", text: "first try" }, t);
  assert(act(s, c, { type: "write", text: "nope" }, t) === false, "no writing while done");
  assert(act(s, c, { type: "edit" }, t) === true && !s.done.includes(c), "edit reopens the page");
  act(s, c, { type: "write", text: "second try" }, t);
  setConn(t, d, false);
  game.playerLeft!(s, d, t.ctx);
  act(s, a, { type: "done", text: "aa" }, t);
  act(s, b, { type: "done", text: "bb" }, t);
  assert(stepOf(s) === 2, "c still writing");
  act(s, c, { type: "done" }, t);
  assert(stepOf(s) === 3, "every connected holder done: early advance without d");
  assert(s.books[bookFor(4, 2, 2)].pages[2].text === "second try", "edited text kept");
  assert(s.books[bookFor(4, 3, 2)].pages[2].blank, "d's page auto-submitted blank");
  // d comes back and plays the last step.
  setConn(t, d, true);
  game.playerReturned!(s, d, t.ctx);
  assert(view(s, d, t).hold !== null, "returning player holds a book again");
  for (const id of t.ids) act(s, id, { type: "done" }, t);
  assert(phaseOf(s) === "reveal", "4 players: 4 steps then reveal");
  // Blank and auto pages can't be reacted to.
  s.rb = 2;
  s.rp = 0;
  assert(act(s, a, { type: "react", e: 0 }, t) === false, "no reactions to the game's prompt");
}

// ---------- hostile actions ----------
{
  const t = makeTestCtx(3);
  const s = game.setup(t.ctx);
  const [a] = t.ids;
  const hostile: unknown[] = [
    null,
    undefined,
    42,
    "done",
    [],
    [{ type: "done" }],
    {},
    { type: null },
    { type: "__proto__" },
    { type: "constructor" },
    { type: "write" },
    { type: "write", text: 5 },
    { type: "write", text: ["array"] },
    { type: "done", text: 7 },
    { type: "done", text: { a: 1 } },
    { type: "stroke", id: "s", color: "#1c1c1e", size: 9, pts: [1, 2] }, // not a draw step
    { type: "react", e: 0 },
    { type: "next" },
    { type: "book", b: 0 },
    { type: "mine" },
    { type: "edit" },
  ];
  for (const h of hostile) assert(act(s, a, h, t) === false, `rejects ${JSON.stringify(h)}`);
  assert(s.done.length === 0 && stepOf(s) === 0, "nothing changed");
  assert(act(s, "stranger", { type: "done" }, t) === false, "non-player rejected");
  assert(game.spectatorAction!(s, "stranger", { type: "book", b: 0 }, t.ctx) === false, "no books during play");

  // Write step to a draw step.
  for (const id of t.ids) act(s, id, { type: "done", text: "hello" }, t);
  assert(stepOf(s) === 1, "in draw step");
  const strokes: unknown[] = [
    { type: "stroke", id: "s", color: "#000", size: 9, pts: [1, 2] },
    { type: "stroke", id: "s", color: "#1c1c1e", size: 1e9, pts: [1, 2] },
    { type: "stroke", id: "s", color: "#1c1c1e", size: 9, pts: [1, 2, "x", 4] },
    { type: "stroke", id: "s", color: "#1c1c1e", size: 9, pts: [1, 2, 3] },
    { type: "stroke", id: "s", color: "#1c1c1e", size: 9, pts: [1001, 2] },
    { type: "stroke", id: "s", color: "#1c1c1e", size: 9, pts: [1, 751] },
    { type: "stroke", id: "s", color: "#1c1c1e", size: 9, pts: [-1, 2] },
    { type: "stroke", id: "s", color: "#1c1c1e", size: 9, pts: [1.5, 2] },
    { type: "stroke", id: "s", color: "#1c1c1e", size: 9, pts: new Array(5000).fill(1) },
    { type: "stroke", id: "y".repeat(400), color: "#1c1c1e", size: 9, pts: [1, 2] },
    { type: "stroke", id: "bad id!", color: "#1c1c1e", size: 9, pts: [1, 2] },
    { type: "stroke", id: "s", color: "#1c1c1e", size: 9, pts: [] },
    { type: "stroke", id: "s", color: "#1c1c1e", size: 9, pts: [1, 2], end: "yes" },
    { type: "stroke", id: "s", color: "#1c1c1e", size: 9, pts: "1,2" },
    { type: "write", text: "not a text step" },
    { type: "done", text: "not a text step" },
    { type: "inspire" },
  ];
  for (const h of strokes) assert(act(s, a, h, t) === false, `rejects ${JSON.stringify(h).slice(0, 80)}`);
  const page = s.books[bookFor(3, 0, 1)].pages[1];
  assert(page.strokes.length === 0 && page.text === "", "nothing landed on the page");
  // Undone strokes can't be revived.
  act(s, a, stroke("z", 3, 1, 1, false), t);
  act(s, a, { type: "undo" }, t);
  act(s, a, stroke("z", 3), t);
  assert(page.strokes.length === 0, "undone stroke id stays dead");
  // Late strokes after the deadline are refused.
  t.advance(DRAW_MS);
  assert(act(s, a, stroke("late", 3), t) === false && page.strokes.length === 0, "late stroke refused");
}

// ---------- ink cap and undo staying in step ----------
{
  const t = makeTestCtx(3);
  const s = game.setup(t.ctx);
  const [a] = t.ids;
  for (const id of t.ids) act(s, id, { type: "done", text: "draw me" }, t);
  const page = s.books[bookFor(3, 0, 1)].pages[1];
  // Fill to the cap in batches of 300 points (600 numbers).
  let i = 0;
  while (page.points < INK_POINTS && i < 40) act(s, a, stroke(`k${i++}`, 300), t);
  assert(page.points === INK_POINTS, "ink capped at INK_POINTS points");
  const nums = page.strokes.reduce((n, st) => n + st.pts.length, 0);
  assert(nums === INK_POINTS * 2, "about 8,000 numbers per drawing");
  // A stroke started with no ink is kept empty, so the artist's undo pops the same stroke.
  const count = page.strokes.length;
  act(s, a, stroke("empty", 10), t);
  assert(page.strokes.length === count + 1 && page.strokes[count].pts.length === 0, "empty stroke recorded at the cap");
  act(s, a, { type: "undo" }, t);
  assert(page.strokes.length === count && page.points === INK_POINTS, "undo pops the empty stroke");
  act(s, a, { type: "undo" }, t);
  assert(page.points === INK_POINTS - 100, "undo frees the last stroke's ink");
  act(s, a, { type: "clear" }, t);
  assert(Number(page.points) === 0 && page.strokes.length === 0, "clear empties the page");

  // A refresh mid-drawing: "mine" sends the strokes back to the artist only.
  act(s, a, stroke("m1", 12), t);
  const n = t.events.length;
  assert(act(s, a, { type: "mine" }, t) === false, "mine returns false");
  const mine = t.events[n];
  assert(mine && mine.to === a && (mine.event as Extract<GarbleEvent, { k: "mine" }>).strokes[0].pts.length === 24, "mine echoes the drawing");
  assert(act(s, a, { type: "mine" }, t) === false && t.events.length === n + 1, "mine is rate-limited");
  assert(view(s, a, t).hold!.ink === 1, "the view tells a refreshed artist they have ink down");
  // Stroke actions never re-broadcast or emit.
  const e0 = t.events.length;
  assert(act(s, a, stroke("m2", 5), t) === false && t.events.length === e0, "strokes are silent");
}

// ---------- inspire ----------
{
  const t = makeTestCtx(3);
  const s = game.setup(t.ctx);
  const [a, b] = t.ids;
  assert(act(s, a, { type: "inspire" }, t) === false, "inspire returns false");
  const ev = t.events[t.events.length - 1];
  const text = (ev.event as Extract<GarbleEvent, { k: "inspire" }>).text;
  assert(ev.to === a && PROMPTS.includes(text), "inspire sends a prompt to the asker");
  assert(view(s, a, t).hold!.draft === text, "and saves it as the draft");
  const n = t.events.length;
  act(s, a, { type: "inspire" }, t);
  assert(t.events.length === n, "inspire is rate-limited");
  t.advance(300);
  act(s, b, { type: "inspire" }, t);
  const other = (t.events[t.events.length - 1].event as Extract<GarbleEvent, { k: "inspire" }>).text;
  assert(other !== text, "no repeated prompts");
}

// ---------- secrecy ----------
{
  const t = makeTestCtx(5, 3);
  const s = game.setup(t.ctx);
  const secret = (i: number) => `secret-${i}-zz`;
  t.ids.forEach((id, i) => act(s, id, { type: "write", text: secret(i) }, t));
  // During writing, nobody sees anyone else's prompt.
  t.ids.forEach((id, i) => {
    const json = JSON.stringify(game.view(s, id, t.ctx));
    for (let j = 0; j < 5; j++) if (j !== i) assert(!json.includes(secret(j)), `player ${i} can't see prompt ${j}`);
  });
  assert(!JSON.stringify(game.view(s, "watcher", t.ctx)).includes("secret-"), "spectator sees no prompts");
  for (const id of t.ids) act(s, id, { type: "done" }, t);
  // Step 1: each player sees exactly the prompt of the book they hold.
  t.ids.forEach((id, i) => {
    const json = JSON.stringify(game.view(s, id, t.ctx));
    const held = bookFor(5, i, 1);
    for (let j = 0; j < 5; j++) assert(json.includes(secret(j)) === (j === held), `player ${i} sees only prompt ${held}`);
  });
  // Drawings: a distinctive point pair per artist.
  t.ids.forEach((id, i) => act(s, id, { type: "stroke", id: `d${i}`, color: "#1c1c1e", size: 9, pts: [911, 600 + i], end: true }, t));
  t.ids.forEach((id, i) => {
    const json = JSON.stringify(game.view(s, id, t.ctx));
    for (let j = 0; j < 5; j++) assert(!json.includes(`911,${600 + j}`), "nobody sees drawings while they're drawn");
    assert(json.includes(secret(bookFor(5, i, 1))), "drawer still sees their prompt");
  });
  for (const id of t.ids) act(s, id, { type: "done" }, t);
  // Step 2: describers see only the drawing in their book, not its prompt or other drawings.
  t.ids.forEach((id, i) => {
    const json = JSON.stringify(game.view(s, id, t.ctx));
    const held = bookFor(5, i, 2);
    const artist = (held + 1) % 5;
    for (let j = 0; j < 5; j++) {
      assert(json.includes(`911,${600 + j}`) === (j === artist), `describer ${i} sees only drawing ${artist}`);
      assert(!json.includes(secret(j)), "describer sees no prompts");
    }
  });
  const spec = JSON.stringify(game.view(s, "watcher", t.ctx));
  assert(!spec.includes("911,") && !spec.includes("secret-"), "spectator sees nothing during play");
  // Into the reveal: nothing beyond the page on stage.
  for (let step = s.step; step < s.steps; step++) {
    t.ids.forEach((id, i) => act(s, id, { type: "done", ...(stepKind(s.step) === "draw" ? {} : { text: `p${step}-${i}-later` }) }, t));
  }
  assert(phaseOf(s) === "reveal", "reveal");
  const v0 = JSON.stringify(game.view(s, "watcher", t.ctx));
  assert(v0.includes(secret(0)), "book 0 page 0 on stage");
  assert(!v0.includes("911,") && !v0.includes("later") && !v0.includes(secret(1)), "no later pages or other books");
  // Revealed-only book requests during the reveal.
  const n = t.events.length;
  game.spectatorAction!(s, "watcher", { type: "book", b: 1 }, t.ctx);
  assert(t.events.length === n, "can't fetch a book that hasn't been revealed");
  game.spectatorAction!(s, "watcher", { type: "book", b: 0 }, t.ctx);
  const e = t.events[t.events.length - 1].event as Extract<GarbleEvent, { k: "book" }>;
  assert(e.k === "book" && e.pages.length === 0, "book 0 so far has no drawings revealed");
  t.advance(PAGE_TEXT_MS);
  tick(s, t);
  const v1 = JSON.stringify(game.view(s, "watcher", t.ctx));
  // Book 0 was held by player 1 at step 1, so its drawing is player 1's.
  assert(v1.includes("911,601") && !v1.includes("later"), "page 1 drawing on stage, nothing after it");
}

// ---------- disconnects never stall ----------
{
  // Everyone but one leaves mid-step: after a grace period the game skips to the reveal.
  const t = makeTestCtx(3);
  const ends = countEnds(t);
  const s = game.setup(t.ctx);
  const [a, b, c] = t.ids;
  act(s, a, { type: "write", text: "only me" }, t);
  setConn(t, b, false);
  game.playerLeft!(s, b, t.ctx);
  setConn(t, c, false);
  game.playerLeft!(s, c, t.ctx);
  tick(s, t);
  assert(s.soloSince !== null && view(s, a, t).soloEndsAt !== null, "solo countdown shown");
  // c comes back: countdown cancelled.
  setConn(t, c, true);
  game.playerReturned!(s, c, t.ctx);
  assert(s.soloSince === null, "solo countdown cancelled on return");
  setConn(t, c, false);
  game.playerLeft!(s, c, t.ctx);
  t.advance(SOLO_GRACE_MS);
  tick(s, t);
  assert(phaseOf(s) === "reveal" && s.endedEarly, "skipped to the reveal");
  assert(s.books.every((bk) => bk.pages.length === 1), "books keep the pages made so far");
  assert(s.books[0].pages[0].text === "only me" && s.books[1].pages[0].auto, "drafts and auto prompts");
  runReveal(s, t);
  assert(phaseOf(s) === "final" && ends() === 1, "reveal runs on timers to the end");
  assert(t.result!.winners.length === 0 && t.result!.headline.includes("ended early"), "no reactions, no winners");
}
{
  // A disconnected player in every phase: steps and the reveal keep moving.
  const t = makeTestCtx(4, 11);
  const s = game.setup(t.ctx);
  const [a, , , d] = t.ids;
  setConn(t, d, false);
  game.playerLeft!(s, d, t.ctx);
  let guard = 0;
  while (phaseOf(s) === "play" && guard++ < 10) {
    const step = s.step;
    for (const id of t.ids.slice(0, 3)) act(s, id, { type: "done", ...(stepKind(step) === "draw" ? {} : { text: "ok" }) }, t);
    assert(stepOf(s) !== step || phaseOf(s) !== "play", "connected players finishing ends the step");
  }
  assert(phaseOf(s) === "reveal" && s.books.every((bk) => bk.pages.length === 4), "4 steps done");
  // d's pages are blank (except their auto prompt).
  assert(s.books[3].pages[0].auto, "d's prompt filled by the game");
  // The author of book 0 leaves: the reveal advances on its own.
  setConn(t, a, false);
  game.playerLeft!(s, a, t.ctx);
  const rp = s.rp;
  t.advance(PAGE_DRAW_MS);
  tick(s, t);
  assert(s.rp === rp + 1, "reveal advances without the author");
  // Everyone disconnected during play does not end steps instantly (timers do).
  const t2 = makeTestCtx(3);
  const s2 = game.setup(t2.ctx);
  for (const id of t2.ids) {
    setConn(t2, id, false);
    game.playerLeft!(s2, id, t2.ctx);
  }
  assert(stepOf(s2) === 0 && phaseOf(s2) === "play", "nobody connected: no instant advance");
  t2.advance(WRITE_MS);
  tick(s2, t2);
  assert(stepOf(s2) === 1 || phaseOf(s2) === "reveal", "deadline still advances");
  runReveal(s, t);
  assert(phaseOf(s) === "final", "finishes");
}

// ---------- max players and ties ----------
{
  const t = makeTestCtx(12, 5);
  const s = game.setup(t.ctx);
  assert(s.steps === 8 && s.books.length === 12, "12 players: 12 books of 8 pages");
  for (let step = 0; step < 8; step++) playStep(s, t, (i) => `p${step}-${i}`);
  assert(phaseOf(s) === "reveal" && s.books.every((bk) => bk.pages.length === 8), "8 pages each");
  for (const bk of s.books) assert(new Set(bk.pages.map((p) => p.by)).size === 8, "no player twice in a book");
  // Tie: two authors get one reaction each.
  const [, b] = t.ids;
  act(s, b, { type: "react", e: 3 }, t); // book 0 page 0 by p0
  t.advance(NEXT_GUARD_MS);
  act(s, t.ids[0], { type: "next" }, t); // page 1 by p1
  act(s, t.ids[0], { type: "react", e: 3 }, t);
  // The reveal view stays small: one drawing at most.
  const size = JSON.stringify(game.view(s, b, t.ctx)).length;
  assert(size < 40_000, `reveal view is small (${size} bytes)`);
  runReveal(s, t);
  assert(t.result && t.result.winners.length === 2, "tie: both win");
  assert(t.result.headline.includes(" tie "), "tie headline");
  const love = s.final!.badges.find((x) => x.e === 3);
  assert(love && love.ids.length === 2 && love.n === 1, "tied badge");
  assert(JSON.stringify(game.view(s, b, t.ctx)).length < 30_000, "final view stays small with 12 books");
}

console.log("✓ garble tests passed");

import { assert, makeTestCtx } from "../../shared/testing";
import { topScorers } from "../../shared/game";
import game, {
  CHOOSE_MS,
  DRAW_MS,
  FEED_MAX,
  GUESS_GAP_MS,
  MAX_POINTS_IN,
  MAX_STROKES,
  REVEAL_MS,
  SOLO_GRACE_MS,
  SYNC_GAP_MS,
  cleanText,
  compact,
  maskOf,
  oneEdit,
  type SketchAction,
  type SketchState,
  type SketchView,
} from "./server";
import { WORDS } from "./data";
import { BG, H, MAX_BATCH, MAX_POINTS, PALETTE, SIZES, W, type SketchEvent } from "./shared";
import { StrokeStore } from "./canvas";

// ---------- harness ----------

// `assert` narrows types, which misleads TypeScript once state changes behind its back.
const ok: (cond: unknown, msg?: string) => void = assert;

const NUL = String.fromCharCode(0);
const ZWSP = String.fromCharCode(0x200b);
const TAB = String.fromCharCode(9);
const NL = String.fromCharCode(10);
const BEL = String.fromCharCode(7);

function start(n: number, seed = 7) {
  const t = makeTestCtx(n, seed);
  let ends = 0;
  const end = t.ctx.end;
  t.ctx.end = (r) => {
    ends += 1;
    end(r);
  };
  const s: SketchState = game.setup(t.ctx);
  const g = {
    t,
    s,
    ends: () => ends,
    act: (id: string, a: unknown) => game.action(s, id, a as SketchAction, t.ctx),
    tick: () => game.tick!(s, t.ctx),
    view: (id: string) => game.view(s, id, t.ctx) as SketchView,
    /** Move the fake clock and run one tick, like the room does. */
    advance: (ms: number) => {
      t.advance(ms);
      return game.tick!(s, t.ctx);
    },
    leave: (id: string) => {
      t.ctx.player(id)!.connected = false;
      game.playerLeft!(s, id, t.ctx);
    },
    back: (id: string) => {
      t.ctx.player(id)!.connected = true;
      game.playerReturned!(s, id, t.ctx);
    },
    guessers: () => s.players.filter((id) => id !== s.artist),
    events: (k: string) => t.events.filter((e) => (e.event as { k?: string }).k === k),
  };
  return g;
}
type G = ReturnType<typeof start>;

/** Make the artist's offers predictable, then pick the first one. */
function choose(g: G, word?: string) {
  if (word) g.s.options = [word, "spare one", "spare two"].map((w) => ({ word: w, level: "easy" as const }));
  ok(g.s.phase === "choose", `expected choose, got ${g.s.phase}`);
  ok(g.act(g.s.artist, { type: "choose", index: 0 }) === true, "artist can choose");
  ok(g.s.phase === "draw", "choosing starts the drawing");
}

/** Does the serialised value mention `word` as a whole word? */
function mentions(v: unknown, word: string) {
  return new RegExp(`(^|[^a-z])${word}([^a-z]|$)`).test(JSON.stringify(v).toLowerCase());
}

const stroke = (over: Record<string, unknown> = {}) => ({
  type: "stroke",
  id: "s1",
  color: PALETTE[0].hex,
  size: SIZES[1],
  pts: [10, 20, 30, 40],
  ...over,
});

/** Run every remaining turn to completion, calling `duringDraw` once per drawing phase. */
function playOut(g: G, duringDraw?: (g: G) => void) {
  for (let guard = 0; g.s.phase !== "final" && guard < 500; guard++) {
    if (g.s.phase === "choose") {
      choose(g);
      duringDraw?.(g);
    } else if (g.s.phase === "draw") g.advance(DRAW_MS);
    else if (g.s.phase === "reveal") g.advance(REVEAL_MS);
  }
  ok(g.s.phase === "final", "game reaches final");
}

// ---------- helpers & data ----------
{
  ok(compact("  Ice-Cream!! ") === "icecream", "compact strips case, punctuation and spaces");
  ok(compact("Crème Brûlée") === "cremebrulee", "compact strips accents");
  ok(oneEdit("elephant", "elephamt") && oneEdit("elephant", "elepant") && oneEdit("elephant", "elephants"), "one edit");
  ok(!oneEdit("elephant", "elephant") && !oneEdit("elephant", "elefant") && !oneEdit("abc", "abcde"), "not one edit");
  ok(cleanText(["  a", NUL, "b ", TAB, NL, " c", ZWSP, " "].join(""), 40) === "ab c", "cleanText strips control/zero-width chars and collapses spaces");
  ok(cleanText("x".repeat(500), 40).length === 40, "cleanText caps length");
  ok(Array.from(cleanText("😀".repeat(50), 40)).length === 40, "cleanText caps by code point");
  ok(JSON.stringify(maskOf("ice-cream ok", [1])) === JSON.stringify([null, "c", null, "-", null, null, null, null, null, " ", null, null]), "mask keeps separators");

  const all = [...WORDS.easy, ...WORDS.medium, ...WORDS.hard];
  ok(all.length >= 250, `need >= 250 words, have ${all.length}`);
  for (const level of ["easy", "medium", "hard"] as const) ok(WORDS[level].length >= 60, `${level} has enough words`);
  ok(new Set(all).size === all.length, "no duplicate words");
  for (const w of all) {
    ok(/^[a-z]+([ -][a-z]+)*$/.test(w) && w.length <= 16, `bad word format: "${w}"`);
    ok(compact(w).length >= 3, `word too short: "${w}"`);
  }
}

// ---------- setup, turn order, laps ----------
{
  for (const [n, laps] of [[2, 2], [3, 2], [4, 1], [12, 1]] as const) {
    const g = start(n);
    ok(g.s.laps === laps, `${n} players -> ${laps} laps`);
    ok(g.s.order.length === n * laps, "one turn per player per lap");
    for (const id of g.t.ids) ok(g.s.order.filter((x) => x === id).length === laps, "everyone draws once per lap");
    ok(JSON.stringify(g.s.order.slice(0, n)) === JSON.stringify(g.s.order.slice(n * (laps - 1))), "same order every lap");
    ok(g.s.phase === "choose" && g.s.turn === 0 && g.s.artist === g.s.order[0], "starts with the first artist choosing");
    ok(g.s.endsAt === g.t.ctx.now() + CHOOSE_MS, "choose deadline");
    ok(JSON.stringify(g.s.options.map((o) => o.level)) === '["easy","medium","hard"]', "one word of each difficulty");
    for (const o of g.s.options) ok(WORDS[o.level].includes(o.word), "offered words come from their level");
    ok(g.s.soloSince === null, "not solo at start");
  }
  // Different seeds shuffle differently.
  const orders = new Set([1, 2, 3, 4, 5, 6].map((seed) => start(5, seed).s.order.join(",")));
  ok(orders.size > 1, "turn order is shuffled");
}

// ---------- choose phase ----------
{
  const g = start(4);
  const artist = g.s.artist;
  const other = g.guessers()[0];
  ok(g.act(other, { type: "choose", index: 0 }) === false, "only the artist chooses");
  for (const index of [3, -1, 1.5, "1", null, NaN, Infinity, undefined]) {
    ok(g.act(artist, { type: "choose", index }) === false, `bad index rejected: ${String(index)}`);
  }
  ok(g.act(artist, { type: "guess", text: "anything" }) === false, "no guessing while choosing");
  ok(g.act(artist, stroke()) === false, "no drawing while choosing");

  // Only the artist sees the offers.
  const words = g.s.options.map((o) => o.word);
  ok(JSON.stringify(g.view(artist).options) === JSON.stringify(g.s.options), "artist sees the offers");
  for (const id of [other, "spectator"]) {
    const v = g.view(id);
    ok(v.options === null && v.word === null && v.mask === null, "no offers or word for others");
    for (const w of words) ok(!mentions(v, w), `offer "${w}" leaked to ${id}`);
  }

  // Timing out takes the first offer.
  ok(!g.advance(CHOOSE_MS - 1), "nothing happens before the deadline");
  ok(g.s.phase === "choose", "still choosing");
  ok(g.advance(1) === true && g.s.phase === "draw", "deadline auto-picks");
  ok(g.s.word === words[0], "auto-pick takes the first word");
  ok(g.s.endsAt === g.t.ctx.now() + DRAW_MS && g.s.phaseMs === DRAW_MS, "draw deadline");
  const last = g.s.feed[g.s.feed.length - 1];
  ok(last.kind === "drawing" && last.by === artist, "feed announces the artist");
}

// Picking explicitly takes that offer.
{
  const g = start(3);
  const pick = g.s.options[2].word;
  ok(g.act(g.s.artist, { type: "choose", index: 2 }) === true && g.s.word === pick, "artist picks the third word");
}

// ---------- guessing, scoring, early end ----------
{
  const g = start(4);
  choose(g, "elephant");
  const artist = g.s.artist;
  const [a, b, c] = g.guessers();

  // Wrong guess: public.
  ok(g.act(a, { type: "guess", text: "  giant   mouse " }) === true, "wrong guess accepted");
  let item = g.s.feed[g.s.feed.length - 1];
  ok(item.kind === "guess" && item.by === a && item.text === "giant mouse", "wrong guess goes to the feed, cleaned");

  // Close guesses: private event, not in the feed.
  for (const text of ["elephamt", "Elepant", "elephants", "the elephant", "ele phant?!x"]) {
    g.t.advance(GUESS_GAP_MS);
    const feedLen = g.s.feed.length;
    const before = g.t.events.length;
    ok(g.act(b, { type: "guess", text }) === false, `close guess "${text}" returns false`);
    ok(g.s.feed.length === feedLen, "close guesses never reach the feed");
    const ev = g.t.events[before];
    ok(ev && ev.to === b && (ev.event as SketchEvent).k === "close", "close event goes only to the guesser");
  }
  ok(!g.s.guessed.includes(b), "close is not correct");

  // Rate limit.
  g.t.advance(GUESS_GAP_MS);
  ok(g.act(c, { type: "guess", text: "rhino" }) === true, "first guess ok");
  ok(g.act(c, { type: "guess", text: "hippo" }) === false, "guess spam is throttled");
  g.t.advance(GUESS_GAP_MS);
  ok(g.act(c, { type: "guess", text: "hippo" }) === true, "guessing works again after the gap");

  // The artist can't guess.
  ok(g.act(artist, { type: "guess", text: "elephant" }) === false, "artist can't guess");

  // Correct guesses: 20s, 40s and 60s into the 80s turn (clock started at choose).
  const t0 = g.s.endsAt - DRAW_MS;
  g.t.advance(t0 + 20_000 - g.t.ctx.now());
  ok(g.act(a, { type: "guess", text: " ELE-PHANT! " }) === true, "correct guess (normalised)");
  ok(g.s.gains[a] === 100 + 225 + 50, `first guesser gets 375, got ${g.s.gains[a]}`);
  ok(g.s.gains[artist] === 60, "artist +60 per guesser");
  item = g.s.feed[g.s.feed.length - 1];
  ok(item.kind === "correct" && item.by === a && !mentions(g.s.feed, "elephant"), "correct guess announced without the word");
  ok(g.act(a, { type: "guess", text: "elephant" }) === false, "can't guess twice");

  // Secrecy: the guesser now knows; the rest still don't.
  ok(g.view(a).word === "elephant" && g.view(a).guessed, "correct guesser sees the word");
  ok(g.view(artist).word === "elephant", "artist sees the word");
  for (const id of [b, c, "spectator"]) ok(!mentions(g.view(id), "elephant"), `word leaked to ${id}`);

  g.t.advance(t0 + 40_000 - g.t.ctx.now());
  g.tick(); // first hint lands at 50%
  ok(g.act(b, { type: "guess", text: "Éléphant" }) === true, "accents ignored");
  ok(g.s.gains[b] === 100 + 150 + 25, `second guesser gets 275, got ${g.s.gains[b]}`);
  g.t.advance(t0 + 60_000 - g.t.ctx.now());
  ok(g.act(c, { type: "guess", text: "elephant" }) === true, "third guesser");
  ok(g.s.gains[c] === 100 + 75, `third guesser gets 175, got ${g.s.gains[c]}`);
  ok(g.s.gains[artist] === 180 && g.s.scores[artist] === 180, "artist scored 3 x 60");
  ok(g.s.phase === "reveal" && g.s.reason === "all", "turn ends early when everyone guessed");
  ok(JSON.stringify(g.s.guessed) === JSON.stringify([a, b, c]), "guess order kept");
  const v = g.view("spectator");
  ok(v.word === "elephant" && v.reason === "all", "everyone sees the word at reveal");
  ok(g.s.history.length === 1 && g.s.history[0].word === "elephant" && g.s.history[0].guessers.length === 3, "turn recorded");
  ok(g.s.feed.some((f) => f.kind === "word" && f.text === "elephant"), "feed shows the word after the turn");
  ok(g.act(c, { type: "guess", text: "x" }) === false, "no guessing during reveal");
}

// A guess that lands after the buzzer (before the next tick reveals) doesn't score.
{
  const g = start(3);
  choose(g, "elephant");
  const [a] = g.guessers();
  g.t.advance(DRAW_MS + 100); // the deadline has passed but no tick has run yet
  ok(g.act(a, { type: "guess", text: "elephant" }) === false, "late correct guess rejected");
  ok((g.s.scores[a] ?? 0) === 0 && (g.s.scores[g.s.artist] ?? 0) === 0 && g.s.guessed.length === 0, "no points after time is up");
  ok(g.act(a, { type: "guess", text: "giraffe" }) === false && !g.s.feed.some((f) => f.kind === "guess"), "late wrong guess ignored too");
  g.tick();
  ok(g.s.phase === "reveal" && g.s.reason === "time", "the tick then reveals as a timeout");
}

// Short words: near misses are public; containing the answer stays private.
{
  const g = start(3);
  choose(g, "cat");
  const [a, b] = g.guessers();
  ok(g.act(a, { type: "guess", text: "car" }) === true, "near miss on a short word is a normal guess");
  ok(g.s.feed[g.s.feed.length - 1].kind === "guess", "and it's public");
  ok(g.act(b, { type: "guess", text: "cats" }) === false, "plural containing the answer is private");
  // Multi-word answers: spacing and hyphens don't matter.
  const h = start(3);
  choose(h, "ice cream");
  const [x, y] = h.guessers();
  ok(h.act(x, { type: "guess", text: "icecream" }) === true && h.s.guessed.includes(x), "ignores spaces");
  ok(h.act(y, { type: "guess", text: "ice creem" }) === false, "multi-word near miss is close");
  h.t.advance(GUESS_GAP_MS);
  ok(h.act(y, { type: "guess", text: "Ice-Cream" }) === true && h.s.phase === "reveal", "hyphen variant correct, turn ends");
}

// ---------- hints ----------
{
  const cases: [string, number][] = [["elephant", 2], ["hot dog", 2], ["cat", 1], ["pear", 1], ["jack-in-the-box", 2]];
  for (const [word, max] of cases) {
    const g = start(3);
    choose(g, word);
    const guesser = g.guessers()[0];
    const hidden = () => g.view(guesser).mask!.filter((m) => m === null).length;
    const letters = compact(word).length;
    ok(hidden() === letters, "all letters hidden at first");
    ok(!g.advance(DRAW_MS * 0.5 - 1), "no hint before 50%");
    g.advance(1);
    ok(g.s.revealed.length === 1 && hidden() === letters - 1, `${word}: hint at 50%`);
    g.advance(DRAW_MS * 0.25);
    ok(g.s.revealed.length === max && hidden() === letters - max, `${word}: ${max} hint(s) by 75%`);
    ok(g.s.revealed.length <= Math.floor(letters / 3), "never more than a third");
    const mask = g.view(guesser).mask!;
    for (let i = 0; i < word.length; i++) {
      if (word[i] === " " || word[i] === "-") ok(mask[i] === word[i], "separators visible");
      else ok(mask[i] === null || mask[i] === word[i], "revealed letters are correct");
    }
    ok(!mentions(g.view(guesser), word), "hints never reveal the whole word");
    // Time runs out.
    g.advance(DRAW_MS * 0.25);
    ok(g.s.phase === "reveal" && g.s.reason === "time", `${word}: time's up -> reveal`);
  }
  // A big jump past both checkpoints still gives both hints in one tick.
  const g = start(3);
  choose(g, "elephant");
  g.advance(DRAW_MS * 0.8);
  ok(g.s.revealed.length === 2 && g.s.phase === "draw", "both hints after a jump");
}

// ---------- drawing protocol ----------
{
  const g = start(4);
  choose(g, "pizza");
  const artist = g.s.artist;
  const other = g.guessers()[0];
  g.t.events.length = 0;

  ok(g.act(artist, stroke()) === false, "stroke returns false (event only)");
  ok(g.s.strokes.length === 1 && g.s.pointCount === 2, "stroke stored");
  let ev = g.t.events[0];
  const e0 = ev.event as Extract<SketchEvent, { k: "stroke" }>;
  ok(ev.except === artist && !ev.to, "stroke event goes to everyone but the artist");
  ok(e0.k === "stroke" && e0.i === 0 && e0.id === "s1" && e0.t === g.s.turn && e0.rev === g.s.strokesRev, "stroke event fields");
  ok(JSON.stringify(e0.pts) === "[10,20,30,40]" && !e0.end, "stroke event points");

  ok(g.act(artist, stroke({ pts: [50, 60], end: true })) === false, "append");
  ok(g.s.strokes[0].pts.length === 6 && g.s.strokes[0].end, "appended and ended");
  ev = g.t.events[1];
  ok((ev.event as { end?: boolean }).end === true, "end flag relayed");
  ok(g.act(artist, stroke({ pts: [1, 1] })) === false && g.s.strokes[0].pts.length === 6, "no appends after end");

  // Eraser colour and every palette colour/size are allowed.
  g.t.events.length = 0;
  ok(g.act(artist, stroke({ id: "er", color: BG, size: 36, pts: [W, H] })) === false && g.s.strokes.length === 2, "eraser + edges ok");
  ok(g.act(artist, stroke({ id: "s3", color: PALETTE[11].hex, size: SIZES[0], pts: [0, 0] })) === false && g.s.strokes.length === 3, "ok");
  // A new stroke can start with end:true; an existing one can end with no new points.
  ok(g.act(artist, stroke({ id: "dot", pts: [5, 5], end: true })) === false && g.s.strokes[3].end, "single-batch stroke");
  ok(g.act(artist, stroke({ id: "s3", pts: [], end: true })) === false && g.s.strokes[2].end, "end with no points");
  ok(g.t.events.length === 4, "every accepted batch emits once");

  // Hostile strokes.
  const count = g.s.strokes.length;
  const bad: [string, Record<string, unknown>, string?][] = [
    ["non-artist", stroke({ id: "x1" }), other],
    ["unknown colour", stroke({ id: "x2", color: "#123456" })],
    ["colour type", stroke({ id: "x3", color: 0 })],
    ["size not allowed", stroke({ id: "x4", size: 5 })],
    ["size type", stroke({ id: "x5", size: "9" })],
    ["odd number count", stroke({ id: "x6", pts: [1, 2, 3] })],
    ["too many numbers", stroke({ id: "x7", pts: Array(MAX_BATCH + 2).fill(1) })],
    ["fraction", stroke({ id: "x8", pts: [1.5, 2] })],
    ["negative", stroke({ id: "x9", pts: [-1, 2] })],
    ["x too big", stroke({ id: "xa", pts: [W + 1, 2] })],
    ["y too big", stroke({ id: "xb", pts: [2, H + 1] })],
    ["string point", stroke({ id: "xc", pts: ["1", 2] })],
    ["NaN point", stroke({ id: "xd", pts: [NaN, 2] })],
    ["pts not array", stroke({ id: "xe", pts: "1,2" })],
    ["pts missing", stroke({ id: "xf", pts: undefined })],
    ["empty new stroke", stroke({ id: "xg", pts: [] })],
    ["id too long", stroke({ id: "a".repeat(17) })],
    ["id empty", stroke({ id: "" })],
    ["id chars", stroke({ id: "a b<c>" })],
    ["id type", stroke({ id: 42 })],
    ["end type", stroke({ id: "xh", end: "yes" })],
  ];
  for (const [what, a, who] of bad) ok(g.act(who ?? artist, a) === false, `${what} returns false`);
  ok(g.s.strokes.length === count, "no hostile stroke was stored");
  // Ids that look like Object.prototype keys are just ids.
  ok(g.act(artist, stroke({ id: "constructor" })) === false && g.s.strokes.length === count + 1, "prototype-ish id works");
  ok(g.act(artist, stroke({ id: "__proto__" })) === false && g.s.strokes.length === count + 2, "__proto__ id works");

  // The view never carries points.
  for (const id of [artist, other, "spectator"]) {
    const v = g.view(id);
    ok(!JSON.stringify(v).includes("pts") && v.strokeCount === g.s.strokes.length, "view has counts, not strokes");
  }

  // Undo and clear.
  const rev = g.s.strokesRev;
  g.t.events.length = 0;
  ok(g.act(other, { type: "undo" }) === false, "only the artist undoes");
  ok(g.act(artist, { type: "undo" }) === true, "undo broadcasts");
  ok(g.s.strokes.length === count + 1 && g.s.strokesRev === rev + 1, "undo pops and bumps rev");
  const u = g.t.events[0].event as Extract<SketchEvent, { k: "undo" }>;
  ok(u.k === "undo" && u.id === "__proto__" && u.rev === rev + 1 && !g.t.events[0].except, "undo event to everyone");
  ok(g.act(artist, stroke({ id: "__proto__" })) === false && g.s.strokes.length === count + 1, "undone id is dead");
  ok(g.act(other, { type: "clear" }) === false, "only the artist clears");
  ok(g.act(artist, { type: "clear" }) === true && g.s.strokes.length === 0 && g.s.pointCount === 0, "clear empties");
  ok(g.s.strokesRev === rev + 2 && (g.t.events[1].event as SketchEvent).k === "clear", "clear bumps rev and emits");
  ok(g.act(artist, { type: "undo" }) === false && g.act(artist, { type: "clear" }) === false, "nothing to undo/clear");
  ok(g.act(artist, stroke({ id: "s1" })) === false && g.s.strokes.length === 0, "cleared ids are dead too");
  ok(g.act(artist, stroke({ id: "fresh" })) === false && g.s.strokes.length === 1, "drawing after clear works");

  // Sync: private, rate-limited, returns false.
  g.t.events.length = 0;
  ok(g.act(other, { type: "sync" }) === false, "sync returns false");
  const sy = g.t.events[0];
  const se = sy.event as Extract<SketchEvent, { k: "sync" }>;
  ok(sy.to === other && se.k === "sync" && se.rev === g.s.strokesRev && se.t === g.s.turn, "sync goes to the asker");
  ok(se.strokes.length === 1 && se.strokes[0].id === "fresh" && JSON.stringify(se.strokes[0].pts) === "[10,20,30,40]", "sync has strokes");
  ok(g.act(other, { type: "sync" }) === false && g.t.events.length === 1, "second sync within 1s is ignored");
  g.t.advance(SYNC_GAP_MS);
  ok(g.act(other, { type: "sync" }) === false && g.t.events.length === 2, "sync allowed again after 1s");
  ok(g.act("spectator", { type: "sync" }) === false && g.t.events.length === 2, "spectators can't use player actions");
  // ...but they can ask for the drawing so far through the read-only spectator hook.
  ok(game.spectatorAction!(g.s, "spectator", { type: "sync" }, g.t.ctx) === false, "spectator sync returns false");
  ok(g.t.events.length === 3 && g.t.events[2].to === "spectator", "spectator sync goes only to the spectator");
  ok(game.spectatorAction!(g.s, "spectator", { type: "undo" }, g.t.ctx) === false && g.t.events.length === 3, "spectators can only sync");
  ok(game.spectatorAction!(g.s, "spectator", null, g.t.ctx) === false, "spectator junk ignored");

  // Undo/clear/stroke outside the draw phase.
  g.advance(DRAW_MS);
  ok(g.s.phase === "reveal", "time's up");
  ok(g.act(artist, stroke({ id: "late" })) === false && g.act(artist, { type: "undo" }) === false, "no drawing in reveal");
  ok(g.act(artist, { type: "clear" }) === false, "no clearing in reveal");
  ok(g.s.strokes.length === 1, "drawing kept during reveal");
  g.advance(REVEAL_MS);
  ok(g.s.phase === "choose" && g.s.strokes.length === 0 && g.s.strokesRev === rev + 3, "new turn wipes the canvas and bumps rev");
}

// Canvas point cap, stroke cap and flood guard.
{
  const g = start(2);
  choose(g, "pizza");
  const artist = g.s.artist;
  const full = Array.from({ length: MAX_BATCH }, (_, i) => (i % 2 ? i % H : i % W));
  const batches = Math.ceil(MAX_POINTS / (MAX_BATCH / 2));
  for (let i = 0; i < batches; i++) g.act(artist, stroke({ id: "big", pts: full }));
  ok(g.s.pointCount === MAX_POINTS, `canvas capped at ${MAX_POINTS}, has ${g.s.pointCount}`);
  const lastEv = g.t.events[g.t.events.length - 1].event as Extract<SketchEvent, { k: "stroke" }>;
  ok(lastEv.pts.length === (MAX_POINTS % (MAX_BATCH / 2)) * 2 || lastEv.pts.length === MAX_BATCH, "overflow trimmed");
  const evCount = g.t.events.length;
  g.act(artist, stroke({ id: "big", pts: [1, 1] }));
  g.act(artist, stroke({ id: "new", pts: [1, 1] }));
  ok(g.t.events.length === evCount && g.s.strokes.length === 1, "full canvas ignores more points");
  g.act(artist, stroke({ id: "big", pts: [], end: true }));
  ok(g.s.strokes[0].end && g.t.events.length === evCount + 1, "a stroke can still finish on a full canvas");
  // Undo frees room again.
  g.act(artist, { type: "clear" });
  g.act(artist, stroke({ id: "again" }));
  ok(g.s.strokes.length === 1, "room again after clear");
  // Flood guard: keep filling and clearing until the per-turn intake cap trips.
  let accepted = 0;
  for (let i = 0; i < 2000; i++) {
    const before = g.s.pointsIn;
    g.act(artist, stroke({ id: `f${i}`, pts: full, end: true }));
    if (g.s.pointsIn === before) break;
    accepted++;
    if (g.s.pointCount >= MAX_POINTS - MAX_BATCH) g.act(artist, { type: "clear" });
  }
  ok(g.s.pointsIn <= MAX_POINTS_IN && accepted < 2000, "per-turn intake is capped");
  ok(g.s.pointsIn + MAX_BATCH / 2 > MAX_POINTS_IN, "loop stopped at the intake cap");
  g.act(artist, stroke({ id: "zz", pts: full }));
  ok(!g.s.strokes.some((s) => s.id === "zz"), "after the cap, batches are ignored");

  const h = start(2);
  choose(h, "pizza");
  for (let i = 0; i < MAX_STROKES; i++) h.act(h.s.artist, stroke({ id: `d${i}`, pts: [i % W, 1], end: true }));
  ok(h.s.strokes.length === MAX_STROKES, "stroke cap reached");
  h.act(h.s.artist, stroke({ id: "one-more" }));
  ok(h.s.strokes.length === MAX_STROKES, "no strokes past the cap");
}

// ---------- hostile actions ----------
{
  const g = start(3);
  const artist = g.s.artist;
  const guesser = g.guessers()[0];
  const junk: unknown[] = [
    null,
    undefined,
    "guess",
    42,
    true,
    [],
    [{ type: "guess", text: "x" }],
    {},
    { type: 5 },
    { type: "nope" },
    { type: ["choose"], index: 0 },
    { type: "choose", index: "0" },
  ];
  for (const a of junk) {
    ok(g.act(artist, a) === false, `junk rejected: ${JSON.stringify(a)}`);
    ok(g.act(guesser, a) === false, "junk rejected for guessers too");
  }
  ok(g.act("stranger", { type: "choose", index: 0 }) === false, "non-participants can't act");
  ok(g.s.phase === "choose", "junk changed nothing");
  choose(g, "banana");
  const guessJunk: unknown[] = [123, null, ["banana"], { text: "banana" }, "", "   ", NUL + BEL + ZWSP];
  for (const text of guessJunk) ok(g.act(guesser, { type: "guess", text }) === false, `bad guess rejected: ${JSON.stringify(text)}`);
  ok(g.act(guesser, { type: "guess", text: "z".repeat(100_000) }) === true, "huge guess is clipped, not fatal");
  const last = g.s.feed[g.s.feed.length - 1];
  ok(last.kind === "guess" && last.text.length === 40, "guess clipped to 40 chars");
  g.t.advance(GUESS_GAP_MS);
  ok(g.act(guesser, { type: "guess", text: "ba" + ZWSP + "na" + NUL + "na" }) === true && g.s.guessed.includes(guesser), "invisible chars stripped");
  ok(g.act("spectator", { type: "guess", text: "banana" }) === false, "spectators can't guess");
}

// Feed keeps the last 40 lines.
{
  const g = start(3);
  choose(g, "banana");
  const id = g.guessers()[0];
  for (let i = 0; i < 60; i++) {
    g.t.advance(GUESS_GAP_MS);
    g.act(id, { type: "guess", text: `wrong ${i}` });
  }
  ok(g.s.feed.length === FEED_MAX, "feed capped");
  const last = g.s.feed[FEED_MAX - 1];
  ok(last.kind === "guess" && last.text === "wrong 59", "newest kept");
  ok(g.s.feed.every((f, i) => i === 0 || f.n > g.s.feed[i - 1].n), "feed ids increase");
}

// ---------- full games ----------
{
  // 4 players, scripted guesses: every turn one guesser gets it at the start.
  const g = start(4, 11);
  const turns: string[] = [];
  playOut(g, (x) => {
    turns.push(x.s.artist);
    const first = x.guessers()[0];
    ok(x.act(first, { type: "guess", text: x.s.word! }) === true, "guess");
  });
  ok(turns.length === 4 && new Set(turns).size === 4, "everyone drew once");
  ok(g.ends() === 1, `ctx.end called exactly once (got ${g.ends()})`);
  const r = g.t.result!;
  const scores = g.s.scores;
  ok(JSON.stringify(r.winners.slice().sort()) === JSON.stringify(topScorers(scores).sort()), "winners are the top scorers");
  ok(r.scores && Object.keys(r.scores).length === 4, "scores for every player");
  for (const id of g.t.ids) ok(r.scores![id] === scores[id], "result scores match");
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  ok(total === 4 * (100 + 300 + 50 + 60), `each turn scores 450 + 60 (total ${total})`);
  ok(r.headline.includes("Sketch Storm") && r.headline.includes("pts"), `headline: ${r.headline}`);
  if (r.winners.length === 1) ok(r.headline.startsWith(g.t.ctx.player(r.winners[0])!.name), "headline names the winner");
  ok(g.s.history.length === 4, "4 turns recorded");
  // Everything after the end is ignored.
  ok(g.act(g.t.ids[0], { type: "guess", text: "x" }) === false, "actions ignored after end");
  ok(g.act(g.t.ids[0], { type: "sync" }) === false, "sync ignored after end");
  ok(!g.advance(60_000), "tick does nothing after end");
  g.leave(g.t.ids[1]);
  g.back(g.t.ids[1]);
  ok(g.ends() === 1 && g.s.phase === "final", "still ended once");
  const fv = g.view(g.t.ids[2]);
  ok(fv.phase === "final" && fv.word === g.s.word && JSON.parse(JSON.stringify(fv)).phase === "final", "final view");
}

// Clear winner with known scores (2 players, 2 laps -> 4 turns).
{
  const g = start(2, 3);
  const [p0] = g.t.ids;
  playOut(g, (x) => {
    // Only p0 ever guesses (when p1 draws); p0 scores 450 twice, p1 gets 60 twice.
    if (x.s.artist !== p0) x.act(p0, { type: "guess", text: x.s.word! });
  });
  ok(g.s.scores[p0] === 900 && g.s.scores[g.t.ids[1]] === 120, `scores ${JSON.stringify(g.s.scores)}`);
  ok(JSON.stringify(g.t.result!.winners) === JSON.stringify([p0]), "p0 wins");
  ok(g.t.result!.headline === "Player0 wins Sketch Storm with 900 pts", g.t.result!.headline);
}

// Ties and zero scores.
{
  const g = start(2, 5);
  playOut(g, (x) => {
    const guesser = x.guessers()[0];
    x.act(guesser, { type: "guess", text: x.s.word! });
  });
  const [a, b] = g.t.ids;
  ok(g.s.scores[a] === g.s.scores[b], "symmetric play ties");
  ok(g.t.result!.winners.length === 2 && g.t.result!.headline.includes("tie"), `tie headline: ${g.t.result!.headline}`);

  const z = start(3, 9);
  playOut(z);
  ok(z.ends() === 1 && z.t.result!.winners.length === 0, "nobody scored -> no winners");
  ok(z.t.result!.headline === "Nobody scored in Sketch Storm", z.t.result!.headline);
  ok(z.s.history.length === 6 && z.s.history.every((h) => h.guessers.length === 0), "6 silent turns");
}

// Max players: 12 turns, no word offered twice.
{
  const g = start(12, 21);
  const offered: string[] = [];
  playOut(g, (x) => {
    offered.push(...x.s.used.slice(offered.length));
    for (const id of x.guessers().slice(0, 2)) x.act(id, { type: "guess", text: x.s.word! });
  });
  ok(g.s.history.length === 12, "12 turns played");
  ok(g.s.used.length === 36 && new Set(g.s.used).size === 36, "36 distinct offers");
  ok(g.ends() === 1 && g.t.result!.winners.length >= 1, "ended once with a winner");
}

// Running low on words: borrow other levels, then allow repeats.
{
  const g = start(3);
  g.s.used = [...WORDS.easy, ...WORDS.medium];
  choose(g);
  g.advance(DRAW_MS);
  g.advance(REVEAL_MS);
  ok(g.s.options.length === 3 && g.s.options.every((o) => o.level === "hard"), "borrowed from hard");
  ok(new Set(g.s.options.map((o) => o.word)).size === 3, "still three different words");
  g.s.used = [...WORDS.easy, ...WORDS.medium, ...WORDS.hard];
  choose(g);
  g.advance(DRAW_MS);
  g.advance(REVEAL_MS);
  ok(g.s.phase === "choose" && g.s.options.length === 3, "repeats allowed once everything is used");
}

// ---------- disconnects ----------
{
  // Artist leaves while choosing -> reveal (no word) -> next turn.
  const g = start(4);
  const artist = g.s.artist;
  g.leave(artist);
  ok(g.s.phase === "reveal" && g.s.reason === "left" && g.s.word === null, "artist left while choosing");
  ok(g.s.feed.some((f) => f.kind === "left" && f.by === artist), "feed notes the artist left");
  ok(g.s.history.length === 0, "no drawing recorded");
  g.advance(REVEAL_MS);
  ok(g.s.phase === "choose" && g.s.turn === 1 && g.s.artist !== artist, "next turn starts");
}
{
  // Artist leaves mid-draw -> reveal with the word, keeps earned points.
  const g = start(4);
  choose(g, "rocket");
  const artist = g.s.artist;
  const a = g.guessers()[0];
  g.act(a, { type: "guess", text: "rocket" });
  g.leave(artist);
  ok(g.s.phase === "reveal" && g.s.reason === "left", "artist left mid-draw");
  ok(g.view(g.guessers()[1]).word === "rocket", "word revealed");
  ok(g.s.scores[artist] === 60, "artist keeps points");
  ok(g.s.history.length === 1, "turn recorded");
  // The away artist's later turns are skipped; returning doesn't break anything.
  g.advance(REVEAL_MS);
  ok(g.s.artist !== artist, "someone else draws");
  g.back(artist);
  ok(g.s.soloSince === null, "back");
}
{
  // Guessers who leave are not waited for.
  const g = start(4);
  choose(g, "rocket");
  const [a, b, c] = g.guessers();
  g.act(a, { type: "guess", text: "rocket" });
  g.t.advance(GUESS_GAP_MS);
  g.act(b, { type: "guess", text: "rocket" });
  ok(g.s.phase === "draw", "c still guessing");
  g.leave(c);
  ok(g.s.phase === "reveal" && g.s.reason === "all", "turn ends when the only one left guessing leaves");
  // c's turn as artist is skipped while away.
  const cTurn = g.s.order.indexOf(c);
  for (let guard = 0; g.s.turn < cTurn && g.s.phase !== "final" && guard < 20; guard++) {
    if (g.s.phase === "choose") choose(g);
    else g.advance(g.s.phase === "draw" ? DRAW_MS : REVEAL_MS);
  }
  ok(g.s.feed.some((f) => f.kind === "skip" && f.by === c), "skipped turn noted in the feed");
  ok(g.s.phase === "final" || g.s.artist !== c, "away artist skipped");
  // c returns and can play.
  g.back(c);
  if (g.s.phase === "choose") choose(g, "banana");
  if (g.s.phase === "draw" && c !== g.s.artist) ok(g.act(c, { type: "guess", text: "banana" }) === true, "returned player guesses");
}
{
  // Down to one connected player: wait SOLO_GRACE_MS, then end early.
  const g = start(3);
  choose(g, "rocket");
  const artist = g.s.artist;
  const [a, b] = g.guessers();
  g.act(a, { type: "guess", text: "rocket" });
  g.leave(a);
  ok(g.s.phase === "draw" && g.s.soloSince === null, "b is still guessing: keep drawing");
  g.leave(b);
  ok(g.s.soloSince !== null, "solo detected");
  ok(g.view(artist).soloEndsAt === g.s.soloSince! + SOLO_GRACE_MS, "view says when the game gives up");
  ok(g.s.phase === "draw", "no early end with zero guessers left");
  g.advance(SOLO_GRACE_MS - 1);
  ok(g.s.phase === "draw" && g.ends() === 0, "waits for the grace period");
  g.advance(1);
  ok(g.s.phase === "final" && g.ends() === 1 && g.s.endedEarly, "ends after the grace period");
  ok(g.s.scores[a] === 450 && g.s.scores[artist] === 60, "instant guess = 100 + 300 + 50");
  ok(JSON.stringify(g.t.result!.winners) === JSON.stringify([a]), "top scorer wins even while away");
  ok(g.t.result!.headline.includes("ended early"), g.t.result!.headline);
  ok(g.view(artist).soloEndsAt === null, "no countdown once final");
}
{
  // Coming back within the grace keeps the game going.
  const g = start(2);
  const other = g.guessers()[0];
  g.leave(other);
  ok(g.s.soloSince !== null && g.s.phase === "choose", "solo while choosing");
  g.advance(SOLO_GRACE_MS / 2);
  g.back(other);
  ok(g.s.soloSince === null, "solo cleared on return");
  g.advance(SOLO_GRACE_MS);
  ok(g.s.phase !== "final" && g.ends() === 0, "game continues");
}
{
  // Leaving during reveal and during someone else's choose: phases keep moving.
  const g = start(4);
  choose(g, "rocket");
  g.advance(DRAW_MS);
  ok(g.s.phase === "reveal" && g.s.reason === "time", "reveal");
  const someone = g.guessers()[0];
  g.leave(someone);
  ok(g.s.phase === "reveal", "a guesser leaving during reveal changes nothing");
  g.advance(REVEAL_MS);
  ok(g.s.phase === "choose", "next turn starts");
  g.back(someone);
  const other = g.guessers().find((id) => id !== someone)!;
  g.leave(other);
  ok(g.s.phase === "choose", "a guesser leaving while choosing changes nothing");
  g.advance(CHOOSE_MS);
  ok(g.s.phase === "draw", "auto-pick still happens");
  g.back(other);
  ok(g.act(other, { type: "guess", text: "nope" }) === true, "returned guesser plays on");
}
{
  // Everyone leaves: the game still ends instead of stalling.
  const g = start(3);
  for (const id of g.t.ids) g.leave(id);
  g.advance(SOLO_GRACE_MS);
  ok(g.s.phase === "final" && g.ends() === 1 && g.t.result!.winners.length === 0, "empty room ends");
  ok(g.t.result!.headline === "Sketch Storm ended early with no points scored", g.t.result!.headline);
}

// ---------- views: serialisable, secret-free ----------
{
  const g = start(3, 13);
  const viewers = [...g.t.ids, "spectator"];
  const check = (label: string) => {
    for (const id of viewers) {
      const v = g.view(id);
      ok(JSON.stringify(JSON.parse(JSON.stringify(v))) === JSON.stringify(v), `${label}: view round-trips`);
      ok(!JSON.stringify(v).includes('"pts"'), `${label}: no stroke data`);
    }
  };
  check("choose");
  const offered = g.s.options.map((o) => o.word);
  choose(g);
  const word = g.s.word!;
  g.act(g.s.artist, stroke());
  check("draw");
  const [a, b] = g.guessers();
  for (const id of [a, b, "spectator"]) {
    const v = g.view(id);
    ok(!mentions(v, word) && v.word === null, `draw: word hidden from ${id}`);
    for (const w of offered) ok(!mentions(v, w), `draw: offer hidden from ${id}`);
    ok(v.mask!.length === word.length, "mask matches the word length");
  }
  ok(g.view("spectator").role === "spectator" && g.view(g.s.artist).role === "artist" && g.view(a).role === "guesser", "roles");
  g.advance(DRAW_MS);
  check("reveal");
  ok(viewers.every((id) => g.view(id).word === word), "reveal: everyone sees the word");
  playOut(g);
  check("final");
}

// ---------- client stroke store (no DOM needed) ----------
{
  type Ev = Record<string, unknown>;
  const st = (t: number, rev: number, i: number, id: string, pts: number[], end = false): Ev => ({
    k: "stroke", t, rev, i, id, color: "#1c1c1e", size: 9, pts, ...(end ? { end: true } : {}),
  });

  // Receiving strokes in order.
  let s = new StrokeStore();
  s.check(1, 0, 5, 0);
  ok(s.turn === 0 && s.rev === 5 && !s.needSync, "fresh turn adopts the view's rev");
  s.handle(st(0, 5, 0, "a", [1, 2, 3, 4]));
  s.handle(st(0, 5, 0, "a", [5, 6], true));
  s.handle(st(0, 5, 1, "b", [7, 8]));
  ok(s.list.length === 2 && s.list[0].pts.length === 6 && s.list[0].end && s.points === 4, "strokes assembled");
  ok(!s.needSync, "in step");
  s.check(1, 0, 5, 2);
  ok(!s.needSync, "view agrees");
  s.check(1, 0, 5, 1);
  ok(!s.needSync, "an older view with fewer strokes is fine");

  // Undo/clear events; junk ignored.
  s.handle(null);
  s.handle("x");
  s.handle({ k: "stroke", t: 0, rev: 5, i: 2, id: 3, pts: [] });
  s.handle({ k: "undo", t: 0, rev: 6, id: "b" });
  ok(s.list.length === 1 && s.rev === 6 && !s.needSync, "undo removes by id");
  s.handle({ k: "undo", t: 0, rev: 6, id: "a" });
  ok(s.list.length === 1, "duplicate undo ignored");
  s.handle({ k: "clear", t: 0, rev: 7 });
  ok(s.list.length === 0 && s.points === 0 && s.rev === 7, "clear wipes");

  // Gaps: a stroke index we don't have, an append for an unknown stroke, a skipped rev.
  s.handle(st(0, 7, 3, "z", [1, 1]));
  ok(s.needSync && s.list.length === 1, "index gap flags a sync but still shows the stroke");
  s.handle({ k: "sync", t: 0, rev: 7, strokes: [{ id: "x", color: "#1c1c1e", size: 9, pts: [1, 1, 2, 2], end: true }] });
  ok(!s.needSync && s.list.length === 1 && s.list[0].id === "x" && s.points === 2, "sync replaces the canvas");
  s.handle(st(0, 9, 1, "y", [3, 3]));
  ok(s.needSync && s.rev === 9, "a jump in rev means we missed an undo/clear");
  s.handle({ k: "sync", t: 0, rev: 9, strokes: [] });
  s.check(1, 0, 10, 0);
  ok(s.needSync, "a newer rev in the view flags a sync");
  s.handle({ k: "sync", t: 0, rev: 10, strokes: [] });
  s.check(1, 0, 10, 3);
  ok(s.needSync, "more strokes on the server than here flags a sync");

  // New turn archives the old one; stale events are ignored.
  s = new StrokeStore();
  s.check(1, 0, 1, 0);
  s.handle(st(0, 1, 0, "a", [1, 1], true));
  s.handle(st(1, 2, 0, "b", [2, 2]));
  ok(s.turn === 1 && s.list.length === 1 && s.list[0].id === "b", "stroke from the next turn starts a fresh canvas");
  ok(s.strokesFor(0)?.[0].id === "a" && s.strokesFor(5) === null, "previous turn archived for the gallery");
  s.handle(st(0, 1, 1, "late", [3, 3]));
  ok(s.list.length === 1 && s.strokesFor(0)!.length === 1, "stale turn events ignored");
  s.check(1, 2, 3, 0);
  ok(s.turn === 2 && s.list.length === 0 && s.strokesFor(1)!.length === 1, "view moves us on too");
  s.check(1, 3, 4, 0);
  ok(s.strokesFor(2) !== null && s.strokesFor(2)!.length === 0, "empty turns are remembered as blank");
  s.check(2, 0, 1, 0);
  ok(s.turn === 0 && s.strokesFor(1) === null && s.list.length === 0, "a new game (Play again) wipes everything");

  // The artist's own canvas: local first, undo/clear echoed back by the server.
  s = new StrokeStore();
  s.check(1, 0, 1, 0);
  s.setOwner(0);
  const a = s.begin("m1", "#1c1c1e", 9, 10, 10);
  s.add(a, 20, 20);
  s.finish(a);
  const b = s.begin("m2", "#1c1c1e", 9, 30, 30);
  s.finish(b);
  ok(s.list.length === 2 && s.points === 3, "local strokes");
  ok(s.undoLocal() && s.list.length === 1, "optimistic undo");
  s.check(1, 0, 1, 2);
  ok(!s.needSync, "no sync while our own undo is in flight");
  s.handle({ k: "undo", t: 0, rev: 2, id: "m2" });
  ok(s.rev === 2 && s.list.length === 1 && !s.needSync, "server confirms the undo");
  ok(s.clearLocal() && s.list.length === 0, "optimistic clear");
  const c = s.begin("m3", "#1c1c1e", 9, 5, 5);
  s.handle({ k: "clear", t: 0, rev: 3 });
  ok(s.list.length === 1 && s.list[0] === c, "the echoed clear keeps strokes drawn since");
  // Sync while drawing: keep our longer copy and strokes the server hasn't seen yet.
  s.add(c, 6, 6);
  const d = s.begin("m4", "#1c1c1e", 9, 7, 7);
  s.handle({ k: "sync", t: 0, rev: 3, strokes: [{ id: "m3", color: "#1c1c1e", size: 9, pts: [5, 5] }] });
  ok(s.list.length === 2 && s.list[0] === c && s.list[1] === d && s.points === 3, "owner sync keeps newer local work");
  s.setOwner(-1);

  // Painting: incremental batches draw every curve segment exactly once.
  const calls: Record<string, number> = {};
  const g = new Proxy(
    { canvas: { width: 100, height: 75 } } as Record<string, unknown>,
    {
      get(target, key: string) {
        if (key in target) return target[key];
        return () => {
          calls[key] = (calls[key] ?? 0) + 1;
        };
      },
      set(target, key: string, v) {
        target[key] = v;
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  s = new StrokeStore();
  s.check(1, 0, 1, 0);
  s.paint(g, 0.1);
  ok(calls.fillRect === 1, "first paint clears to white");
  const n = 50;
  const pts = Array.from({ length: n * 2 }, (_, i) => (i * 7) % 700);
  for (let at = 0; at < pts.length; at += 6) {
    s.handle(st(0, 1, 0, "w", pts.slice(at, at + 6), at + 6 >= pts.length));
    s.paint(g, 0.1);
  }
  ok(calls.quadraticCurveTo === n - 2, `each curve drawn once incrementally (${calls.quadraticCurveTo})`);
  ok(calls.arc === 1 && calls.fillRect === 1, "start dot once, no full repaint needed");
  for (const k of Object.keys(calls)) delete calls[k];
  s.repaint();
  s.paint(g, 0.1);
  ok(calls.fillRect === 1 && calls.quadraticCurveTo === n - 2 && calls.arc === 1, "full repaint draws the same geometry");
}

console.log("sketch: all tests passed");

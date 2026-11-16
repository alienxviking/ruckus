import { assert, makeTestCtx } from "../../shared/testing";
import game, {
  CHOOSE_MS,
  CLUE_BURST,
  CLUE_MS,
  FEED_MAX,
  GIVER_ALL,
  GIVER_EACH,
  GUESS_GAP_MS,
  REVEAL_MS,
  SOLO_GRACE_MS,
  cleanText,
  editDistance,
  judge,
  keyOf,
  maskOf,
  type CharadesAction,
  type CharadesState,
  type CharadesView,
} from "./server";
import { PHRASES } from "./data";
import { CAT_KEYS, CLUE_MAX, isClueEmoji, type CharadesEvent } from "./shared";
import { emojiGroups, emojiInfo, searchEmoji } from "./emoji";

const ok: (cond: unknown, msg?: string) => void = assert;

function start(n: number, seed = 7) {
  const t = makeTestCtx(n, seed);
  let ends = 0;
  const end = t.ctx.end;
  t.ctx.end = (r) => {
    ends += 1;
    end(r);
  };
  const s: CharadesState = game.setup(t.ctx);
  const g = {
    t,
    s,
    ends: () => ends,
    act: (id: string, a: unknown) => game.action(s, id, a as CharadesAction, t.ctx),
    tick: () => game.tick!(s, t.ctx),
    view: (id: string) => game.view(s, id, t.ctx) as CharadesView,
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
    guessers: () => s.players.filter((id) => id !== s.giver),
    events: (k: string) => t.events.filter((e) => (e.event as { k?: string }).k === k),
  };
  return g;
}
type G = ReturnType<typeof start>;

function choose(g: G, phrase?: string) {
  if (phrase) g.s.options = [phrase, "spare one", "spare two"].map((text) => ({ text, cat: "thing" as const }));
  ok(g.s.phase === "choose", `expected choose, got ${g.s.phase}`);
  ok(g.act(g.s.giver, { type: "choose", index: 0 }) === true, "giver can choose");
  ok(g.s.phase === "clue", "choosing starts the clue");
}

// ---------- data & helpers ----------
{
  let total = 0;
  const seen = new Set<string>();
  for (const cat of CAT_KEYS) {
    ok(PHRASES[cat].length >= 30, `${cat} has enough phrases`);
    for (const p of PHRASES[cat]) {
      total++;
      ok(/^[a-z][a-z' -]*[a-z]$/.test(p), `phrase charset: ${p}`);
      ok(!/ {2}/.test(p), `no double spaces: ${p}`);
      ok(!seen.has(p), `duplicate phrase: ${p}`);
      seen.add(p);
      ok(keyOf(p).length >= 3, `phrase has a usable key: ${p}`);
      ok(judge(p, p) === "correct", `phrase matches itself: ${p}`);
      ok(judge(p.toUpperCase() + "!!", p) === "correct", `case/punct-insensitive: ${p}`);
    }
  }
  ok(total >= 200, `>= 200 phrases (got ${total})`);

  // The picker: every emoji is valid, unique, named, and the list stays small.
  let n = 0;
  const all = new Set<string>();
  for (const grp of emojiGroups()) {
    ok(grp.items.length >= 20, `${grp.id} has items`);
    for (const it of grp.items) {
      n++;
      ok(isClueEmoji(it.e), `picker emoji is accepted by the server: ${it.e} ${it.name}`);
      ok(!all.has(it.e), `picker emoji unique: ${it.e}`);
      all.add(it.e);
      ok(it.name && it.words.length > 0, `picker emoji has a name: ${it.e}`);
      ok(it.e.length <= 16, "short emoji");
    }
  }
  ok(n >= 380 && n <= 480, `about 400 picker emoji (got ${n})`);
  ok(searchEmoji("pirate").some((i) => i.e === "🏴‍☠️"), "search finds the pirate flag");
  ok(searchEmoji("pirate")[0].e === "🏴‍☠️", "name match ranks first");
  ok(searchEmoji("LOVE").length >= 5, "search is case-insensitive");
  ok(searchEmoji("zzqx").length === 0, "no junk results");
  ok(searchEmoji("   ").length === 0, "blank search");
  ok(emojiInfo("🍕")?.name === "pizza", "lookup by emoji");

  // Emoji validation: pictographs yes, text/letters/flags/keycaps no.
  for (const e of ["😀", "❤️", "❤", "🏴‍☠️", "👍🏽", "✈️", "🧑‍🚀", "☠️"]) ok(isClueEmoji(e), `accepts ${e}`);
  for (const e of ["a", "A", "1", "hi", "😀😀", "😀 ", " 😀", "🅰️", "🅱", "🆗", "🆒", "🔙", "™️", "©", "Ⓜ️", "ℹ️", "🇫🇷", "🇦", "1️⃣", "#️⃣", "🔟", "", "‍", "😀‍", "x😀", "😀x", "😀".repeat(9), null, 5, ["😀"], {}])
    ok(!isClueEmoji(e), `rejects ${JSON.stringify(e)}`);

  // Normalisation and fuzzy matching.
  ok(keyOf("The Dentist’s Office!") === "dentistsoffice", "articles, apostrophes and punctuation dropped");
  ok(keyOf("Fish & Chips") === keyOf("fish and chips"), "& means and");
  ok(keyOf("Crème brûlée") === "cremebrulee", "accents stripped");
  ok(judge("pirates birthday party", "a pirate's birthday party") === "correct", "missing article and apostrophe ok");
  ok(judge("early bird gets the wrom", "early bird gets the worm") === "correct", "one typo forgiven on a long phrase");
  ok(judge("erly brd gets teh worm", "early bird gets the worm") !== "correct", "too many typos isn't correct");
  ok(judge("early bird", "early bird gets the worm") === "close", "half the words is close");
  ok(judge("cold hands", "cold feet") === "close", "one of two big words is close");
  ok(judge("snow globe x", "snow globe") === "close", "guess containing the answer is close");
  ok(judge("moom", "the moon") === "close", "near miss is close");
  ok(judge("moon", "the moon") === "correct", "article optional");
  ok(judge("zebra", "the moon") === "wrong", "unrelated is wrong");
  ok(judge("zoo", "the zoo") === "correct", "short answer");
  ok(judge("zoe", "the zoo") === "wrong", "short answers need exact match (no close)");
  ok(judge("", "the zoo") === "wrong" && judge("!!!", "the zoo") === "wrong", "empty guess");
  ok(judge("the", "the zoo") === "wrong", "articles alone are nothing");
  ok(editDistance("kitten", "sitting", 5) === 3, "edit distance");
  ok(editDistance("aaaaaaaa", "b", 2) === 3, "edit distance gives up past the cap");
  ok(cleanText("  hi \u0000 there​  ", 40) === "hi there", "cleanText strips junk");
  ok(cleanText("x".repeat(100), 48).length === 48, "cleanText caps");
  const m = maskOf("a pirate's party", [2]);
  ok(m[0] === null && m[1] === " " && m[2] === "p" && m[3] === null && m[8] === "'", "mask keeps spaces and apostrophes, hides letters");
}

// ---------- a full game, 3 players (two laps) ----------
{
  const g = start(3);
  const { s } = g;
  ok(s.order.length === 6 && s.laps === 2, "3 players: everyone gives twice");
  ok(s.phase === "choose" && s.options.length === 3, "starts by choosing");
  ok(new Set(s.options.map((o) => o.cat)).size === 3, "three different categories on offer");

  // Choose-phase secrecy.
  const giver = s.giver;
  const other = g.guessers()[0];
  ok(g.view(giver).options?.length === 3, "giver sees options");
  ok(g.view(other).options === null, "guesser doesn't see options");
  for (const o of s.options) ok(!JSON.stringify(g.view(other)).includes(o.text), "options never leak");
  ok(!JSON.stringify(g.view("spectator")).includes(s.options[0].text), "spectator doesn't see options");

  // Wrong players / phases.
  ok(g.act(other, { type: "choose", index: 0 }) === false, "only the giver chooses");
  ok(g.act(giver, { type: "choose", index: 3 }) === false, "index range");
  ok(g.act(giver, { type: "choose", index: 1.5 }) === false, "integer index");
  ok(g.act(giver, { type: "choose", index: "0" }) === false, "number index");
  ok(g.act(giver, { type: "clue", emoji: ["😀"] }) === false, "no clue while choosing");
  ok(g.act(other, { type: "guess", text: "x" }) === false, "no guesses while choosing");

  choose(g, "pirate ship");
  ok(s.phrase?.text === "pirate ship", "phrase picked");
  const gv = g.view(giver);
  const ov = g.view(other);
  ok(gv.phrase === "pirate ship" && gv.role === "giver", "giver knows the phrase");
  ok(ov.phrase === null && ov.cat === "thing" && ov.mask?.length === 11, "guesser sees category and mask only");
  ok(!JSON.stringify(ov).includes("pirate"), "phrase hidden from guessers");
  ok(!JSON.stringify(g.view("spectator")).includes("pirate"), "phrase hidden from spectators");

  // Building a clue: events, not views.
  g.t.events.length = 0;
  ok(g.act(giver, { type: "clue", emoji: ["🏴‍☠️", "🚢"] }) === false, "clue edits don't re-broadcast the view");
  ok(s.clue.join("") === "🏴‍☠️🚢", "clue stored");
  const ev = g.events("clue");
  ok(ev.length === 1 && ev[0].except === giver, "clue event goes to everyone but the giver");
  const e0 = ev[0].event as Extract<CharadesEvent, { k: "clue" }>;
  ok(e0.t === s.turn && e0.v === s.clueRev && e0.e.length === 2, "event carries turn, rev and clue");
  ok(g.view(other).clue.length === 2, "the next view carries the clue too");
  ok(g.act(giver, { type: "clue", emoji: ["🏴‍☠️", "🚢"] }) === false && g.events("clue").length === 1, "unchanged clue is ignored");
  ok(g.act(giver, { type: "clue", emoji: [] }) === false && s.clue.length === 0, "clearing works");
  ok(g.act(giver, { type: "clue", emoji: ["🏴‍☠️", "🚢"] }) === false && s.clue.length === 2, "re-add");

  // Hostile clues.
  const rev = s.clueRev;
  const bad: unknown[] = [
    null,
    "😀",
    { length: 2 },
    ["p", "i"],
    ["😀", "a"],
    ["😀😀"],
    ["🅰️"],
    ["🇵🇸"],
    Array(CLUE_MAX + 1).fill("😀"),
    [5],
    [null],
    [["😀"]],
    ["x".repeat(5000)],
  ];
  for (const b of bad) ok(g.act(giver, { type: "clue", emoji: b }) === false, `rejects clue ${JSON.stringify(b)?.slice(0, 40)}`);
  ok(g.act(other, { type: "clue", emoji: ["😀"] }) === false, "only the giver gives clues");
  ok(s.clueRev === rev && s.clue.length === 2, "hostile clues change nothing");
  ok(g.act(giver, { type: "clue", emoji: Array(CLUE_MAX).fill("🚢") }) === false && s.clue.length === CLUE_MAX, "12 emoji allowed");
  ok(g.act(giver, { type: "clue", emoji: ["🏴‍☠️", "🚢"] }) === false, "back to 2");

  // Rate limiting: a flood is cut off, then tokens refill.
  let accepted = 0;
  for (let i = 0; i < 40; i++) {
    const before = s.clueRev;
    g.act(giver, { type: "clue", emoji: i % 2 ? ["😀"] : ["😎"] });
    if (s.clueRev !== before) accepted++;
  }
  ok(accepted <= CLUE_BURST, `flood capped (${accepted})`);
  g.t.advance(1000);
  const before = s.clueRev;
  ok(g.act(giver, { type: "clue", emoji: ["🏴‍☠️", "🚢"] }) === false && s.clueRev === before + 1, "tokens refill");

  // Guessing.
  const [a, b] = g.guessers();
  ok(g.act(giver, { type: "guess", text: "pirate ship" }) === false, "giver can't guess");
  ok(g.act(a, { type: "guess", text: 42 }) === false, "guess must be a string");
  ok(g.act(a, { type: "guess", text: "   " }) === false, "blank guess");
  ok(g.act(a, { type: "guess", text: "boat" }) === true, "wrong guess goes to the feed");
  ok(s.feed[s.feed.length - 1].kind === "guess", "feed line");
  ok(g.act(a, { type: "guess", text: "again" }) === false, "guess rate limit");
  g.t.advance(GUESS_GAP_MS);
  g.t.events.length = 0;
  ok(g.act(a, { type: "guess", text: "pirate shop" }) === false, "close guess doesn't broadcast");
  const close = g.events("close");
  ok(close.length === 1 && close[0].to === a, "close is private");
  ok(!s.feed.some((f) => f.kind === "guess" && f.text === "pirate shop"), "close guesses stay out of the feed");
  g.t.advance(GUESS_GAP_MS);
  ok(g.act(a, { type: "guess", text: "x".repeat(5000) }) === true, "oversize guess is capped, not crashed");
  const lastF = s.feed[s.feed.length - 1];
  ok(lastF.kind === "guess" && lastF.text.length <= 48, "capped in feed");
  g.t.advance(GUESS_GAP_MS);
  ok(g.act(a, { type: "guess", text: "Pirate-Ship!" }) === true, "correct guess");
  ok(s.guessed.includes(a) && s.scores[a] > 300 && s.scores[giver] === GIVER_EACH, "points for guesser and giver");
  ok(g.view(a).phrase === "pirate ship", "correct guesser sees the phrase");
  ok(g.view(b).phrase === null, "others still don't");
  ok(g.act(a, { type: "guess", text: "pirate ship" }) === false, "can't score twice");

  // Hints over time.
  g.advance(CLUE_MS * 0.45);
  ok(s.revealed.length >= 1, "first hint after 40%");
  const mb = g.view(b).mask!;
  ok(mb.filter((c) => c && c !== " ").length === s.revealed.length, "hint shows in the mask");
  g.advance(CLUE_MS * 0.4);
  ok(s.hints === 3, "all hint checkpoints passed");
  ok(s.revealed.length <= Math.floor(10 / 3), "at most a third of letters revealed");

  g.t.advance(GUESS_GAP_MS);
  ok(g.act(b, { type: "guess", text: "pirate ship" }) === true, "second guesser");
  ok(s.phase === "reveal" && s.reason === "all", "everyone guessed -> reveal");
  ok(s.scores[giver] === GIVER_EACH * 2 + GIVER_ALL, "giver bonus when all got it");
  ok(s.scores[b] < s.scores[a], "faster guesser scores more");
  ok(g.view(b).phrase === "pirate ship" && g.view("spectator").phrase === "pirate ship", "phrase public at reveal");
  ok(s.history.length === 1 && s.history[0].clue.join("") === "🏴‍☠️🚢", "history keeps the clue");
  ok(g.act(b, { type: "guess", text: "late" }) === false, "no guesses during reveal");

  ok(g.advance(REVEAL_MS) === true && s.phase === "choose" && s.turn === 1, "next turn");
  ok(s.clue.length === 0 && g.view(a).clue.length === 0, "fresh clue each turn");

  // Turn 2: choose times out, clue times out.
  ok(g.advance(CHOOSE_MS) === true && s.phase === "clue", "choose timeout auto-picks");
  ok(s.phrase?.text === s.options[0].text, "auto-picks the first");
  ok(g.advance(CLUE_MS) === true && s.phase === "reveal" && s.reason === "time", "time's up");

  // Play out the rest.
  while (s.phase !== "final") {
    if (s.phase === "reveal") g.advance(REVEAL_MS);
    else if (s.phase === "choose") choose(g);
    else {
      for (const id of g.guessers()) {
        g.t.advance(GUESS_GAP_MS);
        g.act(id, { type: "guess", text: s.phrase!.text });
      }
    }
  }
  ok(g.ends() === 1 && g.t.result !== null, "ended exactly once");
  ok(s.history.length === 6, "six turns played");
  const max = Math.max(...Object.values(s.scores));
  ok(
    g.t.result!.winners.length >= 1 && g.t.result!.winners.every((id) => s.scores[id] === max),
    "winners are the top scorers",
  );
  ok(g.t.result!.headline.includes("Player"), "headline uses names");
  ok(g.act(a, { type: "guess", text: "x" }) === false && g.tick() === false, "ignores everything after the end");
  ok(g.view(a).phase === "final" && g.view(a).history.length === 6, "final view");
  ok(g.ends() === 1, "still one end");
}

// ---------- hostile actions ----------
{
  const g = start(4);
  const junk: unknown[] = [
    null,
    undefined,
    42,
    "choose",
    [],
    [{ type: "choose", index: 0 }],
    {},
    { type: "x" },
    { type: "__proto__" },
    { type: "constructor" },
    { type: "choose" },
    { type: "choose", index: null },
    { type: "choose", index: -1 },
    { type: "choose", index: Infinity },
    { type: "guess", text: ["a"] },
    { type: "clue", text: ["array"] },
    { type: "clue", emoji: "😀" },
  ];
  for (const id of [...g.s.players, "intruder", "__proto__"]) for (const j of junk) ok(g.act(id, j) === false, `junk rejected: ${JSON.stringify(j)}`);
  ok(g.s.phase === "choose", "junk changed nothing");
  ok(g.act("intruder", { type: "choose", index: 0 }) === false, "non-players can't act");
}

// ---------- 4 players get two laps, 5 get one; 12 players work ----------
{
  ok(start(4).s.order.length === 8, "4 players: two laps");
  ok(start(5).s.order.length === 5, "5 players: one lap");
  const g = start(12, 3);
  ok(g.s.order.length === 12 && new Set(g.s.order).size === 12, "12 players: everyone once");
  choose(g, "lost sock");
  for (const id of g.guessers()) {
    ok(g.act(id, { type: "guess", text: "lost sock" }) === true, "12p guess");
  }
  ok(g.s.phase === "reveal" && g.s.reason === "all", "12p all guessed");
  const v = JSON.stringify(g.view(g.s.players[0]));
  ok(v.length < 4000, `view stays small (${v.length})`);
  ok(g.s.scores[g.s.giver] === 11 * GIVER_EACH + GIVER_ALL, "giver scores per guesser");
  // Feed is capped.
  const g2 = start(12, 5);
  choose(g2, "the moon");
  for (let i = 0; i < 80; i++) {
    g2.t.advance(GUESS_GAP_MS);
    g2.act(g2.guessers()[i % 11], { type: "guess", text: `wrong ${i}` });
  }
  ok(g2.s.feed.length === FEED_MAX, "feed capped");
}

// ---------- disconnects ----------
{
  // Giver leaves while choosing -> reveal(left) -> next turn.
  const g = start(4);
  const giver = g.s.giver;
  g.leave(giver);
  ok(g.s.phase === "reveal" && g.s.reason === "left", "giver leaving while choosing ends the turn");
  ok(g.s.history.length === 0, "no history for a turn that never started");
  g.advance(REVEAL_MS);
  ok(g.s.phase === "choose" && g.s.giver !== giver, "next giver");
  // Giver leaves mid-clue.
  const g2 = g.s.giver;
  choose(g);
  g.act(g2, { type: "clue", emoji: ["🌙"] });
  g.leave(g2);
  ok(g.s.phase === "reveal" && g.s.reason === "left" && g.s.history.length === 1, "giver leaving mid-clue reveals");
  // A guesser leaves: the rest finishing still ends the turn.
  g.back(giver);
  g.back(g2);
  g.advance(REVEAL_MS);
  choose(g, "the moon");
  const [x, y, z] = g.guessers();
  g.act(x, { type: "guess", text: "moon" });
  g.act(y, { type: "guess", text: "moon" });
  g.leave(z);
  ok(g.s.phase === "reveal" && g.s.reason === "all", "leaving last guesser ends the turn");
  g.back(z);
  // Turns of away players are skipped.
  g.advance(REVEAL_MS);
  const upcoming = g.s.order[g.s.turn + 1];
  if (upcoming && upcoming !== g.s.giver) {
    g.leave(upcoming);
    choose(g);
    g.advance(CLUE_MS);
    g.advance(REVEAL_MS);
    ok(g.s.giver !== upcoming, "away giver skipped");
    ok(g.s.feed.some((f) => f.kind === "skip" && f.by === upcoming), "skip in the feed");
    g.back(upcoming);
  }
  // Reconnect during reveal / clue: nothing breaks.
  ok(g.view(z).phase !== undefined, "view after reconnect");
}
{
  // Too few connected: grace period, then end early once.
  const g = start(3);
  const [p0, p1, p2] = g.s.players;
  choose(g);
  g.leave(p1 === g.s.giver ? p0 : p1);
  g.leave(p2 === g.s.giver ? p0 : p2);
  ok(g.s.soloSince !== null || g.s.phase === "reveal", "solo detected");
  g.advance(1000);
  ok(g.view(g.s.giver).soloEndsAt !== null, "solo countdown visible");
  g.advance(SOLO_GRACE_MS);
  ok(g.s.phase === "final" && g.ends() === 1 && g.s.endedEarly, "ends early after grace");
  g.advance(10_000);
  ok(g.ends() === 1, "only once");
}
{
  // Coming back during the grace period cancels it.
  const g = start(3);
  const others = g.guessers();
  choose(g);
  g.leave(others[0]);
  g.leave(others[1]);
  g.advance(3000);
  g.back(others[0]);
  g.advance(SOLO_GRACE_MS);
  ok(g.s.phase !== "final" && g.s.soloSince === null, "return cancels the early end");
}
{
  // Everyone ties at 0: no winners, ends once.
  const g = start(3, 11);
  while (g.s.phase !== "final") g.advance(CLUE_MS);
  ok(g.ends() === 1 && g.t.result!.winners.length === 0, "nobody scores -> no winners");
  ok(g.t.result!.headline.length > 0, "headline even with no winner");
}
{
  // Ties share the win.
  const g = start(3, 2);
  g.s.scores[g.s.players[0]] = 500;
  g.s.scores[g.s.players[1]] = 500;
  while (g.s.phase !== "final") g.advance(CLUE_MS);
  ok(g.t.result!.winners.length === 2 && g.t.result!.headline.includes("tie"), "tie shares the win");
}

console.log("✓ emojicharades tests passed");

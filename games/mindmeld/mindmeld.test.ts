import { assert, makeTestCtx } from "../../shared/testing";
import game, { RESUME_MS, WAIT_MS, type MmAction, type MmState, type MmView } from "./server";
import {
  FIRST_ROUND_MS,
  MAX_ROUNDS,
  REVEAL_MS,
  ROUND_MS,
  bestRound,
  checkWord,
  cleanWord,
  isMmEvent,
  matchKey,
  rating,
  wordProblem,
} from "./shared";

// ---------- harness ----------

function start(n: number, seed = 7) {
  const t = makeTestCtx(n, seed);
  let ends = 0;
  const realEnd = t.ctx.end;
  t.ctx.end = (r) => {
    ends += 1;
    realEnd(r);
  };
  const s: MmState = game.setup(t.ctx);
  const h = {
    t,
    s,
    ids: t.ids,
    ends: () => ends,
    act: (i: number | string, a: unknown) =>
      game.action(s, typeof i === "number" ? t.ids[i] : i, a as MmAction, t.ctx),
    submit: (i: number, word: unknown) => h.act(i, { type: "submit", word }),
    unlock: (i: number) => h.act(i, { type: "unlock" }),
    tick: () => game.tick!(s, t.ctx),
    view: (who: number | string) => game.view(s, typeof who === "number" ? t.ids[who] : who, t.ctx) as MmView,
    leave: (i: number) => {
      t.ctx.player(t.ids[i])!.connected = false;
      game.playerLeft!(s, t.ids[i], t.ctx);
    },
    back: (i: number) => {
      t.ctx.player(t.ids[i])!.connected = true;
      game.playerReturned!(s, t.ids[i], t.ctx);
    },
    /** Let the reveal timer run out. */
    afterReveal: () => {
      assert(s.phase === "reveal", `expected reveal, got ${s.phase}`);
      t.advance(REVEAL_MS);
      assert(h.tick() === true, "reveal end should change state");
    },
    last: () => s.history[s.history.length - 1],
  };
  return h;
}

function eq<T>(a: T, b: T, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

/** No undefined anywhere, and survives a JSON round trip unchanged. */
function assertPlainJson(v: unknown, path = "view") {
  if (v === undefined) throw new Error(`${path} is undefined`);
  if (typeof v === "number") assert(Number.isFinite(v), `${path} is not finite`);
  if (v && typeof v === "object") {
    assert(Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype, `${path} is not a plain object`);
    for (const [k, x] of Object.entries(v)) assertPlainJson(x, `${path}.${k}`);
  }
}

// ---------- word rules ----------
{
  const same = (a: string, b: string) => eq(matchKey(a), matchKey(b), `"${a}" should match "${b}"`);
  const differ = (a: string, b: string) => assert(matchKey(a) !== matchKey(b), `"${a}" should not match "${b}"`);

  same("Cats", "cat");
  same("CAFÉ", "cafe");
  same("crème brûlée", "creme brulee");
  same("  Ice   Cream ", "ice-cream");
  same("ice cream", "icecream");
  same("don't", "dont");
  same("don’t", "dont");
  same("The Moon", "moon");
  same("an apple", "apples");
  same("berries", "berry");
  same("cookies", "cookie");
  same("boxes", "box");
  same("dishes", "dish");
  same("kisses", "kiss");
  same("glasses", "glass");
  same("Straße", "strasse");
  same("pies", "pie");
  same("flies", "fly");
  eq(matchKey("glass"), "glass", "ss words keep their s");
  eq(matchKey("bus"), "bus", "3-letter words keep their s");
  eq(matchKey("gas"), "gas", "3-letter words keep their s");
  eq(matchKey("dogs"), "dog", "simple plural");
  eq(matchKey("the"), "the", "a lone article stays");
  eq(matchKey("猫"), "猫", "non-latin letters are kept");
  differ("猫", "犬");
  differ("hat", "hate");
  differ("ice cream", "ice");
  differ("plan", "plane");
  differ("cat", "cut");

  eq(cleanWord("  hello \n\t world  "), "hello world", "whitespace collapsed");
  eq(cleanWord("don’t"), "don't", "curly apostrophe unified");
  eq(cleanWord("he‮llo​"), "hello", "bidi / zero-width stripped");
  eq(cleanWord("a\u0000b\u0007c"), "abc", "control chars stripped");

  const ok = (w: string) => assert(checkWord(w, []).ok, `"${w}" should be allowed`);
  const bad = (w: string) => assert(!checkWord(w, []).ok, `"${w}" should be rejected`);
  ok("a");
  ok("x".repeat(24));
  ok("jalapeño");
  ok("rock 'n' roll");
  ok("T-Rex");
  ok("Zoë");
  ok("кошка");
  bad("");
  bad("   ");
  bad("x".repeat(25));
  bad("abc1");
  bad("hi!");
  bad("<script>");
  bad("🧠");
  bad("--");
  bad("' '");
  bad("a_b");
  assert(wordProblem("x".repeat(25))!.includes("24"), "length message mentions the limit");

  eq(rating(1), "Impossible?!", "rating 1");
  eq(rating(2), "Telepathic", "rating 2");
  eq(rating(3), "Great minds", "rating 3");
  eq(rating(4), "Great minds", "rating 4");
  eq(rating(5), "Getting there", "rating 5");
  eq(rating(6), "Getting there", "rating 6");
  eq(rating(7), "Phew!", "rating 7");
  eq(rating(8), "Phew!", "rating 8");
}

// ---------- full game: meld in round 3 ----------
{
  const g = start(3);
  const { s, t } = g;
  const t0 = t.ctx.now();
  eq(s.phase, "writing", "starts writing");
  eq(s.round, 1, "round 1");
  eq(s.endsAt, t0 + FIRST_ROUND_MS, "round 1 is 40s");
  eq(g.view(0).phaseMs, FIRST_ROUND_MS, "view has the phase length");

  assert(g.submit(0, "cat") === true, "p0 submits");
  assert(g.submit(1, "dog") === true, "p1 submits");
  eq(s.phase, "writing", "waits for the last player");
  eq(
    g.view(2).locks.map((l) => l.state).join(),
    "locked,locked,thinking",
    "lock states visible",
  );
  assert(g.submit(2, "fish") === true, "p2 submits");
  eq(s.phase, "reveal", "everyone in -> reveal at once");
  eq(s.endsAt, t.ctx.now() + REVEAL_MS, "reveal lasts 5s");
  const r1 = g.last();
  eq(r1.sync, 1, "no matches in round 1");
  eq(r1.total, 3, "all 3 count");
  eq(r1.melded, false, "not melded");
  eq(r1.entries.map((e) => e.word).join(), "cat,dog,fish", "words in seat order");

  t.advance(REVEAL_MS - 1);
  assert(!g.tick(), "reveal still running");
  t.advance(1);
  assert(g.tick() === true, "reveal ends");
  eq(s.phase, "writing", "round 2 writing");
  eq(s.round, 2, "round 2");
  eq(s.endsAt, t.ctx.now() + ROUND_MS, "later rounds are 60s");

  // Earlier words are forbidden (plural / case variants too), via a private error.
  t.events.length = 0;
  assert(g.submit(0, "Cats") === false, "used word rejected");
  eq(t.events.length, 1, "one error event");
  eq(t.events[0].to, t.ids[0], "error goes only to the submitter");
  assert(isMmEvent(t.events[0].event), "event shape");
  assert((t.events[0].event as { msg: string }).msg.includes("cat"), "error names the used word");
  eq(s.subs[0], null, "nothing stored on rejection");

  g.submit(0, "pet");
  g.submit(1, "pets");
  g.submit(2, "animal");
  const r2 = g.last();
  eq(r2.sync, 2, "pet + pets match");
  eq(r2.entries.map((e) => e.group).join(), "0,0,-1", "group indexes");
  eq(r2.entries.map((e) => e.size).join(), "2,2,1", "group sizes");
  g.afterReveal();

  g.submit(0, "Furry");
  g.submit(1, "furry");
  g.submit(2, "  FURRY ");
  eq(s.phase, "reveal", "reveal first, even for a meld");
  assert(g.last().melded, "round 3 melded");
  eq(g.last().entries[2].word, "FURRY", "stored word is cleaned");
  eq(g.ends(), 0, "end waits for the reveal to finish");
  g.afterReveal();
  eq(s.phase, "melded", "melded phase");
  eq(s.reason, "meld", "reason meld");
  eq(g.ends(), 1, "ended once");
  assert(t.result, "has result");
  eq(t.result!.winners.join(), t.ids.join(), "everyone wins");
  assert(t.result!.headline.includes("3 rounds"), "headline has round count");
  assert(t.result!.headline.includes("furry"), "headline has the word");

  // After the end: nothing moves.
  t.advance(120_000);
  assert(!g.tick(), "no ticks after end");
  assert(g.submit(0, "again") === false, "no actions after end");
  assert(g.unlock(0) === false, "no unlock after end");
  g.leave(1);
  g.back(1);
  eq(s.phase, "melded", "still melded after disconnect/reconnect");
  eq(g.ends(), 1, "still ended once");
  const fv = g.view(0);
  eq(fv.endsAt, null, "no deadline once over");
  eq(fv.locks.length, 0, "no lock list once over");
  assertPlainJson(fv);
}

// ---------- full game: no meld in 8 rounds ----------
{
  const g = start(2);
  const words = "apple banana cherry dragon eagle falcon grape hippo igloo jelly kite lemon mango night ocean piano"
    .split(" ");
  for (let r = 1; r <= MAX_ROUNDS; r++) {
    eq(g.s.round, r, `round ${r}`);
    assert(g.submit(0, words[(r - 1) * 2]), `p0 word r${r}`);
    assert(g.submit(1, words[(r - 1) * 2 + 1]), `p1 word r${r}`);
    eq(g.s.phase, "reveal", `reveal r${r}`);
    eq(g.ends(), 0, "not over yet");
    g.afterReveal();
  }
  eq(g.s.phase, "failed", "failed after 8 rounds");
  eq(g.s.reason, "rounds", "reason rounds");
  eq(g.s.history.length, MAX_ROUNDS, "8 rounds recorded");
  eq(g.ends(), 1, "ended once");
  eq(g.t.result!.winners.length, 0, "no winners");
  assert(g.t.result!.headline.startsWith("No meld this time..."), "fail headline");
  assert(!g.tick(), "no ticks after failure");
  assert(g.submit(0, "quince") === false, "no actions after failure");
  g.leave(0);
  g.leave(1);
  g.t.advance(120_000);
  assert(!g.tick(), "no ticks with everyone gone after failure");
  g.back(0);
  g.back(1);
  eq(g.s.phase, "failed", "still failed after disconnect/reconnect");
  eq(g.s.reason, "rounds", "reason unchanged");
  eq(g.ends(), 1, "still ended once");
  const fv = g.view("spectator");
  eq(fv.history.length, MAX_ROUNDS, "spectators see the whole journey");
  eq(fv.endsAt, null, "no deadline after failure");
  assertPlainJson(fv);
}

// ---------- fail headline mentions the closest round ----------
{
  const g = start(3);
  const words = [
    ["alpha", "alpha", "bravo"],
    ["charlie", "delta", "echo"],
  ];
  for (let r = 1; r <= MAX_ROUNDS; r++) {
    const row = words[r - 1] ?? [];
    row.forEach((w, i) => g.submit(i, w));
    if (g.s.phase === "writing") {
      g.t.advance(ROUND_MS);
      g.tick();
    }
    g.afterReveal();
  }
  eq(g.s.phase, "failed", "failed");
  assert(g.t.result!.headline.includes("2 of 3"), `headline mentions best sync: ${g.t.result!.headline}`);
  eq(bestRound(g.s.history)!.round, 1, "best round is round 1");
}

// ---------- timers drive every phase ----------
{
  const g = start(3);
  const { s, t } = g;
  g.submit(0, "sun");
  t.advance(FIRST_ROUND_MS - 1);
  assert(!g.tick(), "not yet");
  eq(s.phase, "writing", "still writing");
  t.advance(1);
  assert(g.tick() === true, "timeout reveals");
  eq(s.phase, "reveal", "reveal on timeout");
  const r = g.last();
  eq(r.entries[1].word, null, "p1 blank");
  eq(r.entries[1].away, false, "p1 was online");
  eq(r.total, 3, "online blanks count");
  g.afterReveal();
  eq(s.round, 2, "round 2");
  t.advance(ROUND_MS - 1);
  assert(!g.tick(), "round 2 not over");
  t.advance(1);
  g.tick();
  eq(s.phase, "reveal", "round 2 timeout");
  eq(g.last().sync, 0, "nobody wrote anything");
  g.afterReveal();
  eq(s.round, 3, "round 3");
}

// ---------- a connected blank blocks a meld ----------
{
  const g = start(3);
  g.submit(0, "sun");
  g.submit(1, "sun");
  g.t.advance(FIRST_ROUND_MS);
  g.tick();
  eq(g.last().sync, 2, "two in sync");
  eq(g.last().total, 3, "three count");
  eq(g.last().melded, false, "online blank blocks the meld");
}

// ---------- an offline blank does not block a meld; leaving can trigger the reveal ----------
{
  const g = start(3);
  g.submit(0, "sun");
  g.submit(1, "sunS");
  eq(g.s.phase, "writing", "waiting for p2");
  g.leave(2);
  eq(g.s.phase, "reveal", "p2 leaving reveals immediately");
  const r = g.last();
  eq(r.entries[2].away, true, "p2 marked away");
  eq(r.total, 2, "away blank doesn't count");
  assert(r.melded, "two online players matched -> meld");
  g.afterReveal();
  eq(g.s.phase, "melded", "melded");
  eq(g.t.result!.winners.join(), g.ids.join(), "all participants win, even the absent one");
  assert(g.t.result!.headline.includes("1 round "), "singular round");
}

// ---------- an offline player's submitted word still counts ----------
{
  const g = start(3);
  g.submit(2, "moon");
  g.leave(2);
  g.submit(0, "sun");
  g.submit(1, "sun");
  eq(g.s.phase, "reveal", "all online players locked");
  eq(g.last().total, 3, "p2's word counts");
  eq(g.last().melded, false, "moon breaks the meld");
}

// ---------- unlock / change ----------
{
  const g = start(3);
  const { s, t } = g;
  assert(g.unlock(0) === false, "nothing to unlock");
  g.submit(0, "sun");
  assert(g.submit(0, "sun") === false, "same word again is a no-op");
  assert(g.submit(0, "star") === true, "change while locked");
  eq(s.subs[0]!.word, "star", "changed");
  assert(g.unlock(0) === true, "unlock");
  assert(g.unlock(0) === false, "already unlocked");
  eq(g.view(1).locks[0].state, "editing", "others see 'editing'");
  eq(g.view(0).me!.word, "star", "editor keeps their word");
  eq(g.view(0).me!.locked, false, "but unlocked");
  g.submit(1, "moon");
  g.submit(2, "comet");
  eq(s.phase, "writing", "an editing player holds the reveal");
  t.advance(FIRST_ROUND_MS);
  g.tick();
  eq(s.phase, "reveal", "timeout reveals");
  eq(g.last().entries[0].word, "star", "unlocked word still played at timeout");

  const g2 = start(2);
  g2.submit(0, "sun");
  g2.unlock(0);
  g2.submit(1, "moon");
  eq(g2.s.phase, "writing", "waits for the editor");
  g2.submit(0, "moon");
  eq(g2.s.phase, "reveal", "relock reveals");
  assert(g2.last().melded, "and melds");
}

// ---------- pause when fewer than 2 are online, resume, or give up ----------
{
  // Resume keeps the remaining time.
  const g = start(2);
  const { s, t } = g;
  t.advance(10_000);
  g.leave(1);
  eq(s.pausedLeft, FIRST_ROUND_MS - 10_000, "paused with 30s left");
  eq(s.waitUntil, t.ctx.now() + WAIT_MS, "waits for players");
  eq(g.view(0).endsAt, null, "no running deadline while paused");
  eq(g.view(0).pausedLeft, FIRST_ROUND_MS - 10_000, "pause visible");
  t.advance(20_000);
  assert(!g.tick(), "still paused");
  eq(s.phase, "writing", "timer frozen");
  assert(g.submit(0, "sun") === true, "can still type while paused");
  eq(s.phase, "writing", "no early reveal while paused");
  g.back(1);
  eq(s.pausedLeft, null, "resumed");
  eq(s.endsAt, t.ctx.now() + FIRST_ROUND_MS - 10_000, "remaining time restored");
  g.submit(1, "sun");
  eq(s.phase, "reveal", "reveal after resume");
  assert(g.last().melded, "meld after resume");
}
{
  // Short remaining time gets topped up on resume.
  const g = start(2);
  g.t.advance(38_000);
  g.leave(0);
  eq(g.s.pausedLeft, 2_000, "2s left");
  g.back(0);
  eq(g.s.endsAt, g.t.ctx.now() + RESUME_MS, "topped up");
}
{
  // Nobody comes back: the game ends gracefully.
  const g = start(2);
  g.leave(1);
  g.t.advance(WAIT_MS - 1);
  assert(!g.tick(), "still waiting");
  g.t.advance(1);
  assert(g.tick() === true, "gives up");
  eq(g.s.phase, "failed", "failed");
  eq(g.s.reason, "players", "reason players");
  eq(g.ends(), 1, "ended once");
  eq(g.t.result!.winners.length, 0, "no winners");
  g.back(1);
  assert(!g.tick(), "nothing after end");
  eq(g.ends(), 1, "still once");
}
{
  // Everyone gone (3 players): waits, then ends.
  const g = start(3);
  g.leave(0);
  eq(g.s.pausedLeft, null, "2 online: no pause");
  g.leave(1);
  assert(g.s.pausedLeft !== null, "1 online: paused");
  g.leave(2);
  g.t.advance(WAIT_MS);
  g.tick();
  eq(g.s.phase, "failed", "ends with nobody around");
}

// ---------- disconnects during the reveal ----------
{
  const g = start(2);
  g.submit(0, "sun");
  g.submit(1, "moon");
  eq(g.s.phase, "reveal", "reveal");
  g.leave(1);
  eq(g.s.phase, "reveal", "reveal keeps going");
  g.afterReveal();
  eq(g.s.phase, "writing", "round 2");
  eq(g.s.pausedLeft, ROUND_MS, "round 2 starts paused");
  g.t.advance(10_000);
  g.back(1);
  eq(g.s.pausedLeft, null, "resumed");
  eq(g.s.endsAt, g.t.ctx.now() + ROUND_MS, "full round time");
}

// ---------- reconnecting mid-round keeps your word ----------
{
  const g = start(3);
  g.submit(0, "sun");
  g.leave(0);
  eq(g.s.phase, "writing", "others still thinking");
  g.back(0);
  eq(g.view(0).me!.word, "sun", "word survives a reconnect");
  eq(g.view(0).me!.locked, true, "still locked");
}

// ---------- hostile input ----------
{
  const g = start(3);
  const { s, t } = g;
  const snapshot = () => JSON.stringify(s);
  const before = snapshot();
  const junk: unknown[] = [
    null,
    undefined,
    "submit",
    42,
    true,
    [],
    ["submit", "cat"],
    {},
    { type: "nope" },
    { type: "SUBMIT", word: "cat" },
    { type: "submit" },
    { type: "submit", word: 42 },
    { type: "submit", word: null },
    { type: "submit", word: ["cat"] },
    { type: "submit", word: { toString: "cat" } },
    { type: "submit", word: "x".repeat(1_000_000) },
    { type: "submit", word: "" },
    { type: "submit", word: "   " },
    { type: "submit", word: "x".repeat(25) },
    { type: "submit", word: "abc123" },
    { type: "submit", word: "<b>hi</b>" },
    { type: "submit", word: "🧠" },
    { type: "submit", word: "\u0000\u0001" },
    { type: "unlock" },
    { type: "unlock", word: "cat" },
  ];
  for (const a of junk) {
    let r: boolean | void;
    try {
      r = g.act(0, a);
    } catch (e) {
      throw new Error(`action threw for ${JSON.stringify(a)?.slice(0, 60)}: ${e}`);
    }
    assert(r === false, `rejected: ${JSON.stringify(a)?.slice(0, 60)}`);
  }
  eq(snapshot(), before, "state untouched by junk");
  assert(
    t.events.every((e) => e.to === t.ids[0] && isMmEvent(e.event)),
    "only private error events",
  );
  assert(g.act("stranger", { type: "submit", word: "cat" }) === false, "non-participant rejected");
  assert(g.act("spectator", { type: "unlock" }) === false, "spectator rejected");
  eq(snapshot(), before, "state untouched by outsiders");

  // Wrong phase.
  g.submit(0, "sun");
  g.submit(1, "moon");
  g.submit(2, "star");
  eq(s.phase, "reveal", "reveal");
  const during = snapshot();
  assert(g.submit(0, "comet") === false, "no submits during reveal");
  assert(g.unlock(0) === false, "no unlock during reveal");
  eq(snapshot(), during, "reveal untouched");
}

// ---------- secrecy ----------
{
  const g = start(3);
  g.submit(0, "zebracorn");
  for (const who of [1, 2, "spectator", "stranger"]) {
    const json = JSON.stringify(g.view(who));
    assert(!json.includes("zebracorn"), `secret leaked to ${who}`);
  }
  assert(JSON.stringify(g.view(0)).includes("zebracorn"), "you see your own word");
  eq(g.view("spectator").me, null, "spectators have no seat");
  eq(g.view("spectator").locks[0].state, "locked", "spectators see lock states");
  g.submit(1, "unicornfish");
  g.submit(2, "narwhal");
  for (const who of [0, 1, 2, "spectator"]) {
    assert(JSON.stringify(g.view(who)).includes("zebracorn"), "revealed words are public");
  }
  g.afterReveal();
  g.submit(1, "hornedthing");
  assert(!JSON.stringify(g.view(0)).includes("hornedthing"), "round 2 secret hidden");
  assert(!JSON.stringify(g.view("spectator")).includes("hornedthing"), "round 2 secret hidden from spectators");
  for (const who of [0, 1, 2, "spectator"]) assertPlainJson(g.view(who));
}

// ---------- ties and grouping ----------
{
  const g = start(4);
  g.submit(0, "moon");
  g.submit(1, "sun");
  g.submit(2, "Moons");
  g.submit(3, "sun");
  const r = g.last();
  eq(r.sync, 2, "largest group 2");
  eq(r.melded, false, "two pairs is no meld");
  eq(r.entries.map((e) => e.group).join(), "0,1,0,1", "first-seen pair is group 0");
  eq(r.entries.map((e) => e.size).join(), "2,2,2,2", "all in pairs");
}

// ---------- forbidden words span all earlier rounds ----------
{
  const g = start(2);
  g.submit(0, "Rock");
  g.submit(1, "paper");
  g.afterReveal();
  g.submit(0, "scissors");
  g.submit(1, "lizard");
  g.afterReveal();
  assert(g.submit(0, "rocks") === false, "round 1 word forbidden in round 3");
  assert(g.submit(1, "the paper") === false, "article variant forbidden");
  assert(g.submit(1, "Scissor") === false, "round 2 word forbidden");
  assert(g.submit(0, "spock") === true, "new word fine");
}

// ---------- max players: instant meld ----------
{
  const g = start(12);
  for (let i = 0; i < 11; i++) g.submit(i, i % 2 ? "Brain" : "brains");
  eq(g.s.phase, "writing", "waits for the 12th");
  g.submit(11, "BRAIN");
  assert(g.last().melded, "12-way meld");
  eq(g.last().sync, 12, "12 in sync");
  g.afterReveal();
  eq(g.s.phase, "melded", "melded");
  eq(g.t.result!.winners.length, 12, "12 winners");
  assert(g.t.result!.headline.includes("in 1 round "), `round 1 headline: ${g.t.result!.headline}`);
  eq(rating(g.last().round), "Impossible?!", "round 1 rating");
  for (const who of [0, 11, "spectator"]) assertPlainJson(g.view(who));
}

// ---------- min players: meld in round 2 ----------
{
  const g = start(2);
  g.submit(0, "salt");
  g.submit(1, "ocean");
  g.afterReveal();
  g.submit(0, "sea");
  g.submit(1, "Sea");
  g.afterReveal();
  eq(g.s.phase, "melded", "melded in round 2");
  eq(rating(g.s.history.length), "Telepathic", "rating");
  assert(g.t.result!.headline.includes("2 rounds"), "headline");
  eq(g.ends(), 1, "ended once");
}

// ---------- the last round can still meld ----------
{
  const g = start(2);
  for (let r = 1; r < MAX_ROUNDS; r++) {
    g.submit(0, `a${"bcdefgh"[r - 1]}`);
    g.submit(1, `z${"bcdefgh"[r - 1]}`);
    g.afterReveal();
  }
  eq(g.s.round, MAX_ROUNDS, "final round");
  g.submit(0, "finally");
  g.submit(1, "Finally");
  g.afterReveal();
  eq(g.s.phase, "melded", "meld beats running out");
  eq(rating(MAX_ROUNDS), "Phew!", "phew");
  eq(g.ends(), 1, "ended once");
}

// ---------- plurals of words ending in -e (headache/headaches, axe/axes) ----------
{
  const same = (a: string, b: string) => eq(matchKey(a), matchKey(b), `"${a}" should match "${b}"`);
  const pairs: [string, string][] = [
    ["ache", "aches"],
    ["headache", "headaches"],
    ["toothache", "toothaches"],
    ["niche", "niches"],
    ["cache", "caches"],
    ["avalanche", "avalanches"],
    ["moustache", "moustaches"],
    ["quiche", "quiches"],
    ["cliché", "clichés"],
    ["psyche", "psyches"],
    ["axe", "axes"],
    ["posse", "posses"],
    ["impasse", "impasses"],
    ["crevasse", "crevasses"],
    ["beach", "beaches"],
    ["fox", "foxes"],
    ["buzz", "buzzes"],
    ["box", "boxes"],
    ["dish", "dishes"],
    ["kiss", "kisses"],
    ["glass", "glasses"],
  ];
  for (const [a, b] of pairs) same(a, b);
  assert(matchKey("cache") !== matchKey("cash"), "cache should not match cash");
  assert(matchKey("hat") !== matchKey("hate"), "hat should not match hate");
  assert(matchKey("plan") !== matchKey("plane"), "plan should not match plane");

  // The two forms meld, and the plural is a repeat once the singular was revealed.
  const g = start(2);
  g.submit(0, "headache");
  g.submit(1, "Headaches");
  assert(g.last().melded, "headache + headaches is a meld");
  const g2 = start(2);
  g2.submit(0, "headache");
  g2.submit(1, "migraine");
  g2.afterReveal();
  assert(g2.submit(0, "headaches") === false, "plural of a revealed word is forbidden");
  assert(g2.submit(1, "axes") === true, "unrelated word still fine");
}

// ---------- 2 players: a locked-in player who drops out still counts ----------
{
  // The offline player's word plus the last word in -> reveal and meld (no pause, no abandon).
  const g = start(2);
  g.submit(0, "sun");
  g.leave(0);
  eq(g.s.pausedLeft, null, "a locked-in player who drops doesn't pause the round");
  eq(g.view(1).endsAt, g.s.endsAt, "the clock keeps running for the player still typing");
  g.submit(1, "Sun");
  eq(g.s.phase, "reveal", "last online word reveals everything");
  eq(g.last().entries[0].word, "sun", "offline player's word is revealed");
  eq(g.last().entries[0].away, false, "and isn't an offline blank");
  assert(g.last().melded, "two matching words meld");
  g.afterReveal();
  eq(g.s.phase, "melded", "melded");
  eq(g.t.result!.winners.length, 2, "both win");
}
{
  // The online player runs out of time: normal timeout reveal, then the next round pauses.
  const g = start(2);
  g.t.advance(5_000);
  g.submit(0, "sun");
  g.leave(0);
  g.t.advance(FIRST_ROUND_MS - 5_000 - 1);
  assert(!g.tick(), "still writing");
  eq(g.s.phase, "writing", "the online player keeps their full round");
  g.t.advance(1);
  assert(g.tick() === true, "timeout reveals");
  eq(g.s.phase, "reveal", "reveal");
  eq(g.last().total, 2, "the offline word and the online blank both count");
  eq(g.last().melded, false, "no meld");
  g.afterReveal();
  eq(g.s.round, 2, "round 2");
  eq(g.s.pausedLeft, ROUND_MS, "round 2 pauses: the absent player has no word yet");
  g.back(0);
  eq(g.s.pausedLeft, null, "resumes when they return");
}
{
  // 3 players: two lock in and drop, the last one finishes the round.
  const g = start(3);
  g.submit(0, "moon");
  g.leave(0);
  g.submit(1, "moon");
  g.leave(1);
  eq(g.s.pausedLeft, null, "words from offline players keep the round alive");
  g.submit(2, "moons");
  eq(g.s.phase, "reveal", "reveal");
  assert(g.last().melded, "3-way meld with two offline players");
}
{
  // Everyone offline: freeze and wait, even if two words are in.
  const g = start(3);
  g.submit(0, "moon");
  g.submit(1, "moon");
  g.leave(0);
  g.leave(1);
  g.leave(2);
  eq(g.s.phase, "writing", "no reveal with nobody around");
  assert(g.s.pausedLeft !== null, "paused");
  g.back(2);
  eq(g.s.pausedLeft, null, "the thinking player returns: resumed");
  g.submit(2, "moon");
  assert(g.last().melded, "meld after everyone came back");
}

// ---------- a flaky connection can't stretch a round forever ----------
{
  const g = start(2);
  g.t.advance(38_000);
  g.leave(1);
  eq(g.s.pausedLeft, 2_000, "2s left");
  g.back(1);
  eq(g.s.endsAt, g.t.ctx.now() + RESUME_MS, "first resume tops up to 15s");
  g.t.advance(RESUME_MS - 2_000);
  g.leave(1);
  eq(g.s.pausedLeft, 2_000, "2s left again");
  g.t.advance(1_000);
  g.back(1);
  eq(g.s.endsAt, g.t.ctx.now() + 2_000, "later resumes in the same round keep the time left");
  g.t.advance(2_000);
  assert(g.tick() === true, "round ends");
  eq(g.s.phase, "reveal", "revealed on time");
  g.afterReveal();
  // The top-up is available again in the next round.
  g.t.advance(ROUND_MS - 1_000);
  g.leave(0);
  g.back(0);
  eq(g.s.endsAt, g.t.ctx.now() + RESUME_MS, "new round, new top-up");
}
{
  // A drop between the deadline and the next tick doesn't add time to an expired round.
  const g = start(2);
  g.submit(0, "sun");
  g.t.advance(FIRST_ROUND_MS + 100);
  g.leave(1);
  eq(g.s.phase, "reveal", "expired round reveals instead of pausing");
  eq(g.last().entries[1].away, true, "the leaver is an offline blank");
  eq(g.last().melded, false, "one word alone is no meld");
}

// ---------- invisible letters, variation selectors, stacked accents ----------
{
  for (const filler of ["\u3164", "\u115F", "\u1160", "\uFFA0", "\u3164\u3164"]) {
    eq(cleanWord(filler), "", `filler U+${filler.codePointAt(0)!.toString(16)} stripped`);
    assert(!checkWord(filler, []).ok, "an invisible 'word' is rejected");
  }
  eq(cleanWord("c\u3164at"), "cat", "fillers inside a word are stripped");
  eq(cleanWord("cat\uFE00"), "cat", "variation selector stripped");
  eq(cleanWord("cat\uFE0F"), "cat", "emoji presentation selector stripped");
  eq(cleanWord("ca\u{E0100}t"), "cat", "supplementary variation selector stripped");
  eq(cleanWord("ca\u180Bt"), "cat", "Mongolian variation selector stripped");
  eq(cleanWord("c\u034Fat"), "cat", "combining grapheme joiner stripped");
  eq(cleanWord("he\u202Ello\u200B"), "hello", "existing invisible set still stripped");

  // Marks that don't compose under NFC stay stacked; 4+ on one letter is Zalgo.
  eq(wordProblem("x\u0301\u0302\u0303\u0304"), "Too many accent marks on one letter.", "four stacked accents rejected");
  assert(!checkWord("z\u0334\u0322\u031B\u0356a\u0337\u0338\u0336\u0335lgo", []).ok, "zalgo rejected");
  assert(checkWord("x\u0301\u0302\u0303", []).ok, "up to three marks on one letter is fine");
  assert(checkWord("Vi\u1EC7t", []).ok, "Vietnamese is fine");
  assert(checkWord("Vi\u1EC7t".normalize("NFD"), []).ok, "decomposed Vietnamese is fine");
  assert(checkWord("\u0928\u092E\u0938\u094D\u0924\u0947", []).ok, "Devanagari is fine");
  assert(checkWord("\u0E01\u0E49\u0E32\u0E27", []).ok, "Thai is fine");

  // A look-alike can't dodge the no-repeats rule.
  const g = start(2);
  g.submit(0, "cat");
  g.submit(1, "dog");
  g.afterReveal();
  assert(g.submit(0, "cat\uFE00") === false, "cat + variation selector is still 'cat'");
  assert(g.submit(1, "\u3164") === false, "invisible filler rejected in play");
}

console.log("mindmeld: all tests passed");

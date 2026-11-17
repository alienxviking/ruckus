// End-to-end smoke test against a running `partykit dev` (localhost:1999).
// Two fake players join a room, play a full Tic-Tac-Toe match, and we check
// the room records the winner. Run: node scripts/e2e-room.mjs

const HOST = process.env.PARTY_HOST ?? "localhost:1999";
const room = "e2e" + Math.random().toString(36).slice(2, 7);
// Rooms must be created before anyone can join (a mistyped code is refused).
const created = await fetch(`http://${process.env.PARTY_HOST ?? "localhost:1999"}/parties/main/${room}`, { method: "POST" }).then((r) => r.json());
if (!created.ok) throw new Error("couldn't create the room: " + JSON.stringify(created));
{
  // A code nobody created is refused.
  const ghost = "nope" + Math.random().toString(36).slice(2, 7);
  const exists = await fetch(`http://${process.env.PARTY_HOST ?? "localhost:1999"}/parties/main/${ghost}`).then((r) => r.json());
  if (exists.exists) throw new Error("uncreated room reported as existing");
  console.log("✓ uncreated room code reported as missing");
}

function client(id, name) {
  const ws = new WebSocket(`ws://${HOST}/parties/main/${room}?_pk=${id}.${Math.random().toString(36).slice(2, 8)}`);
  const c = { id, ws, room: null, view: null, events: [], waiters: [] };
  c.received = [];
  c.closed = new Promise((r) => ws.addEventListener("close", (e) => r(e.code)));
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    c.received.push(m.t);
    // Room messages carry the chat history only on join; new lines arrive as "chat" deltas.
    if (m.t === "room") c.room = { ...m.room, chat: m.room.chat ?? c.room?.chat ?? [] };
    if (m.t === "chat" && c.room) c.room.chat = [...c.room.chat, m.msg];
    if (m.t === "game") c.view = m.view;
    if (m.t === "ev") c.events.push(m.e);
    if (m.t === "rejected") c.rejected = m.msg;
    if (m.t === "react") c.reacts = (c.reacts ?? 0) + 1;
    if (m.t === "words") {
      c.words = m;
      c.wordsMsgs = (c.wordsMsgs ?? 0) + 1;
    }
    if (m.t === "err") console.log(`  [${name}] err: ${m.msg}`);
    c.waiters = c.waiters.filter((w) => !w());
  });
  c.send = (msg) => ws.send(JSON.stringify(msg));
  c.until = (pred, ms = 4000) =>
    new Promise((res, rej) => {
      if (pred()) return res();
      const t = setTimeout(() => rej(new Error(`${name}: timed out waiting; view=${JSON.stringify(c.view)?.slice(0, 400)} result=${JSON.stringify(c.room?.result)}`)), ms);
      c.waiters.push(() => (pred() ? (clearTimeout(t), res(), true) : false));
    });
  c.open = new Promise((r) => ws.addEventListener("open", r));
  c.hello = (key = `${id}-secret-key-0001`) => c.send({ t: "hello", name, color: "#4ade80", avatar: "🦊", key });
  return c;
}

const a = client("alice1", "Alice");
const b = client("bob1", "Bob");
await Promise.all([a.open, b.open]);
a.hello();
await a.until(() => a.room?.players.length === 1);
b.hello();
await a.until(() => a.room?.players.length === 2);
console.log("✓ both joined; host =", a.room.hostId);

b.send({ t: "pick", gameId: "tictactoe" }); // not host: ignored
a.send({ t: "pick", gameId: "tictactoe" });
await b.until(() => b.room?.gameId === "tictactoe");
a.send({ t: "start" });
await b.until(() => b.room?.phase === "playing" && b.view);
await a.until(() => a.room?.phase === "playing" && a.view);
console.log("✓ game started");

// Impostor: knows Bob's public id (everyone does) but not his secret key.
{
  const imp = client("bob1", "Impostor");
  await imp.open;
  const boardBefore = JSON.stringify(a.view.board);
  imp.send({ t: "act", a: { type: "place", cell: 8 } }); // before hello: must be ignored
  imp.send({ t: "chat", text: "I am Bob" });
  imp.hello("totally-wrong-key-123456");
  const code = await imp.closed;
  if (!imp.rejected || code !== 4001) throw new Error(`impostor not rejected (code ${code})`);
  if (imp.received.some((t) => t === "room" || t === "game" || t === "ev")) {
    throw new Error(`impostor received data: ${imp.received.join(",")}`);
  }
  await new Promise((r) => setTimeout(r, 300));
  if (JSON.stringify(a.view.board) !== boardBefore) throw new Error("impostor's move was applied");
  if (a.room.chat.some((m) => m.text === "I am Bob")) throw new Error("impostor's chat was accepted");
  if (a.room.players.find((p) => p.id === "bob1")?.connected !== true) throw new Error("real Bob affected");
  // Bob's own socket must still get updates (sockets never share an id on the server).
  a.send({ t: "chat", text: "still there, Bob?" });
  await b.until(() => b.room.chat.some((m) => m.text === "still there, Bob?"));
  console.log("✓ impostor with a stolen id was rejected and saw nothing:", imp.rejected);
}

// Play rounds: both sides take the first free cell in this order, so whoever
// starts completes the top row (0,1,2) while the other fills 3,4.
const order = [0, 3, 1, 4, 2, 5, 6, 7, 8];
let moves = 0;
while (!a.room.result && moves < 200) {
  const v = a.view;
  if (v.roundEnd) {
    const round = v.round;
    await a.until(() => a.view.round !== round || a.room.result, 4000);
    continue;
  }
  const actor = v.seats[v.turn] === a.id ? a : b;
  const cell = order.find((i) => v.board[i] === null);
  const before = JSON.stringify(v.board);
  actor.send({ t: "act", a: { type: "place", cell } });
  await a.until(() => JSON.stringify(a.view.board) !== before || a.view.roundEnd || a.room.result);
  moves++;
}
console.log("✓ match finished:", a.room.result?.headline, "| wins:", JSON.stringify(a.room.wins));

// Quick play: turning it on after a result queues a fitting game, which starts by itself.
{
  const seq = a.room.gameSeq;
  b.send({ t: "auto", on: true }); // not host: ignored
  a.send({ t: "auto", on: true });
  await b.until(() => b.room.autoNext && b.room.next).catch((e) => { console.log("room:", JSON.stringify({ auto: b.room.autoNext, next: b.room.next, result: !!b.room.result, chat: b.room.chat.slice(-3) })); throw e; });
  const next = b.room.next;
  if (next.gameId === "tictactoe") throw new Error("quick play repeated the game just played");
  console.log("✓ quick play queued", next.gameId, "in", Math.round((next.at - Date.now()) / 1000), "s");
  await b.until(() => b.room.gameSeq === seq + 1 && b.room.phase === "playing" && b.room.gameId === next.gameId, 16000);
  console.log("✓ quick play started", b.room.gameId, "by itself");
  // Someone joining mid-game is told they play from the next round.
  const c = client("cara1", "Cara");
  await c.open;
  c.hello();
  await a.until(() => a.room.chat.some((m) => m.text === "Cara joined · playing from the next round"));
  if (a.room.participants.includes("cara1")) throw new Error("late joiner was seated mid-game");
  console.log("✓ late joiner watches, told they're in next round");
  c.ws.close();
  await c.closed;
  a.send({ t: "auto", on: false });
  await b.until(() => !b.room.autoNext);
}

// Reconnect keeps identity
b.ws.close();
await a.until(() => a.room.players.find((p) => p.id === "bob1")?.connected === false);
const b2 = client("bob1", "Bob");
await b2.open;
b2.hello();
await a.until(() => a.room.players.find((p) => p.id === "bob1")?.connected === true);
console.log("✓ reconnect restored player, players:", a.room.players.length);

a.send({ t: "lobby" });
await b2.until(() => b2.room?.phase === "lobby");
console.log("✓ back to lobby");

// ---- Reactions are rate limited: a burst of 6 only lets 3 through. ----
{
  const before = b2.reacts ?? 0;
  for (let i = 0; i < 6; i++) a.send({ t: "react", e: i % 6 });
  a.send({ t: "react", e: 99 }); // invalid: ignored
  await new Promise((r) => setTimeout(r, 600));
  const got = (b2.reacts ?? 0) - before;
  if (got !== 3) throw new Error(`expected 3 reactions through the limit, got ${got}`);
  console.log("✓ reactions rate limited (3 of 6 through)");
}

// ---- Host hand-off: Alice makes Bob host, Bob hands it back. Non-hosts can't. ----
{
  b2.send({ t: "host", id: "bob1" }); // not host: ignored
  a.send({ t: "host", id: "bob1" });
  await a.until(() => a.room.hostId === "bob1");
  a.send({ t: "lock", on: true }); // Alice isn't host any more: ignored
  await new Promise((r) => setTimeout(r, 200));
  if (a.room.locked) throw new Error("non-host locked the room");
  b2.send({ t: "host", id: "alice1" });
  await a.until(() => a.room.hostId === "alice1");
  console.log("✓ host hand-off both ways; non-host can't use host tools");
}

// ---- Lock: nobody new gets in; unlocking opens it again. ----
{
  a.send({ t: "lock", on: true });
  await b2.until(() => b2.room.locked);
  const d = client("dave1", "Dave");
  await d.open;
  d.hello();
  const code = await d.closed;
  if (!/locked/i.test(d.rejected ?? "") || code !== 4001) throw new Error(`locked room let Dave in (${d.rejected}, ${code})`);
  a.send({ t: "lock", on: false });
  await b2.until(() => !b2.room.locked);
  console.log("✓ locked room refuses newcomers, unlock works");
}

// ---- Settings: host only, validated; custom words go to the host only. ----
{
  a.send({ t: "pick", gameId: "sketch" });
  await b2.until(() => b2.room.gameId === "sketch");
  const words = Array.from({ length: 12 }, (_, i) => `custom thing ${i}`);
  b2.send({ t: "setting", gameId: "sketch", key: "words", value: ["hack"] }); // not host
  a.send({ t: "setting", gameId: "sketch", key: "words", value: [...words, "  custom thing 0 ", "x".repeat(500)] });
  await b2.until(() => b2.room.wordCounts?.words === 13);
  await a.until(() => a.words?.words?.words?.length === 13);
  if (b2.wordsMsgs) throw new Error("non-host received the custom words");
  if (a.words.words.words.some((w) => w.length > 40)) throw new Error("long word not trimmed");
  console.log("✓ custom words: cleaned, de-duplicated, host-only (others see a count)");

  a.send({ t: "pick", gameId: "tictactoe" });
  await b2.until(() => b2.room.gameId === "tictactoe");
  a.send({ t: "setting", gameId: "tictactoe", key: "target", value: 1 });
  await b2.until(() => b2.room.settings?.target === 1);
  a.send({ t: "setting", gameId: "tictactoe", key: "target", value: 99 }); // not an option
  b2.send({ t: "setting", gameId: "tictactoe", key: "target", value: 5 }); // not host
  await new Promise((r) => setTimeout(r, 300));
  if (b2.room.settings.target !== 1) throw new Error("invalid / non-host setting was applied");
  console.log("✓ settings: host only, only listed options");
}

// ---- Remove: Bob is kicked and can't come back. ----
{
  b2.send({ t: "kick", id: "alice1" }); // not host
  a.send({ t: "kick", id: "bob1" });
  const code = await b2.closed;
  if (code !== 4003 || !/removed/i.test(b2.rejected ?? "")) throw new Error(`kick didn't close Bob (${code}, ${b2.rejected})`);
  await a.until(() => !a.room.players.some((p) => p.id === "bob1"));
  const b3 = client("bob1", "Bob");
  await b3.open;
  b3.hello();
  await b3.closed;
  if (!/removed/i.test(b3.rejected ?? "")) throw new Error("kicked player got back in");
  console.log("✓ removed player is gone and can't rejoin");
}

// ---- Practice bot: Alice + a bot play a 1-round Tic-Tac-Toe; pausing freezes the game. ----
{
  a.send({ t: "bot", add: true });
  await a.until(() => a.room.players.some((p) => p.bot));
  const seq = a.room.gameSeq;
  const historyBefore = a.room.history.length;
  a.send({ t: "start" });
  await a.until(() => a.room.gameSeq === seq + 1 && a.view);
  if (a.room.participants.length !== 2) throw new Error("bot didn't take a seat");

  // Pause: the game clock stops and moves are refused until it resumes.
  a.send({ t: "pause", on: true });
  await a.until(() => a.room.pause?.by.includes("alice1"));
  const frozen = JSON.stringify(a.view.board);
  a.send({ t: "act", a: { type: "place", cell: a.view.board.findIndex((c) => c === null) } });
  await new Promise((r) => setTimeout(r, 2500)); // the bot would have moved by now
  if (JSON.stringify(a.view.board) !== frozen) throw new Error("board changed while paused");
  a.send({ t: "pause", on: false });
  await a.until(() => !a.room.pause && a.room.pausedMs >= 2000);
  console.log("✓ pause froze the game for", Math.round(a.room.pausedMs / 100) / 10, "s, then resumed");

  let guard = 0;
  while (!a.room.result && guard++ < 60) {
    const v = a.view;
    if (!v.roundEnd && v.seats[v.turn] === a.id) {
      const before = JSON.stringify(v.board);
      a.send({ t: "act", a: { type: "place", cell: order.find((i) => v.board[i] === null) } });
      await a.until(() => JSON.stringify(a.view.board) !== before || a.room.result, 4000);
    } else {
      const before = JSON.stringify(v.board);
      await a.until(() => JSON.stringify(a.view.board) !== before || a.room.result, 8000);
    }
  }
  if (!a.room.result) throw new Error("bot game didn't finish");
  if (a.room.history.length !== historyBefore + 1) throw new Error("history not recorded");
  console.log("✓ bot game finished:", a.room.result.headline);
  a.send({ t: "lobby" });
  await a.until(() => a.room.phase === "lobby");
  a.send({ t: "bot", add: false });
  await a.until(() => !a.room.players.some((p) => p.bot));
  console.log("✓ bot removed");
}
a.ws.close();
await a.closed;
// Exit after sockets fully close (exiting mid-close trips a libuv assert on Windows).
setTimeout(() => process.exit(0), 100);

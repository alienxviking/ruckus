// End-to-end smoke test against a running `partykit dev` (localhost:1999).
// Two fake players join a room, play a full Tic-Tac-Toe match, and we check
// the room records the winner. Run: node scripts/e2e-room.mjs

const HOST = process.env.PARTY_HOST ?? "localhost:1999";
const room = "e2e" + Math.random().toString(36).slice(2, 7);

function client(id, name) {
  const ws = new WebSocket(`ws://${HOST}/parties/main/${room}?_pk=${id}`);
  const c = { id, ws, room: null, view: null, events: [], waiters: [] };
  c.received = [];
  c.closed = new Promise((r) => ws.addEventListener("close", (e) => r(e.code)));
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    c.received.push(m.t);
    if (m.t === "room") c.room = m.room;
    if (m.t === "game") c.view = m.view;
    if (m.t === "ev") c.events.push(m.e);
    if (m.t === "rejected") c.rejected = m.msg;
    if (m.t === "err") console.log(`  [${name}] err: ${m.msg}`);
    c.waiters = c.waiters.filter((w) => !w());
  });
  c.send = (msg) => ws.send(JSON.stringify(msg));
  c.until = (pred, ms = 4000) =>
    new Promise((res, rej) => {
      if (pred()) return res();
      const t = setTimeout(() => rej(new Error(`${name}: timed out waiting`)), ms);
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
a.ws.close();
b2.ws.close();
await Promise.all([a.closed, b2.closed]);
// Exit after sockets fully close (exiting mid-close trips a libuv assert on Windows).
setTimeout(() => process.exit(0), 100);

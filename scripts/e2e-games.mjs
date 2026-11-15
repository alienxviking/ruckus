// Integration test for every game against a real `partykit dev` (localhost:1999).
// For each game: N clients join, the host starts it, everyone throws hostile junk
// actions at it, one player drops and reconnects, and we check the room is still
// alive (chat round-trips, views keep coming) and how much data it sends.
//
//   npx tsx scripts/e2e-games.mjs [gameId ...]
import { CATALOG } from "../games/catalog.ts";

const HOST = process.env.PARTY_HOST ?? "localhost:1999";
const only = process.argv.slice(2);
const games = CATALOG.filter((g) => !only.length || only.includes(g.id));

const JUNK = [
  null,
  42,
  "x",
  [],
  {},
  { type: "x" },
  { type: null },
  { type: "__proto__" },
  { type: "constructor" },
  { type: "guess", text: "a".repeat(5000) },
  { type: "answer", choice: -1, q: 1e9 },
  { type: "turn", dir: "sideways" },
  { type: "line", o: "h", r: 99, c: -4 },
  { type: "drop", col: 1.5 },
  { type: "place", cell: "4" },
  { type: "stroke", id: "s", color: "#000", size: 9, pts: [1, 2, "x", 4] },
  { type: "stroke", id: "y".repeat(400), color: "red", size: 1e9, pts: new Array(5000).fill(1) },
  { type: "vote", target: { $gt: "" } },
  { type: "dial", v: Infinity },
  { type: "dial", v: Number.NaN },
  { type: "tap", round: "1", rt: -5 },
  { type: "clue", text: ["array"] },
  { type: "lie", text: "\u0000\u0007 control" },
  { type: "pick", option: 999 },
  { type: "veto", player: "nobody", i: 7 },
  { type: "sync" },
  { type: "undo" },
  { type: "clear" },
  { type: "ready" },
  { type: "done" },
  { type: "lock" },
  { type: "reroll" },
];

function client(room, id, name) {
  const ws = new WebSocket(`ws://${HOST}/parties/main/${room}?_pk=${id}`);
  const c = { id, ws, room: null, view: null, stats: { game: 0, bytes: 0, maxMsg: 0, ev: 0 }, waiters: [] };
  ws.addEventListener("message", (e) => {
    const data = String(e.data);
    const m = JSON.parse(data);
    // Room messages carry the chat history only on join; new lines arrive as "chat" deltas.
    if (m.t === "room") c.room = { ...m.room, chat: m.room.chat ?? c.room?.chat ?? [] };
    if (m.t === "chat" && c.room) c.room.chat = [...c.room.chat, m.msg];
    if (m.t === "game") {
      c.view = m.view;
      c.stats.game++;
      c.stats.bytes += data.length;
      c.stats.maxMsg = Math.max(c.stats.maxMsg, data.length);
    }
    if (m.t === "ev") {
      c.stats.ev++;
      c.stats.bytes += data.length;
      c.stats.maxMsg = Math.max(c.stats.maxMsg, data.length);
    }
    c.waiters = c.waiters.filter((w) => !w());
  });
  c.closing = false;
  c.dropped = false;
  ws.addEventListener("close", () => {
    if (c.closing) return;
    // The server closed us without being asked: usually `partykit dev` reloading after a file save.
    c.dropped = true;
    for (const w of c.waiters) w();
  });
  c.send = (msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
  c.until = (pred, ms = 6000, what = "condition") =>
    new Promise((res, rej) => {
      if (pred()) return res();
      const fail = (why) => rej(Object.assign(new Error(`${name}: ${why} ${what}`), { dropped: c.dropped }));
      const t = setTimeout(() => fail("timed out waiting for"), ms);
      c.waiters.push(() => {
        if (pred()) return clearTimeout(t), res(), true;
        if (c.dropped) return clearTimeout(t), fail("socket dropped by the server (dev server reload?) while waiting for"), true;
        return false;
      });
    });
  c.open = new Promise((r, rej) => {
    ws.addEventListener("open", r);
    ws.addEventListener("error", () => rej(new Error(`${name}: socket error`)));
  });
  c.hello = (key = `${id}-secret-key-0001`) => c.send({ t: "hello", name, color: "#4ade80", avatar: "🦊", key });
  c.close = () => {
    c.closing = true;
    return new Promise((r) => (ws.readyState === 3 ? r() : (ws.addEventListener("close", r), ws.close())));
  };
  return c;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const rows = [];

async function runGame(g) {
  const n = Math.min(g.maxPlayers, Math.max(g.minPlayers, 3));
  const room = `e2e-${g.id}-${Math.random().toString(36).slice(2, 7)}`;
  const clients = Array.from({ length: n }, (_, i) => client(room, `${g.id}p${i}`, `P${i}`));
  const label = `${g.emoji} ${g.name} (${n}p)`;
  try {
    await Promise.all(clients.map((c) => c.open));
    for (const c of clients) {
      c.hello();
      await c.until(() => c.room?.players.some((p) => p.id === c.id), 4000, "join");
    }
    const [host] = clients;
    host.send({ t: "pick", gameId: g.id });
    await host.until(() => host.room?.gameId === g.id, 4000, "pick");
    host.send({ t: "start" });
    for (const c of clients) await c.until(() => c.room?.phase === "playing" && c.view !== null, 6000, "game view");
    const seq = host.room.gameSeq;

    // Measure natural traffic for 3s (ticks, timers), after any start countdown.
    await sleep(3500);
    for (const c of clients) c.stats = { game: 0, bytes: 0, maxMsg: 0, ev: 0 };
    await sleep(3000);
    const idle = { ...clients[1].stats };

    // Fuzz: every client throws every junk action, twice.
    for (let round = 0; round < 2; round++) {
      for (const c of clients) for (const a of JUNK) c.send({ t: "act", a });
      await sleep(200);
    }
    // Junk at the room level too.
    host.ws.send("not json");
    host.send({ t: "pick", gameId: "../../etc" });
    host.send({ t: "nope" });

    // Drop and reconnect a non-host player mid-game.
    const victim = clients[n - 1];
    await victim.close();
    await host.until(() => host.room.players.find((p) => p.id === victim.id)?.connected === false, 4000, "disconnect seen");
    const back = client(room, victim.id, `P${n - 1}b`);
    await back.open;
    back.hello();
    await host.until(() => host.room.players.find((p) => p.id === victim.id)?.connected === true, 4000, "reconnect seen");
    await back.until(() => back.view !== null, 4000, "view after reconnect");
    clients[n - 1] = back;

    // Liveness: chat round-trips and the same game is still running.
    const marker = `alive-${g.id}`;
    host.send({ t: "chat", text: marker });
    await clients[1].until(() => clients[1].room?.chat.some((m) => m.text === marker), 4000, "chat round-trip");
    if (host.room.phase !== "playing" || host.room.gameSeq !== seq) throw new Error("game was reset or ended by junk");

    // End and return to lobby.
    host.send({ t: "lobby" });
    await clients[1].until(() => clients[1].room?.phase === "lobby", 4000, "back to lobby");

    return {
      game: label,
      ok: "✓",
      "msgs/s (idle)": (idle.game + idle.ev) / 3,
      "KB/s per client": +(idle.bytes / 3 / 1024).toFixed(1),
      "max msg KB": +(idle.maxMsg / 1024).toFixed(1),
    };
  } catch (e) {
    return { game: label, ok: "✗ " + e.message, dropped: !!e.dropped || clients.some((c) => c.dropped) };
  } finally {
    await Promise.all(clients.map((c) => c.close().catch(() => {})));
  }
}

for (const g of games) {
  let row = await runGame(g);
  // A dev-server reload mid-run isn't the game's fault: wait for the rebuild and try once more.
  if (row.dropped) {
    console.log(`↻ ${g.name}: server dropped the sockets (reload?), retrying once`);
    await sleep(3000);
    row = await runGame(g);
  }
  delete row.dropped;
  if (row.ok !== "✓") failures++;
  rows.push(row);
}

console.table(rows);
console.log(failures ? `✗ ${failures} game(s) failed` : "✓ all games survived the integration run");
// Exit after sockets fully close (exiting mid-close trips a libuv assert on Windows).
setTimeout(() => process.exit(failures ? 1 : 0), 100);

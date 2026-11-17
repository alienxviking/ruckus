// Design review screenshots through the real UI (needs `npm run dev`: Next :3000, PartyKit :1999).
// Landing (desktop + phone), lobby + filters (desktop + phone), profile dialog, a handful
// of games mid-play, and a finished Tic-Tac-Toe match for the result banner (two socket
// bots play it while a browser watches).
//
//   node scripts/design-shots.mjs [outDir] [gameId ...]
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CATALOG } from "../games/catalog.ts";

const OUT = process.argv[2] ?? ".shots/design";
const ids = process.argv.slice(3);
const games = (ids.length ? ids : ["sketch", "trivia", "market", "blitz", "sumo", "doublecross"]).map((id) =>
  CATALOG.find((g) => g.id === id),
);
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PARTY = process.env.PARTY_HOST ?? "localhost:1999";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [];
async function open(name, viewport, mobile = false) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`[${name}] ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/hydrat/i.test(m.text()) && errors.push(`[${name}] ${m.text().slice(0, 200)}`));
  return page;
}
const shot = (page, name, full = false) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: full });
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

try {
  const host = await open("host", { width: 1280, height: 860 });
  await host.goto(BASE);
  await host.waitForTimeout(1600);
  await shot(host, "landing-desktop");
  await shot(host, "landing-desktop-full", true);
  const phoneHome = await open("phone-home", { width: 390, height: 844 }, true);
  await phoneHome.goto(BASE);
  await phoneHome.waitForTimeout(1600);
  await shot(phoneHome, "landing-phone");
  await phoneHome.evaluate(() => document.getElementById("games-heading")?.scrollIntoView());
  await phoneHome.waitForTimeout(500);
  await shot(phoneHome, "landing-phone-games");
  await phoneHome.context().close();

  await host.getByRole("button", { name: "Create a room" }).click();
  await host.waitForURL(/\/r\//);
  const roomUrl = host.url();
  await host.getByLabel("Name").fill("Host");
  await host.getByRole("button", { name: "Let's go" }).click();
  await host.getByRole("heading", { name: "Pick a game" }).waitFor();
  const phone = await open("phone", { width: 390, height: 844 }, true);
  await phone.goto(roomUrl);
  await phone.getByLabel("Name").fill("Phone");
  await phone.getByRole("button", { name: "Let's go" }).click();
  const tablet = await open("tablet", { width: 820, height: 1180 }, true);
  await tablet.goto(roomUrl);
  await tablet.getByLabel("Name").fill("Tablet");
  await tablet.getByRole("button", { name: "Let's go" }).click();
  await host.getByText("Tablet").first().waitFor();
  await host.waitForTimeout(1200);
  await shot(host, "lobby-desktop");
  await host.getByRole("button", { name: /^Board [0-9]/ }).click();
  await host.waitForTimeout(700);
  await shot(host, "lobby-filter-board");
  await host.getByRole("button", { name: /^All [0-9]/ }).click();
  await host.getByRole("button", { name: /Market Maker/ }).first().click();
  await host.waitForTimeout(140);
  await shot(host, "lobby-select-glide");
  await host.waitForTimeout(800);
  await shot(host, "lobby-selected");
  await shot(phone, "lobby-phone");
  await phone.evaluate(() => window.scrollTo(0, 700));
  await phone.waitForTimeout(400);
  await shot(phone, "lobby-phone-grid");

  await host.getByRole("button", { name: "Edit your name and look" }).click();
  await host.waitForTimeout(700);
  await shot(host, "profile-dialog");
  await host.keyboard.press("Escape");
  await host.waitForTimeout(500);

  for (const g of games) {
    const re = new RegExp(esc(g.name));
    await host.getByRole("button", { name: re }).first().click();
    await host.getByRole("heading", { name: re }).first().waitFor();
    await host.getByRole("button", { name: "Start game" }).click();
    await host.getByRole("button", { name: "End game" }).waitFor({ timeout: 10_000 });
    await host.waitForTimeout(2500);
    await shot(host, `game-${g.id}-desktop`);
    await shot(phone, `game-${g.id}-phone`);
    await endGame(host);
    await host.getByRole("heading", { name: "Pick a game" }).waitFor({ timeout: 10_000 });
  }

  // Result banner: two bots finish a Tic-Tac-Toe match while the browser watches.
  const code = "dsg" + Math.random().toString(36).slice(2, 6);
  await fetch(`http://${PARTY}/parties/main/${code}`, { method: "POST" });
  const bot = (id, name) => {
    const ws = new WebSocket(`ws://${PARTY}/parties/main/${code}?_pk=${id}.${Math.random().toString(36).slice(2, 8)}`);
    const c = { id, ws, room: null, view: null };
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.t === "room") c.room = { ...m.room };
      if (m.t === "game") c.view = m.view;
    });
    c.ready = new Promise((r) => ws.addEventListener("open", r)).then(() =>
      ws.send(JSON.stringify({ t: "hello", name, color: "#4ce0ff", avatar: "🦊", key: `${id}-design-key-000001` })),
    );
    c.send = (msg) => ws.send(JSON.stringify(msg));
    return c;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const a = bot("dsgA" + code, "Ada");
  await a.ready;
  await sleep(300);
  const b = bot("dsgB" + code, "Bo");
  await b.ready;
  await sleep(300);
  a.send({ t: "pick", gameId: "tictactoe" });
  await sleep(300);
  a.send({ t: "start" });
  await sleep(500);
  await host.goto(`${BASE}/r/${code.toUpperCase()}`);
  const order = [0, 3, 1, 4, 2, 5, 6, 7, 8];
  for (let i = 0; i < 300 && !a.room?.result; i++) {
    const v = a.view;
    if (v && !v.roundEnd) {
      const actor = v.seats[v.turn] === a.id ? a : b;
      const cell = order.find((k) => v.board[k] === null);
      if (cell !== undefined) actor.send({ t: "act", a: { type: "place", cell } });
    }
    await sleep(150);
  }
  await host.waitForTimeout(250);
  await shot(host, "result-banner-reveal");
  await host.waitForTimeout(1500);
  await shot(host, "result-banner");
  a.ws.close();
  b.ws.close();
} catch (e) {
  errors.push(`FAILED: ${e.message}`);
} finally {
  await browser.close();
}
console.log(errors.length ? errors.join("\n") : "design shots OK");
process.exit(errors.some((e) => e.startsWith("FAILED")) ? 1 : 0);

/** "End game" opens Ruckus's own confirm dialog; confirm it. */
async function endGame(page, timeout = 10_000) {
  await page.getByRole("button", { name: "End game" }).first().click({ timeout });
  await page.getByRole("dialog").getByRole("button", { name: "End game" }).click({ timeout });
}

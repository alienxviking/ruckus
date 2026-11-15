// Browser smoke test through the real room UI (needs `npm run dev`: Next on :3000
// and PartyKit on :1999). Three browser contexts join one room: a desktop host,
// a phone and a tablet. The host starts each game in turn; we screenshot every
// screen, check for console errors / crashed game UIs, end the game, and move on.
// Uses the locally installed Edge (no browser download).
//
//   node scripts/browser-smoke.mjs [outDir] [gameId ...]     (default: every game)
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CATALOG } from "../games/catalog.ts";

const OUT = process.argv[2] ?? ".shots/smoke";
const wanted = process.argv.slice(3);
const games = CATALOG.filter((g) => !wanted.length || wanted.includes(g.id));
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [];
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true, caret: "initial" });

async function player(name, viewport, isMobile = false) {
  const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/hydrat/i.test(m.text())) errors.push(`[${name}] console: ${m.text().slice(0, 300)}`);
  });
  page.on("dialog", (d) => d.accept()); // "End this game for everyone?"
  return page;
}

async function joinRoom(page, url, name) {
  await page.goto(url);
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Let's go" }).click();
}

let failed = false;
try {
  const host = await player("host", { width: 1280, height: 860 });
  await host.goto(BASE);
  await shot(host, "00-home");
  await host.getByRole("button", { name: "Create a room" }).click();
  await host.waitForURL(/\/r\//);
  const roomUrl = host.url();
  await host.getByLabel("Name").fill("Host");
  await host.getByRole("button", { name: "Let's go" }).click();
  await host.getByRole("heading", { name: "Pick a game" }).waitFor();

  const phone = await player("phone", { width: 390, height: 844 }, true);
  await joinRoom(phone, roomUrl, "Phone");
  const tablet = await player("tablet", { width: 820, height: 1180 }, true);
  await joinRoom(tablet, roomUrl, "Tablet");
  await host.getByText("Tablet").first().waitFor();
  await shot(host, "01-lobby-host");
  await shot(phone, "02-lobby-phone");

  for (const [i, g] of games.entries()) {
    const tag = `${String(i + 10).padStart(2, "0")}-${g.id}`;
    const before = errors.length;
    try {
      const nameRe = new RegExp(g.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      await host.getByRole("button", { name: nameRe }).first().click();
      await host.getByRole("heading", { name: nameRe }).first().waitFor();
      await host.getByRole("button", { name: "Start game" }).click();
      await host.getByRole("button", { name: "End game" }).waitFor({ timeout: 10_000 });
      await host.waitForTimeout(2500);
      await shot(host, `${tag}-host`);
      await shot(phone, `${tag}-phone`);
      await shot(tablet, `${tag}-tablet`);
      for (const [who, page] of [["host", host], ["phone", phone], ["tablet", tablet]]) {
        if (await page.getByText("This game hit a snag").count()) {
          errors.push(`[${who}] ${g.id}: game UI crashed (error boundary shown)`);
        }
      }
      await host.getByRole("button", { name: "End game" }).click();
      await host.getByRole("heading", { name: "Pick a game" }).waitFor({ timeout: 10_000 });
      const fresh = errors.slice(before);
      console.log(`${fresh.length ? "✗" : "✓"} ${g.name}${fresh.length ? ` (${fresh.length} errors)` : ""}`);
    } catch (e) {
      errors.push(`${g.id}: ${e.message.split("\n")[0]}`);
      console.log(`✗ ${g.name}: ${e.message.split("\n")[0]}`);
      await shot(host, `${tag}-FAILED-host`).catch(() => {});
      // Try to get back to the lobby for the next game.
      await host.getByRole("button", { name: "End game" }).click({ timeout: 2000 }).catch(() => {});
      await host.getByRole("button", { name: "Pick another" }).click({ timeout: 2000 }).catch(() => {});
    }
  }
} catch (e) {
  failed = true;
  console.error("smoke failed:", e.message.split("\n")[0]);
} finally {
  if (errors.length) {
    failed = true;
    console.log("\nbrowser errors:\n  " + errors.join("\n  "));
  }
  await browser.close();
  console.log(failed ? "\n✗ smoke test found problems" : `\n✓ all ${games.length} games rendered cleanly on 3 devices (screenshots in ${OUT})`);
  process.exitCode = failed ? 1 : 0;
}

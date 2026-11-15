// Drive the dev simulator (/dev/<game>) headlessly and take screenshots.
// Needs `next dev` on localhost:3000 (or BASE_URL). Uses installed Edge.
//
//   node scripts/sim-shot.mjs <gameId> [--n 3] [--width 420] [--out .shots/<gameId>] [--steps steps.json]
//
// steps.json is an array run in order. Supported steps:
//   { "shot": "name" }                                full-page screenshot -> <out>/<NN>-name.png
//   { "act": [0, { "type": "place", "cell": 4 }] }    act as player index 0 via window.__sim
//   { "warp": 5000 }                                  jump the clock forward and tick once
//   { "wait": 500 }                                   real-time wait (ms)
//   { "click": { "player": 1, "role": "button", "name": "Start" } }  click inside a player's frame
//   { "click": { "player": 1, "text": "Paris" } }
//   { "click": { "player": 1, "selector": "canvas", "x": 0.5, "y": 0.5 } }  click at relative point
//   { "fill": { "player": 0, "label": "Guess", "text": "apple", "enter": true } }
//   { "key": { "player": 0, "key": "ArrowUp" } }      focus the frame, then press a key
//   { "key": { "player": 0, "label": "Castle 1", "key": "ArrowUp" } }  press a key in a labelled control
//   { "drag": { "player": 0, "selector": "canvas", "points": [[0.1,0.1],[0.9,0.9]] } }
//   { "disconnect": 2 } / { "reconnect": 2 }
//   { "focus": "p1" } / { "focus": null }              show one viewer / everyone
//   { "eval": "window.__sim.state().phase" }          print the result
//   { "expectNoCrash": true }                          fail if any frame shows "Client crashed"
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const gameId = args[0];
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : args[i + 1];
};
if (!gameId) {
  console.error("usage: node scripts/sim-shot.mjs <gameId> [--n 3] [--width 420] [--out dir] [--steps steps.json]");
  process.exit(2);
}
const n = Number(opt("n", 3));
const width = Number(opt("width", 420));
const out = opt("out", join(".shots", gameId));
const stepsFile = opt("steps", null);
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const steps = stepsFile ? JSON.parse(readFileSync(stepsFile, "utf8")) : [{ shot: "start" }];
const errors = [];
const browser = await chromium.launch({ channel: "msedge", headless: true });
const viewportWidth = Math.max(1280, (width + 24) * Math.min(n + 1, 4) + 64);
const page = await browser.newPage({ viewport: { width: viewportWidth, height: 1000 } });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console.error: ${m.text().slice(0, 500)}`);
});

let shotNo = 0;
const frame = (p) => page.locator(`[data-viewer="${typeof p === "number" ? `p${p}` : p}"]`);
const rel = async (loc, x, y) => {
  const box = await loc.boundingBox();
  if (!box) throw new Error("element not visible");
  return { x: box.x + box.width * x, y: box.y + box.height * y };
};

let failed = false;
try {
  await page.goto(`${BASE}/dev/${gameId}?n=${n}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-sim-ready="1"]', { timeout: 60_000 });
  await page.getByLabel("Frame width").selectOption(String(width));
  await page.waitForTimeout(300);

  for (const step of steps) {
    if ("shot" in step) {
      await page.waitForTimeout(150);
      const file = join(out, `${String(++shotNo).padStart(2, "0")}-${step.shot}.png`);
      await page.screenshot({ path: file, fullPage: true, caret: "initial" });
      console.log("shot", file);
    } else if ("act" in step) {
      await page.evaluate(([who, a]) => window.__sim.act(who, a), step.act);
    } else if ("warp" in step) {
      await page.evaluate((ms) => window.__sim.warp(ms), step.warp);
    } else if ("wait" in step) {
      await page.waitForTimeout(step.wait);
    } else if ("click" in step) {
      const c = step.click;
      const f = frame(c.player ?? 0);
      if (c.selector && c.x !== undefined) {
        const pt = await rel(f.locator(c.selector).first(), c.x, c.y);
        await page.mouse.click(pt.x, pt.y);
      } else if (c.role) await f.getByRole(c.role, c.name ? { name: c.name } : {}).first().click();
      else if (c.text) await f.getByText(c.text, { exact: !!c.exact }).first().click();
      else if (c.selector) await f.locator(c.selector).first().click();
    } else if ("fill" in step) {
      const c = step.fill;
      const f = frame(c.player ?? 0);
      const input = c.label ? f.getByLabel(c.label).first() : f.locator(c.selector ?? "input").first();
      await input.fill(c.text);
      if (c.enter) await input.press("Enter");
    } else if ("key" in step) {
      const c = step.key;
      const f = frame(c.player ?? 0);
      // With a label, focus that control and press the key there (e.g. arrows on a slider).
      if (c.label) await f.getByLabel(c.label).first().press(c.key);
      else {
        await f.click({ position: { x: 5, y: 5 } });
        await page.keyboard.press(c.key);
      }
    } else if ("drag" in step) {
      const c = step.drag;
      // Earlier clicks can leave the page scrolled; drags need their target fully on screen.
      await page.evaluate(() => window.scrollTo(0, 0));
      const target = frame(c.player ?? 0).locator(c.selector).first();
      await target.scrollIntoViewIfNeeded();
      const pts = [];
      for (const [x, y] of c.points) pts.push(await rel(target, x, y));
      await page.mouse.move(pts[0].x, pts[0].y);
      await page.mouse.down();
      for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 8 });
      await page.mouse.up();
    } else if ("disconnect" in step) {
      await page.evaluate((who) => window.__sim.setConnected(who, false), step.disconnect);
    } else if ("reconnect" in step) {
      await page.evaluate((who) => window.__sim.setConnected(who, true), step.reconnect);
    } else if ("focus" in step) {
      await page.getByLabel("Show").selectOption(step.focus ?? "");
    } else if ("eval" in step) {
      const v = await page.evaluate((code) => {
        const r = (0, eval)(code);
        return JSON.stringify(r)?.slice(0, 2000);
      }, step.eval);
      console.log("eval", step.eval, "=>", v);
    } else if ("expectNoCrash" in step) {
      const crashes = await page.locator("[data-sim-crash]").count();
      if (crashes) {
        failed = true;
        console.log("✗ client crashed in", crashes, "frame(s):", await page.locator("[data-sim-crash]").first().innerText());
      }
    }
  }
  const crashes = await page.locator("[data-sim-crash]").count();
  if (crashes) {
    failed = true;
    console.log("✗ client crashed in", crashes, "frame(s):", (await page.locator("[data-sim-crash]").first().innerText()).slice(0, 1500));
  }
  const result = await page.evaluate(() => window.__sim?.result());
  if (result) console.log("result:", JSON.stringify(result));
} catch (e) {
  failed = true;
  console.error("✗ step failed:", e.message.split("\n")[0]);
  await page.screenshot({ path: join(out, "zz-failure.png"), fullPage: true }).catch(() => {});
} finally {
  // Hydration noise from Playwright itself is not a game bug.
  const real = errors.filter((e) => !/hydrat/i.test(e));
  if (real.length) {
    failed = true;
    console.log("browser errors:\n  " + real.join("\n  "));
  }
  await browser.close();
  console.log(failed ? "✗ sim-shot finished with problems" : "✓ sim-shot ok");
  process.exitCode = failed ? 1 : 0;
}

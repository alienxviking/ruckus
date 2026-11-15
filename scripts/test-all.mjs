// Runs every game's unit tests (games/<id>/<id>.test.ts).  node scripts/test-all.mjs
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ids = readdirSync(join(root, "games"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(root, "games", d.name, `${d.name}.test.ts`)))
  .map((d) => d.name);

const failed = [];
for (const id of ids) {
  // Run tsx through node directly (no shell): `node --import tsx file.ts`.
  const r = spawnSync(process.execPath, ["--import", "tsx", `games/${id}/${id}.test.ts`], { cwd: root, encoding: "utf8" });
  const ok = r.status === 0;
  if (!ok) failed.push(id);
  console.log(`${ok ? "✓" : "✗"} ${id}`);
  if (!ok) console.log((r.stdout + r.stderr).split("\n").slice(-15).join("\n"));
}
console.log(failed.length ? `\n✗ failing: ${failed.join(", ")}` : `\n✓ all ${ids.length} game test suites passed`);
process.exitCode = failed.length ? 1 : 0;

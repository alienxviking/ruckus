// One-stop check for a single game: typecheck (just that game + shared code),
// lint its folder, and run its tests. Cheap enough to run many in parallel.
//   node scripts/check-game.mjs <gameId>
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const id = process.argv[2];
if (!id || !existsSync(join(root, "games", id))) {
  console.error("usage: node scripts/check-game.mjs <gameId>");
  process.exit(2);
}

const cacheDir = join(root, "node_modules", ".cache", "ruckus");
mkdirSync(cacheDir, { recursive: true });
const cfgPath = join(cacheDir, `tsconfig.${id}.json`);
const rel = (p) => join("..", "..", "..", p).replace(/\\/g, "/");
writeFileSync(
  cfgPath,
  JSON.stringify(
    {
      extends: rel("tsconfig.json"),
      compilerOptions: { incremental: false, noEmit: true, plugins: [] },
      include: [rel(`games/${id}/**/*`), rel("shared/**/*"), rel("components/game-ui.tsx"), rel("next-env.d.ts")],
    },
    null,
    2,
  ),
);

const run = (label, cmd, args) => {
  process.stdout.write(`\n── ${label} ──\n`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  return r.status === 0;
};

const results = {
  typecheck: run("typecheck", "npx", ["tsc", "-p", cfgPath]),
  lint: run("lint", "npx", ["eslint", "--max-warnings=0", `games/${id}`]),
};
const testFile = `games/${id}/${id}.test.ts`;
results.test = existsSync(join(root, testFile)) ? run("tests", "npx", ["tsx", testFile]) : false;
if (!existsSync(join(root, testFile))) console.log(`(missing ${testFile})`);

console.log("\n" + Object.entries(results).map(([k, ok]) => `${ok ? "✓" : "✗"} ${k}`).join("   "));
process.exit(Object.values(results).every(Boolean) ? 0 : 1);

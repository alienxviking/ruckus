// Initial JS (gzip) of the built landing and room pages: every <script src> in the
// prerendered HTML except the noModule legacy polyfill. Run after `npx next build`.
//
//   node scripts/design-size.mjs
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const pages = { "/": "index.html", "/room": "room.html" };
for (const [route, file] of Object.entries(pages)) {
  const html = readFileSync(join(".next/server/app", file), "utf8");
  const srcs = [...html.matchAll(/<script([^>]*)src="([^"]+)"([^>]*)>/g)]
    .filter((m) => !/noModule/i.test(m[1] + m[3]))
    .map((m) => m[2]);
  let raw = 0;
  let gz = 0;
  for (const src of new Set(srcs)) {
    const buf = readFileSync(join(".next", src.replace(/^\/_next\//, "")));
    raw += buf.length;
    gz += gzipSync(buf, { level: 9 }).length;
  }
  console.log(`${route.padEnd(6)} ${srcs.length} scripts  ${(raw / 1024).toFixed(1)} KB raw  ${(gz / 1024).toFixed(1)} KB gzip`);
}
